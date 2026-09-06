/**
 * Saved settings.
 *
 * The interesting cases are all failure cases: storage that isn't there, that
 * throws on touch, or that holds something from an older version of the app.
 * None of them may stop the page loading, so each one is pinned here.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { clearSettings, loadSettings, saveSettings } from '../src/core/settings.js';

/** A `localStorage` stand-in; `onAccess` lets a test make it misbehave. */
function stubStorage({ seed = null, onAccess = null } = {}) {
  let value = seed;
  globalThis.window = {
    localStorage: {
      getItem() {
        if (onAccess) onAccess();
        return value;
      },
      setItem(_key, next) {
        if (onAccess) onAccess();
        value = next;
      },
      removeItem() {
        if (onAccess) onAccess();
        value = null;
      },
    },
  };
  return { read: () => value };
}

const VALID = {
  latitude: 47.6062,
  longitude: -122.3321,
  stationId: '9447130',
  placeLabel: 'Your current location',
  includeSleepingHours: true,
};

afterEach(() => {
  delete globalThis.window;
});

describe('saved settings', () => {
  test('a saved set comes back intact', () => {
    stubStorage();
    saveSettings(VALID);
    assert.deepEqual(loadSettings(), VALID);
  });

  test('nothing saved yet reads as nothing, not a crash', () => {
    stubStorage();
    assert.equal(loadSettings(), null);
  });

  test('a station with no coordinates is worthless, so the whole blob is dropped', () => {
    // A station 3000 miles from the coordinates on screen is worse than the
    // default, so coordinates are the one field we refuse to guess at.
    stubStorage({ seed: JSON.stringify({ stationId: '9447130' }) });
    assert.equal(loadSettings(), null);
  });

  test('out-of-range coordinates are rejected', () => {
    for (const bad of [{ latitude: 91, longitude: 0 }, { latitude: 0, longitude: 181 }]) {
      stubStorage({ seed: JSON.stringify({ ...VALID, ...bad }) });
      assert.equal(loadSettings(), null, JSON.stringify(bad));
    }
  });

  test('a half-written or older blob degrades to defaults rather than undefined', () => {
    stubStorage({ seed: JSON.stringify({ latitude: 10, longitude: 20 }) });
    assert.deepEqual(loadSettings(), {
      latitude: 10,
      longitude: 20,
      stationId: null,
      placeLabel: '',
      includeSleepingHours: false,
    });
  });

  test('garbage in storage reads as nothing', () => {
    stubStorage({ seed: 'not json {{' });
    assert.equal(loadSettings(), null);
  });

  test('a station id of the wrong type is dropped, not passed to NOAA', () => {
    stubStorage({ seed: JSON.stringify({ ...VALID, stationId: 9447130 }) });
    assert.equal(loadSettings().stationId, null);
  });

  test('includeSleepingHours only survives as a real boolean', () => {
    stubStorage({ seed: JSON.stringify({ ...VALID, includeSleepingHours: 'yes' }) });
    assert.equal(loadSettings().includeSleepingHours, false);
  });

  test('storage that throws on touch is survivable', () => {
    // Private windows and "block all site data" both throw on plain access,
    // and reading is enough to trigger it — not just writing.
    const boom = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    stubStorage({ onAccess: boom });
    assert.equal(loadSettings(), null);
    assert.doesNotThrow(() => saveSettings(VALID));
    assert.doesNotThrow(() => clearSettings());
  });

  test('no storage object at all is survivable', () => {
    delete globalThis.window;
    assert.equal(loadSettings(), null);
    assert.doesNotThrow(() => saveSettings(VALID));
  });

  test('clearing means the next visit starts fresh', () => {
    stubStorage();
    saveSettings(VALID);
    clearSettings();
    assert.equal(loadSettings(), null);
  });
});
