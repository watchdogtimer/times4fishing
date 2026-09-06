/**
 * The day's tide curve, with the profile's windows drawn on top of it.
 *
 * Rendered as inline SVG built from a string. There's no chart library here on
 * purpose: it's one chart with one shape, and hand-rolling it keeps the app a
 * dependency-free set of static files.
 *
 * The chart is drawn in its own fixed coordinate space (VIEWBOX below) and
 * scaled to fit its container by the viewBox attribute, so every number in this
 * file is in those units, not screen pixels. The aspect ratio is preserved so
 * the labels don't stretch.
 */

import { formatClockTime } from '../core/time.js';

const VIEWBOX = { width: 720, height: 224 };

/** Space reserved outside the plot area for axis labels and the band captions. */
const PADDING = { top: 36, right: 14, bottom: 26, left: 38 };

const PLOT = {
  left: PADDING.left,
  right: VIEWBOX.width - PADDING.right,
  top: PADDING.top,
  bottom: VIEWBOX.height - PADDING.bottom,
};
const PLOT_WIDTH = PLOT.right - PLOT.left;
const PLOT_HEIGHT = PLOT.bottom - PLOT.top;

const HOURS_PER_DAY = 24;
const X_AXIS_TICK_HOURS = 3;
const Y_AXIS_GRIDLINES = 4;

/** Headroom above and below the curve, as a fraction of its range. */
const VERTICAL_PADDING_RATIO = 0.18;

/** Fallback height range (feet) when there's no tide data to scale to. */
const PLACEHOLDER_HEIGHT_RANGE = { min: 0, max: 1 };

/**
 * Peak opacity of each window band.
 *
 * Gold is reserved for the single best window of the day. It used to mark any
 * window that picked up a sun or tide bonus, which was actively misleading: a
 * bonus-carrying minor period scores *lower* than a plain major, so the eye was
 * being pulled to the wrong band about a fifth of the time.
 */
const BAND_PEAK_OPACITY = { best: 0.32, second: 0.24, heavy: 0.17, light: 0.11 };

/**
 * A window's `weight` (0-1) chosen by the profile, mapped onto the two band
 * shades the chart draws. The chart deliberately doesn't know *why* one window
 * outranks another: fishing sets weight by major/minor, tidepooling by how far
 * below the threshold the water drops, and both just want "heavier" or
 * "lighter" out of it.
 */
const HEAVY_BAND_WEIGHT = 0.75;

/**
 * Opacity at the edge of a band, as a fraction of its peak.
 *
 * The windows are hard-edged in the model (a major is exactly two hours) but
 * fish don't switch off on the hour. Fading the shoulders says "peak here,
 * tapering either side" without claiming a precision the model doesn't have.
 */
const BAND_EDGE_RATIO = 0.3;

/**
 * Build the tide chart for one day.
 *
 * Works with or without tide data: without it you still get whatever windows
 * the profile produced, the daylight band and the hour axis. That matters for
 * fishing, which has plenty to say from the sun and moon alone; tidepooling
 * simply produces no windows without a station, and says so.
 *
 * @param {import('../core/day.js').DayFacts} forecast Already carries the
 *   sampled `tideCurve`, so the chart draws exactly the samples the scoring saw.
 * @param {Date} [now] Current time, for the "now" marker. Omit to hide it.
 * @returns {string} SVG markup.
 */
export function renderTideChart(forecast, profile, now) {
  const curve = forecast.tideCurve ?? [];
  const scale = buildVerticalScale(curve);

  const bands = renderWindowBands(forecast, profile);
  const layers = [
    `<defs>${bands.gradients}</defs>`,
    renderDaylightBand(forecast),
    bands.markup,
    renderGridlines(scale, curve.length > 0),
    renderTideCurve(curve, scale),
    renderTideExtremes(forecast.tides, scale),
    renderSunMarkers(forecast),
    renderNowMarker(forecast, now),
    renderHourAxis(),
  ];

  return `
    <svg class="tide-chart" viewBox="0 0 ${VIEWBOX.width} ${VIEWBOX.height}"
         role="img"
         aria-label="${describeChart(forecast, profile, curve.length > 0)}">
      ${layers.join('\n')}
    </svg>`;
}

/* ---------------------------------------------------------------- *
 * Coordinate mapping
 * ---------------------------------------------------------------- */

