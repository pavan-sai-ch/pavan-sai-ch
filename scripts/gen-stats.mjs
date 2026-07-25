#!/usr/bin/env node
// Generates assets/stats-{dark,light}.svg from the GitHub GraphQL API.
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
      nodes { stargazerCount }
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

  do {
    const page = await gql(after);
    user ??= page;
    repoCount = page.repositories.totalCount;
    for (const repo of page.repositories.nodes) stars += repo.stargazerCount;
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
  };
}

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const fmt = (n) =>
  n >= 1000
    ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`.replace('.0k', 'k')
    : String(n);

const WIDTH = 860;
const HEIGHT = 150;

function tile({ label, value }, i, count, p) {
  const gutter = 56;
  const span = (WIDTH - gutter * 2) / count;
  const x = gutter + span * i + span / 2;
  return `
    <text x="${x.toFixed(1)}" y="82" fill="${p.value}" font-size="34" font-weight="700" text-anchor="middle" letter-spacing="-0.5">${esc(fmt(value))}</text>
    <text x="${x.toFixed(1)}" y="106" fill="${p.muted}" font-size="12.5" text-anchor="middle" letter-spacing="0.3">${esc(label)}</text>`;
}

function render(s, theme) {
  const p = THEMES[theme];
  const now = new Date().toISOString().slice(0, 10);
  const tiles = [
    { label: 'commits, last year', value: s.commits },
    { label: 'pull requests', value: s.prs },
    { label: 'public repos', value: s.repoCount },
    { label: 'stars earned', value: s.stars },
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="GitHub activity for ${esc(USER)}">
  <defs>
    <linearGradient id="rule" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${p.accent}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="${p.accent}" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <g font-family="'Helvetica Neue', Helvetica, Arial, sans-serif">
    <text x="28" y="34" fill="${p.accent}" font-size="12" font-weight="700" letter-spacing="2.5">GITHUB ACTIVITY</text>
    <line x1="28" y1="46" x2="${WIDTH - 28}" y2="46" stroke="url(#rule)" stroke-width="1.5"/>

    ${tiles.map((t, i) => tile(t, i, tiles.length, p)).join('')}

    <text x="${WIDTH - 28}" y="34" fill="${p.muted}" font-size="10.5" text-anchor="end" opacity="0.7">updated ${now}</text>
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
  `stars=${stats.stars} commits=${stats.commits} prs=${stats.prs} repos=${stats.repoCount} followers=${stats.followers}`,
);
