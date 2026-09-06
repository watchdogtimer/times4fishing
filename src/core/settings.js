/**
 * The handful of choices worth remembering between visits.
 *
 * Deliberately `localStorage` rather than a cookie. The Worker serves the app
 * shell from cache with `s-maxage=3600`, shared across everyone on the domain —
 * a cookie would either be ignored by that cache or force the shell to vary per
 * visitor, which would throw away the caching for no gain. Nothing here is
 * needed server-side: the shell is identical for every visitor and the calendar
 * is built in the browser, so the browser is the right place to keep it.
 *
 * Storage is per-origin, so times4fishing and times4tidepooling keep their own
 * settings without any work on our part.
 */

const STORAGE_KEY = 'times4:settings';

/**
 * @typedef {object} SavedSettings
 * @property {number} latitude
 * @property {number} longitude
 * @property {string|null} stationId
 * @property {string} placeLabel Whatever the location line said when this was saved.
 * @property {boolean} includeSleepingHours
 */

/**
 * Read saved settings, or null if there aren't any usable ones.
 *
 * Every failure mode returns null rather than throwing: storage can be
 * unavailable (private windows, browsers set to block site data — where even
 * *reading* `localStorage` throws), empty, or hold something from an older
 * version of the app. None of those should stop the page loading.
 *
 * @returns {SavedSettings|null}
 */
export function loadSettings() {
  let raw;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    // Coordinates are the one part we can't sanely default, so a saved blob
    // without valid ones is worth nothing and gets thrown away.
    if (!isValidLatitude(parsed?.latitude) || !isValidLongitude(parsed?.longitude)) return null;

    return {
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      stationId: typeof parsed.stationId === 'string' && parsed.stationId ? parsed.stationId : null,
      placeLabel: typeof parsed.placeLabel === 'string' ? parsed.placeLabel : '',
      includeSleepingHours: parsed.includeSleepingHours === true,
    };
  } catch {
    return null;
  }
}

/**
 * Remember the current settings. Silently does nothing if storage is blocked,
 * which is the right outcome: the app works fine without it.
 *
 * @param {SavedSettings} settings
 */
export function saveSettings(settings) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Full, blocked, or unavailable. Not worth telling the user about.
  }
}

/** Forget everything. Here so a future "reset" control has something to call. */
export function clearSettings() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // As above.
  }
}

export const isValidLatitude = (value) => Number.isFinite(value) && Math.abs(value) <= 90;
export const isValidLongitude = (value) => Number.isFinite(value) && Math.abs(value) <= 180;
