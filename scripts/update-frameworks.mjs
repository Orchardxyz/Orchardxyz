#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authoredBy, mergedForkContributions } from './merged-fork-contributions.mjs';

const TOKEN = process.env.PERSONAL_GH_TOKEN || process.env.GITHUB_TOKEN || '';
const USERNAME = process.env.GITHUB_USERNAME || process.env.GITHUB_REPOSITORY_OWNER || process.env.GITHUB_ACTOR || '';
const AUTHORING = process.env.FRAMEWORK_AUTHORING || USERNAME;
const DAYS = Number(process.env.FRAMEWORK_DAYS || 365);
const LIMIT = Math.min(8, Number(process.env.FRAMEWORK_LIMIT || 8));
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const README = path.join(ROOT, 'README.md');
const ASSETS = path.join(ROOT, 'assets');
const START = '<!-- START:frameworks -->';
const END = '<!-- END:frameworks -->';

// Package names are explicit direct dependency signals, rather than lockfile matches.
export const FRAMEWORKS = [
  { name: 'Next.js', icon: 'nextjs', js: ['next'], supersedes: ['React'] },
  { name: 'Nuxt', icon: 'nuxtjs', js: ['nuxt'], supersedes: ['Vue'] },
  { name: 'SvelteKit', js: ['@sveltejs/kit'], supersedes: ['Svelte'] },
  { name: 'React', icon: 'react', js: ['react'] },
  { name: 'Vue', icon: 'vue', js: ['vue'] },
  { name: 'Angular', icon: 'angular', js: ['@angular/core'] },
  { name: 'Svelte', icon: 'svelte', js: ['svelte'] },
  { name: 'Astro', icon: 'astro', js: ['astro'] },
  { name: 'Remix', icon: 'remix', js: ['@remix-run/react', '@remix-run/node'] },
  { name: 'Gatsby', icon: 'gatsby', js: ['gatsby'] },
  { name: 'Solid', icon: 'solidjs', js: ['solid-js'] },
  { name: 'Express', icon: 'express', js: ['express'] },
  { name: 'NestJS', icon: 'nestjs', js: ['@nestjs/core'] },
  { name: 'Fastify', js: ['fastify'] },
  { name: 'Hono', js: ['hono'] },
  { name: 'Koa', js: ['koa'] },
  { name: 'Elysia', icon: 'elysia', js: ['elysia'] },
  { name: 'Django', icon: 'django', python: ['django'] },
  { name: 'Flask', icon: 'flask', python: ['flask'] },
  { name: 'FastAPI', icon: 'fastapi', python: ['fastapi'] },
  { name: 'Starlette', python: ['starlette'] },
  { name: 'Spring Boot', icon: 'spring', java: ['spring-boot-starter', 'spring-boot-gradle-plugin', 'spring-boot-starter-parent'] },
  { name: 'Quarkus', java: ['io.quarkus', 'quarkus-'] },
  { name: 'Micronaut', java: ['io.micronaut', 'micronaut-'] },
  { name: 'Ktor', icon: 'ktor', java: ['io.ktor', 'ktor-'] },
  { name: 'Gin', go: ['github.com/gin-gonic/gin'] },
  { name: 'Fiber', go: ['github.com/gofiber/fiber'] },
  { name: 'Echo', go: ['github.com/labstack/echo'] },
  { name: 'Chi', go: ['github.com/go-chi/chi'] },
  { name: 'Actix Web', icon: 'actix', rust: ['actix-web'] },
  { name: 'Axum', rust: ['axum'] },
  { name: 'Rocket', icon: 'rocket', rust: ['rocket'] },
  { name: 'Tauri', icon: 'tauri', rust: ['tauri'] },
  { name: 'Laravel', icon: 'laravel', php: ['laravel/framework'] },
  { name: 'Symfony', icon: 'symfony', php: ['symfony/framework-bundle'] },
  { name: 'Rails', icon: 'rails', ruby: ['rails'] },
  { name: 'Sinatra', ruby: ['sinatra'] },
  { name: 'ASP.NET Core', dotnet: ['microsoft.net.sdk.web', 'microsoft.aspnetcore.app'] },
  { name: 'Blazor', dotnet: ['microsoft.net.sdk.blazorwebassembly', 'microsoft.aspnetcore.components.webassembly'] },
  { name: 'Phoenix', elixir: ['phoenix'] },
  { name: 'Flutter', icon: 'flutter', dart: ['flutter'] },
];

const MANIFEST = /(^|\/)(package\.json|pyproject\.toml|Pipfile|requirements[^/]*\.txt|pom\.xml|build\.gradle(?:\.kts)?|go\.mod|Cargo\.toml|composer\.json|Gemfile|[^/]+\.csproj|mix\.exs|pubspec\.yaml)$/;
const IGNORED = /(^|\/)(node_modules|vendor|target|dist|build|\.next|\.nuxt|\.git)(\/|$)/;

