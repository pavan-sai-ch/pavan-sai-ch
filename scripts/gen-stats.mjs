#!/usr/bin/env node
// Generates assets/stats.svg from the GitHub GraphQL API.
// Requires GITHUB_TOKEN in the environment. Run: node scripts/gen-stats.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const USER = process.env.STATS_USER || 'pavan-sai-ch';
// STATS_TOKEN (a PAT with read:user) also counts private contributions in the
// commit total. The default Actions GITHUB_TOKEN cannot see those.
const TOKEN = process.env.STATS_TOKEN || process.env.GITHUB_TOKEN;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'assets');

if (!TOKEN) {
  console.error('GITHUB_TOKEN is not set');
  process.exit(1);
}

// One file per GitHub theme; the README picks between them with <picture>.
// A single file cannot serve both — cream values vanish on a white background.
const THEMES = {
  dark: {
    accent: '#C2683D',
    value: '#EADFCE',
    muted: '#9A8E80',
    faint: 'rgba(154,142,128,0.22)',
  },
  light: {
    accent: '#A9542D',
    value: '#1F1B16',
    muted: '#6B6259',
    faint: 'rgba(31,27,22,0.14)',
  },
};

// GitHub's own language colours, used as-is on the dark theme.
const LANG_COLORS = {
  TypeScript: '#3178C6',
  JavaScript: '#F1E05A',
  Swift: '#F05138',
  Python: '#3572A5',
  Java: '#B07219',
  'C++': '#F34B7D',
  HTML: '#E34C26',
  CSS: '#563D7C',
  Shell: '#89E051',
  PHP: '#4F5D95',
  Ruby: '#701516',
  Go: '#00ADD8',
  Kotlin: '#A97BFF',
  Dart: '#00B4AB',
  Jupyter: '#DA5B0B',
  'Jupyter Notebook': '#DA5B0B',
};

// Overrides for the light theme, where the stock colour is too pale on white.
const LANG_COLORS_LIGHT = {
  JavaScript: '#B8952B',
  Shell: '#4E8C1D',
  Dart: '#00857E',
  CSS: '#563D7C',
};

const langColor = (name, theme) =>
  (theme === 'light' ? LANG_COLORS_LIGHT[name] : null) ??
  LANG_COLORS[name] ??
  (theme === 'light' ? THEMES.light.accent : THEMES.dark.accent);

const QUERY = `
query($login: String!, $after: String) {
  user(login: $login) {
    followers { totalCount }
    pullRequests { totalCount }
    issues { totalCount }
    contributionsCollection {
      totalCommitContributions
      restrictedContributionsCount
    }
    repositories(
      first: 100
      after: $after
      ownerAffiliations: OWNER
      isFork: false
      privacy: PUBLIC
      orderBy: { field: STARGAZERS, direction: DESC }
    ) {
      pageInfo { hasNextPage endCursor }
      totalCount
      nodes {
        stargazerCount
        primaryLanguage { name }
      }
    }
  }
}`;

async function gql(after) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'pavan-sai-ch-stats',
    },
    body: JSON.stringify({ query: QUERY, variables: { login: USER, after } }),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data.user;
}

