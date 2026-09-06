/**
 * The detail panel shown when a day is clicked: the tide chart, the sun and
 * moon times, the ranked fishing windows, and the day's tide table.
 */

import { formatClockTime } from '../time.js';
import { renderTideChart } from './tide-chart.js';

/**
 * @param {object} options
 * @param {HTMLElement} options.container The panel element.
 * @param {import('../solunar.js').DayForecast} options.forecast
 * @param {import('../tides.js').TideEvent[]} options.tideEvents All loaded
 *   events, so the chart can interpolate across midnight.
 */
export function renderDayDetail({ container, forecast, tideEvents }) {
  const heading = forecast.date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const illuminatedPercent = Math.round(forecast.phase.illuminatedFraction * 100);

  container.innerHTML = `
    <h2>${heading}</h2>
    <div class="sub">Rating ${forecast.rating} / 5 · ${forecast.phase.name} (${illuminatedPercent}% illuminated)</div>

    <div class="chart-panel">
      ${renderTideChart(forecast, tideEvents, new Date())}
      <p class="chart-caption">
        Tide height through the day. Shaded bands are fishing windows, and the gold one is
        the day's best. Wider bands are major periods (2 hours), narrow ones minor (1 hour).
        The lighter background is daylight.
      </p>
    </div>

    <div class="cols3">
      <section>
        <h3>Sun &amp; moon</h3>
        ${renderFacts(forecast)}
      </section>
      <section class="windows">
        <h3>Best windows today</h3>
        ${renderWindows(forecast.windows)}
      </section>
      <section class="tides">
        <h3>Tides</h3>
        ${renderTideTable(forecast.tides)}
      </section>
    </div>`;

  container.classList.add('show');
}

function renderFacts(forecast) {
  const facts = [
    ['Sunrise', forecast.sunrise],
    ['Sunset', forecast.sunset],
    ['Moonrise', forecast.moonrise],
    ['Moonset', forecast.moonset],
    ['Moon overhead', forecast.moonOverhead],
    ['Moon underfoot', forecast.moonUnderfoot],
  ];
  return facts
    .map(
      ([label, hour]) =>
        `<div class="fact"><span>${label}</span><span>${formatClockTime(hour) ?? '—'}</span></div>`,
    )
    .join('');
}

function renderWindows(windows) {
  if (windows.length === 0) {
    return '<p class="empty">No events computed for this location and date.</p>';
  }

  return windows
    .map((window) => {
      const notes = [window.label];
      if (window.fishableFraction < 0.5) notes.push('outside fishable hours');
      if (window.sunEvent) notes.push(`near ${window.sunEvent}`);
      if (window.tideEvent) {
        const kind = window.tideEvent.type === 'H' ? 'high' : 'low';
        notes.push(`near ${kind} tide (${window.tideEvent.height.toFixed(1)} ft)`);
      }
      return `
        <div class="win-row${window.isBest ? ' best' : ''}">
          <span class="tag">${window.kind}</span>
          <span class="time">${formatClockTime(window.start)} – ${formatClockTime(window.end)}</span>
          ${window.isBest ? '<span class="best-tag">Best</span>' : ''}
          <span class="note">${notes.join(' · ')}</span>
        </div>`;
    })
    .join('');
}

function renderTideTable(tides) {
  if (tides.length === 0) return '<p class="empty">No tide station set.</p>';

  return tides
    .map(
      (tide) => `
        <div class="tide-row">
          <span class="${tide.type === 'H' ? 'h' : 'l'}">${tide.type === 'H' ? 'High' : 'Low'}</span>
          <span>${formatClockTime(tide.hour)} · ${tide.height.toFixed(1)} ft</span>
        </div>`,
    )
    .join('');
}
