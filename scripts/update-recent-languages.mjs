#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PERSONAL_TOKEN = process.env.PERSONAL_GH_TOKEN || '';
const TOKEN = PERSONAL_TOKEN || process.env.GITHUB_TOKEN || '';
const USERNAME = process.env.GITHUB_USERNAME || process.env.GITHUB_REPOSITORY_OWNER || process.env.GITHUB_ACTOR;
const RECENT_LANG_DAYS = Number(process.env.RECENT_LANG_DAYS || 60);
const RECENT_LANG_LIMIT = Number(process.env.RECENT_LANG_LIMIT || 6);
const RECENT_LANG_MIN_PERCENT = Number(process.env.RECENT_LANG_MIN_PERCENT || 0.1);
const RECENT_LANG_BAR_CELLS = Number(process.env.RECENT_LANG_BAR_CELLS || 24);
const RECENT_LANG_AUTHORING = process.env.RECENT_LANG_AUTHORING || USERNAME || '';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const README_PATH = path.resolve(__dirname, '..', 'README.md');
const OUTPUT_LIGHT_PATH = path.resolve(__dirname, '..', 'assets', 'recent-languages-light.svg');
const OUTPUT_DARK_PATH = path.resolve(__dirname, '..', 'assets', 'recent-languages-dark.svg');
const START_MARKER = '<!-- START:recent-languages -->';
const END_MARKER = '<!-- END:recent-languages -->';
const USER_AGENT = 'orchard-recent-languages';
const BAR_X = 0;
const BAR_Y = 6;
const BAR_HEIGHT = 16;
const BAR_RADIUS = 3;
const CELL_WIDTH = 21;
const LABEL_FONT_SIZE = 12;
const LABEL_LINE_HEIGHT = 15;
const LABEL_TOP_GAP = 11;
const LABEL_BOTTOM_PADDING = 2;
const MONO_GLYPH_WIDTH = LABEL_FONT_SIZE * 0.62;
const LABEL_WIDTH_SAFETY_PADDING = 12;

const extensionToLanguage = new Map([
  ['.ts', 'TypeScript'],
  ['.tsx', 'TypeScript'],
  ['.mts', 'TypeScript'],
  ['.cts', 'TypeScript'],
  ['.js', 'JavaScript'],
  ['.jsx', 'JavaScript'],
  ['.mjs', 'JavaScript'],
  ['.cjs', 'JavaScript'],
  ['.py', 'Python'],
  ['.css', 'CSS'],
  ['.scss', 'CSS'],
  ['.sass', 'CSS'],
  ['.less', 'CSS'],
  ['.html', 'HTML'],
  ['.htm', 'HTML'],
  ['.vue', 'Vue'],
  ['.rs', 'Rust'],
  ['.go', 'Go'],
  ['.swift', 'Swift'],
  ['.sh', 'Shell'],
  ['.bash', 'Shell'],
  ['.zsh', 'Shell'],
]);

const themes = {
  light: {
    track: '#e5e7eb',
    trackStroke: '#d1d5db',
    segment: '#4b5563',
    cutout: '#f9fafb',
    legend: '#24292f',
    percent: '#6e7781',
    separator: '#8b949e',
    empty: '#6b7280',
  },
  dark: {
    track: '#30363d',
    trackStroke: '#3f444c',
    segment: '#8b949e',
    cutout: '#161b22',
    legend: '#e6edf3',
    percent: '#9da7b3',
    separator: '#6e7681',
    empty: '#9ca3af',
  },
};

const segmentStyles = [
  { kind: 'solid', opacity: 0.96 },
  { kind: 'diagonal', opacity: 0.9 },
  { kind: 'dots', opacity: 0.84 },
  { kind: 'grid', opacity: 0.78 },
  { kind: 'vertical', opacity: 0.72 },
  { kind: 'checker', opacity: 0.68 },
];

const BAR_WIDTH = RECENT_LANG_BAR_CELLS * CELL_WIDTH;
const SVG_WIDTH = Math.ceil(Math.max(BAR_WIDTH, estimateMaxSingleLineLabelWidth()));

if (!USERNAME) {
  console.error('Missing username: set GITHUB_USERNAME or rely on GitHub Actions context');
  process.exit(1);
}

if (!TOKEN) {
  console.error('Missing token: set PERSONAL_GH_TOKEN or GITHUB_TOKEN');
  process.exit(1);
}

/**
 * Escapes XML-sensitive characters before inserting text into SVG markup.
 */
