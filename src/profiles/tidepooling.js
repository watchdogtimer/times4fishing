/**
 * times4tidepooling: when the water drops far enough, for long enough, in
 * daylight.
 *
 * This is not the fishing model with different words on it. Fishing scores moon
 * transits and treats the tide as a bonus; tidepooling inverts that completely.
 * The tide curve *generates* the windows here, and the moon barely appears:
 *
 *  - **How low it goes** dominates. Exposing the low intertidal is the whole
 *    trip, and the difference between a -1.4 ft low and a +0.8 ft low is the
 *    difference between anemones and a wet walk.
 *  - **Daylight is close to a gate**, not the soft discount fishing applies. A
 *    -1.8 ft low at 4 AM is worthless to almost everyone. Night tidepooling
 *    with a torch is a real thing, so the floor isn't zero, but it's low.
 *  - **Duration matters on its own.** A flat, slow low gives you two hours of
 *    poking about; a sharp V gives you forty minutes. Two days with identical
 *    low-water *heights* can be genuinely different trips, which is why the
 *    window is the whole span below the threshold rather than a fixed
 *    hour either side of a moment.
 *  - **Moon phase is deliberately NOT scored.** This is the trap. NOAA's
 *    predicted heights already contain the spring/neap and perigean effects, so
 *    applying the fishing model's phase multiplier on top would count the moon
 *    twice. It's shown as a fact and kept out of the arithmetic.
 *
 * Because the tide is the entire signal, this profile is useless without a
 * station. `requiresTideStation` says so, and the views degrade accordingly.
 */

import { fractionWithin, isDaylight, rankWindows } from '../core/day.js';
import { addHours, formatClockTime } from '../core/time.js';
import { LOCATIONS } from '../locations.js';

/** Every tunable in the rating model. */
export const SCORING = {
  /**
   * The exposure threshold and the depth that counts as excellent, as
   * percentiles of the low waters actually predicted for this station.
   *
   * An absolute figure can't work across coasts: -1.0 ft MLLW is a red-letter
   * day in San Diego and an ordinary Tuesday in Anchorage, where the range is
   * six times larger. Percentiles of the station's own lows adapt to both
   * without us shipping a table of coastlines.
   *
   * MLLW zero is a tempting universal threshold, since the datum is by
   * definition the mean of the lower low waters, but "below average" is a much
   * weaker claim in a 25 ft range than in a 6 ft one. Percentiles it is.
   *
   * The threshold is deliberately generous: at the 65th percentile, most lows
   * open a window, and it's `depthBelowThreshold` that separates a good one
   * from a great one. A strict threshold looked principled and wasn't: at the
   * 35th percentile 58% of days scored zero, which is a calendar of grey
   * squares that can't tell you which of two mediocre weekends to take.
   */
  thresholdPercentile: 0.65,
  referencePercentile: 0.05,

  /**
   * Fallback threshold when there aren't enough lows to take a percentile of,
   * which really only happens on a stub of a data set. MLLW zero is the least
   * arbitrary constant available.
   */
  fallbackThresholdFeet: 0,

  /** A window shorter than this isn't worth the drive, so it isn't listed. */
  minWindowMinutes: 30,

  /** Duration at which the duration term saturates. */
  generousWindowHours: 2.5,

  /** How the two halves of a window's quality trade off. They sum to 1. */
  depthWeight: 0.65,
  durationWeight: 0.35,

  /**
   * What a window in full darkness still counts for.
   *
   * Not zero: night tidepooling by torchlight is a real and rather good thing,
   * and octopuses are far more active after dark. It just shouldn't decide
   * whether Saturday beats Sunday for the family trip this site is aimed at.
   */
  darkWeight: 0.15,

  /**
   * Credit for a day's *second* usable window, as a fraction of its own score.
   *
   * Most days have two lows and usually only one is in daylight. When both are,
   * that's a genuinely more flexible day, but it isn't twice as good: you're
   * going to one of them.
   */
  secondWindowCredit: 0.25,

  /** How long before the low you want to be on the rocks. */
  arriveBeforeLowHours: 1,

  maxRating: 5,
};

