/**
 * The physical facts of one local calendar day, and the generic machinery for
 * ranking whatever windows a profile decides to build out of them.
 *
 * Nothing in here knows what a good day looks like. That judgement belongs to a
 * profile (`src/profiles/`), because it's the one thing times4fishing and
 * times4tidepooling genuinely disagree about: fishing scores moon transits and
 * treats the tide as a bonus, tidepooling scores how far the water drops and
 * barely looks at the moon. Everything up to that fork is shared.
 */

import {
  moonPhase,
  moonPosition,
  solveLocalEventHour,
  sunPosition,
  toEpochDays,
  MOON_HORIZON_ALTITUDE_DEG,
  SUN_HORIZON_ALTITUDE_DEG,
} from './astronomy.js';
import { localToUtcOffsetHours } from './time.js';

/**
 * @typedef {object} TideEvent
 * @property {number} hour   Local hours, 0-24.
 * @property {'H'|'L'} type  High or low water.
 * @property {number} height Feet above the MLLW datum.
 */

/**
 * @typedef {object} DayFacts
 * @property {Date} date
 * @property {number|null} sunrise Local hours. Null inside the polar circles.
 * @property {number|null} sunset
 * @property {number|null} moonrise
 * @property {number|null} moonset
 * @property {number|null} moonOverhead  Upper transit, moon at its highest.
 * @property {number|null} moonUnderfoot Lower transit, moon at its lowest.
 * @property {{illuminatedFraction: number, name: string, waxing: boolean,
 *   cycleFraction: number, isFull: boolean, isNew: boolean}} phase
 * @property {TideEvent[]} tides
 * @property {{hour: number, height: number}[]} tideCurve Continuous height
 *   through the day, sampled between the extremes. Empty when there's no
 *   station, or when the day isn't bracketed by known extremes on both sides.
 */

/**
 * @typedef {object} Window
 * @property {string} source  Profile-specific identifier for what caused it.
 * @property {string} label   Plain description, e.g. "Moon overhead".
 * @property {number} center  Local hours at the peak.
 * @property {number} start   Local hours.
 * @property {number} end     Local hours. May wrap past midnight.
 * @property {number} weight  0-1. Drives band width and shading in the chart,
 *   so a profile can say "this one matters more" without the views needing to
 *   know why. Fishing maps majors to 1 and minors to 0.5; tidepooling maps it
 *   to how far below the threshold the water gets.
 * @property {number} score   What the ranking and the day's rating use.
 * @property {number} rank    1 for the day's best, 2 for the next, and so on.
 */

/**
 * Sun, moon and tide for one local calendar day. No scoring, no opinions.
 *
 * @param {object} options
 * @param {Date} options.date        Any time on the day of interest.
 * @param {number} options.latitude  Degrees, north positive.
 * @param {number} options.longitude Degrees, east positive.
 * @param {TideEvent[]} [options.tides] That day's high/low predictions, if we have them.
 * @param {{hour: number, height: number}[]} [options.tideCurve] The day's
 *   sampled curve. Passed in rather than computed here because it needs the
 *   neighbouring days' extremes, which is the caller's problem, and because the
 *   chart wants the same samples the scoring used.
 * @param {number} [options.utcOffsetHours] Hours to add to local time to get
 *   UT. Defaults to the running environment's own offset, which is right in the
 *   browser and wrong in a Worker: server-side callers must pass the location's
 *   offset (see `utcOffsetHoursInZone`).
 * @returns {DayFacts}
 */
export function computeDayFacts({
  date,
  latitude,
  longitude,
  tides = [],
  tideCurve = [],
  utcOffsetHours = localToUtcOffsetHours(date),
}) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const dayOfMonth = date.getDate();

  // Local midnight, expressed as an absolute time the astronomy can use.
  const utcOffsetDays = utcOffsetHours / 24;
  const midnightEpochDays = toEpochDays(year, month, dayOfMonth, 0) + utcOffsetDays;

  const solve = (options) =>
    solveLocalEventHour({
      midnightEpochDays,
      utcOffsetHours,
      latitude,
      longitude,
      ...options,
    });

  const sunOptions = { positionFn: sunPosition, horizonAltitudeDeg: SUN_HORIZON_ALTITUDE_DEG };
  const moonOptions = { positionFn: moonPosition, horizonAltitudeDeg: MOON_HORIZON_ALTITUDE_DEG };

  return {
    date,
    sunrise: solve({ ...sunOptions, direction: -1 }),
    sunset: solve({ ...sunOptions, direction: +1 }),
    moonrise: solve({ ...moonOptions, direction: -1 }),
    moonset: solve({ ...moonOptions, direction: +1 }),
    moonOverhead: solve({ positionFn: moonPosition, hourAngleDeg: 0 }),
    moonUnderfoot: solve({ positionFn: moonPosition, hourAngleDeg: 180 }),
    // Sample the phase at local midday, the middle of the day being rated.
    phase: {
      ...moonPhase(toEpochDays(year, month, dayOfMonth, 12) + utcOffsetDays),
      ...moonMilestone(toEpochDays(year, month, dayOfMonth, 0) + utcOffsetDays),
    },
    tides,
    tideCurve,
  };
}

