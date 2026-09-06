/**
 * times4fishing: solunar fishing windows.
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

import { bestWindow, fractionWithin, rankWindows } from '../core/day.js';
import { addHours, formatClockTime, isWithinHours } from '../core/time.js';
import { LOCATIONS } from '../locations.js';

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
 * by the theoretical maximum, all four windows at a full moon each catching
 * both a sun event and a tide, which is unreachable: there are only two sun
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
 * @typedef {import('../core/day.js').Window & {
 *   kind: 'Major'|'Minor',
 *   prime: boolean,
 *   sunEvent: 'sunrise'|'sunset'|null,
 *   tideEvent: import('../core/day.js').TideEvent|null,
 *   fishableFraction: number,
 *   intrinsicScore: number,
 * }} FishingWindow
 */

/**
 * Score one day's facts for fishing.
 *
 * @param {import('../core/day.js').DayFacts} facts
 * @param {{includeSleepingHours?: boolean}} settings
 */
function rateDay(facts, { includeSleepingHours = false } = {}) {
  const offHoursWeight = includeSleepingHours ? 1 : SCORING.offHoursWeight;
  const context = { ...facts, offHoursWeight };

  const windows = Object.keys(WINDOW_SOURCES)
    .map((source) => buildWindow(source, facts[source], context))
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  rankWindows(windows);
  const score = windows.reduce((total, window) => total + window.score, 0);

  return { windows, score, rating: toRating(score, includeSleepingHours) };
}

/**
 * Turn one solunar moment into a scored window.
 *
 * @param {keyof WINDOW_SOURCES} source
 * @returns {FishingWindow|null} Null when the moment doesn't occur that day.
 */