/**
 * The two reference days the 0-5 rating is stretched between.
 *
 * Same lesson as the fishing scale: these have to describe days that actually
 * happen, not a theoretical ceiling. The arithmetic ceiling here is 1.16 (a
 * window 1.25x the station's reference depth, long enough to saturate the
 * duration term, wholly in daylight) plus a second window's credit on top, and
 * nothing real gets close to all of that at once.
 *
 * `excellent` is 1.0: a near-perfect daylight low, or a very good one with a
 * usable second window. `quiet` is 0, and unlike fishing that floor is real and
 * regularly hit. A day whose only lows come at night offers nothing, and saying
 * so is more useful than inventing a star for it.
 *
 * Measured over 2190 day/station forecasts (six stations, all of 2026): 18%
 * zero, 21% one, 15% two, 22% three, 17% four, 7% five. The spread is wider at
 * the bottom than the fishing scale's on purpose, because dead days are a real
 * feature of tidepooling and not a modelling failure. It also varies a lot by
 * coast, which is signal rather than noise: Seattle scores 1% zeroes and Miami
 * 35%, and that is a fair description of the tidepooling on offer.
 */
const RATING_SCALE = {
  quiet: 0,
  excellent: 1,
};

/**
 * @typedef {import('../core/day.js').Window & {
 *   lowestHeight: number,
 *   depthBelowThreshold: number,
 *   durationHours: number,
 *   daylightFraction: number,
 *   arriveBy: number,
 * }} TidepoolWindow
 */

/**
 * How low this station's water actually gets, so a day can be judged against
 * its own coastline rather than an absolute number of feet.
 *
 * Derived from whatever predictions are already loaded, so it costs no extra
 * request. Four weeks is a small sample and a spring/neap cycle is about two of
 * them, so the numbers wobble a little between pages; a year of `interval=hilo`
 * for the station would settle them if that ever seems worth a fetch.
 *
 * @param {import('../core/tides.js').TideEvent[]} events
 * @returns {{thresholdFeet: number, referenceDepthFeet: number, sampleSize: number}}
 */
export function stationTideStats(events) {
  const lows = events.filter((event) => event.type === 'L').map((event) => event.height);

  if (lows.length < 4) {
    return {
      thresholdFeet: SCORING.fallbackThresholdFeet,
      referenceDepthFeet: 1,
      sampleSize: lows.length,
    };
  }

  const thresholdFeet = percentile(lows, SCORING.thresholdPercentile);
  const referenceFeet = percentile(lows, SCORING.referencePercentile);
  return {
    thresholdFeet,
    // Guarded so a station with a nearly flat range can't divide by zero.
    referenceDepthFeet: Math.max(0.25, thresholdFeet - referenceFeet),
    sampleSize: lows.length,
  };
}

/** Linear-interpolated percentile of an unsorted list. */
function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  const position = fraction * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/**
 * Score one day's facts for tidepooling.
 *
 * @param {import('../core/day.js').DayFacts} facts
 * @param {{tideStats?: object}} settings
 */
function rateDay(facts, { tideStats } = {}) {
  const stats = tideStats ?? stationTideStats(facts.tides ?? []);
  const windows = findExposureWindows(facts, stats);

  rankWindows(windows);

  // You go to one low, so the day is worth its best window, with a nudge for
  // having a real alternative. Summing them would say two mediocre lows beat
  // one superb one, which is backwards.
  const ranked = [...windows].sort((a, b) => b.score - a.score);
  const score =
    (ranked[0]?.score ?? 0) + (ranked[1]?.score ?? 0) * SCORING.secondWindowCredit;

  return { windows, score, rating: toRating(score), tideStats: stats };
}

/**
 * Every contiguous stretch of the day where the water sits below the threshold.
 *
 * Walks the sampled curve rather than the high/low extremes, because the
 * question isn't "when was the low" but "how long was it shallow enough", and
 * only the curve can answer that. Days without a curve (no station, or the
 * padding days missing at the edge of a fetch) produce no windows, which is the
 * honest answer for this site rather than something to paper over.
 *
 * @param {import('../core/day.js').DayFacts} facts
 * @returns {TidepoolWindow[]}
 */
