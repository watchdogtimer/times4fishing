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

  /**
   * The hours you'd realistically be on the water, in local time.
   *
   * A major period at 1 AM is real astronomy, but almost nobody fishes it, so
   * letting it drive a day's rating makes the calendar useless for planning.
   */
  fishableHours: { from: 6, to: 22 },

  /**
   * What a window outside those hours still counts for, as a fraction.
   *
   * Not zero: night fishing is a real thing and the window is still shown and
   * still labelled. It just shouldn't decide whether Saturday beats Sunday.
   * The "include sleeping hours" toggle raises this to 1, which turns the
   * discount off entirely.
   */
  offHoursWeight: 0.2,

  /** Rating scale shown in the UI. */
  maxRating: 5,
};

/**
 * The two reference days the 0-5 rating is stretched between.
 *
 * These have to describe days that actually occur. An earlier version divided
 * by the theoretical maximum — all four windows at a full moon, each catching
 * both a sun event and a tide — which is unreachable: there are only two sun
 * events in a day, so at most two windows can ever take that bonus. Real days
 * scored between 34% and 79% of that ceiling, so every rating collapsed into
 * 2, 3 or 4, and 82% of days came out as exactly 3. The calendar could not
 * show you which day was better because the number barely moved.
 *
 * There are two scales because the two modes have genuinely different ceilings.
 * With the off-hours discount on, what separates a good day from a bad one is
 * mostly *when* the periods fall; with it off, that variable is gone and only
 * the moon phase and the sun/tide bonuses are left. Sharing one scale would
 * push every unrestricted day to five stars.
 *
 * Both are derived from SCORING, so re-weighting the model re-calibrates them.
 */
const RATING_SCALE = {
  /**
   * Off-hours discounted (the default).
   *
   * Quiet: one major period at an hour you'd fish, everything else in the
   * middle of the night. Excellent: a full or new moon with all four periods
   * falling in fishable hours.
   */
  fishableHours: {
    quiet:
      SCORING.baseScore[MAJOR] +
      (SCORING.baseScore[MAJOR] + SCORING.baseScore[MINOR]) * SCORING.offHoursWeight,
    excellent: fullMoonDayScore(),
  },

  /**
   * Sleeping hours included, so every window counts in full.
   *
   * Quiet: three plain periods at a quarter moon, which is the worst the model
   * produces once time of day stops mattering. Excellent: a full or new moon
   * with one major period landing on both a sun event and a tide change.
   */
  allHours: {
    quiet: 2 * SCORING.baseScore[MAJOR] + SCORING.baseScore[MINOR],
    excellent: fullMoonDayScore() + SCORING.sunBonus[MAJOR] + SCORING.tideBonus[MAJOR],
  },
};

/** All four periods at a full or new moon, with no sun or tide bonuses. */
function fullMoonDayScore() {
  const phase = 1 + SCORING.maxPhaseBonus;
  return 2 * SCORING.baseScore[MAJOR] * phase + 2 * SCORING.baseScore[MINOR] * phase;
}

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
 * @property {number} fishableFraction How much of the window falls in fishable
 *   hours, 0 to 1. Views use it to dim the ones you'd have to set an alarm for.
 * @property {number} intrinsicScore Solunar strength on its own merits, before
 *   the time-of-day discount. Only useful for spotting a strong window that the
 *   discount has pushed down the ranking.
 * @property {number} score `intrinsicScore` weighted by `fishableFraction`.
 *   This is what the ranking and the day's rating use.
 * @property {number} rank 1 for the day's best window, 2 for the next, and so
 *   on. Unique within a day, so it's safe to drive the UI's styling.
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
 * @property {number} score  Sum of the window scores, before scaling.
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
 * @param {boolean} [options.includeSleepingHours] Count windows at any hour in
 *   full, instead of discounting the ones outside SCORING.fishableHours.
 * @returns {DayForecast}
 */