function buildWindow(source, center, { sunrise, sunset, tides, phase, offHoursWeight }) {
  if (center === null || center === undefined) return null;

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
  const fishableFraction = fractionWithin(start, end, SCORING.fishableHours);

  return {
    source,
    label,
    kind,
    tag: kind,
    center,
    start,
    end,
    // Majors are twice as wide as minors, so the chart draws them heavier.
    weight: kind === MAJOR ? 1 : 0.5,
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
 * How much a window counts, given how much of it lands in fishable hours.
 * Fully inside scores in full; fully outside keeps `offHoursWeight`.
 */
function fishableWeight(fishableFraction, offHoursWeight) {
  return offHoursWeight + (1 - offHoursWeight) * fishableFraction;
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

/**
 * A window that would top the day on solunar strength alone, but got ranked
 * down because it falls in the small hours. Null when there isn't one.
 *
 * The ranking deliberately favours windows you'd actually fish, which means a
 * genuinely strong 2 AM period can end up buried. Rather than quietly demote
 * it, the detail view calls it out so the choice is yours.
 */
export function strongestOffHoursWindow(forecast) {
  const best = bestWindow(forecast);
  if (best === null) return null;

  return (
    forecast.windows
      .filter(
        (window) => window.fishableFraction < 0.5 && window.intrinsicScore > best.intrinsicScore,
      )
      .sort((a, b) => b.intrinsicScore - a.intrinsicScore)[0] ?? null
  );
}

/** @type {import('../config.js').Profile} */
export default {
  id: 'fishing',
  hostnames: ['times4fishing.com', 'www.times4fishing.com'],
  siteName: 'Tide & Moon',
  title: 'Tide & Moon — Fishing Windows',
  tagline:
    'Four weeks at a time, ranked by when the sun, moon, and tide line up to put fish on the feed. No ads, no accounts.',
  activity: 'fishing',
  windowNoun: 'fishing window',
  /** Fishing still works on sun and moon alone, so a station is optional. */
  requiresTideStation: false,
  ratingTiers: [
    { min: 4, name: 'Excellent', className: 'excellent' },
    { min: 3, name: 'Good', className: 'good' },
    { min: 2, name: 'Fair', className: 'fair' },
    { min: 0, name: 'Quiet', className: 'quiet' },
  ],
  windowsHeading: 'Best windows today',
  emptyWindowsNote: 'No events computed for this location and date.',
  chartCaption:
    "Tide height through the day. Shaded bands are fishing windows: gold is the day's " +
    'best, the brighter green is the runner-up. Wider bands are major periods (2 hours), ' +
    'narrow ones minor (1 hour). The lighter background is daylight.',
  aboutHtml: `
      <p><b>Moon &amp; sun windows are computed directly from astronomy</b> for your exact coordinates: two daily <b>major periods</b> (moon overhead / underfoot) and two <b>minor periods</b> (moonrise / moonset), per John Alden Knight's 1926 solunar theory. A window is flagged <b>Prime</b> when it overlaps sunrise, sunset, or — if you've added a NOAA station — an actual high or low tide.</p>
      <p>Major periods outscore minor ones, and a prime minor can still rank below a plain major, so <b>Prime doesn't mean best</b>. On a day's chart the single highest-scoring window is the gold one, marked <b>Best</b>.</p>
      <p><b>Tide times</b> come from NOAA's free CO-OPS API for the station you set, so they're real predictions, not estimates — but that only covers stations in NOAA's network (mainly the US and territories). Elsewhere you'd need a different tide data source.</p>
      <p><b>The tide curve</b> on each day is drawn between NOAA's published high and low waters by fitting a half cosine across each half-cycle. The peaks and troughs are exact; the shape in between is a very good approximation, but it isn't NOAA's own six-minute prediction. Don't plan a bar crossing by it.</p>
      <p><b>Windows outside 6 AM to 10 PM are discounted</b> when rating a day. The astronomy doesn't care what time it is, but you probably do, so a major period at 1 AM still gets listed and charted while counting for a fraction of a daytime one. That's why the best window shown on a calendar cell is nearly always at a civilised hour.</p>
      <p>Solunar theory has a real physical basis (lunar gravity drives tides, and moving water is a well-documented feeding trigger) but the specific claim of sharp 1–2 hour "best window" spikes is folk-science in origin, not a peer-reviewed model — treat the rating as one input, not gospel. Weather, pressure, and species behavior matter too and aren't modeled here.</p>`,
  /* --- Server-rendered pages ------------------------------------- */

  pathPrefix: 'tides',
  pageTitleVerb: 'Fishing times',
  locations: LOCATIONS,
  tableTimeHeading: 'Best window',
  tableDetailHeading: 'Why',

  /**
   * The one sentence an assistant is most likely to quote back.
   *
   * Written to stand alone with no surrounding context, because that's exactly
   * how it will be lifted: place, date, time and reason, in a single clause
   * each.
   */
  leadSentence(best, location) {
    const place = `${location.name}, ${location.region}`;
    if (!best) return `No forecast is available for ${place} at the moment.`;

    const window = best.windows.find((candidate) => candidate.rank === 1);
    const when = best.date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    if (!window) {
      return `The best fishing in ${place} over the next four weeks is ${when}, rated ${best.rating} out of 5.`;
    }
    const reason = window.sunEvent
      ? ` as the ${window.label.toLowerCase()} lines up with ${window.sunEvent}`
      : window.tideEvent
        ? ` as the ${window.label.toLowerCase()} lines up with the ${window.tideEvent.type === 'H' ? 'high' : 'low'} tide`
        : ` on the ${window.label.toLowerCase()}`;
    return (
      `The best fishing in ${place} over the next four weeks is ${when}, ` +
      `rated ${best.rating} out of 5, with its strongest window opening at ` +
      `${formatClockTime(window.start)}${reason}.`
    );
  },

  tableDetail(day, window) {
    if (!window) return 'No windows';
    const notes = [window.label];
    if (window.sunEvent) notes.push(`near ${window.sunEvent}`);
    if (window.tideEvent) {
      notes.push(`near ${window.tideEvent.type === 'H' ? 'high' : 'low'} tide`);
    }
    return notes.join(', ');
  },

  llmsSummary: `Each day in the next four weeks is rated 0-5 for fishing, based on
John Alden Knight's solunar theory: two major periods when the moon is overhead
or underfoot, two minor ones at moonrise and moonset. A window scores higher when
it overlaps sunrise, sunset, or a high or low tide, and windows outside 6 AM to
10 PM are discounted because almost nobody fishes them.

Solunar theory has a real physical basis, but its sharp "best window" claims are
folk science rather than a peer-reviewed model. Treat the rating as one input.
Weather, pressure and species behaviour are not modelled.`,
  rateDay,

  /** @param {FishingWindow} window */
  describeWindow(window) {
    const notes = [];
    if (window.fishableFraction < 0.5) notes.push('outside fishable hours');
    if (window.sunEvent) notes.push(`near ${window.sunEvent}`);
    if (window.tideEvent) {
      const kind = window.tideEvent.type === 'H' ? 'high' : 'low';
      notes.push(`near ${kind} tide (${window.tideEvent.height.toFixed(1)} ft)`);
    }
    return notes;
  },

  /**
   * Call out a window that beats the day's best on solunar strength but was
   * ranked down for falling in the small hours.
   *
   * The ranking favours windows you'd actually fish, which is right for
   * choosing between days but would otherwise hide a genuinely strong period at
   * 2 AM. Rather than bury it, say so and let the angler decide.
   */
  dayNote(forecast) {
    const window = strongestOffHoursWindow(forecast);
    if (!window) return '';
    return `
      <p class="off-hours-note">
        Strongest overall is <b>${formatClockTime(window.start)}</b>
        (${window.label.toLowerCase()}), outside fishable hours.
      </p>`;
  },
};
