/**
 * Shared test setup.
 *
 * The fixture is one real month of NOAA predictions for San Diego, frozen to a
 * file. Tests never touch the network: a suite that can fail because NOAA is
 * having a bad morning is a suite people learn to ignore, and this one is meant
 * to gate deploys.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { computeDayForecast } from '../src/core/day.js';
import { sampleTideCurve } from '../src/core/tides.js';
import { addDays, toDateKey, utcOffsetHoursInZone } from '../src/core/time.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/san-diego-tides.json', import.meta.url));

export const SAN_DIEGO = {
  latitude: 32.7157,
  longitude: -117.1611,
  timeZone: 'America/Los_Angeles',
};

/** The frozen tide events, rehydrated into the shape `tides.js` produces. */
export function loadTideEvents() {
  return JSON.parse(readFileSync(FIXTURE, 'utf8')).map((event) => ({
    ...event,
    time: new Date(event.t),
  }));
}

export function groupByDate(events) {
  const byDate = {};
  for (const event of events) (byDate[event.dateKey] ??= []).push(event);
  return byDate;
}

/**
 * Forecast a run of days from the fixture.
 *
 * The UTC offset is passed explicitly, so these assertions hold identically on
 * a laptop in California and in a CI container running UTC. That property is
 * the whole reason `computeDayFacts` takes an offset at all.
 */
export function forecastFixtureDays({ profile, settings = {}, start = new Date(2026, 0, 1, 12), days = 45 }) {
  const events = loadTideEvents();
  const byDate = groupByDate(events);

  return Array.from({ length: days }, (_, offset) => {
    const date = addDays(start, offset);
    return computeDayForecast({
      date,
      latitude: SAN_DIEGO.latitude,
      longitude: SAN_DIEGO.longitude,
      tides: byDate[toDateKey(date)] ?? [],
      tideCurve: sampleTideCurve(events, date),
      utcOffsetHours: utcOffsetHoursInZone(date, SAN_DIEGO.timeZone),
      profile,
      settings,
    });
  });
}