function escapeXml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function manifestKind(filename) {
  const base = path.posix.basename(filename);
  if (base === 'package.json') return 'js';
  if (base === 'pyproject.toml' || base === 'Pipfile' || /^requirements.*\.txt$/.test(base)) return 'python';
  if (base === 'pom.xml' || /^build\.gradle(\.kts)?$/.test(base)) return 'java';
  if (base === 'go.mod') return 'go';
  if (base === 'Cargo.toml') return 'rust';
  if (base === 'composer.json') return 'php';
  if (base === 'Gemfile') return 'ruby';
  if (base.endsWith('.csproj')) return 'dotnet';
  if (base === 'mix.exs') return 'elixir';
  if (base === 'pubspec.yaml') return 'dart';
  return null;
}

function structuredNames(kind, filename, content) {
  if (kind === 'js' || kind === 'php') {
    const data = JSON.parse(content);
    const fields = kind === 'js' ? ['dependencies', 'devDependencies'] : ['require', 'require-dev'];
    return fields.flatMap(field => Object.keys(data[field] || {})).map(name => name.toLowerCase());
  }
  if (kind === 'go') {
    return content.split('\n').filter(line => !line.includes('// indirect')).flatMap(line => {
      const match = line.match(/^\s*(github\.com\/[\w.-]+\/[\w.-]+(?:\/v\d+)?)\s+v\d/);
      return match ? [match[1].replace(/\/v\d+$/, '').toLowerCase()] : [];
    });
  }
  if (kind === 'rust') {
    let section = '';
    const names = [];
    for (const line of content.split('\n')) {
      const header = line.match(/^\s*\[([^\]]+)\]/);
      if (header) section = header[1];
      if (!/(^|\.)dependencies$/.test(section)) continue;
      const entry = line.match(/^\s*([\w-]+)\s*=/);
      if (entry) names.push(entry[1].toLowerCase());
    }
    return names;
  }
  if (kind === 'ruby') return [...content.matchAll(/^\s*gem\s+['"]([^'"]+)['"]/gm)].map(match => match[1].toLowerCase());
  if (kind === 'python') {
    if (path.posix.basename(filename).startsWith('requirements')) {
      return content.split('\n').map(line => line.trim().match(/^([\w.-]+)(?:\s|[<=>!~;\[]|$)/)?.[1]?.toLowerCase()).filter(Boolean);
    }
    let section = '';
    let inArray = false;
    const names = [];
    for (const line of content.split('\n')) {
      const header = line.match(/^\s*\[([^\]]+)\]/);
      if (header) { section = header[1].toLowerCase(); inArray = false; }
      if (/^\s*#/.test(line)) continue;
      if (section === 'project' || section === 'project.optional-dependencies' || section === 'dependency-groups') {
        if (/^\s*(dependencies|[\w-]+)\s*=\s*\[/.test(line) && (section !== 'project' || /^\s*dependencies\s*=/.test(line))) inArray = true;
        if (inArray) for (const match of line.matchAll(/['"]([a-zA-Z][\w.-]*)[^'"]*['"]/g)) names.push(match[1].toLowerCase());
        if (line.includes(']')) inArray = false;
      } else if (section === 'tool.poetry.dependencies' || section.startsWith('tool.poetry.group.') && section.endsWith('.dependencies') || section === 'packages' || section === 'dev-packages') {
        const key = line.match(/^\s*['"]?([\w.-]+)['"]?\s*=/);
        if (key) names.push(key[1].toLowerCase());
      }
    }
    return names;
  }
  if (kind === 'java') {
    return FRAMEWORKS.flatMap(item => (item.java || []).filter(name => content.toLowerCase().includes(name)));
  }
  if (kind === 'dotnet') {
    return FRAMEWORKS.flatMap(item => (item.dotnet || []).filter(name => content.toLowerCase().includes(name)));
  }
  if (kind === 'elixir') return [...content.matchAll(/\{\s*:([\w]+)\s*,/g)].map(match => match[1].toLowerCase());
  if (kind === 'dart') return /^\s*flutter\s*:/m.test(content) ? ['flutter'] : [];
  return [];
}

export function detectFrameworks(filename, content) {
  const kind = manifestKind(filename);
  if (!kind) return [];
  const names = structuredNames(kind, filename, content);
  const found = FRAMEWORKS.filter(item => (item[kind] || []).some(signal => names.some(name => name === signal || (kind === 'java' && name.startsWith(signal)) || (kind === 'go' && name.startsWith(`${signal}/`)))));
  const superseded = new Set(found.flatMap(item => item.supersedes || []));
  return found.filter(item => !superseded.has(item.name)).map(item => item.name);
}

export function activeProjectDirectories(changedFiles, manifestPaths) {
  const dirs = [...new Set(manifestPaths.map(file => path.posix.dirname(file)))];
  return new Set(changedFiles.filter(file => !IGNORED.test(file) && !/(^|\/)(README[^/]*|[^/]+\.md|[^/]+\.lock|[^/]+\.sum)$/.test(file)).map(file => {
    const matching = dirs.filter(dir => dir === '.' || file.startsWith(`${dir}/`));
    return matching.sort((a, b) => b.length - a.length)[0];
  }).filter(Boolean));
}

async function githubJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${TOKEN}`, 'User-Agent': 'orchard-frameworks' } });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
  return response.json();
}

async function paged(url) {
  const all = [];
  for (let page = 1; ; page++) {
    const u = new URL(url);
    u.searchParams.set('per_page', '100');
    u.searchParams.set('page', String(page));
    const items = await githubJson(u);
    all.push(...items);
    if (items.length < 100) return all;
  }
}

function matchesAuthor(commit, authors) {
  return [commit.author?.login, commit.commit?.author?.name, commit.commit?.author?.email, commit.committer?.login]
    .filter(Boolean).some(value => authors.has(String(value).toLowerCase()));
}

async function repoActivity(repo, since, authors) {
  const commits = await paged(`https://api.github.com/repos/${repo.full_name}/commits?sha=${encodeURIComponent(repo.default_branch)}&since=${encodeURIComponent(since)}`);
  const own = commits.filter(commit => matchesAuthor(commit, authors));
  const changed = new Set();
  for (let i = 0; i < own.length; i += 8) {
    const details = await Promise.all(own.slice(i, i + 8).map(commit => githubJson(`https://api.github.com/repos/${repo.full_name}/commits/${commit.sha}`)));
    for (const detail of details) for (const file of detail.files || []) changed.add(file.filename);
  }
  return { own, changed: [...changed] };
}

async function repoManifests(repo) {
  const branch = await githubJson(`https://api.github.com/repos/${repo.full_name}/branches/${encodeURIComponent(repo.default_branch)}`);
  const sha = branch.commit.commit.tree.sha;
  const tree = await githubJson(`https://api.github.com/repos/${repo.full_name}/git/trees/${sha}?recursive=1`);
  if (tree.truncated) throw new Error(`Truncated tree for ${repo.full_name}`);
  return tree.tree.filter(entry => entry.type === 'blob' && MANIFEST.test(entry.path) && !IGNORED.test(entry.path));
}

async function blobText(repo, sha) {
  const blob = await githubJson(`https://api.github.com/repos/${repo.full_name}/git/blobs/${sha}`);
  if (blob.encoding !== 'base64') throw new Error(`Unsupported blob encoding in ${repo.full_name}`);
  return Buffer.from(blob.content.replace(/\s/g, ''), 'base64').toString('utf8');
}

function glyphWidth(text) {
  return [...text].reduce((sum, char) => sum + (/[ilI1.,]/.test(char) ? 0.31 : /[MW@]/.test(char) ? 0.85 : /[A-Z]/.test(char) ? 0.67 : /\s/.test(char) ? 0.3 : 0.56), 0);
}

export function fallbackLayout(name) {
  const preferredBreaks = { Micronaut: ['Micro', 'naut'], Starlette: ['Star', 'lette'] };
  const parts = name.replace(/([a-z])([A-Z])/g, '$1 $2').split(/\s+/).filter(Boolean);
  let lines = preferredBreaks[name] || [name];
  if (!preferredBreaks[name] && name.length > 7) {
    if (parts.length > 1) {
      const candidates = parts.slice(1).map((_, index) => [parts.slice(0, index + 1).join(' '), parts.slice(index + 1).join(' ')]);
      lines = candidates.sort((a, b) => Math.max(...a.map(glyphWidth)) - Math.max(...b.map(glyphWidth)))[0];
    } else {
      const split = Math.ceil(name.length / 2);
      lines = [name.slice(0, split), name.slice(split)];
    }
  }
  const widest = Math.max(...lines.map(glyphWidth));
  const fontSize = Math.max(8, Math.min(lines.length === 1 ? 12 : 10, Math.floor((34 / widest) * 2) / 2));
  return { lines, fontSize };
}

export function fallbackSvg(item, theme) {
  const dark = theme === 'dark';
  const { lines, fontSize } = fallbackLayout(item.name);
  const text = lines.map((line, index) => `<text x="20" y="${lines.length === 1 ? 24 : 17 + index * 12}" text-anchor="middle" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="600" fill="${dark ? '#f0f6fc' : '#24292f'}">${escapeXml(line)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40" role="img" aria-label="${escapeXml(item.name)}"><title>${escapeXml(item.name)}</title><rect x="1" y="1" width="38" height="38" rx="8" fill="${dark ? '#24292f' : '#f6f8fa'}" stroke="${dark ? '#57606a' : '#d0d7de'}"/>${text}</svg>\n`;
}

function frameworkMarkup(names) {
  if (!names.length) return '<sub>No framework activity found in the last 365 days.</sub>';
  return ['<p>', ...names.map(name => {
    const item = FRAMEWORKS.find(entry => entry.name === name);
    const src = item.icon ? `https://skillicons.dev/icons?i=${item.icon}&amp;theme=` : `./assets/framework-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-`;
    return `  <picture><source media="(prefers-color-scheme: dark)" srcset="${src}dark${item.icon ? '' : '.svg'}" /><img src="${src}light${item.icon ? '' : '.svg'}" alt="${escapeXml(name)}" title="${escapeXml(name)}" width="40" height="40" /></picture>`;
  }), '</p>'].join('\n');
}

function replaceBlock(readme, markup) {
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start < 0 || end < start) throw new Error('Missing frameworks markers in README.md');
  return `${readme.slice(0, start + START.length)}\n${markup}\n${readme.slice(end)}`;
}

export function rankFrameworks(score, limit = LIMIT) {
  return [...score].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, Math.min(8, limit)).map(([name]) => name);
}

async function scoreActiveProjects(repo, changed, projectName, projectScores) {
  const manifests = await repoManifests(repo);
  const activeDirs = activeProjectDirectories(changed, manifests.map(item => item.path));
  for (const dir of activeDirs) {
    const found = new Set();
    for (const manifest of manifests.filter(item => path.posix.dirname(item.path) === dir)) {
      try {
        for (const name of detectFrameworks(manifest.path, await blobText(repo, manifest.sha))) found.add(name);
      } catch (error) {
        console.warn(`Skipping ${repo.full_name}/${manifest.path}: ${error.message}`);
      }
    }
    const projectKey = `${projectName.toLowerCase()}:${dir}`;
    for (const name of found) {
      if (!projectScores.has(name)) projectScores.set(name, new Set());
      projectScores.get(name).add(projectKey);
    }
  }
}

async function main() {
  if (!TOKEN || !USERNAME) throw new Error('Set PERSONAL_GH_TOKEN (or GITHUB_TOKEN) and GITHUB_USERNAME');
  if (!Number.isInteger(DAYS) || DAYS < 1 || !Number.isInteger(LIMIT) || LIMIT < 1) throw new Error('Invalid framework window or limit');
  const authors = new Set(AUTHORING.split(',').map(value => value.trim().toLowerCase()).filter(Boolean));
  const since = new Date(Date.now() - DAYS * 86400000).toISOString();
  const repos = (await paged('https://api.github.com/user/repos?affiliation=owner&visibility=all&sort=updated'))
    .filter(repo => !repo.fork && repo.size > 0 && repo.default_branch && repo.pushed_at >= since);
  const projectScores = new Map();
  for (const repo of repos) {
    const activity = await repoActivity(repo, since, authors);
    if (!activity.own.length) continue;
    console.log(`Scanning ${repo.full_name}: ${activity.own.length} authored commits`);
    await scoreActiveProjects(repo, activity.changed, repo.full_name, projectScores);
  }

  const mergedForkCommits = await mergedForkContributions({
    githubFetch: githubJson,
    username: USERNAME,
    since,
    matchesAuthor: commit => authoredBy(commit, authors),
  });
  const upstream = new Map();
  for (const contribution of mergedForkCommits) {
    const name = contribution.repo.full_name;
    if (!upstream.has(name)) upstream.set(name, { repo: contribution.repo, changed: new Set() });
    for (const file of contribution.files) upstream.get(name).changed.add(file.filename);
  }
  for (const { repo, changed } of upstream.values()) {
    console.log(`Scanning merged fork contributions in ${repo.full_name}`);
    await scoreActiveProjects(repo, [...changed], repo.full_name, projectScores);
  }

  const score = new Map([...projectScores].map(([name, projects]) => [name, projects.size]));
  const names = rankFrameworks(score);
  for (const file of await fs.readdir(ASSETS)) {
    if (/^framework-.*-(light|dark)\.svg$/.test(file)) await fs.unlink(path.join(ASSETS, file));
  }
  for (const name of names) {
    const item = FRAMEWORKS.find(entry => entry.name === name);
    if (item.icon) continue;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    for (const theme of ['light', 'dark']) await fs.writeFile(path.join(ASSETS, `framework-${slug}-${theme}.svg`), fallbackSvg(item, theme));
  }
  const readme = await fs.readFile(README, 'utf8');
  await fs.writeFile(README, replaceBlock(readme, frameworkMarkup(names)));
  console.log(`Updated frameworks for ${USERNAME}: ${names.join(', ') || 'none'}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
