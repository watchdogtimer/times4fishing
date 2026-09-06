/**
 * The curated location list.
 *
 * Mostly guarding against the quiet failures: a slug changed (which orphans a
 * live page), a marine point that drifted inland (which silently returns a flat
 * zero surf forecast), or a note written for one site leaking onto the other.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { LOCATIONS, nearestMarinePoint } from '../src/locations.js';
import { PROFILES } from '../src/config.js';

const PROFILE_IDS = new Set(Object.keys(PROFILES));

describe('locations', () => {
  test('every location is complete enough to render a page', () => {
    for (const location of LOCATIONS) {
      assert.match(location.slug, /^[a-z0-9-]+$/, `${location.name} has an unsafe slug`);
      assert.ok(location.name && location.region, `${location.slug} missing name/region`);
      assert.match(location.stationId, /^\d+$/, `${location.slug} station id`);
      assert.ok(Math.abs(location.latitude) <= 90 && Math.abs(location.longitude) <= 180);
      assert.ok(location.timeZone.includes('/'), `${location.slug} timezone`);
    }
  });

  test('slugs are unique — a collision would silently shadow a page', () => {
    const slugs = LOCATIONS.map((l) => l.slug);
    assert.equal(new Set(slugs).size, slugs.length);
  });

  test('every location has a marine point, and it is offshore of the place', () => {
    for (const location of LOCATIONS) {
      assert.ok(location.marine, `${location.slug} has no marine point`);
      const { latitude, longitude } = location.marine;
      assert.ok(Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180, location.slug);
      // Close enough to be the same weather, far enough to be in the water.
      const miles = roughMiles(location.latitude, location.longitude, latitude, longitude);
      assert.ok(miles > 0.5, `${location.slug} marine point is on top of the town`);
      assert.ok(miles < 60, `${location.slug} marine point is ${miles.toFixed(0)} mi away`);
    }
  });

  test('notes and seasons are only written against real profiles', () => {
    // A typo'd key here shows nothing rather than erroring, so it needs pinning.
    for (const location of LOCATIONS) {
      for (const field of ['notes', 'seasons']) {
        for (const key of Object.keys(location[field] ?? {})) {
          assert.ok(PROFILE_IDS.has(key), `${location.slug}.${field}.${key} is not a profile`);
        }
      }
    }
  });

  test('season notes read as prose, not as stubs', () => {
    for (const location of LOCATIONS) {
      for (const [profileId, text] of Object.entries(location.seasons ?? {})) {
        assert.ok(text.length > 60, `${location.slug}.${profileId} is too short to be useful`);
        assert.match(text, /[.!]$/, `${location.slug}.${profileId} should end in a full stop`);
      }
    }
  });

  test('no note mentions the other site’s activity', () => {
    // The bug this replaces: a fishing page telling anglers about tidepooling season.
    const foreign = { fishing: /tidepool|intertidal/i, tidepooling: /\bangler|\bfishing\b/i };
    for (const location of LOCATIONS) {
      for (const field of ['notes', 'seasons']) {
        for (const [profileId, text] of Object.entries(location[field] ?? {})) {
          const pattern = foreign[profileId];
          if (pattern) assert.doesNotMatch(text, pattern, `${location.slug}.${field}.${profileId}`);
        }
      }
    }
  });

  test('nearestMarinePoint finds a nearby coast and refuses a distant one', () => {
    const sanDiego = LOCATIONS.find((l) => l.slug === 'san-diego-ca');
    assert.deepEqual(nearestMarinePoint(32.7157, -117.1611), sanDiego.marine);
    // Kansas has no coast, and guessing one would be worse than saying nothing.
    assert.equal(nearestMarinePoint(38.5, -98.0), null);
  });
});

/** Equirectangular approximation; fine at these distances. */
function roughMiles(lat1, lon1, lat2, lon2) {
  const x = (lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  return Math.hypot(x, lat2 - lat1) * 69;
}
