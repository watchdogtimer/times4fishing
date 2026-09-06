/**
 * Solunar fishing windows.
 *
 * Solunar theory (John Alden Knight, 1926) holds that fish feed most actively
 * when the moon is directly overhead or underfoot ("major" periods) and, less
 * strongly, when it rises or sets ("minor" periods). We compute those four
 * moments from astronomy, widen each into a window, and score it higher when it
 * lines up with the other two things that reliably move fish: the low-light
 * hours around sunrise and sunset, and moving water around a tide change.
 *
 * The weights below are a judgement call, not a fitted model. They're gathered
 * in one place so they're easy to find and easy to argue with.
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
import { addHours, isWithinHours, localToUtcOffsetHours } from './time.js';

export const MAJOR = 'Major';
export const MINOR = 'Minor';

/**
 * The four solunar moments, and what to call them in the UI.
 *
 * "Major" and "Minor" are the traditional solunar names and anglers know them,
 * but they say nothing about what's actually happening. The label is the plain
 * description, which is what the chart shows; the kind is kept for the tables
 * and for the scoring weights.
 */
export const WINDOW_SOURCES = {
  moonOverhead: { kind: MAJOR, label: 'Moon overhead' },
  moonUnderfoot: { kind: MAJOR, label: 'Moon underfoot' },
  moonrise: { kind: MINOR, label: 'Moonrise' },
  moonset: { kind: MINOR, label: 'Moonset' },
};

/** Every tunable in the rating model. */
export const SCORING = {
  /** Half-width of each window, in hours. Majors get a wider window than minors. */
  halfSpanHours: { [MAJOR]: 1, [MINOR]: 0.5 },

  /** Score a window starts with, before any bonuses. */
  baseScore: { [MAJOR]: 3, [MINOR]: 2 },

  /** Bonus when the window overlaps sunrise or sunset. */
  sunBonus: { [MAJOR]: 2, [MINOR]: 1 },

  /** Bonus when the window overlaps a high or low tide. */
  tideBonus: { [MAJOR]: 1.5, [MINOR]: 1 },

  /** How close the window's centre must be to count as "overlapping". */
  sunToleranceHours: 0.5,
  tideToleranceHours: 0.75,

  /**
   * Multiplier applied at a full or new moon, tapering to 1.0 at the quarters.
   * Both extremes of the cycle produce the strongest tides, so the model cares
   * about how far the phase is from half-lit, not whether it's waxing or waning.
   */
  maxPhaseBonus: 0.3,

  /** Rating scale shown in the UI. */
  maxRating: 5,
};

/**
 * The best score a single day could possibly reach: every window at a full or
 * new moon, each one landing on both a sun event and a tide change. Real days
 * never hit this, which is why 5-star days are rare rather than routine.
 */
const MAX_DAILY_SCORE = [MAJOR, MAJOR, MINOR, MINOR].reduce(
  (total, kind) =>
    total +
    SCORING.baseScore[kind] * (1 + SCORING.maxPhaseBonus) +
    SCORING.sunBonus[kind] +
    SCORING.tideBonus[kind],
  0,
);

/**
 * @typedef {object} TideEvent
 * @property {number} hour   Local hours, 0-24.
 * @property {'H'|'L'} type  High or low water.
 * @property {number} height Feet above the MLLW datum.
 */

/**
 * @typedef {object} FishingWindow
 * @property {keyof WINDOW_SOURCES} source What causes this window.
 * @property {string} label      Plain description, e.g. "Moon overhead".
 * @property {'Major'|'Minor'} kind
 * @property {number} center     Local hours at the peak of the window.
 * @property {number} start      Local hours.
 * @property {number} end        Local hours. May wrap past midnight.
 * @property {boolean} prime     Overlaps a sun event or a tide change.
 * @property {'sunrise'|'sunset'|null} sunEvent Which sun event, if any.
 * @property {TideEvent|null} tideEvent
 * @property {number} score
 * @property {boolean} isBest    The day's highest-scoring window. Exactly one
 *   window per day has this, so it's safe to drive the UI's "go here" styling.
 */

/**
 * @typedef {object} DayForecast
 * @property {Date} date
 * @property {number|null} sunrise Local hours. Null inside the polar circles.
 * @property {number|null} sunset
 * @property {number|null} moonrise
 * @property {number|null} moonset
 * @property {number|null} moonOverhead Upper transit — moon at its highest.
 * @property {number|null} moonUnderfoot Lower transit — moon at its lowest, below the horizon.
 * @property {{illuminatedFraction: number, name: string}} phase
 * @property {FishingWindow[]} windows Sorted by start time.
 * @property {number} rating 0-5.
 * @property {TideEvent[]} tides
 */

