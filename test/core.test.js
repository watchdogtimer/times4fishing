/**
 * The plumbing that only breaks in production.
 *
 * Timezone handling in particular: the browser and the Worker disagree about
 * what "today" means, and every bug that follows from that is invisible on a
 * developer's laptop in the same zone as the location they're testing.
 */

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';

import { activeProfile, PROFILES, profileForHostname } from '../src/config.js';
import { LOCATIONS, locationBySlug } from '../src/locations.js';
import {
  secondsUntilMidnightInZone,
  todayInZone,
  utcOffsetHoursInZone,
} from '../src/core/time.js';

describe('timezone helpers', () => {
  test('offsets are positive west of Greenwich, and follow daylight saving', () => {
    const winter = new Date('2026-01-15T12:00:00Z');
    const summer = new Date('2026-07-15T12:00:00Z');
    assert.equal(utcOffsetHoursInZone(winter, 'America/Los_Angeles'), 8);
    assert.equal(utcOffsetHoursInZone(summer, 'America/Los_Angeles'), 7);
    assert.equal(utcOffsetHoursInZone(winter, 'America/New_York'), 5);
    assert.equal(utcOffsetHoursInZone(winter, 'UTC'), 0);
    // Hawaii doesn't observe it, so both readings must agree.
    assert.equal(utcOffsetHoursInZone(winter, 'Pacific/Honolulu'), 10);
    assert.equal(utcOffsetHoursInZone(summer, 'Pacific/Honolulu'), 10);
  });

  test("today in a zone is that zone's date, not the runtime's", () => {
    // Deliberately January: California is on standard time, so the offset is a
    // flat 8 and the assertion doesn't quietly depend on when the clocks change.
    // 07:00 UTC is 23:00 the previous evening there.
    const at = new Date('2026-01-15T07:00:00Z');
    assert.equal(todayInZone('America/Los_Angeles', at).getDate(), 14);
    assert.equal(todayInZone('UTC', at).getDate(), 15);
  });

  test('cache lifetime is bounded and shrinks as local midnight approaches', () => {
    const zone = 'America/Los_Angeles'; // UTC-8 in January.
    const justAfterMidnight = new Date('2026-01-15T08:05:00Z'); // 00:05 local
    const lateEvening = new Date('2026-01-15T06:00:00Z'); // 22:00 local, 14 Jan

    const early = secondsUntilMidnightInZone(zone, justAfterMidnight);
    const late = secondsUntilMidnightInZone(zone, lateEvening);

    assert.ok(early > 23 * 3600 && early <= 86400, `got ${early}`);
    assert.ok(late > 0 && late <= 2 * 3600, `got ${late}`);
    assert.ok(early > late, 'later in the day must mean a shorter cache');
    assert.ok(late >= 60, 'never asks for a zero or negative max-age');
  });
});

describe('profile selection', () => {
  test('each production hostname reaches its own site', () => {
    for (const profile of Object.values(PROFILES)) {
      for (const hostname of profile.hostnames) {
        assert.equal(profileForHostname(hostname).id, profile.id);
        assert.equal(profileForHostname(hostname.toUpperCase()).id, profile.id);
      }
    }
  });

  test('a port on the hostname is ignored', () => {
    assert.equal(profileForHostname('times4tidepooling.com:8787').id, 'tidepooling');
  });

  test('an unknown host falls back to fishing rather than failing', () => {
    assert.equal(profileForHostname('example.invalid').id, 'fishing');
    assert.equal(profileForHostname('').id, 'fishing');
  });

  test('?profile= works off production but is refused on the live domains', () => {
    assert.equal(activeProfile(new URL('http://localhost:8787/?profile=tidepooling')).id, 'tidepooling');
    // The important half: one site must never serve the other's content under
    // its own URL, which is the duplicate-content pattern search engines punish.
    assert.equal(
      activeProfile(new URL('https://times4fishing.com/?profile=tidepooling')).id,
      'fishing',
    );
    assert.equal(
      activeProfile(new URL('https://times4tidepooling.com/?profile=fishing')).id,
      'tidepooling',
    );
  });

  test('the two sites never claim the same hostname', () => {
    const all = Object.values(PROFILES).flatMap((profile) => profile.hostnames);
    assert.equal(new Set(all).size, all.length, 'a hostname is claimed twice');
  });

  test('the two sites never claim the same path prefix', () => {
    const prefixes = Object.values(PROFILES).map((profile) => profile.pathPrefix);
    assert.equal(new Set(prefixes).size, prefixes.length);
  });
});

describe('locations', () => {
  test('slugs are unique and URL-safe', () => {
    const slugs = LOCATIONS.map((location) => location.slug);
    assert.equal(new Set(slugs).size, slugs.length, 'duplicate slug');
    for (const slug of slugs) {
      assert.match(slug, /^[a-z0-9-]+$/, `${slug} is not URL-safe`);
      assert.equal(locationBySlug(slug).slug, slug);
    }
  });

  test('every location carries what the Worker needs to render it', () => {
    for (const location of LOCATIONS) {
      assert.match(location.stationId, /^\d{7}$/, `${location.slug}: bad station id`);
      assert.ok(Math.abs(location.latitude) <= 90, `${location.slug}: latitude`);
      assert.ok(Math.abs(location.longitude) <= 180, `${location.slug}: longitude`);
      // Throws on an unknown zone, which is the point: a typo here would
      // otherwise only surface as wrong times on one location's page.
      assert.ok(utcOffsetHoursInZone(new Date(), location.timeZone) !== undefined);
      assert.ok(location.name && location.region, `${location.slug}: missing name/region`);
    }
  });
});
