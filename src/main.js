/**
 * Application entry point: holds the UI state and wires the controls to the views.
 *
 * The data flow is one-directional and deliberately dumb. Any change to the
 * location, station or page updates `state`, then calls `refresh()`, which
 * re-fetches tides if needed and re-renders the whole calendar. At four weeks
 * of cells that's cheap, and it means there's no partial-update logic to get
 * wrong.
 */

import { computeDayForecast } from './solunar.js';
import { emptyTideData, fetchTidePredictions, findNearestStation } from './tides.js';
import { addDays, isSameDay, startOfDay, toDateKey } from './time.js';
import { renderCalendarGrid } from './views/calendar-grid.js';
import { renderDayDetail } from './views/day-detail.js';

/** One page of the calendar is four weeks. */
const DAYS_PER_PAGE = 28;

/** San Diego, CA — somewhere to start before the user sets a location. */
const DEFAULT_LOCATION = { latitude: 32.7157, longitude: -117.1611 };

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
};

const state = {
  /** 0 is the four weeks starting today; higher numbers move forward. Never negative. */
  pageOffset: 0,
  /** NOAA station id, or null for sun-and-moon-only mode. */
  stationId: null,
  /** @type {import('./tides.js').TideData} Tides for the page currently on screen. */
  tideData: emptyTideData(),
  /** Count windows at any hour in full, rather than discounting the small hours. */
  includeSleepingHours: false,
  ...DEFAULT_LOCATION,
};

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
    setStatus('No tide station set — moon & sun windows only.');
    return;
  }

  setStatus(`Loading tide predictions for station ${state.stationId}…`);
  try {
    state.tideData = await fetchTidePredictions(state.stationId, start, end);
    setStatus(`Tide predictions loaded for station ${state.stationId}.`);
  } catch (error) {
    state.tideData = emptyTideData();
    setStatus(`Could not load tides for station ${state.stationId}: ${error.message}`);
  }
}

/** Fetch the tides for the current page, then redraw. */
async function refresh() {
  const { start, end } = currentPageRange();
  await loadTides(start, end);
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
      includeSleepingHours: state.includeSleepingHours,
    });

  elements.rangeLabel.textContent = formatRange(start, end);
  elements.previousPage.disabled = state.pageOffset <= 0;

  renderCalendarGrid({
    container: elements.grid,
    rangeStart: start,
    rangeEnd: end,
    today,
    forecastFor,
    onSelectDay: showDay,
  });

  // The header shows tonight's moon, which only makes sense on the current page.
  if (isSameDay(start, today)) {
    const { phase } = forecastFor(today);
    const percent = Math.round(phase.illuminatedFraction * 100);
    elements.moonToday.innerHTML = `${phase.name}<span class="pct">${percent}%</span>`;
  }
}

function showDay(forecast, cell) {
  for (const other of elements.grid.querySelectorAll('.cell')) {
    other.classList.toggle('selected', other === cell);
  }
  renderDayDetail({
    container: elements.detail,
    forecast,
    tideEvents: state.tideData.events,
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
  Object.assign(state, location);
  state.stationId = elements.station.value.trim() || null;
  hideDetail();
  refresh();
});

elements.locate.addEventListener('click', () => {
  if (!navigator.geolocation) {
    setStatus('Geolocation is not available in this browser.');
    return;
  }
  setStatus('Asking your browser for your location…');
  navigator.geolocation.getCurrentPosition(
    (position) => {
      elements.latitude.value = position.coords.latitude.toFixed(4);
      elements.longitude.value = position.coords.longitude.toFixed(4);
      elements.place.textContent = 'Your current location';
      elements.update.click();
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
  hideDetail();
  render(); // Only the scoring changed, so the tides we already have still stand.
});

refresh();