/** Local hour (0-24) to an x coordinate. */
const xForHour = (hour) => PLOT.left + (hour / HOURS_PER_DAY) * PLOT_WIDTH;

/**
 * Work out the vertical range to draw, with a little headroom so the peaks and
 * troughs don't touch the edges of the plot.
 *
 * @returns {{min: number, max: number, y: (height: number) => number}}
 */
function buildVerticalScale(curve) {
  let { min, max } = PLACEHOLDER_HEIGHT_RANGE;

  if (curve.length > 0) {
    const heights = curve.map((sample) => sample.height);
    min = Math.min(...heights);
    max = Math.max(...heights);
    // A dead-flat curve would divide by zero below; give it an arbitrary range.
    if (max - min < 0.01) max = min + 1;

    const headroom = (max - min) * VERTICAL_PADDING_RATIO;
    min -= headroom;
    max += headroom;
  }

  const y = (height) => PLOT.bottom - ((height - min) / (max - min)) * PLOT_HEIGHT;
  return { min, max, y };
}

/* ---------------------------------------------------------------- *
 * Layers, drawn back to front
 * ---------------------------------------------------------------- */

/** Shade the hours between sunrise and sunset, so night reads as the darker part. */
function renderDaylightBand({ sunrise, sunset }) {
  if (sunrise === null || sunset === null) return '';

  // Above the arctic circle, or for a location where the sun sets after
  // midnight, daylight wraps around the end of the day.
  const spans = sunset > sunrise ? [[sunrise, sunset]] : [[0, sunset], [sunrise, HOURS_PER_DAY]];

  return spans
    .map(([from, to]) => {
      const x = xForHour(from);
      const width = xForHour(to) - x;
      return `<rect class="chart-daylight" x="${x}" y="${PLOT.top}" width="${width}" height="${PLOT_HEIGHT}"/>`;
    })
    .join('');
}

/**
 * The windows, as soft-edged vertical bands with captions above them.
 *
 * A window centred near midnight runs off one edge and back in the other, so
 * each one can turn into two rectangles. The fade is computed against the
 * *whole* window rather than each rectangle, so a split window still reads as
 * one shape with its peak in the right place.
 *
 * @returns {{markup: string, gradients: string}} The gradients belong in <defs>.
 */
function renderWindowBands({ windows }, profile) {
  const markup = [];
  const gradients = [];

  windows.forEach((window, windowIndex) => {
    const peakOpacity =
      BAND_PEAK_OPACITY[
        window.rank === 1
          ? 'best'
          : window.rank === 2
            ? 'second'
            : window.weight >= HEAVY_BAND_WEIGHT
              ? 'heavy'
              : 'light'
      ];
    const color = window.rank === 1 ? 'var(--brass)' : 'var(--kelp)';
    const spanHours = hoursBetween(window.start, window.end);

    splitAtMidnight(window.start, window.end).forEach(([from, to], partIndex) => {
      const gradientId = `window-${windowIndex}-${partIndex}`;
      // Where this rectangle sits within the whole window, as fractions 0..1.
      const fromFraction = hoursBetween(window.start, from) / spanHours;
      const toFraction = hoursBetween(window.start, to) / spanHours;

      gradients.push(bandGradient(gradientId, color, peakOpacity, fromFraction, toFraction));

      const x = xForHour(from);
      markup.push(
        `<rect class="chart-window" x="${x}" y="${PLOT.top}" width="${xForHour(to) - x}"` +
          ` height="${PLOT_HEIGHT}" fill="url(#${gradientId})">` +
          `<title>${describeWindow(window, profile)}</title></rect>`,
      );
    });

    markup.push(renderWindowCaption(window));
  });

  return { markup: markup.join('\n'), gradients: gradients.join('') };
}

/**
 * A horizontal gradient that peaks in the middle of the window and fades at
 * both shoulders, clipped to the slice this rectangle covers.
 */
