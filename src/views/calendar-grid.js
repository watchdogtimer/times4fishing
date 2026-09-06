/**
 * The four-week calendar grid.
 *
 * Each in-range cell shows the day number, the start of its best window, and a
 * gauge for the 0-5 rating. Days outside the range are still rendered so the
 * grid starts on a Sunday and ends on a Saturday, but they're dimmed and inert.
 */

import { bestWindow } from '../solunar.js';
import { formatClockTime, isSameDay } from '../time.js';

const DAYS_PER_WEEK = 7;

/**
 * Render the grid into `container`.
 *
 * @param {object} options
 * @param {HTMLElement} options.container
 * @param {Date} options.rangeStart First day in the range.
 * @param {Date} options.rangeEnd   Last day in the range.
 * @param {Date} options.today
 * @param {(date: Date) => import('../solunar.js').DayForecast} options.forecastFor
 * @param {(forecast: import('../solunar.js').DayForecast, cell: HTMLElement) => void} options.onSelectDay
 */
export function renderCalendarGrid({ container, rangeStart, rangeEnd, today, forecastFor, onSelectDay }) {
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
        ? buildDayCell(date, today, forecastFor(date), onSelectDay)
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

function buildDayCell(date, today, forecast, onSelectDay) {
  const best = bestWindow(forecast);
  const isPrime = best?.prime ?? false;

  // A real button so it's keyboard reachable and announced as clickable.
  const cell = document.createElement('button');
  cell.type = 'button';
  cell.className = `cell${isSameDay(date, today) ? ' today' : ''}`;
  cell.setAttribute(
    'aria-label',
    `${date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}, ` +
      `rated ${forecast.rating} out of 5`,
  );

  const bestLine = best
    ? `${isPrime ? '<b>Prime</b> · ' : ''}${formatClockTime(best.start)}`
    : '—';
  const gaugePercent = (forecast.rating / 5) * 100;

  cell.innerHTML = `
    <div class="num">${date.getDate()}</div>
    <div class="bestline">${bestLine}</div>
    <div class="gauge${isPrime ? ' prime' : ''}"><i style="width:${gaugePercent}%"></i></div>`;

  cell.addEventListener('click', () => onSelectDay(forecast, cell));
  return cell;
}
