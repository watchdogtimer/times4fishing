/**
 * The page-caching switch.
 *
 * Worth pinning because the failure is invisible: a stale page looks exactly
 * like a page that didn't change, so nobody notices the switch stopped working
 * until they've spent an afternoon debugging a deploy that was fine.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { cacheControl, cachingEnabled } from '../src/worker.js';

describe('page caching switch', () => {
  test('only the exact string "on" enables it', () => {
    assert.equal(cachingEnabled({ PAGE_CACHE: 'on' }), true);
    for (const value of ['off', 'ON', 'true', '1', 'yes', '', undefined, null]) {
      assert.equal(cachingEnabled({ PAGE_CACHE: value }), false, `PAGE_CACHE=${value}`);
    }
  });

  test('a missing binding fails towards no caching, not towards stale', () => {
    // If the var is ever dropped from wrangler.jsonc, the site should get slow,
    // never wrong.
    assert.equal(cachingEnabled({}), false);
    assert.equal(cachingEnabled(undefined), false);
    assert.equal(cacheControl({}, 3600), 'no-store');
  });

  test('off means no-store regardless of the lifetime asked for', () => {
    const env = { PAGE_CACHE: 'off' };
    for (const seconds of [60, 900, 3600, 86400]) {
      assert.equal(cacheControl(env, seconds), 'no-store');
    }
  });

  test('on restores the real lifetimes', () => {
    const env = { PAGE_CACHE: 'on' };
    assert.equal(cacheControl(env, 86400), 'public, max-age=900, s-maxage=86400');
    assert.equal(cacheControl(env, 3600, 300), 'public, max-age=300, s-maxage=3600');
  });

  test('the browser never holds a page longer than the edge does', () => {
    // A short-lived page shouldn't get the default 900s browser window.
    const env = { PAGE_CACHE: 'on' };
    assert.equal(cacheControl(env, 60), 'public, max-age=60, s-maxage=60');
  });
});
