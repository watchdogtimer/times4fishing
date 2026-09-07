/**
 * Short-range weather for the calendar overlay.
 *
 * Source is the National Weather Service (api.weather.gov): free, no key, US
 * public domain, and unlike the other obvious options it carries no
 * non-commercial restriction — which matters for a site that may one day carry
 * an ad. Its coverage is the US and its territories, the same footprint as the
 * NOAA tide stations this whole app already depends on, so it adds no new gap.
 *
 * This never feeds the rating. The calendar runs four weeks out and the
 * forecast reaches about seven days, so folding it into the score would mean
 * the first week was judged on different evidence from the rest — the same day
 * would change rating as it drifted into the horizon, which is worse than
 * useless for planning. It's an overlay: shown where it exists, absent where it
 * doesn't, and never part of the arithmetic.
 *
 * Wave height comes from a second gridpoint, offshore. NWS carries a wave
 * series at the land coordinate too, but there it is all zeros — the grid is
 * telling the truth about the surf on dry land. Asked a few kilometres out to
 * sea, the same endpoint returns a real forecast. That is why every curated
 * location carries a hand-picked `marine` point: there is no dependable way to
 * work out which way is seaward from a coastal coordinate, and a silently-zero
 * surf number is worse than none on a page someone makes a safety call from.
 *
 * Like the rest of this file it never feeds the rating. On the Pacific the best
 * winter lows and the worst winter swell arrive together, so scoring surf would
 * cancel out the very days the tide model is pointing at. It is shown so the
 * reader can make that call themselves.
 */

const POINTS_URL = 'https://api.weather.gov/points';

/** NWS asks callers to identify themselves. Browsers ignore this; Workers don't. */
const USER_AGENT = 'times4fishing.com / times4tidepooling.com (contact via site)';

const WATER_TEMPERATURE_URL = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';

/**
 * @typedef {object} DayWeather
 * @property {number|null} highF
 * @property {number|null} lowF
 * @property {number|null} windMph      Strongest sustained wind in the day.
 * @property {number|null} gustMph
 * @property {number|null} cloudPercent Mean sky cover.
 * @property {number|null} precipPercent Highest chance of precipitation.
 * @property {number|null} waveFt      Largest significant wave height in the day.
 * @property {number|null} swellPeriodS Longest dominant wave period. Long-period
 *   swell carries far more energy at the same height, which is what turns a
 *   walkable reef into a dangerous one.
 */

/**
 * @typedef {object} WeatherOutlook
 * @property {Record<string, DayWeather>} byDate Keyed "YYYY-MM-DD", local.
 * @property {number|null} waterTempF Latest reading, where the station has one.
 * @property {string|null} error
 */

/** An outlook with nothing in it, for when the fetch fails or isn't wanted. */
export function emptyOutlook() {
  return { byDate: {}, waterTempF: null, error: null };
}

/**
 * Fetch about a week of daily weather for a point, plus water temperature.
 *
 * The two sources are independent and either may be missing, so they're settled
 * rather than awaited in series: a station without a thermometer shouldn't cost
 * you the air temperature.
 *
 * @param {object} options
 * @param {number} options.latitude
 * @param {number} options.longitude
 * @param {string} [options.stationId] NOAA station, for water temperature.
 * @returns {Promise<WeatherOutlook>}
 */
export async function fetchWeatherOutlook({ latitude, longitude, stationId, marine }) {
  const [forecast, waterTemp, waves] = await Promise.allSettled([
    fetchGridForecast(latitude, longitude),
    stationId ? fetchWaterTemperature(stationId) : Promise.resolve(null),
    marine ? fetchWaveForecast(marine) : Promise.resolve({}),
  ]);

  if (forecast.status === 'rejected') {
    return { ...emptyOutlook(), error: forecast.reason?.message ?? 'weather unavailable' };
  }

  // Waves are the most optional part of an already optional overlay, so a
  // failure there leaves the rest of the forecast standing.
  const byWaveDate = waves.status === 'fulfilled' ? waves.value : {};
  const byDate = {};
  for (const dateKey of new Set([...Object.keys(forecast.value), ...Object.keys(byWaveDate)])) {
    byDate[dateKey] = {
      ...emptyDay(),
      ...forecast.value[dateKey],
      ...byWaveDate[dateKey],
    };
  }

  return {
    byDate,
    waterTempF: waterTemp.status === 'fulfilled' ? waterTemp.value : null,
    error: null,
  };
}

/** Every field a DayWeather can carry, so a partial day still has known keys. */
function emptyDay() {
  return {
    highF: null, lowF: null, windMph: null, gustMph: null,
    cloudPercent: null, precipPercent: null, waveFt: null, swellPeriodS: null,
  };
}

/**
 * The wave series from an offshore gridpoint.
 *
 * Coarse by nature: whole feet, several hours apart, and often only a handful
 * of points across the week. Good enough for "there is a big swell running",
 * not for anything finer, which is why the UI shows it as a number and never
 * interpolates between them.
 *
 * @param {{latitude: number, longitude: number}} marine
 * @returns {Promise<Record<string, {waveFt: number|null, swellPeriodS: number|null}>>}
 */
async function fetchWaveForecast({ latitude, longitude }) {
  const point = await getJson(`${POINTS_URL}/${latitude.toFixed(4)},${longitude.toFixed(4)}`);
  const gridUrl = point?.properties?.forecastGridData;
  if (!gridUrl) return {};

  const properties = (await getJson(gridUrl))?.properties ?? {};
  const byDate = {};
  const collect = (seriesName, field, convert) => {
    for (const [dateKey, value] of expandSeries(properties[seriesName])) {
      (byDate[dateKey] ??= {})[field] ??= [];
      byDate[dateKey][field].push(convert(value));
    }
  };

  collect('waveHeight', 'waves', metresToFeet);
  collect('wavePeriod', 'periods', (value) => value);

  return Object.fromEntries(
    Object.entries(byDate).map(([dateKey, raw]) => [
      dateKey,
      { waveFt: highest(raw.waves), swellPeriodS: highest(raw.periods) },
    ]),
  );
}

