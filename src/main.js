/**
 * Application entry point: holds the UI state and wires the controls to the views.
 *
 * The data flow is one-directional and deliberately dumb. Any change to the
 * location, station or page updates `state`, then calls `refresh()`, which
 * re-fetches tides if needed and re-renders the whole calendar. At four weeks
 * of cells that's cheap, and it means there's no partial-update logic to get
 * wrong.
 */

import { activeProfile, supportLinkHtml, swapIconProfile } from './config.js';
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
import { createLocationMap, loadLeaflet } from './views/location-map.js';
import { renderLocationThumbnail } from './views/location-thumbnail.js';
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
  station: document.getElementById('station'),
  update: document.getElementById('recalc'),
  locate: document.getElementById('locate'),
  findStation: document.getElementById('findStation'),
  previousPage: document.getElementById('prevPage'),
  nextPage: document.getElementById('nextPage'),
  includeSleeping: document.getElementById('includeSleeping'),
  nearby: document.getElementById('nearby'),
  map: document.getElementById('map'),
  mapThumb: document.getElementById('mapThumb'),
  pickOnMap: document.getElementById('pickOnMap'),
  picker: document.getElementById('picker'),
  pickerHint: document.getElementById('pickerHint'),
  pickerCoords: document.getElementById('pickerCoords'),
  pickerConfirm: document.getElementById('pickerConfirm'),
};

/**
 * The picker's map, built the first time the picker is opened and kept after.
 *
 * Null until then, and null forever if Leaflet can't be fetched — everything
 * that touches it uses `?.`, because "no map" is a state the page has to keep
 * working in. See `views/location-map.js`.
 * @type {ReturnType<typeof createLocationMap>|null}
 */
let pickerMap = null;

/**
 * The spot the picker's pin is on, which is not yet the app's location.
 *
 * The picker commits on "Use this spot" rather than on every click, so you can
 * pan around and change your mind. Cancelling drops this on the floor.
 * @type {{latitude: number, longitude: number}|null}
 */
let pendingLocation = null;

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
  drawLocationThumbnail();
  rememberSettings();
  hideDetail();
  refresh();
}

/** Redraw the little map panel on whatever the current location is. */
function drawLocationThumbnail() {
  renderLocationThumbnail({
    container: elements.mapThumb,
    latitude: state.latitude,
    longitude: state.longitude,
  });
}

/**
 * What to call a spot on the map.
 *
 * Coordinates used to be the answer, because coordinates were also the input
 * and the label just echoed what you'd typed. With the boxes gone that reads as
 * the app telling you a number you never asked for, so it says the nearest
 * written-up place instead, with the distance so it can't overclaim: "14 mi
 * from Monterey, California" is true in a way that "Monterey" wouldn't be.
 *
 * There's no geocoder behind this and there isn't going to be — it's the same
 * curated list the "written up nearby" row uses. Past its reach we fall back to
 * coordinates, because for a point in the open Pacific there is genuinely
 * nothing else honest to say.
 */
function describePlace({ latitude, longitude }) {
  if (latitude === DEFAULT_LOCATION.latitude && longitude === DEFAULT_LOCATION.longitude) {
    return DEFAULT_PLACE_LABEL;
  }

  const [nearest] = nearbyLocations(latitude, longitude, { limit: 1 });
  if (!nearest) return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;

  const { location, miles } = nearest;
  const where = `${location.name}, ${location.region}`;
  return miles < 2 ? where : `${Math.round(miles)} mi from ${where}`;
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
  for (const link of document.querySelectorAll('link[href^="/icons/"]')) {
    link.setAttribute('href', swapIconProfile(link.getAttribute('href'), profile));
  }

  const set = (id, html) => {
    const element = document.getElementById(id);
    if (element) element.innerHTML = html;
  };
  set('headline', profile.headline);
  // The picker is JS-only, so unlike the rest of the chrome the Worker has no
  // reason to mirror this one: nothing without a browser ever opens the dialog.
  // The markup carries neutral wording so it reads right until this runs.
  set('pickerTitle', `Where do you go ${escapeHtml(profile.activity)}?`);

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
 * The picker.
 *
 * Opening it is the only thing on this page that reaches for Leaflet, so the
 * dialog goes up first and the map fills in when it arrives. That ordering is
 * the point: a slow CDN should look like a map that takes a moment, not like a
 * button that does nothing.
 */
async function openPicker() {
  pendingLocation = null;
  showPicker({ hint: 'Loading the map…', coords: '', ready: false });
  elements.picker.showModal();

  try {
    await loadLeaflet();
  } catch {
    // The one honest thing left to say. The station controls and "Use my
    // location" are untouched, and the calendar behind this is still correct.
    showPicker({
      hint: "The map didn't load. You can still use your browser's location instead.",
      coords: '',
      ready: false,
    });
    return;
  }

  pickerMap ??= createLocationMap({
    container: elements.map,
    latitude: state.latitude,
    longitude: state.longitude,
    onPick: (location) => {
      pendingLocation = location;
      // Coordinates here rather than a place name: this line's job is to
      // confirm the pin moved, and a name 14 miles away doesn't change when
      // you nudge it.
      showPicker({ hint: 'Click the map, or drag the pin.', coords: formatCoordinates(location), ready: true });
    },
  });

  // Leaflet caches the size it was built at, and the dialog can be reopened at
  // a different one. Then back to wherever the app actually is, in case the
  // location changed by other means since the last open.
  pickerMap.refresh();
  pickerMap.moveTo(state.latitude, state.longitude);
  showPicker({
    hint: 'Click the map, or drag the pin.',
    coords: formatCoordinates(state),
    ready: true,
  });
}

/** The picker's own readout of exactly where the pin is. */
const formatCoordinates = ({ latitude, longitude }) =>
  `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;

function showPicker({ hint, coords, ready }) {
  elements.pickerHint.textContent = hint;
  elements.pickerCoords.textContent = coords;
  elements.pickerConfirm.disabled = !ready;
}

elements.pickOnMap.addEventListener('click', openPicker);
elements.mapThumb.addEventListener('click', openPicker);

elements.picker.addEventListener('close', () => {
  // `<form method="dialog">` gives us the button's value for free, so cancelling
  // — including by pressing Escape, which returns "" — needs no handling at all.
  if (elements.picker.returnValue !== 'confirm') return;
  const location = pendingLocation ?? { latitude: state.latitude, longitude: state.longitude };
  applyLocation(location, describePlace(location));
});

// Nothing to re-read: the location lives in `state` and the station in its
// input, so this is "load the station I just typed" against where we already are.
elements.update.addEventListener('click', () => {
  applyLocation(
    { latitude: state.latitude, longitude: state.longitude },
    elements.place.textContent.trim(),
  );
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
      applyLocation(location, 'Your current location');
      // Only if the picker has already been built — this must not be the thing
      // that drags Leaflet onto the page.
      pickerMap?.moveTo(location.latitude, location.longitude, { zoom: 12 });
    },
    (error) => setStatus(`Could not get your location: ${error.message}`),
  );
});

elements.findStation.addEventListener('click', async () => {
  setStatus('Looking up the nearest NOAA station…');
  try {
    const station = await findNearestStation(state.latitude, state.longitude);
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
// After the restore, so the panel shows the place you left rather than the
// default. It's the only thing on the page that says where you are now that the
// coordinate boxes are gone, so it must not lag a frame behind.
drawLocationThumbnail();

refresh();
