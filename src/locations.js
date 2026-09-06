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
 * @property {{latitude: number, longitude: number}} marine
 *   A point offshore, for the wave forecast. NWS carries a wave series at the
 *   place's own coordinates too, but on land it comes back all zeros, so it has
 *   to be asked somewhere there is actually water. Hand-picked and checked
 *   against the live API, because there is no reliable way to work out which
 *   way is seaward from a coastal coordinate.
 * @property {Record<string, string>} [notes]
 *   Local context, keyed by profile id. Keyed rather than shared because the
 *   same page serves both sites: a note about trampled intertidal is guidance
 *   on one and noise on the other.
 * @property {Record<string, string>} [seasons]
 *   When this place is worth visiting, keyed by profile id. Measured from the
 *   station's own predictions rather than folklore — see the seasonal research
 *   in the commit that added these.
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
    marine: { latitude: 32.65, longitude: -117.3 },
    seasons: {
      tidepooling:
        'December through February is the season: the year\'s deepest lows land mid-afternoon and ' +
        'almost all of them are in daylight. The same tides are just as low in June and arrive ' +
        'around half past four in the morning.',
    },
  },
  {
    slug: 'la-jolla-ca',
    name: 'La Jolla',
    region: 'California',
    stationId: '9410230',
    latitude: 32.8669,
    longitude: -117.2571,
    timeZone: 'America/Los_Angeles',
    marine: { latitude: 32.85, longitude: -117.36 },
    notes: {
      tidepooling:
        'The reef flats south of the cove are among the most accessible low intertidal in ' +
        'southern California, and among the most trampled. Watch your feet.',
    },
    seasons: {
      tidepooling:
        'Winter afternoons, almost without exception. Summer\'s lows are equally deep and fall ' +
        'before dawn, so the reef sees far fewer feet in July than the tide tables alone would ' +
        'suggest.',
    },
  },
  {
    slug: 'santa-barbara-ca',
    name: 'Santa Barbara',
    region: 'California',
    stationId: '9411340',
    latitude: 34.4085,
    longitude: -119.6851,
    timeZone: 'America/Los_Angeles',
    marine: { latitude: 34.35, longitude: -119.72 },
    seasons: {
      tidepooling:
        'Winter afternoons, around half past three. The Channel Islands block a good deal of the ' +
        'northwest swell, so a winter low here is walkable more often than one further up the ' +
        'coast.',
    },
  },
  {
    slug: 'santa-monica-ca',
    name: 'Santa Monica',
    region: 'California',
    stationId: '9410840',
    latitude: 34.0089,
    longitude: -118.4973,
    timeZone: 'America/Los_Angeles',
    marine: { latitude: 33.94, longitude: -118.58 },
    seasons: {
      tidepooling:
        'Winter afternoons. Sand is as much the variable as water: winter storms strip it back ' +
        'and uncover rock that is buried by August.',
    },
  },
  {
    slug: 'monterey-ca',
    name: 'Monterey',
    region: 'California',
    stationId: '9413450',
    latitude: 36.6053,
    longitude: -121.8884,
    timeZone: 'America/Los_Angeles',
    marine: { latitude: 36.58, longitude: -122.0 },
    seasons: {
      tidepooling:
        'Winter afternoons, though less absolutely than southern California. About a fifth of the ' +
        'year\'s best lows fall on spring mornings, and those are the calmer trips.',
    },
  },
  {
    slug: 'san-francisco-ca',
    name: 'San Francisco',
    region: 'California',
    stationId: '9414290',
    latitude: 37.8063,
    longitude: -122.4659,
    timeZone: 'America/Los_Angeles',
    marine: { latitude: 37.76, longitude: -122.63 },
    seasons: {
      tidepooling:
        'Winter lows arrive close to five in the afternoon, so the light runs out before the ' +
        'water comes back. Spring mornings are the practical alternative.',
    },
  },
  {
    slug: 'bodega-bay-ca',
    name: 'Bodega Bay',
    region: 'California',
    stationId: '9415020',
    latitude: 38.3167,
    longitude: -123.0481,
    timeZone: 'America/Los_Angeles',
    marine: { latitude: 38.28, longitude: -123.15 },
    seasons: {
      tidepooling:
        'Winter afternoons and spring mornings, roughly evenly split. Swell is the limiting ' +
        'factor here far more often than tide height.',
    },
  },
  {
    slug: 'crescent-city-ca',
    name: 'Crescent City',
    region: 'California',
    stationId: '9419750',
    latitude: 41.7456,
    longitude: -124.1843,
    timeZone: 'America/Los_Angeles',
    marine: { latitude: 41.73, longitude: -124.3 },
    seasons: {
      tidepooling:
        'Split almost evenly between winter evenings and summer mornings. Summer is the safer ' +
        'bet: winter\'s lows arrive near dusk with the year\'s largest swell running.',
    },
  },
  {
    slug: 'newport-or',
    name: 'Newport',
    region: 'Oregon',
    stationId: '9435380',
    latitude: 44.6252,
    longitude: -124.0454,
    timeZone: 'America/Los_Angeles',
    marine: { latitude: 44.61, longitude: -124.2 },
    seasons: {
      tidepooling:
        'Summer mornings, not winter. The deepest lows fall from May to July around a quarter to ' +
        'eight, and nearly three-quarters of them are in daylight. This is already the reverse of ' +
        'the California pattern.',
    },
  },
  {
    slug: 'astoria-or',
    name: 'Astoria',
    region: 'Oregon',
    stationId: '9439040',
    latitude: 46.2073,
    longitude: -123.7683,
    timeZone: 'America/Los_Angeles',
    marine: { latitude: 46.18, longitude: -124.15 },
    seasons: {
      tidepooling:
        'Summer mornings, emphatically. Winter\'s deep lows arrive around eight in the evening in ' +
        'the dark. The Columbia\'s outflow keeps the water turbid whatever the tide does.',
    },
  },
  {
    slug: 'seattle-wa',
    name: 'Seattle',
    region: 'Washington',
    stationId: '9447130',
    latitude: 47.6026,
    longitude: -122.3393,
    timeZone: 'America/Los_Angeles',
    marine: { latitude: 47.6, longitude: -122.44 },
    seasons: {
      tidepooling:
        'Summer, without qualification. Every one of the year\'s deepest lows between May and July ' +
        'falls in broad daylight around half past eleven; every winter one lands near ten at ' +
        'night. This is the opposite of the California pattern.',
    },
  },
  {
    slug: 'port-townsend-wa',
    name: 'Port Townsend',
    region: 'Washington',
    stationId: '9444900',
    latitude: 48.1129,
    longitude: -122.7595,
    timeZone: 'America/Los_Angeles',
    marine: { latitude: 48.15, longitude: -122.83 },
    seasons: {
      tidepooling:
        'Summer mornings, around half past ten, all of them in daylight. The winter equivalents ' +
        'arrive close to half past nine in the evening.',
    },
  },
  {
    slug: 'juneau-ak',
    name: 'Juneau',
    region: 'Alaska',
    stationId: '9452210',
    latitude: 58.2988,
    longitude: -134.4197,
    timeZone: 'America/Juneau',
    marine: { latitude: 58.28, longitude: -134.4 },
    seasons: {
      tidepooling:
        'Late spring through summer mornings. The range here is among the largest in the country, ' +
        'so a good low uncovers a great deal of ground and the water returns across it faster ' +
        'than you expect.',
    },
  },
  {
    slug: 'honolulu-hi',
    name: 'Honolulu',
    region: 'Hawaii',
    stationId: '1612340',
    latitude: 21.3069,
    longitude: -157.8583,
    timeZone: 'Pacific/Honolulu',
    marine: { latitude: 21.25, longitude: -157.9 },
    seasons: {
      tidepooling:
        'Spring mornings. With a range under two feet this is less about season than about ' +
        'catching the handful of days the water drops below about half a foot at a civilised ' +
        'hour.',
    },
  },
  {
    slug: 'boston-ma',
    name: 'Boston',
    region: 'Massachusetts',
    stationId: '8443970',
    latitude: 42.3601,
    longitude: -71.0589,
    timeZone: 'America/New_York',
    marine: { latitude: 42.33, longitude: -70.9 },
    seasons: {
      tidepooling:
        'Spread through the year, which is unusual. Winter and spring lows come mid to late ' +
        'afternoon, summer\'s before seven in the morning. What rules out a January trip here is ' +
        'water temperature, not water level.',
    },
  },
  {
    slug: 'portland-me',
    name: 'Portland',
    region: 'Maine',
    stationId: '8418150',
    latitude: 43.6591,
    longitude: -70.2568,
    timeZone: 'America/New_York',
    marine: { latitude: 43.6, longitude: -70.15 },
    seasons: {
      tidepooling:
        'Winter and spring afternoons, summer early mornings. The range is large enough that the ' +
        'water returns quickly once it turns, which is worth watching if you have walked out onto ' +
        'anything.',
    },
  },
  {
    slug: 'newport-ri',
    name: 'Newport',
    region: 'Rhode Island',
    stationId: '8452660',
    latitude: 41.5045,
    longitude: -71.3264,
    timeZone: 'America/New_York',
    marine: { latitude: 41.44, longitude: -71.33 },
    seasons: {
      tidepooling:
        'Winter and early spring, around the middle of the day. The range is small, so the gap ' +
        'between an exceptional day and an ordinary one is a matter of inches.',
    },
  },
  {
    slug: 'montauk-ny',
    name: 'Montauk',
    region: 'New York',
    stationId: '8510560',
    latitude: 41.0482,
    longitude: -71.9595,
    timeZone: 'America/New_York',
    marine: { latitude: 41.0, longitude: -71.95 },
    seasons: {
      tidepooling:
        'Winter afternoons. With barely two feet of range, wind does as much as the moon: a hard ' +
        'northwesterly will push more water off the flats than the tide will.',
    },
  },
  {
    slug: 'atlantic-city-nj',
    name: 'Atlantic City',
    region: 'New Jersey',
    stationId: '8534720',
    latitude: 39.3556,
    longitude: -74.4183,
    timeZone: 'America/New_York',
    marine: { latitude: 39.32, longitude: -74.36 },
    seasons: {
      tidepooling:
        'Winter middays. Nearly six in ten of the year\'s deepest lows fall between December and ' +
        'February, about half of those in daylight.',
    },
  },
  {
    slug: 'charleston-sc',
    name: 'Charleston',
    region: 'South Carolina',
    stationId: '8665530',
    latitude: 32.7807,
    longitude: -79.9251,
    timeZone: 'America/New_York',
    marine: { latitude: 32.7, longitude: -79.8 },
    seasons: {
      tidepooling:
        'Spring afternoons. Winter\'s lows are marginally deeper but cluster around one in the ' +
        'afternoon in cold water; by April the same tides come at half past two and are in ' +
        'daylight three times out of four.',
    },
  },
  {
    slug: 'key-west-fl',
    name: 'Key West',
    region: 'Florida',
    stationId: '8724580',
    latitude: 24.5551,
    longitude: -81.8079,
    timeZone: 'America/New_York',
    marine: { latitude: 24.48, longitude: -81.8 },
    seasons: {
      tidepooling:
        'Late spring and summer afternoons. Winter\'s lows are technically the year\'s lowest and ' +
        'almost all of them arrive around twenty to four in the morning, which makes them of no ' +
        'use to anyone.',
    },
  },
  {
    slug: 'galveston-tx',
    name: 'Galveston',
    region: 'Texas',
    stationId: '8771450',
    latitude: 29.3013,
    longitude: -94.7977,
    timeZone: 'America/Chicago',
    marine: { latitude: 29.23, longitude: -94.72 },
    seasons: {
      tidepooling:
        'Winter mornings. One tide a day here rather than two, and a cold front pushing water ' +
        'offshore will take it lower than the prediction says.',
    },
  },
];

/** @returns {Location|undefined} */
export function locationBySlug(slug) {
  return LOCATIONS.find((location) => location.slug === slug);
}

/**
 * The offshore point for whichever curated location is nearest, if one is close.
 *
 * The app is coordinate-driven — you can type in anywhere — but a marine point
 * has to be picked by hand, so there is nothing sensible to offer for a
 * coordinate in the middle of the country. Rather than guess a direction and
 * risk a confidently wrong surf number, this returns null beyond a short radius
 * and the surf line simply doesn't appear.
 *
 * @returns {{latitude: number, longitude: number}|null}
 */
export function nearestMarinePoint(latitude, longitude, withinMiles = 40) {
  let best = null;
  for (const location of LOCATIONS) {
    if (!location.marine) continue;
    const miles = distanceInMiles(latitude, longitude, location.latitude, location.longitude);
    if (miles <= withinMiles && (best === null || miles < best.miles)) {
      best = { miles, marine: location.marine };
    }
  }
  return best?.marine ?? null;
}

/** Great-circle miles. Duplicated from tides.js rather than importing it, so
 *  locations.js stays a leaf module the Worker can load on its own. */
function distanceInMiles(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(a));
}