async function collect() {
  let after = null;
  let user = null;
  let stars = 0;
  let repoCount = 0;
  // Counted by primary language per repo, not by bytes: byte-size ranking is
  // dominated by generated/embedded content (notebook outputs, vendored CSS).
  const langRepos = new Map();

  do {
    const page = await gql(after);
    user ??= page;
    repoCount = page.repositories.totalCount;
    for (const repo of page.repositories.nodes) {
      stars += repo.stargazerCount;
      const name = repo.primaryLanguage?.name;
      if (name) langRepos.set(name, (langRepos.get(name) ?? 0) + 1);
    }
    after = page.repositories.pageInfo.hasNextPage
      ? page.repositories.pageInfo.endCursor
      : null;
  } while (after);

  const c = user.contributionsCollection;
  return {
    stars,
    repoCount,
    followers: user.followers.totalCount,
    prs: user.pullRequests.totalCount,
    issues: user.issues.totalCount,
    commits: c.totalCommitContributions + c.restrictedContributionsCount,
    langs: [...langRepos.entries()].sort((a, b) => b[1] - a[1]),
  };
}

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const fmt = (n) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`.replace('.0k', 'k') : String(n);

function statRow(label, value, y, p) {
  return `
    <text x="0" y="${y}" fill="${p.muted}" font-size="14">${esc(label)}</text>
    <text x="250" y="${y}" fill="${p.value}" font-size="16" font-weight="700" text-anchor="end">${esc(fmt(value))}</text>
    <line x1="0" y1="${y + 12}" x2="250" y2="${y + 12}" stroke="${p.faint}" stroke-width="1"/>`;
}

function langBar(langs, width, theme, p) {
  const top = langs.slice(0, 6);
  const total = top.reduce((sum, [, size]) => sum + size, 0) || 1;
  let x = 0;
  const segments = top
    .map(([name, size], i) => {
      const w = Math.max((size / total) * width, 2);
      const rect = `<rect x="${x.toFixed(1)}" y="0" width="${w.toFixed(1)}" height="10" rx="${i === 0 || i === top.length - 1 ? 5 : 0}" fill="${langColor(name, theme)}"/>`;
      x += w;
      return rect;
    })
    .join('\n      ');

  const legend = top
    .map(([name, size], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const lx = col * 165;
      const ly = 40 + row * 26;
      const pct = ((size / total) * 100).toFixed(1);
      const label = name.length > 13 ? `${name.slice(0, 12)}…` : name;
      return `
      <circle cx="${lx + 5}" cy="${ly - 4}" r="5" fill="${langColor(name, theme)}"/>
      <text x="${lx + 18}" y="${ly}" fill="${p.muted}" font-size="13">${esc(label)}</text>
      <text x="${lx + 150}" y="${ly}" fill="${p.value}" font-size="13" text-anchor="end">${pct}%</text>`;
    })
    .join('');

  return `${segments}${legend}`;
}

function render(s, theme) {
  const p = THEMES[theme];
  const now = new Date().toISOString().slice(0, 10);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="860" height="260" viewBox="0 0 860 260" role="img" aria-label="GitHub statistics for ${esc(USER)}">
  <defs>
    <linearGradient id="divider" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${p.accent}" stop-opacity="0"/>
      <stop offset="50%" stop-color="${p.accent}" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="${p.accent}" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <g font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">
    <g transform="translate(28, 40)">
      <text x="0" y="0" fill="${p.accent}" font-size="12" font-weight="700" letter-spacing="2.5">ACTIVITY</text>
      ${statRow('Total stars earned', s.stars, 38, p)}
      ${statRow('Commits (last year)', s.commits, 76, p)}
      ${statRow('Pull requests', s.prs, 114, p)}
      ${statRow('Issues opened', s.issues, 152, p)}
      ${statRow('Public repositories', s.repoCount, 190, p)}
    </g>

    <line x1="430" y1="30" x2="430" y2="230" stroke="url(#divider)" stroke-width="1.5"/>

    <g transform="translate(470, 40)">
      <text x="0" y="0" fill="${p.accent}" font-size="12" font-weight="700" letter-spacing="2.5">TOP LANGUAGES BY REPO</text>
      <g transform="translate(0, 22)">
        ${langBar(s.langs, 320, theme, p)}
      </g>
    </g>

    <text x="832" y="240" fill="${p.muted}" font-size="10.5" text-anchor="end" opacity="0.7">updated ${now}</text>
  </g>
</svg>
`;
}

const stats = await collect();
mkdirSync(OUT_DIR, { recursive: true });
for (const theme of Object.keys(THEMES)) {
  const file = resolve(OUT_DIR, `stats-${theme}.svg`);
  writeFileSync(file, render(stats, theme));
  console.log(`wrote ${file}`);
}
console.log(
  `stars=${stats.stars} commits=${stats.commits} prs=${stats.prs} issues=${stats.issues} repos=${stats.repoCount} langs=${stats.langs.length}`,
);
