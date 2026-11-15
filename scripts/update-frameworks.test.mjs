import assert from 'node:assert/strict';
import test from 'node:test';
import { activeProjectDirectories, detectFrameworks, fallbackLayout, fallbackSvg, rankFrameworks } from './update-frameworks.mjs';

test('recognizes frontend and backend JavaScript frameworks without parent duplicates', () => {
  assert.deepEqual(detectFrameworks('package.json', JSON.stringify({ dependencies: {
    next: '1', react: '1', nuxt: '1', vue: '1', '@nestjs/core': '1', fastify: '1',
  } })), ['Next.js', 'Nuxt', 'NestJS', 'Fastify']);
});

test('recognizes direct dependencies in non-JavaScript manifests', () => {
  const cases = [
    ['pyproject.toml', '[project]\ndependencies = ["fastapi>=0.1", "django>=4"]', ['Django', 'FastAPI']],
    ['pyproject.toml', '[project]\ndescription = "A Django migration guide"\ndependencies = ["flask>=3"]', ['Flask']],
    ['requirements.txt', 'Flask==3\n# django==5', ['Flask']],
    ['pom.xml', '<dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>', ['Spring Boot']],
    ['go.mod', 'require (\n github.com/gin-gonic/gin v1.0.0\n github.com/labstack/echo/v4 v4.0.0 // indirect\n)', ['Gin']],
    ['Cargo.toml', '[build-dependencies]\ntauri-build = "2"\n[dependencies]\naxum = "0.8"\nactix-web = "4"\ntauri = "2"', ['Actix Web', 'Axum', 'Tauri']],
    ['composer.json', '{"require":{"laravel/framework":"^12"}}', ['Laravel']],
    ['Gemfile', 'gem "rails", "~> 8"', ['Rails']],
    ['app.csproj', '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>', ['ASP.NET Core']],
    ['mix.exs', '{:phoenix, "~> 1.7"}', ['Phoenix']],
    ['pubspec.yaml', 'dependencies:\n  flutter:\n    sdk: flutter', ['Flutter']],
  ];
  for (const [filename, content, expected] of cases) assert.deepEqual(detectFrameworks(filename, content), expected, filename);
  assert.deepEqual(detectFrameworks('Cargo.toml', '[build-dependencies]\ntauri-build = "2"'), []);
});

test('attributes changed files to the closest manifest in a monorepo', () => {
  const dirs = activeProjectDirectories(
    ['apps/web/src/page.tsx', 'apps/api/main.py', 'docs/README.md', 'apps/web/package-lock.json'],
    ['package.json', 'apps/web/package.json', 'apps/api/pyproject.toml', 'apps/unused/package.json'],
  );
  assert.deepEqual([...dirs].sort(), ['apps/api', 'apps/web']);
});

test('limits the ranked result to eight frameworks', () => {
  const score = new Map(Array.from({ length: 10 }, (_, index) => [`Framework ${index}`, 10 - index]));
  assert.deepEqual(rankFrameworks(score, 12), Array.from({ length: 8 }, (_, index) => `Framework ${index}`));
});

test('keeps fallback icons square and lays out long names on two lines', () => {
  assert.deepEqual(fallbackLayout('Hono').lines, ['Hono']);
  assert.deepEqual(fallbackLayout('SvelteKit').lines, ['Svelte', 'Kit']);
  assert.deepEqual(fallbackLayout('Starlette').lines, ['Star', 'lette']);
  assert.deepEqual(fallbackLayout('ASP.NET Core').lines, ['ASP.NET', 'Core']);
  const svg = fallbackSvg({ name: 'ASP.NET Core' }, 'dark');
  assert.match(svg, /width="40" height="40"/);
  assert.match(svg, /<text[^>]*>ASP\.NET<\/text><text[^>]*>Core<\/text>/);
});
