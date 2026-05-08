#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PERSONAL_TOKEN = process.env.PERSONAL_GH_TOKEN || '';
const TOKEN = PERSONAL_TOKEN || process.env.GITHUB_TOKEN || '';
const USERNAME = process.env.GITHUB_USERNAME || process.env.GITHUB_REPOSITORY_OWNER || process.env.GITHUB_ACTOR;
const LANG_ACTIVE_MONTHS = Number(process.env.LANG_ACTIVE_MONTHS || 12);
const MAX_SKILL_ICONS = Number(process.env.MAX_SKILL_ICONS || 6);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const README_PATH = path.resolve(__dirname, '..', 'README.md');
const START_MARKER = '<!-- START:recent-stack -->';
const END_MARKER = '<!-- END:recent-stack -->';

const languageToSkillIcon = {
  TypeScript: 'ts',
  JavaScript: 'js',
  HTML: 'html',
  CSS: 'css',
  Python: 'python',
  Go: 'go',
  Rust: 'rust',
  Java: 'java',
  'C++': 'cpp',
  C: 'c',
  'C#': 'cs',
  PHP: 'php',
  Ruby: 'ruby',
  Kotlin: 'kotlin',
  Swift: 'swift',
  Dart: 'dart',
  Shell: 'bash',
  Vue: 'vue',
  Svelte: 'svelte',
  Elixir: 'elixir',
  Lua: 'lua',
  Scala: 'scala',
  Haskell: 'haskell',
  R: 'r',
  OCaml: 'ocaml',
  Zig: 'zig',
};

if (!USERNAME) {
  console.error('Missing username: set GITHUB_USERNAME or rely on GitHub Actions context');
  process.exit(1);
}

function createHeaders({ includeAuth = true, extra = {} } = {}) {
  const headers = {
    'User-Agent': 'orchard-readme-stack',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...extra,
  };

  if (includeAuth && TOKEN) {
    headers.Authorization = `Bearer ${TOKEN}`;
  }

  return headers;
}

async function githubFetch(url, options = {}) {
  const res = await fetch(url, { headers: createHeaders(options) });

  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`GitHub API ${res.status}: ${msg}`);
  }

  return res.json();
}

async function listRepos() {
  const repos = [];
  let page = 1;

  while (true) {
    const authenticatedUrl = `https://api.github.com/user/repos?per_page=100&page=${page}&affiliation=owner&visibility=all&sort=updated`;
    const publicUrl = `https://api.github.com/users/${encodeURIComponent(USERNAME)}/repos?per_page=100&page=${page}&type=owner&sort=updated`;
    let data;

    if (PERSONAL_TOKEN) {
      data = await githubFetch(authenticatedUrl);
    } else {
      data = await githubFetch(publicUrl, { includeAuth: false });
    }
    const ownedRepos = data.filter(repo => !repo.fork);
    repos.push(...ownedRepos);

    if (data.length < 100) {
      break;
    }

    page += 1;
  }

  return repos;
}

function getCutoffDate() {
  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - LANG_ACTIVE_MONTHS);
  return cutoff;
}

function filterActiveRepos(repos) {
  const cutoff = getCutoffDate();
  return repos.filter(repo => repo.pushed_at && new Date(repo.pushed_at) >= cutoff);
}

async function getLanguageTotals(repos) {
  const totals = new Map();

  for (const repo of repos) {
    const languages = await githubFetch(repo.languages_url);

    for (const [language, bytes] of Object.entries(languages)) {
      totals.set(language, (totals.get(language) || 0) + bytes);
    }
  }

  return totals;
}

function toSortedLanguages(totals) {
  return Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
}

function pickSkillIcons(sortedLanguages) {
  const icons = [];
  const labels = [];

  for (const [language] of sortedLanguages) {
    const icon = languageToSkillIcon[language];

    if (!icon || icons.includes(icon)) {
      continue;
    }

    icons.push(icon);
    labels.push(language);

    if (icons.length >= MAX_SKILL_ICONS) {
      break;
    }
  }

  return { icons, labels };
}

function buildStackMarkup(icons, labels) {
  const iconQuery = icons.join(',');
  const alt = `Recent top languages: ${labels.join(', ')}`;

  return [
    '<p>',
    '  <a href="https://skillicons.dev">',
    `    <img src="https://skillicons.dev/icons?i=${iconQuery}" alt="${alt}" />`,
    '  </a>',
    '</p>',
  ].join('\n');
}

function replaceMarkedSection(content, replacement) {
  const start = content.indexOf(START_MARKER);
  const end = content.indexOf(END_MARKER);

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Could not find recent-stack markers in README.md');
  }

  const before = content.slice(0, start + START_MARKER.length);
  const after = content.slice(end);
  return `${before}\n${replacement}\n${after}`;
}

async function updateReadme() {
  const repos = await listRepos();
  const activeRepos = filterActiveRepos(repos);
  const targetRepos = activeRepos.length > 0 ? activeRepos : repos;
  const totals = await getLanguageTotals(targetRepos);
  const sortedLanguages = toSortedLanguages(totals);
  const { icons, labels } = pickSkillIcons(sortedLanguages);

  if (icons.length === 0) {
    throw new Error('No supported languages found for skill-icons output');
  }

  const readme = await fs.readFile(README_PATH, 'utf8');
  const replacement = buildStackMarkup(icons, labels);
  const updated = replaceMarkedSection(readme, replacement);

  await fs.writeFile(README_PATH, updated, 'utf8');
  console.log(`Updated README recent stack for ${USERNAME}: ${labels.join(', ')}`);
}

updateReadme().catch(error => {
  console.error(error);
  process.exit(1);
});
