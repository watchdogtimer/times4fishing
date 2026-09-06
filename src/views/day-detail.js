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
 * @param {import('../core/weather.js').DayWeather|null} [options.weather] Null
 *   beyond the forecast horizon, which is most of the calendar.
 * @param {number|null} [options.waterTempF]
 */
export function renderDayDetail({ container, forecast, profile, weather, waterTempF }) {
  const heading = forecast.date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const illuminatedPercent = Math.round(forecast.phase.illuminatedFraction * 100);
  const moonCaption = profile.moonCaption(forecast.phase);

  container.innerHTML = `
    <h2>${heading}</h2>
    <div class="sub">Rating ${forecast.rating} / 5 · ${moonCaption} (${illuminatedPercent}% illuminated)</div>
    ${renderWeather(weather, waterTempF)}

    <div class="chart-panel">
      ${renderTideChart(forecast, profile, new Date())}
      <p class="chart-caption">${profile.chartCaption}</p>
    </div>

    <div class="cols3">
      <section>
        <h3>${profile.factsHeading}</h3>
        ${renderFacts(profile, forecast)}
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

/**
 * The weather row, for days inside the forecast horizon.
 *
 * Explicitly labelled as a forecast and kept visually separate from the tide and
 * astronomy numbers above it, because they are not the same kind of claim: the
 * tide times are published predictions good for years, this is a guess about
 * next Tuesday.
 */
function renderWeather(weather, waterTempF) {
  const parts = [];
  if (weather && weather.highF !== null) {
    parts.push(`${weather.highF}° / ${weather.lowF}°`);
    if (weather.windMph !== null) {
      const gust = weather.gustMph ? ` (gusting ${weather.gustMph})` : '';
      parts.push(`wind ${weather.windMph} mph${gust}`);
    }
    if (weather.cloudPercent !== null) parts.push(`${weather.cloudPercent}% cloud`);
    if (weather.precipPercent) parts.push(`${weather.precipPercent}% chance of rain`);
    if (weather.waveFt !== null && weather.waveFt !== undefined) {
      const period = weather.swellPeriodS ? ` at ${Math.round(weather.swellPeriodS)}s` : '';
      parts.push(`surf ${Math.round(weather.waveFt)} ft${period}`);
    }
  }
  if (waterTempF !== null && waterTempF !== undefined) parts.push(`water ${waterTempF}°`);

  if (parts.length === 0) return '';
  return `<div class="wx-row"><span class="wx-label">Forecast</span>${parts.join(' · ')}</div>`;
}

function renderFacts(profile, forecast) {
  return profile
    .dayFacts(forecast)
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
