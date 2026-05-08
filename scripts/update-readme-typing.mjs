#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const README_PATH = path.resolve(__dirname, '..', 'README.md');
const START_MARKER = '<!-- START:readme-typing -->';
const END_MARKER = '<!-- END:readme-typing -->';

const TEXT = process.env.README_TYPING_TEXT || 'Make it happen.';
const LIGHT_COLOR = process.env.README_TYPING_LIGHT_COLOR || '111827';
const DARK_COLOR = process.env.README_TYPING_DARK_COLOR || 'E5E7EB';
const FONT = process.env.README_TYPING_FONT || 'SF Mono';
const FONT_SIZE = process.env.README_TYPING_FONT_SIZE || '20';
const WIDTH = process.env.README_TYPING_WIDTH || '260';
const HEIGHT = process.env.README_TYPING_HEIGHT || '28';
const DURATION = process.env.README_TYPING_DURATION || '2500';
const PAUSE = process.env.README_TYPING_PAUSE || '1000';

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function buildTypingUrl(color) {
  const url = new URL('https://readme-typing-svg.demolab.com/');
  url.searchParams.set('lines', TEXT);
  url.searchParams.set('font', FONT);
  url.searchParams.set('size', FONT_SIZE);
  url.searchParams.set('width', WIDTH);
  url.searchParams.set('height', HEIGHT);
  url.searchParams.set('duration', DURATION);
  url.searchParams.set('pause', PAUSE);
  url.searchParams.set('repeat', 'false');
  url.searchParams.set('vCenter', 'true');
  url.searchParams.set('background', '00000000');
  url.searchParams.set('color', color);
  return url.toString();
}

function buildMarkup() {
  const darkUrl = escapeXml(buildTypingUrl(DARK_COLOR));
  const lightUrl = escapeXml(buildTypingUrl(LIGHT_COLOR));
  const safeText = escapeXml(TEXT);

  return [
    '<picture>',
    `  <source media="(prefers-color-scheme: dark)" srcset="${darkUrl}" />`,
    `  <img src="${lightUrl}" alt="${safeText}" />`,
    '</picture>',
  ].join('\n');
}

function replaceMarkedSection(content, replacement) {
  const start = content.indexOf(START_MARKER);
  const end = content.indexOf(END_MARKER);

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Could not find readme-typing markers in README.md');
  }

  const before = content.slice(0, start + START_MARKER.length);
  const after = content.slice(end);
  return `${before}\n${replacement}\n${after}`;
}

async function main() {
  const readme = await fs.readFile(README_PATH, 'utf8');
  const updated = replaceMarkedSection(readme, buildMarkup());
  await fs.writeFile(README_PATH, updated, 'utf8');
  console.log(`Updated README typing block with readme-typing-svg: ${TEXT}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