function findExposureWindows(facts, stats) {
  const curve = facts.tideCurve ?? [];
  if (curve.length === 0) return [];

  const windows = [];
  let run = null;

  const closeRun = () => {
    if (run === null) return;
    const durationHours = run.end - run.start;
    if (durationHours * 60 >= SCORING.minWindowMinutes) {
      windows.push(buildWindow(run, facts, stats));
    }
    run = null;
  };

  for (const sample of curve) {
    if (sample.height <= stats.thresholdFeet) {
      if (run === null) run = { start: sample.hour, end: sample.hour, lowest: sample };
      run.end = sample.hour;
      if (sample.height < run.lowest.height) run.lowest = sample;
    } else {
      closeRun();
    }
  }
  closeRun();

  return windows.sort((a, b) => a.start - b.start);
}

/** @returns {TidepoolWindow} */
function buildWindow(run, facts, stats) {
  const durationHours = run.end - run.start;
  const depthBelowThreshold = stats.thresholdFeet - run.lowest.height;

  // How far below the threshold, against how far this station ever goes. Allowed
  // past 1 so an exceptional king tide still reads as better than a merely good
  // one, but capped so one freak low doesn't flatten the rest of the scale.
  const depthScore = Math.min(1.25, depthBelowThreshold / stats.referenceDepthFeet);
  const durationScore = Math.min(1, durationHours / SCORING.generousWindowHours);

  const daylightFraction = fractionWithin(run.start, run.end, daylightSpan(facts));
  const quality = SCORING.depthWeight * depthScore + SCORING.durationWeight * durationScore;

  return {
    source: 'lowTide',
    label: `Low water ${run.lowest.height.toFixed(1)} ft`,
    tag: `${durationHours.toFixed(1)}h`,
    center: run.lowest.hour,
    start: run.start,
    end: run.end,
    weight: Math.max(0.35, Math.min(1, depthScore)),
    lowestHeight: run.lowest.height,
    depthBelowThreshold,
    durationHours,
    daylightFraction,
    arriveBy: addHours(run.lowest.hour, -SCORING.arriveBeforeLowHours),
    score: quality * daylightWeight(daylightFraction),
    rank: 0,
  };
}

/**
 * The day's lit span, as a plain {from, to} for `fractionWithin`.
 *
 * A window can straddle midnight but daylight can't, so the polar cases are
 * flattened to "all day" or "no day" rather than being modelled properly. The
 * NOAA station network doesn't reach the polar circles, so this is theory.
 */
function daylightSpan({ sunrise, sunset }) {
  if (sunrise === null || sunset === null) return { from: 0, to: 24 };
  if (sunrise > sunset) return { from: 0, to: 24 };
  return { from: sunrise, to: sunset };
}

/** Near-binary: full credit in daylight, `darkWeight` at night, linear between. */
function daylightWeight(daylightFraction) {
  return SCORING.darkWeight + (1 - SCORING.darkWeight) * daylightFraction;
}

/** Collapse the day's score into the 0-5 rating shown on the calendar. */
function toRating(dailyScore) {
  const { quiet, excellent } = RATING_SCALE;
  const fraction = (dailyScore - quiet) / (excellent - quiet);
  const scaled = Math.round(fraction * SCORING.maxRating);
  return Math.max(0, Math.min(SCORING.maxRating, scaled));
}

/**
 * A window with a genuinely better tide than the day's pick, which lost only
 * because it falls in the dark. Null when there isn't one.
 *
 * The mirror of the fishing profile's `strongestOffHoursWindow`, and needed for
 * the same reason. Ranking within a day is about which trip to take, so
 * daylight rightly dominates; that means a +1.2 ft nothing of a low can outrank
 * a -0.7 ft one four hours long, purely because the good one is at 3 AM. The
 * day's rating already says "don't bother", but a reader looking at the panel
 * deserves to be told the real low exists and when it is.
 *
 * @returns {TidepoolWindow|null}
 */
export function strongestDarkWindow(forecast) {
  const best = forecast.windows.find((window) => window.rank === 1);
  if (!best) return null;

  return (
    forecast.windows
      .filter(
        (window) =>
          window.daylightFraction < 0.25 &&
          window.depthBelowThreshold > best.depthBelowThreshold + MEANINGFULLY_LOWER_FEET,
      )
      .sort((a, b) => b.depthBelowThreshold - a.depthBelowThreshold)[0] ?? null
  );
}

/**
 * How much deeper a dark low has to be before it's worth mentioning.
 *
 * Half a foot is roughly the difference between the same zone and the next one
 * down, and below that the comparison is noise dressed up as advice.
 */
const MEANINGFULLY_LOWER_FEET = 0.5;

