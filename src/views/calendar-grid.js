/**
 * The four-week calendar grid.
 *
 * Each in-range cell shows the day number, the start of its best window, and a
 * gauge for the 0-5 rating. Days outside the range are still rendered so the
 * grid starts on a Sunday and ends on a Saturday, but they're dimmed and inert.
 */

import { bestWindow, secondBestWindow } from '../core/day.js';
import { formatClockTime, formatClockTimeCompact, isSameDay, toDateKey } from '../core/time.js';

const DAYS_PER_WEEK = 7;
const MAX_RATING = 5;

/**
 * How a rating is described and coloured.
 *
 * The tiers themselves live on the profile, because the words differ: a bad
 * fishing day is "Quiet" and worth a punt anyway, a bad tidepooling day is
 * "Skip it" and genuinely is.
 *
 * The cell used to colour itself gold when the day's best window happened to
 * carry a sun or tide bonus, which is a different question from whether the
 * day is any good — the gold day was actually the worse of the pair about 1
 * time in 10. Colour now follows the rating, so gold really does mean better,
 * and the filled-dot count says the same thing again for anyone who can't rely
 * on the colour.
 */
const tierFor = (rating, profile) => profile.ratingTiers.find((tier) => rating >= tier.min);

/**
 * Render the grid into `container`.
 *
 * @param {object} options
 * @param {HTMLElement} options.container
 * @param {Date} options.rangeStart First day in the range.
 * @param {Date} options.rangeEnd   Last day in the range.
 * @param {Date} options.today
 * @param {(date: Date) => object} options.forecastFor
 * @param {(forecast: object, cell: HTMLElement) => void} options.onSelectDay
 * @param {import('../config.js').Profile} options.profile
 * @param {import('../core/weather.js').WeatherOutlook} [options.weather] Only
 *   covers about the next week, so most cells get nothing and that's expected.
 */
export function renderCalendarGrid({
  container,
  rangeStart,
  rangeEnd,
  today,
  forecastFor,
  onSelectDay,
  profile,
  weather,
}) {
  container.replaceChildren();

  // Pad out to whole weeks so the grid lines up under the weekday headings.
  const gridStart = new Date(rangeStart);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());
  const gridEnd = new Date(rangeEnd);
  gridEnd.setDate(gridEnd.getDate() + (DAYS_PER_WEEK - 1 - gridEnd.getDay()));

  for (let cursor = new Date(gridStart); cursor <= gridEnd; cursor.setDate(cursor.getDate() + 1)) {
    const date = new Date(cursor);
    const inRange = date >= rangeStart && date <= rangeEnd;
    container.append(
      inRange
        ? buildDayCell(
            date,
            today,
            forecastFor(date),
            onSelectDay,
            profile,
            weather?.byDate?.[toDateKey(date)] ?? null,
          )
        : buildOutOfRangeCell(date),
    );
  }
}

function buildOutOfRangeCell(date) {
  const cell = document.createElement('div');
  cell.className = 'cell out-of-range';
  cell.setAttribute('aria-hidden', 'true');
  cell.innerHTML = `<div class="num">${date.getDate()}</div>`;
  return cell;
}

/**
 * The one time a cell has room for.
 *
 * Fishing wants the window's start, because that's when to be there. Tidepooling
 * wants the low itself: its windows run for hours and often get clipped at
 * midnight, so a start time is both less useful and sometimes just "12:00 AM".
 */
function cellTime(window, profile) {
  return profile.cellTime?.(window) ?? window.start;
}

function buildDayCell(date, today, forecast, onSelectDay, profile, dayWeather) {
  const best = bestWindow(forecast);
  const second = secondBestWindow(forecast);
  const tier = tierFor(forecast.rating, profile);

  // A real button so it's keyboard reachable and announced as clickable.
  const cell = document.createElement('button');
  cell.type = 'button';
  cell.className = `cell ${tier.className}${isSameDay(date, today) ? ' today' : ''}`;
  cell.setAttribute(
    'aria-label',
    `${date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}: ` +
      `${tier.name}, ${forecast.rating} out of ${MAX_RATING}` +
      `${best ? `. Best window from ${formatClockTime(cellTime(best, profile))}` : ''}` +
      `${second ? `, second best from ${formatClockTime(cellTime(second, profile))}` : ''}`,
  );

  // Two times rather than one: the best window often isn't the one that fits
  // your day, and the runner-up is a real alternative about a third of the time.
  cell.innerHTML = `
    <div class="num">${date.getDate()}</div>
    <div class="rating" title="${tier.name} — ${forecast.rating}/${MAX_RATING}">${renderDots(
      forecast.rating,
    )}</div>
    <div class="times">
      <div class="best">${best ? renderTime(cellTime(best, profile)) : '—'}</div>
      ${
        second
          ? `<div class="second"><span class="or">or </span>${renderTime(cellTime(second, profile))}</div>`
          : ''
      }
    </div>
    ${renderWeatherLine(dayWeather)}`;

  cell.addEventListener('click', () => onSelectDay(forecast, cell));
  return cell;
}

/** Both spellings of a time; the stylesheet shows whichever the column can fit. */
function renderTime(localHours) {
  return (
    `<span class="full">${formatClockTime(localHours)}</span>` +
    `<span class="compact">${formatClockTimeCompact(localHours)}</span>`
  );
}

/**
 * The weather strip at the foot of a cell, for the week the forecast reaches.
 *
 * Kept to two numbers because that's what fits, and because they're the two that
 * change whether you go: how warm it is and how hard it's blowing. The strip is
 * simply absent beyond the forecast horizon rather than showing a placeholder,
 * so the edge of what's known is visible at a glance.
 */
function renderWeatherLine(dayWeather) {
  if (!dayWeather || dayWeather.highF === null) return '';
  const wind = dayWeather.windMph === null ? '' : ` <span class="wind">${dayWeather.windMph}mph</span>`;
  return `<div class="wx">${dayWeather.highF}°${wind}</div>`;
}

/** The rating as filled and empty dots, countable at a glance across the grid. */
function renderDots(rating) {
  return Array.from(
    { length: MAX_RATING },
    (_, index) => `<i class="${index < rating ? 'on' : 'off'}"></i>`,
  ).join('');
}