function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/**
 * Builds the authenticated GitHub API headers used by all requests.
 */
function createHeaders() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': USER_AGENT,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/**
 * Fetches JSON from the GitHub REST API and throws on non-2xx responses.
 */
async function githubFetch(url) {
  const res = await fetch(url, { headers: createHeaders() });

  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`GitHub API ${res.status}: ${msg}`);
  }

  return res.json();
}

/**
 * Returns the ISO timestamp used as the lower bound for recent activity.
 */
function getCutoffIsoDate() {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - RECENT_LANG_DAYS);
  return cutoff.toISOString();
}

/**
 * Normalizes the configured author identifiers into a lowercase lookup set.
 */
function parseAuthoringIdentifiers(value) {
  return new Set(
    value
      .split(',')
      .map(entry => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Checks whether a commit belongs to the configured author identities.
 */
function commitMatchesAuthoring(commit, authoringIdentifiers) {
  const candidates = [
    commit.author?.login,
    commit.commit?.author?.name,
    commit.commit?.author?.email,
    commit.committer?.login,
    commit.commit?.committer?.name,
    commit.commit?.committer?.email,
  ]
    .filter(Boolean)
    .map(value => String(value).toLowerCase());

  return candidates.some(candidate => authoringIdentifiers.has(candidate));
}

/**
 * Lists owned, non-fork repositories sorted by recent update time.
 */
async function listRepos() {
  const repos = [];
  let page = 1;

  while (true) {
    const url = new URL(`https://api.github.com/user/repos?per_page=100&page=${page}&affiliation=owner&visibility=all&sort=updated`);
    const data = await githubFetch(url.toString());
    repos.push(...data.filter(repo => !repo.fork));

    if (data.length < 100) {
      break;
    }

    page += 1;
  }

  return repos;
}

/**
 * Narrows repositories to those updated inside the recent activity window.
 */
function filterRecentRepos(repos) {
  const cutoff = new Date(getCutoffIsoDate());
  return repos
    .filter((repo) => {
      if (!repo.pushed_at || new Date(repo.pushed_at) < cutoff) {
        return false;
      }

      if (repo.size === 0) {
        return false;
      }

      return typeof repo.default_branch === 'string' && repo.default_branch.trim().length > 0;
    });
}

/**
 * Collects recent commits authored by the configured identities for one repo.
 */
async function listMatchingCommits(repo, cutoffIso, authoringIdentifiers, seenCommits, collected) {
  let page = 1;

  while (true) {
    const url = new URL(`https://api.github.com/repos/${repo.full_name}/commits`);
    url.searchParams.set('sha', repo.default_branch);
    url.searchParams.set('since', cutoffIso);
    url.searchParams.set('per_page', '100');
    url.searchParams.set('page', String(page));

    const commits = await githubFetch(url.toString());

    if (commits.length === 0) {
      break;
    }

    for (const commit of commits) {
      if (!commitMatchesAuthoring(commit, authoringIdentifiers)) {
        continue;
      }

      if (seenCommits.has(commit.sha)) {
        continue;
      }

      seenCommits.add(commit.sha);
      collected.push({
        repo: repo.full_name,
        sha: commit.sha,
      });
    }

    if (commits.length < 100) {
      break;
    }

    page += 1;
  }
}

/**
 * Maps a changed filename to the language bucket used in the recent chart.
 */
function languageFromFilename(filename) {
  const basename = path.basename(filename);

  if (basename === 'Dockerfile') {
    return null;
  }

  const ext = path.extname(filename).toLowerCase();
  return extensionToLanguage.get(ext) || null;
}

/**
 * Builds weighted language totals from recent authored commit file changes.
 */
async function collectLanguageTotals() {
  const repos = filterRecentRepos(await listRepos());
  const authoringIdentifiers = parseAuthoringIdentifiers(RECENT_LANG_AUTHORING);
  const seenCommits = new Set();
  const matchingCommits = [];
  const cutoffIso = getCutoffIsoDate();

  for (const repo of repos) {
    await listMatchingCommits(repo, cutoffIso, authoringIdentifiers, seenCommits, matchingCommits);
  }

  const totals = new Map();

  for (const commitRef of matchingCommits) {
    const detail = await githubFetch(`https://api.github.com/repos/${commitRef.repo}/commits/${commitRef.sha}`);

    for (const file of detail.files || []) {
      const language = languageFromFilename(file.filename);

      if (!language) {
        continue;
      }

      const weight = Math.max(file.changes || 0, file.additions || 0, file.deletions || 0, 1);
      totals.set(language, (totals.get(language) || 0) + weight);
    }
  }

  return {
    matchingCommitCount: matchingCommits.length,
    totals,
  };
}

/**
 * Orders languages by activity weight, drops tiny slices, and limits visible entries.
 */
function sortLanguages(totals) {
  const sorted = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((sum, [, value]) => sum + value, 0);

  if (total <= 0) {
    return [];
  }

  return sorted
    .filter(([, value]) => ((value / total) * 100) >= RECENT_LANG_MIN_PERCENT)
    .slice(0, RECENT_LANG_LIMIT);
}

/**
 * Converts weighted language shares into a fixed number of bar cells.
 */
function allocateBarCells(items) {
  const total = items.reduce((sum, [, value]) => sum + value, 0);

  if (total <= 0) {
    return [];
  }

  const base = items.map(() => 1);
  let remaining = RECENT_LANG_BAR_CELLS - items.length;

  if (remaining < 0) {
    remaining = 0;
  }

  const raw = items.map(([, value]) => (value / total) * remaining);
  const floors = raw.map(Math.floor);
  let used = floors.reduce((sum, value) => sum + value, 0);

  const order = raw
    .map((value, index) => ({ index, remainder: value - floors[index] }))
    .sort((a, b) => b.remainder - a.remainder);

  const cells = base.map((value, index) => value + floors[index]);
  let cursor = 0;

  while (used < remaining) {
    cells[order[cursor % order.length].index] += 1;
    used += 1;
    cursor += 1;
  }

  return cells;
}

/**
 * Formats a weighted share as a single decimal percentage string.
 */
function formatPercent(value, total) {
  return `${((value / total) * 100).toFixed(1)}%`;
}

/**
 * Formats the recent-language summary for accessibility text and logs.
 */
function buildSummaryText(items) {
  const total = items.reduce((sum, [, value]) => sum + value, 0);
  return items
    .map(([language, value]) => `${language} ${formatPercent(value, total)}`)
    .join(' • ');
}

/**
 * Estimates monospace text width closely enough for SVG line wrapping.
 */
function measureMonospaceText(text) {
  return text.length * MONO_GLYPH_WIDTH;
}

/**
 * Estimates the widest single-line label we can produce from the language mapping.
 */
function estimateMaxSingleLineLabelWidth() {
  const separatorWidth = measureMonospaceText(' • ');
  const tokens = Array.from(new Set(extensionToLanguage.values()))
    .map(language => `${language} 100.0%`)
    .sort((a, b) => measureMonospaceText(b) - measureMonospaceText(a))
    .slice(0, RECENT_LANG_LIMIT);

  if (tokens.length === 0) {
    return BAR_WIDTH;
  }

  const contentWidth = tokens.reduce((sum, token) => sum + measureMonospaceText(token), 0);
  const separatorsWidth = separatorWidth * Math.max(tokens.length - 1, 0);
  return contentWidth + separatorsWidth + LABEL_WIDTH_SAFETY_PADDING;
}

/**
 * Converts recent-language items into preformatted label tokens.
 */
function buildLabelTokens(items) {
  const total = items.reduce((sum, [, value]) => sum + value, 0);
  return items.map(([language, value]) => {
    const percent = formatPercent(value, total);
    return {
      language,
      percent,
      text: `${language} ${percent}`,
    };
  });
}

/**
 * Wraps language tokens into one or more SVG text lines within the bar width.
 */
function wrapLabelLines(tokens, maxWidth) {
  const separatorWidth = measureMonospaceText(' • ');
  const lines = [];
  let currentLine = [];
  let currentWidth = 0;

  for (const token of tokens) {
    const tokenWidth = measureMonospaceText(token.text);
    const nextWidth = currentLine.length === 0
      ? tokenWidth
      : currentWidth + separatorWidth + tokenWidth;

    if (currentLine.length > 0 && nextWidth > maxWidth) {
      lines.push(currentLine);
      currentLine = [token];
      currentWidth = tokenWidth;
      continue;
    }

    currentLine.push(token);
    currentWidth = nextWidth;
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines;
}

/**
 * Defines the reusable SVG patterns used to distinguish each bar segment.
 */
function buildPatternDefs(theme) {
  return [
    `<pattern id="pattern-diagonal" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(28)">`,
    `  <rect width="8" height="8" fill="${theme.segment}" fill-opacity="${segmentStyles[1].opacity}" />`,
    `  <rect x="0" y="0" width="2" height="8" fill="${theme.cutout}" fill-opacity="0.92" />`,
    `</pattern>`,
    `<pattern id="pattern-dots" width="8" height="8" patternUnits="userSpaceOnUse">`,
    `  <rect width="8" height="8" fill="${theme.segment}" fill-opacity="${segmentStyles[2].opacity}" />`,
    `  <circle cx="2" cy="2" r="1.15" fill="${theme.cutout}" fill-opacity="0.96" />`,
    `  <circle cx="6" cy="6" r="1.15" fill="${theme.cutout}" fill-opacity="0.96" />`,
    `</pattern>`,
    `<pattern id="pattern-grid" width="8" height="8" patternUnits="userSpaceOnUse">`,
    `  <rect width="8" height="8" fill="${theme.segment}" fill-opacity="${segmentStyles[3].opacity}" />`,
    `  <path d="M0 4H8M4 0V8" stroke="${theme.cutout}" stroke-opacity="0.96" stroke-width="1.2" />`,
    `</pattern>`,
    `<pattern id="pattern-vertical" width="8" height="8" patternUnits="userSpaceOnUse">`,
    `  <rect width="8" height="8" fill="${theme.segment}" fill-opacity="${segmentStyles[4].opacity}" />`,
    `  <rect x="1" y="0" width="1.5" height="8" fill="${theme.cutout}" fill-opacity="0.92" />`,
    `  <rect x="5.5" y="0" width="1.5" height="8" fill="${theme.cutout}" fill-opacity="0.92" />`,
    `</pattern>`,
    `<pattern id="pattern-checker" width="8" height="8" patternUnits="userSpaceOnUse">`,
    `  <rect width="8" height="8" fill="${theme.segment}" fill-opacity="${segmentStyles[5].opacity}" />`,
    `  <rect x="0" y="0" width="4" height="4" fill="${theme.cutout}" fill-opacity="0.9" />`,
    `  <rect x="4" y="4" width="4" height="4" fill="${theme.cutout}" fill-opacity="0.9" />`,
    `</pattern>`,
  ].join('\n  ');
}

/**
 * Renders the textured horizontal activity bar from the allocated cells.
 */
function buildBar(items, cells, theme) {
  const segments = [
    `<rect x="${BAR_X}" y="${BAR_Y}" width="${BAR_WIDTH}" height="${BAR_HEIGHT}" rx="${BAR_RADIUS}" fill="${theme.track}" />`,
    `<rect x="${BAR_X}" y="${BAR_Y}" width="${BAR_WIDTH}" height="${BAR_HEIGHT}" rx="${BAR_RADIUS}" fill="none" stroke="${theme.trackStroke}" stroke-width="1" />`,
  ];
  let x = BAR_X;

  for (let index = 0; index < items.length; index += 1) {
    const width = cells[index] * CELL_WIDTH;
    const style = segmentStyles[index] || segmentStyles[segmentStyles.length - 1];
    const fill =
      style.kind === 'solid'
        ? `${theme.segment}`
        : `url(#pattern-${style.kind})`;
    const fillOpacity = style.kind === 'solid' ? style.opacity : 1;

    segments.push(
      `<rect x="${x}" y="${BAR_Y}" width="${width}" height="${BAR_HEIGHT}" fill="${fill}" fill-opacity="${fillOpacity}" />`,
    );
    x += width;
  }

  return segments.join('\n  ');
}

/**
 * Builds SVG text lines for the recent-language label beneath the bar.
 */
function buildLabelLines(items, theme) {
  const tokens = buildLabelTokens(items);
  const lines = wrapLabelLines(tokens, SVG_WIDTH);
  const labelTop = BAR_Y + BAR_HEIGHT + LABEL_TOP_GAP;
  const textLines = lines.map((line, index) => {
    const y = labelTop + (index * LABEL_LINE_HEIGHT);
    const parts = [];

    line.forEach((token, tokenIndex) => {
      if (tokenIndex > 0) {
        parts.push('<tspan class="separator"> • </tspan>');
      }

      parts.push(`<tspan class="label">${escapeXml(token.language)} </tspan>`);
      parts.push(`<tspan class="percent">${escapeXml(token.percent)}</tspan>`);
    });

    return `  <text x="${BAR_X}" y="${y}" class="label-line" dominant-baseline="hanging" xml:space="preserve">${parts.join('')}</text>`;
  });

  const height = labelTop + (lines.length * LABEL_LINE_HEIGHT) + LABEL_BOTTOM_PADDING;

  return {
    height,
    style: [
      '  <style>',
      `    .label-line { font: 500 ${LABEL_FONT_SIZE}px "SFMono-Regular", "SF Mono", ui-monospace, Menlo, Monaco, Consolas, "Liberation Mono", monospace; letter-spacing: 0; }`,
      `    .label { fill: ${theme.legend}; }`,
      `    .percent { fill: ${theme.percent}; }`,
      `    .separator { fill: ${theme.separator}; }`,
      '  </style>',
    ].join('\n'),
    markup: textLines.join('\n'),
  };
}

/**
 * Creates the neutral fallback SVG shown when no recent activity is found.
 */
function buildEmptySvg(theme) {
  return [
    `<svg width="${SVG_WIDTH}" height="28" viewBox="0 0 ${SVG_WIDTH} 28" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">`,
    '  <title id="title">Recent languages</title>',
    `  <desc id="desc">No recent language activity found in the last ${RECENT_LANG_DAYS} days.</desc>`,
    '  <style>',
    `    .empty { fill: ${theme.empty}; font: 500 13px "SFMono-Regular", "SF Mono", ui-monospace, Menlo, Monaco, Consolas, "Liberation Mono", monospace; }`,
    '  </style>',
    `  <text class="empty" x="0" y="18">No recent language activity in the last ${RECENT_LANG_DAYS} days.</text>`,
    '</svg>',
  ].join('\n');
}

/**
 * Builds one themed SVG variant for the recent languages module.
 */
function buildSvg(items, theme) {
  if (items.length === 0) {
    return buildEmptySvg(theme);
  }

  const cells = allocateBarCells(items);
  const languagesDesc = buildSummaryText(items).replaceAll(' • ', ', ');
  const label = buildLabelLines(items, theme);

  return [
    `<svg width="${SVG_WIDTH}" height="${label.height}" viewBox="0 0 ${SVG_WIDTH} ${label.height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">`,
    '  <title id="title">Recent languages</title>',
    `  <desc id="desc">Recently used languages over the last ${RECENT_LANG_DAYS} days: ${escapeXml(languagesDesc)}.</desc>`,
    '  <defs>',
    `  ${buildPatternDefs(theme)}`,
    '  </defs>',
    label.style,
    `  ${buildBar(items, cells, theme)}`,
    label.markup,
    '</svg>',
  ].join('\n');
}

/**
 * Replaces the recent-languages block in README with generated markup.
 */
function replaceMarkedSection(content, replacement) {
  const start = content.indexOf(START_MARKER);
  const end = content.indexOf(END_MARKER);

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Could not find recent-languages markers in README.md');
  }

  const before = content.slice(0, start + START_MARKER.length);
  const after = content.slice(end);
  return `${before}\n${replacement}\n${after}`;
}

/**
 * Builds the HTML block inserted under the Recent languages heading in README.
 */
function buildRecentLanguagesMarkup(items) {
  return [
    '<picture>',
    '  <source media="(prefers-color-scheme: dark)" srcset="./assets/recent-languages-dark.svg" />',
    `  <img src="./assets/recent-languages-light.svg" alt="Recently used languages" width="${SVG_WIDTH}" align="top" />`,
    '</picture>',
  ].join('\n');
}

/**
 * Generates both light and dark SVG outputs from the current recent totals.
 */
async function main() {
  const { matchingCommitCount, totals } = await collectLanguageTotals();
  const sorted = sortLanguages(totals);
  const lightSvg = buildSvg(sorted, themes.light);
  const darkSvg = buildSvg(sorted, themes.dark);
  const readme = await fs.readFile(README_PATH, 'utf8');
  const updatedReadme = replaceMarkedSection(readme, buildRecentLanguagesMarkup(sorted));

  await fs.writeFile(OUTPUT_LIGHT_PATH, lightSvg, 'utf8');
  await fs.writeFile(OUTPUT_DARK_PATH, darkSvg, 'utf8');
  await fs.writeFile(README_PATH, updatedReadme, 'utf8');

  const label = sorted.length > 0 ? sorted.map(([language]) => language).join(', ') : 'none';
  console.log(`Updated recent languages SVGs for ${USERNAME}: ${label} (${matchingCommitCount} commits scanned)`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