function bandGradient(id, color, peakOpacity, fromFraction, toFraction) {
  const edgeOpacity = peakOpacity * BAND_EDGE_RATIO;
  /** Triangular ramp: full at the centre of the window, `edge` at either end. */
  const opacityAt = (fraction) =>
    edgeOpacity + (peakOpacity - edgeOpacity) * (1 - Math.abs(2 * fraction - 1));

  const stop = (offset, opacity) =>
    `<stop offset="${offset.toFixed(3)}" stop-color="${color}" stop-opacity="${opacity.toFixed(3)}"/>`;

  const stops = [stop(0, opacityAt(fromFraction))];
  // Only include the peak if this slice actually contains the window's centre.
  if (fromFraction < 0.5 && toFraction > 0.5) {
    stops.push(stop((0.5 - fromFraction) / (toFraction - fromFraction), peakOpacity));
  }
  stops.push(stop(1, opacityAt(toFraction)));

  return `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0">${stops.join('')}</linearGradient>`;
}

/**
 * The caption above a band: what the window is, and whether it's the best one.
 *
 * The *reason* a window is good (a tide change, sunrise) isn't spelled out here
 * on purpose. The chart already shows it: the band visibly contains the tide
 * dot or the dashed sun line. Words would just crowd the top of the plot.
 */
function renderWindowCaption(window) {
  const x = xForHour(window.center);
  const anchor = labelAnchorFor(x);
  const rankName = { 1: 'BEST', 2: '2ND BEST' }[window.rank];
  const rankClass = { 1: ' best', 2: ' second' }[window.rank] ?? '';

  const rankLine = rankName
    ? `<text class="chart-window-label${rankClass}" x="${x}" y="${
        PLOT.top - 20
      }" text-anchor="${anchor}">${rankName}</text>`
    : '';
  return `${rankLine}<text class="chart-window-label${rankClass}" x="${x}" y="${
    PLOT.top - 8
  }" text-anchor="${anchor}">${window.label.toUpperCase()}</text>`;
}

/**
 * Tooltip text: here the reason is worth spelling out, since there's room.
 *
 * The notes are the profile's business, so it supplies them and the chart just
 * joins them up.
 */
function describeWindow(window, profile) {
  const notes = profile.describeWindow?.(window) ?? [];
  const detail = notes.length > 0 ? ` (${notes.join(', ')})` : '';
  return `${window.label}, ${formatClockTime(window.start)} to ${formatClockTime(
    window.end,
  )}${detail}`;
}

/** Horizontal gridlines with height labels, plus the baseline under the plot. */
function renderGridlines(scale, hasTideData) {
  const baseline = `<line class="chart-axis" x1="${PLOT.left}" y1="${PLOT.bottom}" x2="${PLOT.right}" y2="${PLOT.bottom}"/>`;
  if (!hasTideData) return baseline;

  const lines = [];
  for (let i = 0; i <= Y_AXIS_GRIDLINES; i++) {
    const height = scale.min + ((scale.max - scale.min) * i) / Y_AXIS_GRIDLINES;
    const y = scale.y(height);
    lines.push(
      `<line class="chart-grid" x1="${PLOT.left}" y1="${y}" x2="${PLOT.right}" y2="${y}"/>`,
      `<text class="chart-tick" x="${PLOT.left - 7}" y="${y + 3}" text-anchor="end">${height.toFixed(1)}</text>`,
    );
  }
  // Mean lower low water is the datum tides are measured from, so zero is worth
  // calling out whenever it's actually on screen.
  if (scale.min < 0 && scale.max > 0) {
    const y = scale.y(0);
    lines.push(`<line class="chart-datum" x1="${PLOT.left}" y1="${y}" x2="${PLOT.right}" y2="${y}"/>`);
  }
  return lines.join('') + baseline;
}

/** The curve itself, plus a soft fill down to the baseline. */
function renderTideCurve(curve, scale) {
  if (curve.length === 0) {
    return `<text class="chart-empty" x="${PLOT.left + PLOT_WIDTH / 2}" y="${
      PLOT.top + PLOT_HEIGHT / 2
    }" text-anchor="middle">Set a NOAA station to see the tide curve</text>`;
  }

  const points = curve.map((s) => `${xForHour(s.hour).toFixed(1)},${scale.y(s.height).toFixed(1)}`);
  const line = `M ${points.join(' L ')}`;
  const area = `${line} L ${PLOT.right},${PLOT.bottom} L ${PLOT.left},${PLOT.bottom} Z`;

  return `<path class="chart-tide-area" d="${area}"/><path class="chart-tide-line" d="${line}"/>`;
}

