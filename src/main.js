/**
 * Application entry point: holds the UI state and wires the controls to the views.
 *
 * The data flow is one-directional and deliberately dumb. Any change to the
 * location, station or page updates `state`, then calls `refresh()`, which
 * re-fetches tides if needed and re-renders the whole calendar. At four weeks
 * of cells that's cheap, and it means there's no partial-update logic to get
 * wrong.
 */

import { activeProfile, supportLinkHtml } from './config.js';
import { escapeHtml } from './core/html.js';
import { computeDayForecast } from './core/day.js';
import {
  emptyTideData,
  fetchTidePredictions,
  findNearestStation,
  sampleTideCurve,
} from './core/tides.js';
import { addDays, isSameDay, startOfDay, toDateKey } from './core/time.js';
import { nearbyLocations, nearestMarinePoint } from './locations.js';
import { loadSettings, saveSettings } from './core/settings.js';
import { emptyOutlook, fetchWeatherOutlook } from './core/weather.js';
import { stationTideStats } from './profiles/tidepooling.js';
import { renderCalendarGrid } from './views/calendar-grid.js';
import { renderMoonPhase } from './views/moon-phase.js';
import { renderDayDetail } from './views/day-detail.js';

/** Which site this is. Decided by hostname, so both run from one deployment. */
const profile = activeProfile();

/** One page of the calendar is four weeks. */
const DAYS_PER_PAGE = 28;

/** San Diego, CA — somewhere to start before the user sets a location. */
const DEFAULT_LOCATION = { latitude: 32.7157, longitude: -117.1611 };
const DEFAULT_PLACE_LABEL = 'San Diego, CA (default)';

const elements = {
  grid: document.getElementById('grid'),
  detail: document.getElementById('detail'),
  rangeLabel: document.getElementById('rangeLabel'),
  moonToday: document.getElementById('moonToday'),
  tideStatus: document.getElementById('tideStatus'),
  place: document.getElementById('place'),
  latitude: document.getElementById('lat'),
  longitude: document.getElementById('lon'),
  station: document.getElementById('station'),
  update: document.getElementById('recalc'),
  locate: document.getElementById('locate'),
  findStation: document.getElementById('findStation'),
  previousPage: document.getElementById('prevPage'),
  nextPage: document.getElementById('nextPage'),
  includeSleeping: document.getElementById('includeSleeping'),
  nearby: document.getElementById('nearby'),
};

const state = {
  /** 0 is the four weeks starting today; higher numbers move forward. Never negative. */
  pageOffset: 0,
  /** NOAA station id, or null for sun-and-moon-only mode. */
  stationId: null,
  /** @type {import('./core/tides.js').TideData} Tides for the page currently on screen. */
  tideData: emptyTideData(),
  /** Count windows at any hour in full, rather than discounting the small hours. */
  includeSleepingHours: false,
  /**
   * How low this station's water usually gets. Recomputed whenever tides load,
   * because it's derived from the predictions themselves rather than fetched.
   * Only the tidepooling profile reads it; fishing ignores it.
   */
  tideStats: null,
  /**
   * About a week of NWS weather, keyed by date. Never feeds the rating — the
   * calendar runs four weeks and the forecast reaches seven days, so scoring it
   * would judge the first week on different evidence from the rest.
   * @type {import('./core/weather.js').WeatherOutlook}
   */
  weather: emptyOutlook(),
  ...DEFAULT_LOCATION,
};

/**
 * Put last visit's location and station back on the page.
 *
 * Runs before the first render so the opening calendar is already the one you
 * left, rather than San Diego for a beat and then a second load.
 */
function restoreSavedSettings() {
  const saved = loadSettings();
  if (!saved) return;

  state.latitude = saved.latitude;
  state.longitude = saved.longitude;
  state.stationId = saved.stationId;
  state.includeSleepingHours = saved.includeSleepingHours;

  elements.latitude.value = saved.latitude.toFixed(4);
  elements.longitude.value = saved.longitude.toFixed(4);
  elements.station.value = saved.stationId ?? '';
  elements.includeSleeping.checked = saved.includeSleepingHours;
  if (saved.placeLabel) elements.place.textContent = saved.placeLabel;
}

/**
 * Adopt a new location and redraw.
 *
 * The place line is passed in rather than left alone, because it used to go
 * stale: typing new coordinates changed the calendar but left the label reading
 * "San Diego, CA (default)". Harmless while it was only on screen, misleading
 * once we started saving it.
 */
function applyLocation(location, placeLabel) {
  Object.assign(state, location);
  state.stationId = elements.station.value.trim() || null;
  elements.place.textContent = placeLabel;
  rememberSettings();
  hideDetail();
  refresh();
}