/**
 * Compute the sun, moon and fishing windows for one local calendar day.
 *
 * @param {object} options
 * @param {Date} options.date       Any time on the day of interest.
 * @param {number} options.latitude Degrees, north positive.
 * @param {number} options.longitude Degrees, east positive.
 * @param {TideEvent[]} [options.tides] That day's high/low predictions, if we have them.
 * @returns {DayForecast}
 */
export function computeDayForecast({ date, latitude, longitude, tides = [] }) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const dayOfMonth = date.getDate();

  // Local midnight, expressed as an absolute time the astronomy can use.
  const utcOffsetHours = localToUtcOffsetHours(date);
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

  const sunrise = solve({ ...sunOptions, direction: -1 });
  const sunset = solve({ ...sunOptions, direction: +1 });
  const moonrise = solve({ ...moonOptions, direction: -1 });
  const moonset = solve({ ...moonOptions, direction: +1 });
  const moonOverhead = solve({ positionFn: moonPosition, hourAngleDeg: 0 });
  const moonUnderfoot = solve({ positionFn: moonPosition, hourAngleDeg: 180 });

  // Sample the phase at local midday, the middle of the day we're rating.
  const phase = moonPhase(toEpochDays(year, month, dayOfMonth, 12) + utcOffsetDays);

  const context = { sunrise, sunset, tides, phase };
  const windows = [
    buildWindow('moonOverhead', moonOverhead, context),
    buildWindow('moonUnderfoot', moonUnderfoot, context),
    buildWindow('moonrise', moonrise, context),
    buildWindow('moonset', moonset, context),
  ]
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  markBestWindow(windows);

  return {
    date,
    sunrise,
    sunset,
    moonrise,
    moonset,
    moonOverhead,
    moonUnderfoot,
    phase,
    windows,
    rating: toRating(windows),
    tides,
  };
}

/**
 * Turn one solunar moment into a scored window.
 *
 * @param {keyof WINDOW_SOURCES} source
 * @returns {FishingWindow|null} Null when the moment doesn't occur that day.
 */
function buildWindow(source, center, { sunrise, sunset, tides, phase }) {
  if (center === null) return null;

  const { kind, label } = WINDOW_SOURCES[source];
  const halfSpan = SCORING.halfSpanHours[kind];
  const tolerance = SCORING.sunToleranceHours;

  const sunEvent = isWithinHours(center, sunrise, tolerance)
    ? 'sunrise'
    : isWithinHours(center, sunset, tolerance)
      ? 'sunset'
      : null;
  const tideEvent =
    tides.find((tide) => isWithinHours(center, tide.hour, SCORING.tideToleranceHours)) ?? null;

  let score = SCORING.baseScore[kind] * phaseMultiplier(phase.illuminatedFraction);
  if (sunEvent) score += SCORING.sunBonus[kind];
  if (tideEvent) score += SCORING.tideBonus[kind];

  return {
    source,
    label,
    kind,
    center,
    start: addHours(center, -halfSpan),
    end: addHours(center, halfSpan),
    prime: sunEvent !== null || tideEvent !== null,
    sunEvent,
    tideEvent,
    score,
    isBest: false,
  };
}

/**
 * Flag the day's highest-scoring window.
 *
 * Ties are common — the two major periods often score identically — so the
 * earliest wins, which is deterministic and puts the marker on the one you can
 * still get to. `windows` must already be sorted by start time.
 */
function markBestWindow(windows) {
  let best = null;
  for (const window of windows) {
    if (best === null || window.score > best.score) best = window;
  }
  if (best) best.isBest = true;
}

/**
 * Phase weighting: 1.0 at the quarters, peaking at new and full moon.
 * `2·illumination - 1` maps the 0-1 illuminated fraction onto -1..+1, so its
 * absolute value is "how far from half-lit we are".
 */
function phaseMultiplier(illuminatedFraction) {
  const distanceFromHalf = Math.abs(2 * illuminatedFraction - 1);
  return 1 + SCORING.maxPhaseBonus * distanceFromHalf;
}

/** Collapse a day's window scores into the 0-5 rating shown on the calendar. */
function toRating(windows) {
  const dailyScore = windows.reduce((total, window) => total + window.score, 0);
  const scaled = Math.round((dailyScore / MAX_DAILY_SCORE) * SCORING.maxRating);
  return Math.max(0, Math.min(SCORING.maxRating, scaled));
}

/** The day's highest-scoring window, or null if the day has none. */
export function bestWindow(forecast) {
  return forecast.windows.find((window) => window.isBest) ?? null;
}