/** Dots and labels on each high and low water. */
function renderTideExtremes(tides, scale) {
  return tides
    .map((tide) => {
      const x = xForHour(tide.hour);
      const y = scale.y(tide.height);
      const isHigh = tide.type === 'H';
      // Keep the label inside the plot: highs get labelled above, lows below.
      const labelY = isHigh ? y - 10 : y + 17;
      const anchor = labelAnchorFor(x);

      return `
        <circle class="chart-extreme ${isHigh ? 'high' : 'low'}" cx="${x}" cy="${y}" r="3.5"/>
        <text class="chart-extreme-label ${isHigh ? 'high' : 'low'}" x="${x}" y="${labelY}"
              text-anchor="${anchor}">${tide.height.toFixed(1)} ft ${formatClockTime(tide.hour)}</text>`;
    })
    .join('\n');
}

/** Sunrise and sunset ticks along the bottom axis. */
function renderSunMarkers({ sunrise, sunset }) {
  return [
    ['Sunrise', sunrise],
    ['Sunset', sunset],
  ]
    .filter(([, hour]) => hour !== null)
    .map(([label, hour]) => {
      const x = xForHour(hour);
      return `
        <line class="chart-sun-line" x1="${x}" y1="${PLOT.top}" x2="${x}" y2="${PLOT.bottom}"/>
        <text class="chart-sun-label" x="${x}" y="${PLOT.bottom + 11}"
              text-anchor="${labelAnchorFor(x)}">${label}</text>`;
    })
    .join('\n');
}

/** A vertical line at the current time, but only when we're showing today. */
function renderNowMarker(forecast, now) {
  if (!now) return '';
  const isToday =
    now.getFullYear() === forecast.date.getFullYear() &&
    now.getMonth() === forecast.date.getMonth() &&
    now.getDate() === forecast.date.getDate();
  if (!isToday) return '';

  const x = xForHour(now.getHours() + now.getMinutes() / 60);
  return `
    <line class="chart-now" x1="${x}" y1="${PLOT.top - 4}" x2="${x}" y2="${PLOT.bottom}"/>
    <text class="chart-now-label" x="${x}" y="${PLOT.top - 12}" text-anchor="${labelAnchorFor(x)}">now</text>`;
}

/** Hour labels along the bottom. */
function renderHourAxis() {
  const labels = [];
  for (let hour = 0; hour <= HOURS_PER_DAY; hour += X_AXIS_TICK_HOURS) {
    const x = xForHour(hour);
    labels.push(
      `<text class="chart-tick" x="${x}" y="${PLOT.bottom + 22}" text-anchor="${labelAnchorFor(
        x,
      )}">${formatHourLabel(hour)}</text>`,
    );
  }
  return labels.join('');
}

/* ---------------------------------------------------------------- *
 * Small helpers
 * ---------------------------------------------------------------- */

/** Length of an hour range, counting forward across midnight if it wraps. */
function hoursBetween(from, to) {
  return ((to - from) % HOURS_PER_DAY + HOURS_PER_DAY) % HOURS_PER_DAY;
}

/** Split an hour range that wraps past midnight into ranges that don't. */
function splitAtMidnight(start, end) {
  return end >= start ? [[start, end]] : [[start, HOURS_PER_DAY], [0, end]];
}

/** Nudge labels inward at the edges of the plot so they aren't clipped. */
function labelAnchorFor(x) {
  const EDGE = 28;
  if (x < PLOT.left + EDGE) return 'start';
  if (x > PLOT.right - EDGE) return 'end';
  return 'middle';
}

/** "12a", "6a", "12p" — compact enough to fit at every tick. */
function formatHourLabel(hour) {
  const h = hour % HOURS_PER_DAY;
  const meridiem = h < 12 ? 'a' : 'p';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${meridiem}`;
}

/** Text alternative for screen readers. */
function describeChart(forecast, profile, hasTideData) {
  const date = forecast.date.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
  const tidePart = hasTideData
    ? `${forecast.tides.length} tide changes`
    : 'no tide data for this location';
  const best = forecast.windows.find((window) => window.rank === 1);
  const bestPart = best
    ? ` Best window: ${best.label.toLowerCase()}, ${formatClockTime(best.start)} to ${formatClockTime(best.end)}.`
    : '';
  return `Tide and ${profile.windowNoun} chart for ${date}: ${tidePart}, ${forecast.windows.length} ${profile.windowNoun}s.${bestPart}`;
}
