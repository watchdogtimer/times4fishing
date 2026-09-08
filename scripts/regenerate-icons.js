/**
 * Rasterise the PNG favicons from the SVGs.
 *
 * `icons/<site>/icon.svg` is the drawing; the two PNGs beside it are copies of
 * it for the places that can't take an SVG. Run this after editing an SVG, so
 * the three never disagree about what the site's icon looks like:
 *
 *   npm run icons && git diff --stat icons/
 *
 * It shells out to headless Chrome, because that is the one SVG renderer every
 * Mac already has. A missing Chrome is not worth a dependency: the PNGs are
 * checked in, and this only needs to run when the artwork changes.
 *
 * The 180px file is the iOS home-screen icon, so it comes out square with the
 * artwork inset. iOS rounds the corners itself, and would otherwise round a
 * shape that is already rounded.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROFILES } from '../src/config.js';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const icons = (path) => fileURLToPath(new URL(`../icons/${path}`, import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'times4-icons-'));

/** Square, with the artwork pulled in so iOS's corner mask can't clip it. */
function forHomeScreen(svg) {
  const inner = svg.match(/<g clip-path="url\(#tile\)">([\s\S]*)<\/g>\s*<\/svg>/)[1];
  return svg
    .replace('rx="13"', 'rx="0"')
    .replace(inner, `\n    <g transform="translate(32 32) scale(.84) translate(-32 -32)">${inner}</g>\n  `);
}

function render(svg, size, outPath) {
  const page = join(work, `${size}-${Math.random().toString(36).slice(2)}.html`);
  writeFileSync(page, `<style>html,body{margin:0;padding:0}svg{display:block}</style>${
    svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}`);
  execFileSync(CHROME, [
    '--headless', '--disable-gpu', '--hide-scrollbars',
    '--default-background-color=00000000',
    `--window-size=${size},${size}`, `--screenshot=${outPath}`, page,
  ], { stdio: 'ignore' });
  console.log(outPath.replace(/.*\/icons\//, 'icons/'));
}

for (const profile of Object.values(PROFILES)) {
  const svg = readFileSync(icons(`${profile.id}/icon.svg`), 'utf8');
  render(svg, 32, icons(`${profile.id}/icon-32.png`));
  render(forHomeScreen(svg), 180, icons(`${profile.id}/touch-180.png`));
}
