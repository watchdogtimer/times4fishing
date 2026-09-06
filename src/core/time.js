/**
 * Date and clock-time helpers.
 *
 * Times of day are passed around as "local hours": a float in [0, 24) where
 * 6.5 means 6:30 AM local time. That keeps the solunar math free of Date
 * objects and timezone handling, at the cost of needing the wrap-aware
 * comparisons below.
 */

import { hoursApart, normalizeHours } from './astronomy.js';

const MINUTES_PER_HOUR = 60;

/**
 * Hours to add to local time to get UT.
 *
 * `getTimezoneOffset()` returns minutes and is positive west of Greenwich, so
 * US Pacific in winter gives +8. It's read per-date rather than once, so a
 * calendar spanning a daylight-saving change stays correct on both sides of it.
 *
 * @param {Date} date
 */
export function localToUtcOffsetHours(date) {
  return date.getTimezoneOffset() / MINUTES_PER_HOUR;
}

/**
 * Format a local-hours value as a 12-hour clock time, e.g. "6:32 AM".
 *
 * @param {number|null|undefined} localHours
 * @returns {string|null} null when there's no time to show.
 */
export function formatClockTime(localHours) {
  if (localHours === null || localHours === undefined) return null;

  let hour = Math.floor(localHours);
  let minute = Math.round((localHours - hour) * MINUTES_PER_HOUR);
  if (minute === MINUTES_PER_HOUR) {
    minute = 0;
    hour += 1;
  }
  hour = ((hour % 24) + 24) % 24;

  const meridiem = hour < 12 ? 'AM' : 'PM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${meridiem}`;
}

/**
 * A shorter clock time for tight spaces: "7:53a", "12:59p".
 *
 * The calendar grid is seven columns wide, which leaves about 37px per cell on
 * a phone — not enough for "12:59 PM" without wrapping. The full format is
 * still rendered alongside it and CSS picks whichever fits.
 */
export function formatClockTimeCompact(localHours) {
  const full = formatClockTime(localHours);
  if (full === null) return null;
  return full.replace(' AM', 'a').replace(' PM', 'p');
}

/** Shift a local-hours value, wrapping around midnight. Null passes through. */
export function addHours(localHours, delta) {
  return localHours === null ? null : normalizeHours(localHours + delta);
}

/**
 * True when two times of day are within `toleranceHours` of each other,
 * measuring across midnight if that's the shorter way round.
 *
 * @param {number|null} a
 * @param {number|null|undefined} b
 * @param {number} toleranceHours
 */
export function isWithinHours(a, b, toleranceHours) {
  if (a === null || b === null || b === undefined) return false;
  return hoursApart(a, b) <= toleranceHours;
}

/** Local calendar date as "YYYY-MM-DD". Used as a map key, so it must be stable. */
export function toDateKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** True when two Dates fall on the same local calendar day. */
export function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** A copy of `date` shifted by whole days. Never mutates the input. */
export function addDays(date, days) {
  const shifted = new Date(date);
  shifted.setDate(shifted.getDate() + days);
  return shifted;
}

/** A copy of `date` snapped back to 00:00 local time. */
export function startOfDay(date) {
  const midnight = new Date(date);
  midnight.setHours(0, 0, 0, 0);
  return midnight;
}

/**
 * Hours to add to local time to get UT, for an arbitrary IANA timezone.
 *
 * `localToUtcOffsetHours` asks the Date what the *browser's* offset is, which
 * is the right answer in the browser and the wrong one everywhere else: the
 * Worker that server-renders these pages runs in UTC, so it has to be told
 * which zone the location is in.
 *
 * Formatting the instant into the target zone and reading the pieces back is
 * the only way to get at another zone's offset without shipping a timezone
 * database. Reading it per-date rather than caching it keeps daylight saving
 * correct on both sides of a changeover.
 *
 * @param {Date} date
 * @param {string} timeZone IANA name, e.g. "America/Los_Angeles".
 */
export function utcOffsetHoursInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);

  const field = (type) => Number(parts.find((part) => part.type === type).value);
  const wallClockAsUtc = Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    field('hour'),
    field('minute'),
    field('second'),
  );

  // Positive west of Greenwich, matching localToUtcOffsetHours.
  return (date.getTime() - wallClockAsUtc) / (60 * 60 * 1000);
}

/**
 * The current calendar date in a given timezone, as a Date whose year, month
 * and day read back correctly through `getFullYear`/`getMonth`/`getDate`.
 *
 * The whole codebase treats a Date as a carrier for a *calendar date* and keeps
 * the time-of-day separate as local hours, which is what lets the astronomy run
 * anywhere as long as it's handed the right UTC offset. This builds such a Date
 * for another zone: noon is used rather than midnight so no amount of
 * daylight-saving arithmetic can tip it into the neighbouring day.
 *
 * @param {string} timeZone IANA name.
 * @param {Date} [now]
 */
export function todayInZone(timeZone, now = new Date()) {
  const [month, day, year] = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(now)
    .split('/')
    .map(Number);
  return new Date(year, month - 1, day, 12);
}

/**
 * Seconds until the next local midnight in a timezone.
 *
 * The whole point of the server-rendered pages is that one render is good for
 * everyone for the rest of that place's day, so this is the cache lifetime.
 * Floored at a minute so a request landing exactly on midnight can't ask for a
 * zero or negative max-age.
 *
 * @param {string} timeZone IANA name.
 * @param {Date} [now]
 */
export function secondsUntilMidnightInZone(timeZone, now = new Date()) {
  const offsetHours = utcOffsetHoursInZone(now, timeZone);
  const localMs = now.getTime() - offsetHours * 60 * 60 * 1000;
  const msIntoDay = ((localMs % 86400000) + 86400000) % 86400000;
  return Math.max(60, Math.round((86400000 - msIntoDay) / 1000));
}
