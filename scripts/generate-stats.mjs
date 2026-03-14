#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const TOKEN = process.env.PERSONAL_GH_TOKEN || process.env.GITHUB_TOKEN;
const USERNAME = process.env.GITHUB_USERNAME || process.env.GITHUB_REPOSITORY_OWNER || process.env.GITHUB_ACTOR;

if (!TOKEN) {
  console.error('Missing token: set PERSONAL_GH_TOKEN (preferred) or GITHUB_TOKEN');
  process.exit(1);
}

if (!USERNAME) {
  console.error('Missing username: set GITHUB_USERNAME or rely on GitHub Actions context');
  process.exit(1);
}

const WEEK_COUNT = 12;
const WIDTH = 467;

const themePalette = {
  light: {
    text: '#1f2328',
    subText: '#4b5563',
    bg: '#ffffff',
    border: '#d0d7de',
    commit: '#0969da',
    commitArea: 'rgba(9,105,218,0.15)',
    pr: '#c25100',
    prArea: 'rgba(194,81,0,0.18)',
    ringBg: '#f3f4f6',
  },
  dark: {
    text: '#c9d1d9',
    subText: '#9ca3af',
    bg: '#0d1117',
    border: '#30363d',
    commit: '#58a6ff',
    commitArea: 'rgba(88,166,255,0.18)',
    pr: '#f0883e',
    prArea: 'rgba(240,136,62,0.20)',
    ringBg: '#161b22',
  },
};

async function githubFetch(url, headers = {}) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'User-Agent': 'orchard-profile-cards',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...headers,
    },
  });

  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`GitHub API ${res.status}: ${msg}`);
  }
  return res.json();
}

function weekRanges(count = WEEK_COUNT) {
  const ranges = [];
  const now = new Date();
  // align to start of current week (Monday UTC)
  const day = now.getUTCDay();
  const diffToMonday = (day + 6) % 7; // 0 if Monday
  const startOfWeek = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diffToMonday));

  for (let i = count - 1; i >= 0; i--) {
    const start = new Date(startOfWeek);
    start.setUTCDate(start.getUTCDate() - i * 7);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    ranges.push({ start, end });
  }
  return ranges;
}

function formatDate(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function searchCount(query, endpoint = 'issues', accept = 'application/vnd.github+json') {
  const url = `https://api.github.com/search/${endpoint}?q=${encodeURIComponent(query)}&per_page=1`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'User-Agent': 'orchard-profile-cards',
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Search API ${endpoint} failed: ${res.status} ${msg}`);
  }
  const data = await res.json();
  return data.total_count || 0;
}

async function getWeeklyActivity(username) {
  const ranges = weekRanges(WEEK_COUNT);
  const commits = [];
  const prs = [];

  for (const range of ranges) {
    const start = formatDate(range.start);
    const end = formatDate(range.end);
    const prQ = `is:pr author:${username} created:${start}..${end}`;
    const commitQ = `author:${username} committer-date:${start}..${end}`;
    const [prCount, commitCount] = await Promise.all([
      searchCount(prQ, 'issues'),
      searchCount(commitQ, 'commits', 'application/vnd.github.cloak-preview+json'),
    ]);
    prs.push(prCount);
    commits.push(commitCount);
  }

  return { ranges, commits, prs };
}

async function listRepos() {
  const repos = [];
  let page = 1;
  while (true) {
    const url = `https://api.github.com/user/repos?per_page=100&page=${page}&affiliation=owner&visibility=all&sort=updated`;
    const data = await githubFetch(url);
    repos.push(...data.filter(r => !r.fork));
    if (data.length < 100) break;
    page += 1;
  }
  return repos;
}

async function getLanguages(username) {
  const repos = await listRepos(username);
  const totals = new Map();
  for (const repo of repos) {
    const langs = await githubFetch(repo.languages_url);
    for (const [lang, bytes] of Object.entries(langs)) {
      totals.set(lang, (totals.get(lang) || 0) + bytes);
    }
  }
  const entries = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
  const totalBytes = entries.reduce((sum, [, v]) => sum + v, 0) || 1;
  const top3 = entries.slice(0, 3).map(([name, bytes]) => ({ name, bytes, pct: (bytes / totalBytes) * 100 }));
  const othersBytes = entries.slice(3).reduce((sum, [, v]) => sum + v, 0);
  if (othersBytes > 0) {
    top3.push({ name: 'Others', bytes: othersBytes, pct: (othersBytes / totalBytes) * 100 });
  }
  return top3;
}

function linePath(values, xScale, yScale) {
  return values
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(v)}`)
    .join(' ');
}

function areaPath(values, xScale, yScale, baseY) {
  const parts = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(v)}`);
  const lastX = xScale(values.length - 1);
  const firstX = xScale(0);
  parts.push(`L ${lastX} ${baseY} L ${firstX} ${baseY} Z`);
  return parts.join(' ');
}