/** @type {import('../config.js').Profile} */
export default {
  id: 'tidepooling',
  hostnames: ['times4tidepooling.com', 'www.times4tidepooling.com'],
  siteName: 'Low Water',
  headline: 'Best times for tide pooling',
  title: 'Best times for tide pooling — Low Water',
  tagline:
    'Four weeks at a time, ranked by when the tide drops far enough, for long enough, in daylight. No ads, no accounts.',
  activity: 'tidepooling',
  windowNoun: 'tidepooling window',
  factsHeading: 'Daylight',
  /**
   * No moonrise, moonset or transits.
   *
   * Those four are the solunar model's moments, and this site doesn't use that
   * model — the tide curve generates the windows. Listing when the moon is
   * underfoot to someone deciding whether to walk out onto a reef is noise
   * dressed as data. Sunrise and sunset stay because daylight is a hard
   * requirement of the trip.
   */
  dayFacts: (forecast) => [
    ['Sunrise', forecast.sunrise],
    ['Sunset', forecast.sunset],
  ],
  /**
   * Phase named by what it does to the water, not by its shape.
   *
   * "Waning Crescent" asks the reader to know that phase drives tidal range.
   * "Neap tides" tells them the lows this week are unremarkable, which is the
   * only reason the moon appears on this site at all.
   */
  moonCaption: (phase) => {
    const extremeness = Math.abs(2 * phase.illuminatedFraction - 1);
    if (extremeness >= 0.7) return 'Spring tides';
    if (extremeness <= 0.3) return 'Neap tides';
    // Heading for a new or full moon means the range is still opening up.
    return phase.waxing === phase.illuminatedFraction > 0.5 ? 'Tides building' : 'Tides easing';
  },
  windowsHeading: 'Low-water windows',
  emptyWindowsNote:
    'No low-water window on this day — the tide never drops far enough to be worth the trip.',
  chartCaption:
    'Tide height through the day. Shaded bands are the stretches when the water sits below ' +
    "this station's usual low: gold is the day's best, the brighter green is the runner-up. " +
    'Darker bands mean the water drops further. The lighter background is daylight, and a ' +
    'band outside it is a torchlight trip.',
  /** The tide is the entire signal here, so there is no useful fallback mode. */
  requiresTideStation: true,
  ratingTiers: [
    { min: 4, name: 'Excellent', className: 'excellent' },
    { min: 3, name: 'Good', className: 'good' },
    { min: 2, name: 'Fair', className: 'fair' },
    { min: 0, name: 'Skip it', className: 'quiet' },
  ],
  aboutHtml: `
      <p><b>The tide is the whole story here</b>, so unlike a fishing calendar this site needs a NOAA station and says nothing useful without one. A day is rated on its best stretch of low water: how far the tide drops, how long it stays down, and whether that happens in daylight.</p>
      <p><b>How low counts most.</b> Exposing the low intertidal is the trip, and the difference between a -1.4 ft low and a +0.8 ft low is the difference between anemones and a wet walk. Because a good low means different numbers on different coasts, the threshold is set from the station's own predicted lows rather than a fixed height: -1.0 ft is a red-letter day in San Diego and an ordinary Tuesday in Anchorage.</p>
      <p><b>Daylight is close to a gate</b>, not a mild preference. A -1.8 ft low at 4 AM is a superb tide and a useless outing for most people, and it's rated accordingly. Night tidepooling by torchlight is real and rather good, so such days keep a fraction of their score rather than dropping to zero.</p>
      <p><b>Duration matters on its own.</b> A flat, slow low gives you two hours on the rocks; a sharp one gives you forty minutes. Two days with the same low-water height can be genuinely different trips, so the window drawn on the chart is the whole stretch below the threshold, not a fixed hour either side of the low.</p>
      <p><b>Moon phase is shown but deliberately not scored.</b> New and full moons do produce the biggest tides, but NOAA's predicted heights already contain that, along with the moon's distance. Adding a phase bonus on top would be counting the same thing twice.</p>
      <p><b>Plenty of days score zero, and that's the honest answer.</b> Roughly a fifth do. On the Pacific coast the extreme lows swap between daytime in winter and the middle of the night in summer, so half the year is simply better than the other half, and a calendar that pretended otherwise would be lying to you.</p>
      <p><b>Get there early and watch the water.</b> Walk out on the tail of the ebb and follow it down rather than arriving at the low itself. Surf and swell matter enormously for both safety and visibility and aren't yet modelled here, so check a marine forecast before you go, and never turn your back on the sea.</p>`,
  /* --- Server-rendered pages ------------------------------------- */

  pathPrefix: 'locations',
  /** Was 'spots', which wasn't wrong so much as it said nothing. */
  legacyPathPrefixes: ['spots'],
  pageTitleVerb: 'Tidepooling times',
  locations: LOCATIONS,
  tableTimeHeading: 'Low water',
  tableDetailHeading: 'What you get',

  /**
   * The one sentence an assistant is most likely to quote back.
   *
   * Height and clock time are the two facts a reader actually wants, so they go
   * in early and in that order, with the duration behind them.
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
      return `No day in the next four weeks brings the tide low enough in daylight at ${place}.`;
    }
    const light = window.daylightFraction < 0.25 ? ', though it falls after dark' : '';
    return (
      `The best tidepooling in ${place} over the next four weeks is ${when}, ` +
      `with a ${window.lowestHeight.toFixed(1)} ft low at ${formatClockTime(window.center)} ` +
      `and about ${window.durationHours.toFixed(1)} hours of exposed rock${light}.`
    );
  },

  tableDetail(day, window) {
    if (!window) return 'Nothing exposed';
    const parts = [
      `${window.lowestHeight.toFixed(1)} ft`,
      `${window.durationHours.toFixed(1)} h`,
    ];
    parts.push(window.daylightFraction < 0.25 ? 'after dark' : 'in daylight');
    return parts.join(', ');
  },

  llmsSummary: `Each day in the next four weeks is rated 0-5 for tidepooling, based
on how far the tide drops below this station's usual low, how long it stays down,
and whether that happens in daylight. Depth counts for most, daylight is close to
a gate rather than a preference, and duration counts on its own because a flat
slow low gives hours on the rocks where a sharp one gives forty minutes.

Moon phase is shown but deliberately not scored: NOAA's predicted heights already
contain the spring/neap and perigean effects, so scoring the phase again would
count the same thing twice. The threshold for "low" is a percentile of each
station's own predicted lows rather than a fixed height, because -1.0 ft means
very different things in San Diego and in Anchorage.

Roughly a fifth of days score zero, which is the honest answer rather than a
modelling failure: on the Pacific coast the extreme lows swap between daytime in
winter and the middle of the night in summer. Surf and swell matter greatly for
safety and visibility and are not yet modelled.`,
  rateDay,

  /** The low itself, not the start of the long stretch of water around it. */
  cellTime: (window) => window.center,

  /** @param {TidepoolWindow} window */
  describeWindow(window) {
    const notes = [
      `${window.depthBelowThreshold.toFixed(1)} ft below the usual low`,
      `${window.durationHours.toFixed(1)} h of exposure`,
    ];
    if (window.daylightFraction < 0.25) notes.push('after dark');
    else if (window.daylightFraction < 0.9) notes.push('partly after dark');
    return notes;
  },

  /**
   * The one piece of advice the numbers don't carry: get there before the low.
   *
   * The window is when the water is *already* down, but the trip works best if
   * you walk out on the tail of the ebb and follow it down, so you're not
   * chasing it. Worth saying plainly, because "low tide at 2:00 PM" reads to
   * most people as "arrive at 2:00 PM", by which point you've missed half of it.
   */
  dayNote(forecast) {
    const best = forecast.windows.find((window) => window.rank === 1);
    if (!best) return '';

    const safety =
      best.daylightFraction < 0.25
        ? ' Bring a torch, and check the surf before you go.'
        : ' Check the surf before you go.';

    const arrival = `
      <p class="off-hours-note">
        Be on the rocks by <b>${formatClockTime(best.arriveBy)}</b> and follow the water
        down to the low at ${formatClockTime(best.center)}.${safety}
      </p>`;

    const dark = strongestDarkWindow(forecast);
    if (!dark) return arrival;

    return `${arrival}
      <p class="off-hours-note">
        The day's real low is <b>${dark.lowestHeight.toFixed(1)} ft</b> at
        ${formatClockTime(dark.center)}, which is
        ${dark.depthBelowThreshold.toFixed(1)} ft further down but in the dark.
      </p>`;
  },
};
