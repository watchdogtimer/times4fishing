/**
 * The detail panel shown when a day is clicked: the tide chart, the sun and
 * moon times, the ranked windows, and the day's tide table.
 *
 * Everything that would name an activity is delegated to the profile. The panel
 * knows there are windows with ranks and notes; it doesn't know whether a note
 * says "near sunrise" or "1.8 ft below the usual low".
 */

import { formatClockTime } from '../core/time.js';
import { renderTideChart } from './tide-chart.js';

/**
 * @param {object} options
 * @param {HTMLElement} options.container The panel element.
 * @param {object} options.forecast
 * @param {import('../config.js').Profile} options.profile
 */
export function renderDayDetail({ container, forecast, profile }) {
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
      ${renderTideChart(forecast, profile, new Date())}
      <p class="chart-caption">${profile.chartCaption}</p>
    </div>

    <div class="cols3">
      <section>
        <h3>Sun &amp; moon</h3>
        ${renderFacts(forecast)}
      </section>
      <section class="windows">
        <h3>${profile.windowsHeading}</h3>
        ${renderWindows(forecast.windows, profile)}
        ${profile.dayNote?.(forecast) ?? ''}
      </section>
      <section class="tides">
        <h3>Tides</h3>
        ${renderTideTable(forecast.tides, profile)}
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

function renderWindows(windows, profile) {
  if (windows.length === 0) {
    return `<p class="empty">${profile.emptyWindowsNote}</p>`;
  }

  return windows
    .map((window) => {
      const notes = [window.label, ...(profile.describeWindow?.(window) ?? [])];
      const rankTag = { 1: 'Best', 2: '2nd best' }[window.rank];
      const rankClass = { 1: ' best', 2: ' second' }[window.rank] ?? '';
      return `
        <div class="win-row${rankClass}">
          <span class="tag">${window.tag ?? ''}</span>
          <span class="time">${formatClockTime(window.start)} – ${formatClockTime(window.end)}</span>
          ${rankTag ? `<span class="rank-tag">${rankTag}</span>` : ''}
          <span class="note">${notes.join(' · ')}</span>
        </div>`;
    })
    .join('');
}

function renderTideTable(tides, profile) {
  if (tides.length === 0) {
    return `<p class="empty">${
      profile.requiresTideStation
        ? 'No tide station set. This site needs one.'
        : 'No tide station set.'
    }</p>`;
  }

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
