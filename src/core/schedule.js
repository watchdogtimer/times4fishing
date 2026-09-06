/**
 * A run of consecutive days for one location, ready to render.
 *
 * This is the piece the server-rendered pages need and the browser app doesn't:
 * it fetches once, samples every curve, and hands back a plain array. Because a
 * location's timezone is explicit rather than inherited from the runtime, it
 * produces identical output in a Worker running in UTC and in a browser
 * anywhere on earth. That's what makes the result safe to cache and share.
 */

import { computeDayForecast } from './day.js';
import { emptyTideData, fetchTidePredictions, sampleTideCurve } from './tides.js';
import { addDays, toDateKey, todayInZone, utcOffsetHoursInZone } from './time.js';
import { stationTideStats } from '../profiles/tidepooling.js';

/**
 * @param {object} options
 * @param {import('../config.js').Profile} options.profile
 * @param {import('../locations.js').Location} options.location
 * @param {Date} [options.startDate] Defaults to today in the location's zone.
 * @param {number} [options.days]
 * @param {object} [options.settings] Merged into what the profile receives.
 * @returns {Promise<{days: object[], tideStats: object|null, tideError: string|null}>}
 */
export async function forecastRange({
  profile,
  location,
  startDate = todayInZone(location.timeZone),
  days = 28,
  settings = {},
}) {
  const endDate = addDays(startDate, days - 1);

  let tideData = emptyTideData();
  let tideError = null;
  try {
    tideData = await fetchTidePredictions(location.stationId, startDate, endDate);
  } catch (error) {
    tideError = error.message;
  }

  const tideStats = tideData.events.length > 0 ? stationTideStats(tideData.events) : null;

  const forecasts = [];
  for (let offset = 0; offset < days; offset++) {
    const date = addDays(startDate, offset);
    forecasts.push(
      computeDayForecast({
        date,
        latitude: location.latitude,
        longitude: location.longitude,
        tides: tideData.byDate[toDateKey(date)] ?? [],
        tideCurve: sampleTideCurve(tideData.events, date),
        utcOffsetHours: utcOffsetHoursInZone(date, location.timeZone),
        profile,
        settings: { ...settings, tideStats },
      }),
    );
  }

  return { days: forecasts, tideStats, tideError };
}

/** The highest-rated day in a run, earliest winning a tie. */
export function bestDay(forecasts) {
  return forecasts.reduce(
    (best, day) => (best === null || day.score > best.score ? day : best),
    null,
  );
}