const metresToFeet = (metres) => metres * 3.28084;

/** Largest value in a series, or null if there wasn't one. */
function highest(values) {
  const usable = (values ?? []).filter((value) => Number.isFinite(value));
  return usable.length ? Math.max(...usable) : null;
}

/** Resolve the point to a grid, then pull the raw series and fold it by day. */
async function fetchGridForecast(latitude, longitude) {
  const point = await getJson(`${POINTS_URL}/${latitude.toFixed(4)},${longitude.toFixed(4)}`);
  const gridUrl = point?.properties?.forecastGridData;
  if (!gridUrl) throw new Error('NWS has no grid for this point');

  const grid = await getJson(gridUrl);
  const properties = grid?.properties ?? {};

  const byDate = {};
  const collect = (seriesName, field, convert) => {
    for (const [dateKey, value] of expandSeries(properties[seriesName])) {
      (byDate[dateKey] ??= {})[field] ??= [];
      byDate[dateKey][field].push(convert(value));
    }
  };

  collect('temperature', 'temps', celsiusToFahrenheit);
  collect('windSpeed', 'winds', kilometresToMiles);
  collect('windGust', 'gusts', kilometresToMiles);
  collect('skyCover', 'clouds', (value) => value);
  collect('probabilityOfPrecipitation', 'precip', (value) => value);

  return Object.fromEntries(
    Object.entries(byDate).map(([dateKey, raw]) => [dateKey, summariseDay(raw)]),
  );
}

/** @returns {DayWeather} */
function summariseDay(raw) {
  return {
    highF: round(max(raw.temps)),
    lowF: round(min(raw.temps)),
    windMph: round(max(raw.winds)),
    gustMph: round(max(raw.gusts)),
    cloudPercent: round(mean(raw.clouds)),
    precipPercent: round(max(raw.precip)),
  };
}

/**
 * Expand one NWS series into [localDateKey, value] pairs, one per hour.
 *
 * NWS packs runs of equal values into ISO 8601 intervals — `"2026-09-06T13:00:00+00:00/PT2H"`
 * means "this value holds for two hours from then" — so a day's worth of
 * temperature can arrive as three entries. Expanding to hours before bucketing
 * keeps the daily high from being decided by how NWS happened to compress it.
 *
 * @param {{values: {validTime: string, value: number|null}[]}} [series]
 * @returns {[string, number][]}
 */
function expandSeries(series) {
  const out = [];
  for (const entry of series?.values ?? []) {
    if (entry.value === null || entry.value === undefined) continue;

    const [startText, durationText] = entry.validTime.split('/');
    const start = new Date(startText);
    const hours = Math.max(1, durationInHours(durationText));

    for (let hour = 0; hour < hours; hour++) {
      const at = new Date(start.getTime() + hour * 3600000);
      out.push([localDateKey(at), entry.value]);
    }
  }
  return out;
}

/**
 * Hours in an ISO 8601 duration like `P6DT23H` or `PT2H`.
 *
 * Only days and hours appear in NWS gridpoint data, and anything finer would
 * round to an hour here anyway.
 */
function durationInHours(text) {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(text ?? '');
  if (!match) return 1;
  const [, days, hours, minutes] = match.map((part) => (part ? Number(part) : 0));
  return days * 24 + hours + (minutes >= 30 ? 1 : 0);
}

/**
 * A Date's calendar day in the *runtime's* zone, as "YYYY-MM-DD".
 *
 * Deliberately the runtime's zone rather than the location's. In the browser
 * that's the reader's zone, which is the right bucket for a reader looking at
 * their own coast, and it matches how the rest of the app keys days. The Worker
 * doesn't use this module, so its UTC clock never comes into it.
 */
function localDateKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Latest water temperature at a NOAA station, where it has a thermometer.
 *
 * The data API only knows seven-digit station ids, because those are the
 * physical installations, the ones that can carry a sensor at all. A
 * subordinate prediction station like `TWC0405` ("Point Loma") is an offset
 * applied to one of those rather than a place with instruments, so there's
 * nothing to ask for and NOAA says as much with a 400. We don't ask: it isn't
 * a failure worth a line in the console, it's a station that doesn't have one.
 */
async function fetchWaterTemperature(stationId) {
  if (!/^\d{7}$/.test(stationId)) return null;

  const params = new URLSearchParams({
    product: 'water_temperature',
    application: 'times4-app',
    date: 'latest',
    station: stationId,
    time_zone: 'lst_ldt',
    units: 'english',
    format: 'json',
  });
  const payload = await getJson(`${WATER_TEMPERATURE_URL}?${params}`);
  // Most stations simply don't offer this product, which is not an error.
  if (payload?.error || !payload?.data?.length) return null;
  const value = parseFloat(payload.data[0].v);
  return Number.isFinite(value) ? Math.round(value) : null;
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/geo+json', 'user-agent': USER_AGENT },
  });
  if (!response.ok) throw new Error(`${new URL(url).hostname} returned ${response.status}`);
  return response.json();
}

const celsiusToFahrenheit = (celsius) => (celsius * 9) / 5 + 32;
const kilometresToMiles = (kilometres) => kilometres * 0.621371;

const max = (values) => (values?.length ? Math.max(...values) : null);
const min = (values) => (values?.length ? Math.min(...values) : null);
const mean = (values) =>
  values?.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const round = (value) => (value === null ? null : Math.round(value));