export function computeDayForecast({
  date,
  latitude,
  longitude,
  tides = [],
  includeSleepingHours = false,
}) {
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

  const offHoursWeight = includeSleepingHours ? 1 : SCORING.offHoursWeight;
  const context = { sunrise, sunset, tides, phase, offHoursWeight };
  const windows = [
    buildWindow('moonOverhead', moonOverhead, context),
    buildWindow('moonUnderfoot', moonUnderfoot, context),
    buildWindow('moonrise', moonrise, context),
    buildWindow('moonset', moonset, context),
  ]
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  rankWindows(windows);

  const dailyScore = windows.reduce((total, window) => total + window.score, 0);

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
    score: dailyScore,
    rating: toRating(dailyScore, includeSleepingHours),
    tides,
  };
}

/**
 * Turn one solunar moment into a scored window.
 *
 * @param {keyof WINDOW_SOURCES} source
 * @returns {FishingWindow|null} Null when the moment doesn't occur that day.
 */
function buildWindow(source, center, { sunrise, sunset, tides, phase, offHoursWeight }) {
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

  const start = addHours(center, -halfSpan);
  const end = addHours(center, halfSpan);
  const fishableFraction = fractionInFishableHours(start, end);

  return {
    source,
    label,
    kind,
    center,
    start,
    end,
    prime: sunEvent !== null || tideEvent !== null,
    sunEvent,
    tideEvent,
    fishableFraction,
    intrinsicScore: score,
    score: score * fishableWeight(fishableFraction, offHoursWeight),
    rank: 0,
  };
}

/**
 * Number the windows from best to worst.
 *
 * Ties are common — the two major periods often score identically — so the
 * earliest wins, which is deterministic and puts the marker on the one you can
 * still get to. `windows` must already be sorted by start time for that
 * tie-break to hold.
 */
function rankWindows(windows) {
  [...windows]
    .sort((a, b) => b.score - a.score)
    .forEach((window, index) => {
      window.rank = index + 1;
    });
}

/**
 * How much a window counts, given how much of it lands in fishable hours.
 * Fully inside scores in full; fully outside keeps `offHoursWeight`.
 */
function fishableWeight(fishableFraction, offHoursWeight) {
  return offHoursWeight + (1 - offHoursWeight) * fishableFraction;
}

/**
 * The fraction of a window that falls inside SCORING.fishableHours.
 *
 * The window may straddle midnight, so it's split into non-wrapping pieces
 * first and each piece intersected with the fishable span.
 */
function fractionInFishableHours(start, end) {
  const { from, to } = SCORING.fishableHours;
  const pieces = end >= start ? [[start, end]] : [[start, 24], [0, end]];

  const total = pieces.reduce((sum, [a, b]) => sum + (b - a), 0);
  if (total <= 0) return 0;

  const inside = pieces.reduce(
    (sum, [a, b]) => sum + Math.max(0, Math.min(b, to) - Math.max(a, from)),
    0,
  );
  return inside / total;
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
function toRating(dailyScore, includeSleepingHours) {
  const { quiet, excellent } = includeSleepingHours
    ? RATING_SCALE.allHours
    : RATING_SCALE.fishableHours;
  const fraction = (dailyScore - quiet) / (excellent - quiet);
  const scaled = Math.round(fraction * SCORING.maxRating);
  return Math.max(0, Math.min(SCORING.maxRating, scaled));
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

/** @returns {FishingWindow|null} */
function windowByRank(forecast, rank) {
  return forecast.windows.find((window) => window.rank === rank) ?? null;
}

/**
 * A window that would top the day on solunar strength alone, but got ranked
 * down because it falls in the small hours. Null when there isn't one.
 *
 * The ranking deliberately favours windows you'd actually fish, which means a
 * genuinely strong 2 AM period can end up buried. Rather than quietly demote
 * it, the detail view calls it out so the choice is yours. Returns null when
 * the sleeping-hours discount is off, since then the best window already is
 * the strongest one.
 */
export function strongestOffHoursWindow(forecast) {
  const best = bestWindow(forecast);
  if (best === null) return null;

  return (
    forecast.windows
      .filter(
        (window) =>
          window.fishableFraction < 0.5 && window.intrinsicScore > best.intrinsicScore,
      )
      .sort((a, b) => b.intrinsicScore - a.intrinsicScore)[0] ?? null
  );
}
