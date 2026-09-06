/**
 * Tide predictions from NOAA CO-OPS.
 *
 * https://api.tidesandcurrents.noaa.gov/api/prod/ — free, no key, but it only
 * covers NOAA's own station network (broadly the US and its territories).
 *
 * We ask for `interval=hilo`, which returns just the high and low water events
 * rather than a dense time series. That's a much smaller response, and it's all
 * the rating model needs. The chart reconstructs a continuous curve from those
 * extremes (see `sampleTideCurve`).
 */

/** Miles per radian of great-circle arc — the Earth's mean radius. */
const EARTH_RADIUS_MILES = 3958.8;
const DEG_TO_RAD = Math.PI / 180;

const STATION_DIRECTORY_URL =
  'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions';
const PREDICTIONS_URL = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';

/**
 * Extra days fetched on each side of the requested range.
 *
 * The curve on the first morning is shaped by the previous evening's last
 * high or low, and the same applies in reverse at the end of the range. Without
 * this padding the chart would have nothing to interpolate against near
 * midnight and the curve would start and end mid-air.
 */
const CURVE_PADDING_DAYS = 1;

/**
 * @typedef {object} TideEvent
 * @property {Date} time     Absolute moment of the extreme.
 * @property {string} dateKey Local calendar day, "YYYY-MM-DD".
 * @property {number} hour   Local hours within that day, 0-24.
 * @property {'H'|'L'} type  High or low water.
 * @property {number} height Feet relative to the MLLW datum.
 */

/**
 * @typedef {object} TideData
 * @property {TideEvent[]} events All events, sorted by time, including padding days.
 * @property {Record<string, TideEvent[]>} byDate Events grouped by local calendar day.
 */

/** Great-circle distance in miles between two lat/lon pairs. */
export function distanceInMiles(lat1, lon1, lat2, lon2) {
  const deltaLat = (lat2 - lat1) * DEG_TO_RAD;
  const deltaLon = (lon2 - lon1) * DEG_TO_RAD;
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(haversine));
}

/**
 * Find the closest NOAA tide-prediction station to a point.
 *
 * The directory is a single ~3000-entry JSON document, so a linear scan is
 * simpler and quite fast enough.
 *
 * @returns {Promise<{id: string, name: string, distanceMiles: number}>}
 */
export async function findNearestStation(latitude, longitude) {
  const response = await fetch(STATION_DIRECTORY_URL);
  if (!response.ok) throw new Error(`NOAA station directory returned ${response.status}`);
  const { stations } = await response.json();

  let nearest = null;
  for (const station of stations) {
    const distanceMiles = distanceInMiles(
      latitude,
      longitude,
      parseFloat(station.lat),
      parseFloat(station.lng),
    );
    if (nearest === null || distanceMiles < nearest.distanceMiles) {
      nearest = { id: station.id, name: station.name, distanceMiles };
    }
  }
  if (nearest === null) throw new Error('NOAA station directory was empty');
  return nearest;
}