function renderActivity({ commits, prs, ranges, theme }) {
  const palette = themePalette[theme];
  const height = 230;
  const margin = { top: 22, right: 16, bottom: 42, left: 56 };
  const innerWidth = WIDTH - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const maxVal = Math.max(1, ...commits, ...prs);
  const baseY = margin.top + innerHeight;
  const xScale = i => margin.left + (i / Math.max(1, commits.length - 1)) * innerWidth;
  const yScale = v => baseY - (v / maxVal) * innerHeight;

  const tickIndexes = ranges.map((_, i) => i).filter(i => i % 2 === 0 || i === ranges.length - 1);
  const labels = ranges.map(r => formatDate(r.start).slice(5));
  const commitSum = commits.reduce((a, b) => a + b, 0);
  const prSum = prs.reduce((a, b) => a + b, 0);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="titleId descId">
  <title id="titleId">${USERNAME}'s GitHub Activity (last 12 weeks)</title>
  <desc id="descId">Weekly commits and pull requests for the last 12 weeks. Commits total ${commitSum}. Pull requests total ${prSum}.</desc>
  <rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${height - 1}" rx="12" fill="${palette.bg}" stroke="${palette.border}" />
  <g transform="translate(${margin.left - 6}, ${margin.top})" font-family="'Segoe UI', Ubuntu, Sans-Serif">
    <text x="0" y="0" fill="${palette.text}" font-size="16" font-weight="700">Activity (last 12 weeks)</text>
  </g>
  <g transform="translate(${WIDTH - margin.right - 4}, ${margin.top})" font-family="'Segoe UI', Ubuntu, Sans-Serif" text-anchor="end" fill="${palette.subText}" font-size="12">
    <text x="0" y="0">Commits: ${commitSum}</text>
    <text x="0" y="16">PRs: ${prSum}</text>
  </g>
  <g>
    <path d="${areaPath(commits, xScale, yScale, baseY)}" fill="${palette.commitArea}" />
    <path d="${linePath(commits, xScale, yScale)}" stroke="${palette.commit}" stroke-width="2.2" fill="none" />
    <path d="${areaPath(prs, xScale, yScale, baseY)}" fill="${palette.prArea}" />
    <path d="${linePath(prs, xScale, yScale)}" stroke="${palette.pr}" stroke-width="2.2" fill="none" />
  </g>
  <g stroke="${palette.border}" stroke-width="1" stroke-dasharray="2 4" opacity="0.7">
    <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${baseY}" />
    <line x1="${margin.left}" y1="${baseY}" x2="${WIDTH - margin.right}" y2="${baseY}" />
  </g>
  <g font-family="'Segoe UI', Ubuntu, Sans-Serif" fill="${palette.subText}" font-size="11" text-anchor="middle">
    ${tickIndexes.map(i => `<text x="${xScale(i)}" y="${height - 14}">${labels[i]}</text>`).join('\n    ')}
  </g>
  <g font-family="'Segoe UI', Ubuntu, Sans-Serif" fill="${palette.subText}" font-size="12">
    <g transform="translate(${margin.left}, ${margin.top + 6})">
      <rect x="0" y="0" width="12" height="3" rx="1.5" fill="${palette.commit}" />
      <text x="18" y="6" dominant-baseline="middle">Commits</text>
    </g>
    <g transform="translate(${margin.left + 90}, ${margin.top + 6})">
      <rect x="0" y="0" width="12" height="3" rx="1.5" fill="${palette.pr}" />
      <text x="18" y="6" dominant-baseline="middle">PRs</text>
    </g>
  </g>
</svg>`;
}

// GitHub language colors fallback map (common ones). Extend as needed.
const languageColors = {
  JavaScript: '#f1e05a',
  TypeScript: '#3178c6',
  Python: '#3572a5',
  Go: '#00ADD8',
  Rust: '#dea584',
  Java: '#b07219',
  Ruby: '#701516',
  PHP: '#4F5D95',
  C: '#555555',
  'C++': '#f34b7d',
  'C#': '#178600',
  HTML: '#e34c26',
  CSS: '#563d7c',
  Shell: '#89e051',
  Swift: '#ffac45',
  Kotlin: '#A97BFF',
  Dart: '#00B4AB',
  Elixir: '#6e4a7e',
  Vue: '#41b883',
  Svelte: '#ff3e00',
  Other: '#9ca3af',
};

function polarToCartesian(cx, cy, r, angle) {
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

function arcPath(cx, cy, r, startAngle, endAngle) {
  const [sx, sy] = polarToCartesian(cx, cy, r, startAngle);
  const [ex, ey] = polarToCartesian(cx, cy, r, endAngle);
  const largeArc = endAngle - startAngle <= Math.PI ? 0 : 1;
  return `M ${sx} ${sy} A ${r} ${r} 0 ${largeArc} 1 ${ex} ${ey}`;
}

function renderLanguages({ languages, theme }) {
  const palette = themePalette[theme];
  const height = 200;
  const cx = 150;
  const cy = 110;
  const outerR = 62;
  const innerR = 36;
  const items = languages.map(lang => ({ ...lang, pct: Math.round(lang.pct) })).filter(l => l.pct > 0);
  const totalPct = items.reduce((s, l) => s + l.pct, 0);
  const adjusted = items.map((l, i) => (i === items.length - 1 ? { ...l, pct: l.pct + (100 - totalPct) } : l));

  let angle = -Math.PI / 2;
  const slices = adjusted.map((lang, idx) => {
    const delta = (lang.pct / 100) * Math.PI * 2;
    const start = angle;
    const end = angle + delta;
    angle = end;
    const color = languageColors[lang.name] || languageColors.Other;
    const pathArc = arcPath(cx, cy, outerR, start, end);
    const [ix, iy] = polarToCartesian(cx, cy, innerR, end);
    const [ox, oy] = polarToCartesian(cx, cy, outerR, start);
    const largeArc = delta <= Math.PI ? 0 : 1;
    const d = `M ${polarToCartesian(cx, cy, outerR, start).join(' ')} A ${outerR} ${outerR} 0 ${largeArc} 1 ${polarToCartesian(cx, cy, outerR, end).join(' ')} L ${polarToCartesian(cx, cy, innerR, end).join(' ')} A ${innerR} ${innerR} 0 ${largeArc} 0 ${polarToCartesian(cx, cy, innerR, start).join(' ')} Z`;
    return { d, color, lang };
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="titleLang descLang">
  <title id="titleLang">${USERNAME}'s Top Languages (past year)</title>
  <desc id="descLang">Top languages by bytes over the past year. ${adjusted
    .map(l => `${l.name} ${l.pct}%`)
    .join(', ')}.</desc>
  <rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${height - 1}" rx="12" fill="${palette.bg}" stroke="${palette.border}" />
  <g transform="translate(18, 26)" font-family="'Segoe UI', Ubuntu, Sans-Serif" fill="${palette.text}">
    <text x="0" y="0" font-size="16" font-weight="700">Languages (Top 3, past year)</text>
  </g>
  <g>
    <circle cx="${cx}" cy="${cy}" r="${outerR}" fill="${palette.ringBg}" />
    ${slices.map(s => `<path d="${s.d}" fill="${s.color}" />`).join('\n    ')}
    <circle cx="${cx}" cy="${cy}" r="${innerR}" fill="${palette.bg}" />
    <text x="${cx}" y="${cy - 4}" text-anchor="middle" font-family="'Segoe UI', Ubuntu, Sans-Serif" font-size="13" font-weight="700" fill="${palette.text}">${adjusted[0]?.name || 'N/A'}</text>
    <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-family="'Segoe UI', Ubuntu, Sans-Serif" font-size="12" fill="${palette.subText}">${adjusted[0]?.pct ?? 0}%</text>
  </g>
  <g font-family="'Segoe UI', Ubuntu, Sans-Serif" font-size="13" fill="${palette.text}" transform="translate(240, 70)">
    ${adjusted
      .map((lang, i) => {
        const color = languageColors[lang.name] || languageColors.Other;
        return `<g transform="translate(0, ${i * 26})">
  <rect x="0" y="-10" width="12" height="12" rx="2" fill="${color}" />
  <text x="18" y="0" dominant-baseline="middle">${lang.name} — ${Math.max(0, Math.min(100, Math.round(lang.pct)))}%</text>
</g>`;
      })
      .join('\n    ')}
  </g>
</svg>`;
}

async function main() {
  console.log(`Generating cards for ${USERNAME}...`);
  const [{ ranges, commits, prs }, languages] = await Promise.all([
    getWeeklyActivity(USERNAME),
    getLanguages(USERNAME),
  ]);

  const activityLight = renderActivity({ commits, prs, ranges, theme: 'light' });
  const activityDark = renderActivity({ commits, prs, ranges, theme: 'dark' });
  const langsLight = renderLanguages({ languages, theme: 'light' });
  const langsDark = renderLanguages({ languages, theme: 'dark' });

  const outDir = path.join(process.cwd(), 'profile');
  await fs.mkdir(outDir, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(outDir, 'activity.svg'), activityLight, 'utf8'),
    fs.writeFile(path.join(outDir, 'activity-dark.svg'), activityDark, 'utf8'),
    fs.writeFile(path.join(outDir, 'langs.svg'), langsLight, 'utf8'),
    fs.writeFile(path.join(outDir, 'langs-dark.svg'), langsDark, 'utf8'),
  ]);
  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
