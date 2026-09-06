/**
 * The scoring models, pinned.
 *
 * These exist because nothing here fails loudly. A change to the shared core
 * that shifts a rating doesn't throw, doesn't log, and doesn't look wrong on
 * screen — the calendar just quietly recommends a different day. And there are
 * now two models reading that core, so it's entirely possible to break
 * tidepooling while looking at fishing and never notice.
 *
 * The golden file is real output from a real month of NOAA predictions. It is
 * not a specification: when a deliberate change moves the numbers, regenerate
 * it and read the diff, because that diff is the change's actual effect on the
 * product, which is otherwise very hard to see.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, describe } from 'node:test';
import { fileURLToPath } from 'node:url';

import fishing from '../src/profiles/fishing.js';
import tidepooling, { stationTideStats } from '../src/profiles/tidepooling.js';
import { PROFILES } from '../src/config.js';
import { forecastFixtureDays, loadTideEvents } from './helpers.js';

const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/golden-forecasts.json', import.meta.url)), 'utf8'),
);

const tideStats = stationTideStats(loadTideEvents());

const CASES = [
  ['fishing', fishing, {}],
  ['fishingAllHours', fishing, { includeSleepingHours: true }],
  ['tidepooling', tidepooling, { tideStats }],
];

describe('golden forecasts', () => {
  for (const [name, profile, settings] of CASES) {
    test(`${name} matches the frozen output`, () => {
      const actual = forecastFixtureDays({ profile, settings }).map((day) => {
        const best = day.windows.find((window) => window.rank === 1);
        return {
          date: day.date.toISOString().slice(0, 10),
          rating: day.rating,
          score: Number(day.score.toFixed(6)),
          windows: day.windows.length,
          best: best ? { label: best.label, start: Number(best.start.toFixed(6)) } : null,
        };
      });
      assert.deepEqual(actual, golden[name]);
    });
  }

  test('the tidepooling threshold is still derived the same way', () => {
    assert.equal(Number(tideStats.thresholdFeet.toFixed(6)), golden._tideStats.thresholdFeet);
    assert.equal(
      Number(tideStats.referenceDepthFeet.toFixed(6)),
      golden._tideStats.referenceDepthFeet,
    );
  });
});

/**
 * Invariants every profile has to hold, present and future.
 *
 * Run against the registry rather than a hand-written list, so a third site
 * inherits the whole suite the moment it's added to `config.js`.
 */
describe('profile invariants', () => {
  for (const [name, profile] of Object.entries(PROFILES)) {
    const settings = profile.id === 'tidepooling' ? { tideStats } : {};
    const days = forecastFixtureDays({ profile, settings });

    test(`${name}: ratings stay inside 0-5`, () => {
      for (const day of days) {
        assert.ok(Number.isInteger(day.rating), `${day.date}: rating not an integer`);
        assert.ok(day.rating >= 0 && day.rating <= 5, `${day.date}: rating ${day.rating}`);
      }
    });

    test(`${name}: ranks are 1..n with no gaps or ties`, () => {
      for (const day of days) {
        const ranks = day.windows.map((window) => window.rank).sort((a, b) => a - b);
        assert.deepEqual(
          ranks,
          day.windows.map((_, index) => index + 1),
          `${day.date}: ranks were ${ranks}`,
        );
      }
    });

    test(`${name}: a better-scoring window always ranks higher`, () => {
      for (const day of days) {
        for (const a of day.windows) {
          for (const b of day.windows) {
            if (a.score > b.score) assert.ok(a.rank < b.rank, `${day.date}: ${a.label} vs ${b.label}`);
          }
        }
      }
    });

    test(`${name}: windows are sorted by start and carry a drawable weight`, () => {
      for (const day of days) {
        const starts = day.windows.map((window) => window.start);
        assert.deepEqual(starts, [...starts].sort((a, b) => a - b), `${day.date}`);
        for (const window of day.windows) {
          assert.ok(window.weight > 0 && window.weight <= 1, `${day.date}: weight ${window.weight}`);
          assert.equal(typeof window.label, 'string');
          assert.ok(window.label.length > 0);
        }
      }
    });

    test(`${name}: declares everything the views and the Worker read off it`, () => {
      for (const key of [
        'id', 'hostnames', 'siteName', 'headline', 'title', 'tagline', 'activity', 'windowNoun',
        'requiresTideStation', 'ratingTiers', 'windowsHeading', 'emptyWindowsNote',
        'chartCaption', 'aboutHtml', 'llmsSummary', 'pathPrefix', 'pageTitleVerb',
        'locations', 'tableTimeHeading', 'tableDetailHeading', 'factsHeading',
      ]) {
        assert.ok(profile[key] !== undefined, `${name} is missing ${key}`);
      }
      for (const key of ['rateDay', 'leadSentence', 'tableDetail', 'describeWindow',
        'dayFacts', 'moonCaption']) {
        assert.equal(typeof profile[key], 'function', `${name}.${key} should be a function`);
      }
      // Descending, so `find` returns the highest matching tier.
      const mins = profile.ratingTiers.map((tier) => tier.min);
      assert.deepEqual(mins, [...mins].sort((a, b) => b - a), `${name} tiers out of order`);
      assert.equal(mins.at(-1), 0, `${name} has no tier covering a zero rating`);
    });

    test(`${name}: the lead sentence names the place and says something`, () => {
      const best = days.reduce((a, b) => (b.score > a.score ? b : a));
      const location = profile.locations[0];
      const sentence = profile.leadSentence(best, location);
      assert.ok(sentence.includes(location.name), `missing place: ${sentence}`);
      assert.ok(sentence.length > 40 && sentence.endsWith('.'), `looks wrong: ${sentence}`);
    });
  }
});

describe('tidepooling model', () => {
  const days = forecastFixtureDays({ profile: tidepooling, settings: { tideStats } });

  test('every window really is below the threshold', () => {
    for (const day of days) {
      for (const window of day.windows) {
        assert.ok(
          window.lowestHeight <= tideStats.thresholdFeet,
          `${day.date}: ${window.lowestHeight} ft is not below ${tideStats.thresholdFeet}`,
        );
      }
    }
  });

  test('a window in the dark never outranks a comparable one in daylight', () => {
    for (const day of days) {
      for (const dark of day.windows.filter((window) => window.daylightFraction < 0.25)) {
        for (const lit of day.windows.filter((window) => window.daylightFraction > 0.9)) {
          // Only comparable when the dark one isn't also a much better tide.
          if (dark.depthBelowThreshold <= lit.depthBelowThreshold) {
            assert.ok(lit.rank < dark.rank, `${day.date}: dark window outranked a daylight one`);
          }
        }
      }
    }
  });

  test('moon phase is not an input to the score', () => {
    // Two days with near-identical tides but different phases must not diverge
    // on phase alone. Asserted structurally instead: re-rating with the phase
    // replaced must produce identical scores.
    for (const day of days.slice(0, 20)) {
      const rescored = tidepooling.rateDay(
        { ...day, phase: { illuminatedFraction: 0.5, name: 'First Quarter' } },
        { tideStats },
      );
      assert.equal(rescored.score, day.score, `${day.date} changed when the phase did`);
    }
  });
});