/** NOAA wants dates as "YYYYMMDD". */
function toNoaaDate(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}${month}${day}`;
}

/**
 * Fetch high/low predictions covering [startDate, endDate], plus a padding day
 * on each side for the curve.
 *
 * Times come back in the station's own local time (`lst_ldt`). We read them as
 * the browser's local time, which is right whenever the station and the user
 * share a timezone — true for essentially any station you'd actually fish.
 *
 * @param {string} stationId
 * @param {Date} startDate First local day to cover.
 * @param {Date} endDate   Last local day to cover.
 * @returns {Promise<TideData>}
 */
export async function fetchTidePredictions(stationId, startDate, endDate) {
  const paddedStart = new Date(startDate);
  paddedStart.setDate(paddedStart.getDate() - CURVE_PADDING_DAYS);
  const paddedEnd = new Date(endDate);
  paddedEnd.setDate(paddedEnd.getDate() + CURVE_PADDING_DAYS);

  const params = new URLSearchParams({
    product: 'predictions',
    application: 'tide-and-moon-app',
    begin_date: toNoaaDate(paddedStart),
    end_date: toNoaaDate(paddedEnd),
    datum: 'MLLW',
    station: stationId,
    time_zone: 'lst_ldt',
    units: 'english',
    interval: 'hilo',
    format: 'json',
  });

  const response = await fetch(`${PREDICTIONS_URL}?${params}`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message || 'NOAA station error');

  const events = (payload.predictions ?? []).map(parsePrediction).sort((a, b) => a.time - b.time);

  const byDate = {};
  for (const event of events) {
    (byDate[event.dateKey] ??= []).push(event);
  }
  return { events, byDate };
}

/** Turn one `{t: "2026-09-06 03:24", v: "5.12", type: "H"}` row into a TideEvent. */
function parsePrediction(prediction) {
  const [datePart, timePart] = prediction.t.split(' ');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hours, minutes] = timePart.split(':').map(Number);

  return {
    time: new Date(year, month - 1, day, hours, minutes),
    dateKey: datePart,
    hour: hours + minutes / 60,
    type: prediction.type,
    height: parseFloat(prediction.v),
  };
}

/** An empty TideData, for when no station is set or the fetch failed. */
export function emptyTideData() {
  return { events: [], byDate: {} };
}

/* ---------------------------------------------------------------- *
 * Reconstructing the curve between extremes
 * ---------------------------------------------------------------- */

/**
 * Height of the tide at an arbitrary moment between two consecutive extremes.
 *
 * Over one half-cycle the tide is very close to a single sinusoid, so we fit a
 * half cosine between the two known heights. It's exact at both ends and within
 * a few inches in between — the same assumption behind the mariner's "rule of
 * twelfths", just continuous instead of hourly. Good enough to draw; not a
 * substitute for NOAA's own six-minute predictions.
 *
 * @param {TideEvent} from Earlier extreme.
 * @param {TideEvent} to   Later extreme.
 * @param {number} atMs    Moment to evaluate, between the two.
 */
function interpolateHeight(from, to, atMs) {
  const span = to.time - from.time;
  if (span <= 0) return from.height;

  const progress = (atMs - from.time) / span;
  const midHeight = (from.height + to.height) / 2;
  const amplitude = (from.height - to.height) / 2;
  return midHeight + amplitude * Math.cos(Math.PI * progress);
}

/**
 * Sample a continuous tide curve across one local calendar day.
 *
 * @param {TideEvent[]} events All known events, sorted by time. Must extend
 *   past both ends of the day for the curve to be complete.
 * @param {Date} day Any moment on the day to sample.
 * @param {number} [samplesPerHour] Higher is smoother; 6 is plenty at chart size.
 * @returns {{hour: number, height: number}[]} Empty when the day isn't bracketed
 *   by known extremes.
 */
export function sampleTideCurve(events, day, samplesPerHour = 6) {
  if (events.length < 2) return [];

  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayStartMs = dayStart.getTime();
  const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000;

  // We can only draw where the day is bracketed by a known extreme on each side.
  if (events[0].time > dayStartMs || events[events.length - 1].time < dayEndMs) return [];

  const samples = [];
  const totalSamples = 24 * samplesPerHour;
  let segmentIndex = 0;

  for (let i = 0; i <= totalSamples; i++) {
    const hour = (i / samplesPerHour);
    const atMs = dayStartMs + hour * 60 * 60 * 1000;

    // Events are sorted and we sweep forward, so this walk is O(n) overall.
    while (segmentIndex < events.length - 2 && events[segmentIndex + 1].time < atMs) {
      segmentIndex += 1;
    }
    samples.push({
      hour,
      height: interpolateHeight(events[segmentIndex], events[segmentIndex + 1], atMs),
    });
  }
  return samples;
}