/**
 * The facts for a day plus one profile's verdict on them.
 *
 * @param {object} options Everything `computeDayFacts` takes, plus:
 * @param {import('../profiles/fishing.js').default} options.profile
 * @param {object} [options.settings] Passed through to the profile untouched.
 * @returns {DayFacts & {windows: Window[], score: number, rating: number}}
 */
/**
 * Whether the exact moment of a new or full moon lands inside this local day.
 *
 * Thresholding the illuminated fraction doesn't work: the moon reads as more
 * than 99% lit for well over a day either side of full, so "is it full?" would
 * be true three days running. The cycle fraction is monotonic instead — it runs
 * 0 to 1 across the month, passing 0.5 exactly at full and wrapping through 0
 * exactly at new — so a day owns the event when the crossing falls between its
 * own midnight and the next.
 *
 * @param {number} midnightEpochDays Local midnight, as absolute epoch-days.
 * @returns {{isFull: boolean, isNew: boolean}}
 */
function moonMilestone(midnightEpochDays) {
  const start = moonPhase(midnightEpochDays).cycleFraction;
  const end = moonPhase(midnightEpochDays + 1).cycleFraction;

  return {
    // The fraction only runs backwards when it has wrapped past new.
    isNew: end < start,
    isFull: start < 0.5 && end >= 0.5,
  };
}

export function computeDayForecast({ profile, settings = {}, ...factOptions }) {
  const facts = computeDayFacts(factOptions);
  return { ...facts, ...profile.rateDay(facts, settings) };
}

/**
 * Number the windows from best to worst, in place.
 *
 * Ties are common, so the earliest wins: that's deterministic, and it puts the
 * marker on the one you can still get to. `windows` must already be sorted by
 * start time for that tie-break to hold.
 *
 * @param {Window[]} windows
 */
export function rankWindows(windows) {
  [...windows]
    .sort((a, b) => b.score - a.score)
    .forEach((window, index) => {
      window.rank = index + 1;
    });
}

/** The day's highest-scoring window, or null if the day has none. */
export function bestWindow(forecast) {
  return windowByRank(forecast, 1);
}

/**
 * The day's runner-up, for when the best window doesn't suit.
 *
 * Worth surfacing: on 29% of days it scores within 15% of the best, so it's a
 * real alternative rather than a consolation prize.
 */
export function secondBestWindow(forecast) {
  return windowByRank(forecast, 2);
}

/** @returns {Window|null} */
export function windowByRank(forecast, rank) {
  return forecast.windows.find((window) => window.rank === rank) ?? null;
}

/**
 * The fraction of a window that falls inside a span of the day.
 *
 * The window may straddle midnight, so it's split into non-wrapping pieces
 * first and each piece intersected with the span.
 *
 * @param {number} start Local hours.
 * @param {number} end   Local hours, possibly wrapped past midnight.
 * @param {{from: number, to: number}} span
 */
export function fractionWithin(start, end, { from, to }) {
  const pieces = end >= start ? [[start, end]] : [[start, 24], [0, end]];

  const total = pieces.reduce((sum, [a, b]) => sum + (b - a), 0);
  if (total <= 0) return 0;

  const inside = pieces.reduce(
    (sum, [a, b]) => sum + Math.max(0, Math.min(b, to) - Math.max(a, from)),
    0,
  );
  return inside / total;
}

/** True when `hour` falls between sunrise and sunset. Polar days count as lit. */
export function isDaylight(hour, { sunrise, sunset }) {
  if (hour === null) return false;
  if (sunrise === null || sunset === null) return true;
  return sunrise <= sunset
    ? hour >= sunrise && hour <= sunset
    : hour >= sunrise || hour <= sunset; // Sun sets after midnight local.
}