/** What to call a set of coordinates when we've no better name for them. */
function describePlace({ latitude, longitude }) {
  const isDefault =
    latitude === DEFAULT_LOCATION.latitude && longitude === DEFAULT_LOCATION.longitude;
  return isDefault ? DEFAULT_PLACE_LABEL : `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
}

/** Remember where we are, so the next visit opens here. */
function rememberSettings() {
  saveSettings({
    latitude: state.latitude,
    longitude: state.longitude,
    stationId: state.stationId,
    placeLabel: elements.place.textContent.trim(),
    includeSleepingHours: state.includeSleepingHours,
  });
}

/* ---------------------------------------------------------------- *
 * Profile chrome
 * ---------------------------------------------------------------- */

/**
 * Stamp the profile's wording onto the page.
 *
 * The Worker already does this server-side, so on the live sites this is a
 * no-op that rewrites the same strings it finds. It earns its keep in local
 * dev, where the page is served as a plain file, and for `?profile=` previews.
 */
function applyProfileChrome() {
  document.documentElement.dataset.profile = profile.id;
  document.title = profile.title;
  document.querySelector('meta[name="description"]')?.setAttribute('content', profile.tagline);

  const set = (id, html) => {
    const element = document.getElementById(id);
    if (element) element.innerHTML = html;
  };
  set('headline', profile.headline);

  // Hidden in the markup by default, so nothing flashes up before this runs.
  const support = document.getElementById('support');
  const supportLink = supportLinkHtml();
  if (support) {
    support.innerHTML = supportLink;
    support.hidden = !supportLink;
  }
  set('tagline', profile.tagline);
  set('aboutBody', profile.aboutHtml);
  set(
    'legendTiers',
    profile.ratingTiers
      .map((tier) => `<span><i class="dot ${tier.className}"></i> ${tier.name}</span>`)
      .join(''),
  );

  // Only tidepooling insists on a station, and only fishing has anything to say
  // about the small hours, so each site drops the other's control.
  document
    .getElementById('sleepingToggle')
    ?.toggleAttribute('hidden', profile.id !== 'fishing');
}

/* ---------------------------------------------------------------- *
 * Rendering
 * ---------------------------------------------------------------- */

/** The four-week span the current page covers. */
function currentPageRange() {
  const today = startOfDay(new Date());
  const start = addDays(today, state.pageOffset * DAYS_PER_PAGE);
  return { today, start, end: addDays(start, DAYS_PER_PAGE - 1) };
}

/** Reload tides if a station is set, and report what happened in the status line. */
async function loadTides(start, end) {
  if (!state.stationId) {
    state.tideData = emptyTideData();
    state.tideStats = null;
    setStatus(
      profile.requiresTideStation
        ? 'Set a tide station to see anything — low water is the whole story here.'
        : 'No tide station set — moon & sun windows only.',
    );
    return;
  }

  setStatus(`Loading tide predictions for station ${state.stationId}…`);
  try {
    state.tideData = await fetchTidePredictions(state.stationId, start, end);
    state.tideStats = stationTideStats(state.tideData.events);
    setStatus(`Tide predictions loaded for station ${state.stationId}.`);
  } catch (error) {
    state.tideData = emptyTideData();
    state.tideStats = null;
    setStatus(`Could not load tides for station ${state.stationId}: ${error.message}`);
  }
}

/**
 * Load the weather overlay for the current location.
 *
 * Failure is quiet on purpose. The overlay is a bonus on top of a calendar that
 * works perfectly well without it, so a bad day at api.weather.gov should cost
 * you the temperatures and nothing else.
 */
async function loadWeather() {
  try {
    state.weather = await fetchWeatherOutlook({
      latitude: state.latitude,
      longitude: state.longitude,
      stationId: state.stationId,
      // Only the curated locations know where their water is, so anyone far
      // from one simply gets no surf line rather than a guessed one.
      marine: nearestMarinePoint(state.latitude, state.longitude),
    });
  } catch {
    state.weather = emptyOutlook();
  }
}

/** Fetch the tides for the current page, then redraw. */
async function refresh() {
  const { start, end } = currentPageRange();
  await loadTides(start, end);
  render();

  // The weather is slower and optional, so the calendar goes up without it and
  // gains the overlay a moment later rather than waiting on two round trips.
  await loadWeather();
  render();
}

/**
 * Redraw the calendar from whatever is already in `state`.
 *
 * Split out from `refresh` so the settings that only affect scoring — the
 * sleeping-hours toggle — can redraw without re-fetching from NOAA.
 */
function render() {
  const { today, start, end } = currentPageRange();

  const forecastFor = (date) =>
    computeDayForecast({
      date,
      latitude: state.latitude,
      longitude: state.longitude,
      tides: state.tideData.byDate[toDateKey(date)] ?? [],
      // Sampled once here so the scoring and the chart see the same curve.
      tideCurve: sampleTideCurve(state.tideData.events, date),
      profile,
      settings: {
        includeSleepingHours: state.includeSleepingHours,
        tideStats: state.tideStats,
      },
    });

  renderNearby();
  elements.rangeLabel.textContent = formatRange(start, end);
  elements.previousPage.disabled = state.pageOffset <= 0;

  renderCalendarGrid({
    container: elements.grid,
    rangeStart: start,
    rangeEnd: end,
    today,
    forecastFor,
    onSelectDay: showDay,
    profile,
    weather: state.weather,
  });

  // The header shows tonight's moon, which only makes sense on the current page.
  if (isSameDay(start, today)) {
    const { phase } = forecastFor(today);
    const percent = Math.round(phase.illuminatedFraction * 100);
    elements.moonToday.innerHTML = `
      <div class="moon-text">
        <span class="moon-caption">${profile.moonCaption(phase)}</span>
        <span class="pct">${percent}%</span>
      </div>
      ${renderMoonPhase(phase, { label: `${phase.name}, ${percent}% illuminated` })}`;
  }
}

/**
 * Point at the written-up places near wherever the calendar currently is.
 *
 * The app is coordinate-driven, so it otherwise has no idea those pages exist
 * and neither does the reader: the homepage had no link out at all, which left
 * search engines as the only route in. This is the route for people.
 *
 * Nothing renders when there is no curated location within reach, which is the
 * honest outcome for most of the map rather than a list of places a thousand
 * miles away.
 */
function renderNearby() {
  const nearby = nearbyLocations(state.latitude, state.longitude);
  if (nearby.length === 0) {
    elements.nearby.hidden = true;
    return;
  }

  const links = nearby
    .map(({ location, miles }) => {
      const distance = miles < 1 ? 'here' : `${Math.round(miles)} mi`;
      return `<a href="/${profile.pathPrefix}/${location.slug}/">${escapeHtml(location.name)}` +
        `<span class="miles">${distance}</span></a>`;
    })
    .join('');

  elements.nearby.innerHTML =
    `<span class="nearby-label">Written up nearby</span>${links}` +
    `<a class="nearby-all" href="/${profile.pathPrefix}/">All locations</a>`;
  elements.nearby.hidden = false;
}

function showDay(forecast, cell) {
  for (const other of elements.grid.querySelectorAll('.cell')) {
    other.classList.toggle('selected', other === cell);
  }
  renderDayDetail({
    container: elements.detail,
    forecast,
    profile,
    weather: state.weather.byDate[toDateKey(forecast.date)] ?? null,
    waterTempF: state.weather.waterTempF,
  });
  elements.detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideDetail() {
  elements.detail.classList.remove('show');
}

function setStatus(message) {
  elements.tideStatus.textContent = message;
}

function formatRange(start, end) {
  const from = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const to = end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${from} – ${to}`;
}

