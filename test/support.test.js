/**
 * The support link.
 *
 * The failure that matters is a link rendering when none is configured — an
 * empty href, or worse a placeholder account, would send a reader's money to a
 * stranger. So the "unset" case is the one pinned hardest.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { SUPPORT_URL, supportLinkHtml } from '../src/config.js';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

describe('support link', () => {
  test('renders nothing at all when no URL is configured', () => {
    if (SUPPORT_URL) return; // configured; the next test covers it
    assert.equal(supportLinkHtml(), '');
  });

  test('the configured URL is a real https address, not a page id or a snippet', () => {
    // Ko-fi's embed gives you a page id; pasting that as a URL half-works via a
    // redirect, and pasting the whole script tag would render as text.
    if (!SUPPORT_URL) return;
    assert.match(SUPPORT_URL, /^https:\/\//, 'must be an absolute https URL');
    assert.doesNotMatch(SUPPORT_URL, /<|script/i, 'looks like an embed snippet, not a URL');
    assert.ok(new URL(SUPPORT_URL).pathname.length > 1, 'no path — is this just the domain?');
  });

  test('no third-party script rides along with it', () => {
    // The site promises no ads and no accounts; a donation widget phoning home
    // would be the first thing to make that untrue.
    for (const file of ['../index.html', '../src/config.js', '../src/render/html.js']) {
      assert.doesNotMatch(read(file), /ko-fi\.com\/cdn|kofiwidget/i, `${file} embeds Ko-fi JS`);
    }
  });

  test('when set, it is a real external link that cannot be tampered with', () => {
    // Exercised by hand rather than by mutating the module, since ESM exports
    // are read-only: this asserts on the shape the function produces.
    const rendered = supportLinkHtml.toString();
    assert.match(rendered, /noopener/, 'must not hand window.opener to a payment page');
    assert.match(rendered, /nofollow/, 'a donation link should not pass ranking');
    assert.match(rendered, /replace\(/, 'the URL must be escaped before interpolation');
  });

  test('the shell reserves a slot that starts hidden', () => {
    const html = read('../index.html');
    assert.match(html, /<p class="support" id="support" hidden><\/p>/,
      'the slot must start hidden so nothing flashes before the script runs');
  });

  test('both render paths fill the same slot', () => {
    // The Worker rewrites the shell server-side and main.js mirrors it for local
    // dev; if they drift, one of the two sites silently loses the link.
    assert.match(read('../src/worker.js'), /#support/);
    assert.match(read('../src/main.js'), /getElementById\('support'\)/);
    assert.match(read('../src/render/html.js'), /supportLinkHtml\(\)/);
  });
});

describe('support link visibility', () => {
  test('the Worker lifts the hidden attribute when it fills the slot', () => {
    // Caught in review: the slot ships hidden, and an early version filled it
    // without removing that, so a configured link rendered invisibly.
    const worker = read('../src/worker.js');
    const block = worker.slice(worker.indexOf("'#support'"), worker.indexOf("'#support'") + 500);
    assert.match(block, /removeAttribute\('hidden'\)/,
      'filling the support slot must also unhide it');
  });
});
