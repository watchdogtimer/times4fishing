/**
 * The places that get their own server-rendered page.
 *
 * Deliberately a short curated list rather than NOAA's ~3000 stations. A page
 * per station would be a million thin pages once you multiply by dates, which
 * is the textbook shape of a site Google files under "spam" and stops crawling.
 * Every entry here is somewhere a person would actually go.
 *
 * Each needs an IANA timezone, because the Worker renders these in UTC and the
 * whole calendar is in local time. The browser can ask the Date for its own
 * offset; the Worker has to be told.
 */

/**
 * @typedef {object} Location
 * @property {string} slug      URL segment. Stable — changing one orphans a page.
 * @property {string} name      Display name, e.g. "San Diego".
 * @property {string} region    State or territory, e.g. "California".
 * @property {string} stationId NOAA CO-OPS tide station.
 * @property {number} latitude
 * @property {number} longitude
 * @property {string} timeZone  IANA name.
 * @property {string} [blurb]   One sentence of genuinely local context.
 */

/** @type {Location[]} */
export const LOCATIONS = [
  {
    slug: 'san-diego-ca',
    name: 'San Diego',
    region: 'California',
    stationId: '9410170',
    latitude: 32.7157,
    longitude: -117.1611,
    timeZone: 'America/Los_Angeles',
    blurb:
      'San Diego gets its deepest lows on winter afternoons, which is why the tidepooling season here runs opposite to the swimming one.',
  },
  {
    slug: 'la-jolla-ca',
    name: 'La Jolla',
    region: 'California',
    stationId: '9410230',
    latitude: 32.8669,
    longitude: -117.2571,
    timeZone: 'America/Los_Angeles',
    blurb:
      'The reef flats south of the cove are among the most accessible low intertidal in southern California, and among the most trampled — watch your feet.',
  },
  {
    slug: 'santa-barbara-ca',
    name: 'Santa Barbara',
    region: 'California',
    stationId: '9411340',
    latitude: 34.4085,
    longitude: -119.6851,
    timeZone: 'America/Los_Angeles',
  },
  {
    slug: 'santa-monica-ca',
    name: 'Santa Monica',
    region: 'California',
    stationId: '9410840',
    latitude: 34.0089,
    longitude: -118.4973,
    timeZone: 'America/Los_Angeles',
  },
  {
    slug: 'monterey-ca',
    name: 'Monterey',
    region: 'California',
    stationId: '9413450',
    latitude: 36.6053,
    longitude: -121.8884,
    timeZone: 'America/Los_Angeles',
  },
  {
    slug: 'san-francisco-ca',
    name: 'San Francisco',
    region: 'California',
    stationId: '9414290',
    latitude: 37.8063,
    longitude: -122.4659,
    timeZone: 'America/Los_Angeles',
  },
  {
    slug: 'bodega-bay-ca',
    name: 'Bodega Bay',
    region: 'California',
    stationId: '9415020',
    latitude: 38.3167,
    longitude: -123.0481,
    timeZone: 'America/Los_Angeles',
  },
  {
    slug: 'crescent-city-ca',
    name: 'Crescent City',
    region: 'California',
    stationId: '9419750',
    latitude: 41.7456,
    longitude: -124.1843,
    timeZone: 'America/Los_Angeles',
  },
  {
    slug: 'newport-or',
    name: 'Newport',
    region: 'Oregon',
    stationId: '9435380',
    latitude: 44.6252,
    longitude: -124.0454,
    timeZone: 'America/Los_Angeles',
  },
  {
    slug: 'astoria-or',
    name: 'Astoria',
    region: 'Oregon',
    stationId: '9439040',
    latitude: 46.2073,
    longitude: -123.7683,
    timeZone: 'America/Los_Angeles',
  },
  {
    slug: 'seattle-wa',
    name: 'Seattle',
    region: 'Washington',
    stationId: '9447130',
    latitude: 47.6026,
    longitude: -122.3393,
    timeZone: 'America/Los_Angeles',
  },
  {
    slug: 'port-townsend-wa',
    name: 'Port Townsend',
    region: 'Washington',
    stationId: '9444900',
    latitude: 48.1129,
    longitude: -122.7595,
    timeZone: 'America/Los_Angeles',
  },
  {
    slug: 'juneau-ak',
    name: 'Juneau',
    region: 'Alaska',
    stationId: '9452210',
    latitude: 58.2988,
    longitude: -134.4197,
    timeZone: 'America/Juneau',
  },
  {
    slug: 'honolulu-hi',
    name: 'Honolulu',
    region: 'Hawaii',
    stationId: '1612340',
    latitude: 21.3069,
    longitude: -157.8583,
    timeZone: 'Pacific/Honolulu',
  },
  {
    slug: 'boston-ma',
    name: 'Boston',
    region: 'Massachusetts',
    stationId: '8443970',
    latitude: 42.3601,
    longitude: -71.0589,
    timeZone: 'America/New_York',
  },
  {
    slug: 'portland-me',
    name: 'Portland',
    region: 'Maine',
    stationId: '8418150',
    latitude: 43.6591,
    longitude: -70.2568,
    timeZone: 'America/New_York',
  },
  {
    slug: 'newport-ri',
    name: 'Newport',
    region: 'Rhode Island',
    stationId: '8452660',
    latitude: 41.5045,
    longitude: -71.3264,
    timeZone: 'America/New_York',
  },
  {
    slug: 'montauk-ny',
    name: 'Montauk',
    region: 'New York',
    stationId: '8510560',
    latitude: 41.0482,
    longitude: -71.9595,
    timeZone: 'America/New_York',
  },
  {
    slug: 'atlantic-city-nj',
    name: 'Atlantic City',
    region: 'New Jersey',
    stationId: '8534720',
    latitude: 39.3556,
    longitude: -74.4183,
    timeZone: 'America/New_York',
  },
  {
    slug: 'charleston-sc',
    name: 'Charleston',
    region: 'South Carolina',
    stationId: '8665530',
    latitude: 32.7807,
    longitude: -79.9251,
    timeZone: 'America/New_York',
  },
  {
    slug: 'key-west-fl',
    name: 'Key West',
    region: 'Florida',
    stationId: '8724580',
    latitude: 24.5551,
    longitude: -81.8079,
    timeZone: 'America/New_York',
  },
  {
    slug: 'galveston-tx',
    name: 'Galveston',
    region: 'Texas',
    stationId: '8771450',
    latitude: 29.3013,
    longitude: -94.7977,
    timeZone: 'America/Chicago',
  },
];

/** @returns {Location|undefined} */
export function locationBySlug(slug) {
  return LOCATIONS.find((location) => location.slug === slug);
}