/* ---------------------------------------------------------------- *
 * Controls
 * ---------------------------------------------------------------- */

/**
 * Read the coordinate inputs.
 *
 * @returns {{latitude: number, longitude: number}|null} Null if either is unusable.
 */
function readLocationInputs() {
  const latitude = parseFloat(elements.latitude.value);
  const longitude = parseFloat(elements.longitude.value);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

elements.update.addEventListener('click', () => {
  const location = readLocationInputs();
  if (!location) {
    setStatus('Enter a latitude between -90 and 90 and a longitude between -180 and 180.');
    return;
  }
  applyLocation(location, describePlace(location));
});

elements.locate.addEventListener('click', () => {
  if (!navigator.geolocation) {
    setStatus('Geolocation is not available in this browser.');
    return;
  }
  setStatus('Asking your browser for your location…');
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const location = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      elements.latitude.value = location.latitude.toFixed(4);
      elements.longitude.value = location.longitude.toFixed(4);
      applyLocation(location, 'Your current location');
    },
    (error) => setStatus(`Could not get your location: ${error.message}`),
  );
});

elements.findStation.addEventListener('click', async () => {
  const location = readLocationInputs();
  if (!location) {
    setStatus('Enter a valid latitude and longitude first.');
    return;
  }
  setStatus('Looking up the nearest NOAA station…');
  try {
    const station = await findNearestStation(location.latitude, location.longitude);
    elements.station.value = station.id;
    setStatus(
      `Nearest station: ${station.name} (#${station.id}, ${station.distanceMiles.toFixed(1)} mi away). ` +
        'Press Update to load its tides.',
    );
  } catch (error) {
    setStatus(`Could not reach the NOAA station directory: ${error.message}`);
  }
});

elements.previousPage.addEventListener('click', () => {
  if (state.pageOffset <= 0) return;
  state.pageOffset -= 1;
  hideDetail();
  refresh();
});

elements.nextPage.addEventListener('click', () => {
  state.pageOffset += 1;
  hideDetail();
  refresh();
});

elements.includeSleeping.addEventListener('change', () => {
  state.includeSleepingHours = elements.includeSleeping.checked;
  rememberSettings();
  hideDetail();
  render(); // Only the scoring changed, so the tides we already have still stand.
});

applyProfileChrome();
// Before the first render, so the opening calendar is the one you left rather
// than the default flashing up and being replaced. `refresh` owns the status
// line from here on, so restoring says nothing — the filled-in fields show it.
restoreSavedSettings();
refresh();
