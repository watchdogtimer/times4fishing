/**
 * Low-precision sun and moon positions.
 *
 * The formulas come from Paul Schlyter's "Computing planetary positions"
 * (https://stjarnhimlen.se/comp/ppcomp.html), which trades a lot of precision
 * for a little arithmetic. Expect roughly ±1 arcminute for the sun and
 * ±2 arcminutes for the moon, which works out to rise/set times good to about
 * a minute. That is far better than we need for fishing windows.
 *
 * Two conventions run through this whole file:
 *
 *  1. Angles are in DEGREES, not radians. The `sinDeg`/`cosDeg`/etc. helpers
 *     do the conversion so the formulas read like the published ones.
 *  2. Time is expressed as `epochDays` — days (including a fractional part)
 *     since the epoch 1999-12-31 00:00 UT. Schlyter's orbital elements are all
 *     linear in this quantity, which is why it shows up everywhere.
 */

/* ---------------------------------------------------------------- *
 * Degree-based trig helpers
 * ---------------------------------------------------------------- */

const RADIANS_PER_DEGREE = Math.PI / 180;

export const sinDeg = (deg) => Math.sin(deg * RADIANS_PER_DEGREE);
export const cosDeg = (deg) => Math.cos(deg * RADIANS_PER_DEGREE);
export const atan2Deg = (y, x) => Math.atan2(y, x) / RADIANS_PER_DEGREE;

/** asin/acos, clamped so floating point drift just outside [-1, 1] can't produce NaN. */
const clampToUnit = (x) => Math.max(-1, Math.min(1, x));
export const asinDeg = (x) => Math.asin(clampToUnit(x)) / RADIANS_PER_DEGREE;
export const acosDeg = (x) => Math.acos(clampToUnit(x)) / RADIANS_PER_DEGREE;

/** Wrap an angle into [0, 360). */
export function normalizeDegrees(deg) {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** Wrap a clock time into [0, 24). */
export function normalizeHours(hours) {
  const wrapped = hours % 24;
  return wrapped < 0 ? wrapped + 24 : wrapped;
}

/* ---------------------------------------------------------------- *
 * Time
 * ---------------------------------------------------------------- */

/** Julian Day number of 1999-12-31 00:00 UT, the epoch Schlyter's elements use. */
const EPOCH_JULIAN_DAY = 2451543.5;

/**
 * Convert a UT calendar date to days since the epoch.
 *
 * Uses the standard Gregorian Julian Day algorithm (Meeus, ch. 7). January and
 * February are treated as months 13 and 14 of the previous year so that the
 * leap day always lands at the end of the "year".
 *
 * @param {number} year   Full year, e.g. 2026.
 * @param {number} month  1-12.
 * @param {number} day    1-31.
 * @param {number} hourUt Hour of day in UT, may be fractional.
 */
export function toEpochDays(year, month, day, hourUt) {
  if (month <= 2) {
    year -= 1;
    month += 12;
  }
  const century = Math.floor(year / 100);
  const gregorianCorrection = 2 - century + Math.floor(century / 4);
  const julianDay =
    Math.floor(365.25 * (year + 4716)) +
    Math.floor(30.6001 * (month + 1)) +
    day +
    hourUt / 24 +
    gregorianCorrection -
    1524.5;
  return julianDay - EPOCH_JULIAN_DAY;
}

/* ---------------------------------------------------------------- *
 * Shared orbital mechanics
 * ---------------------------------------------------------------- */

/**
 * Obliquity of the ecliptic: the tilt of Earth's axis, which is what turns
 * ecliptic coordinates (where the orbits are simple) into equatorial ones
 * (where rise/set is simple). Drifts very slowly, hence the tiny time term.
 */
function obliquityOfEcliptic(epochDays) {
  return 23.4393 - 3.563e-7 * epochDays;
}

/**
 * Solve Kepler's equation M = E - e·sin(E) for the eccentric anomaly E.
 *
 * `M` (mean anomaly) advances uniformly with time; `E` is the angle you
 * actually need to locate the body on its ellipse. There's no closed form, so
 * we seed with the standard first-order approximation and refine with Newton's
 * method. Both the sun and the moon have small eccentricities (0.017 and 0.055),
 * so a handful of iterations converges well past the precision we need.
 *
 * @param {number} meanAnomalyDeg
 * @param {number} eccentricity
 * @param {number} iterations
 * @returns {number} Eccentric anomaly in degrees.
 */
function solveKepler(meanAnomalyDeg, eccentricity, iterations) {
  const degPerRad = 1 / RADIANS_PER_DEGREE;
  let eccentricAnomaly =
    meanAnomalyDeg +
    degPerRad * eccentricity * sinDeg(meanAnomalyDeg) * (1 + eccentricity * cosDeg(meanAnomalyDeg));

  for (let i = 0; i < iterations; i++) {
    const error =
      eccentricAnomaly - degPerRad * eccentricity * sinDeg(eccentricAnomaly) - meanAnomalyDeg;
    const derivative = 1 - eccentricity * cosDeg(eccentricAnomaly);
    eccentricAnomaly -= error / derivative;
  }
  return eccentricAnomaly;
}

/**
 * Rotate ecliptic coordinates into equatorial ones (right ascension /
 * declination) by tilting about the x-axis by the obliquity.
 *
 * @returns {{rightAscension: number, declination: number}} Both in degrees.
 */
function eclipticToEquatorial(x, y, z, obliquityDeg) {
  const radius = Math.sqrt(x * x + y * y + z * z);
  const equatorialY = y * cosDeg(obliquityDeg) - z * sinDeg(obliquityDeg);
  const equatorialZ = y * sinDeg(obliquityDeg) + z * cosDeg(obliquityDeg);
  return {
    rightAscension: normalizeDegrees(atan2Deg(equatorialY, x)),
    declination: asinDeg(equatorialZ / radius),
  };
}

/**
 * @typedef {object} SkyPosition
 * @property {number} rightAscension Degrees, 0-360. Celestial "longitude".
 * @property {number} declination    Degrees, -90 to +90. Celestial "latitude".
 * @property {number} eclipticLongitude Degrees, 0-360. The body's true position
 *   along the ecliptic. Used for the moon phase.
 * @property {number} [meanLongitude] Degrees, 0-360. Sun only: where the sun
 *   would be if the Earth's orbit were a circle. Sidereal time is defined from
 *   this, not from the true longitude — the difference between them is the
 *   equation of time, up to about 16 minutes.
 */

/* ---------------------------------------------------------------- *
 * Sun
 * ---------------------------------------------------------------- */

/**
 * Position of the sun.
 *
 * The sun is the easy case: by definition it sits on the ecliptic, so its
 * ecliptic latitude is zero and we only have to solve the Earth's orbit and
 * rotate the result into equatorial coordinates.
 *
 * @param {number} epochDays
 * @returns {SkyPosition}
 */
export function sunPosition(epochDays) {
  // Orbital elements of the Earth's orbit, seen from Earth as the sun's orbit.
  const argumentOfPerihelion = normalizeDegrees(282.9404 + 4.70935e-5 * epochDays);
  const eccentricity = 0.016709 - 1.151e-9 * epochDays;
  const meanAnomaly = normalizeDegrees(356.047 + 0.9856002585 * epochDays);

  const eccentricAnomaly = solveKepler(meanAnomaly, eccentricity, 3);

  // Position in the orbital plane, then converted to distance + true anomaly.
  const orbitalX = cosDeg(eccentricAnomaly) - eccentricity;
  const orbitalY = Math.sqrt(1 - eccentricity * eccentricity) * sinDeg(eccentricAnomaly);
  const distanceAu = Math.sqrt(orbitalX * orbitalX + orbitalY * orbitalY);
  const trueAnomaly = atan2Deg(orbitalY, orbitalX);

  const eclipticLongitude = normalizeDegrees(trueAnomaly + argumentOfPerihelion);
  const x = distanceAu * cosDeg(eclipticLongitude);
  const y = distanceAu * sinDeg(eclipticLongitude);

  const equatorial = eclipticToEquatorial(x, y, 0, obliquityOfEcliptic(epochDays));
  const meanLongitude = normalizeDegrees(meanAnomaly + argumentOfPerihelion);
  return { ...equatorial, eclipticLongitude, meanLongitude };
}

/* ---------------------------------------------------------------- *
 * Moon
 * ---------------------------------------------------------------- */

/**
 * The largest periodic corrections to the moon's orbit, as
 * [coefficient, and the multiples of D, meanAnomaly, sunMeanAnomaly, F to combine].
 *
 * The moon's orbit is badly disturbed by the sun, so the simple ellipse is off
 * by more than a degree. These terms, each a sine wave in some combination of
 * the four fundamental arguments below, pull it back to a few arcminutes.
 * Schlyter lists them in descending order of size; we keep every term he does.
 *
 * Arguments:
 *   D  - mean elongation (moon's angular distance from the sun)
 *   Mm - moon's mean anomaly
 *   Ms - sun's mean anomaly
 *   F  - argument of latitude (moon's distance from its ascending node)
 */
const MOON_LONGITUDE_TERMS = [
  // [coefficient, D, Mm, Ms, F]
  [-1.274, -2, 1, 0, 0], // Evection
  [0.658, 2, 0, 0, 0], // Variation
  [-0.186, 0, 0, 1, 0], // Yearly equation
  [-0.059, -2, 2, 0, 0],
  [-0.057, -2, 1, 1, 0],
  [0.053, 2, 1, 0, 0],
  [0.046, 2, 0, -1, 0],
  [0.041, 0, 1, -1, 0],
  [-0.035, 1, 0, 0, 0], // Parallactic equation
  [-0.031, 0, 1, 1, 0],
  [-0.015, -2, 0, 0, 2],
  [0.011, -4, 1, 0, 0],
];

const MOON_LATITUDE_TERMS = [
  // [coefficient, D, Mm, Ms, F]
  [-0.173, -2, 0, 0, 1],
  [-0.055, -2, 1, 0, -1],
  [-0.046, -2, 1, 0, 1],
  [0.033, 2, 0, 0, 1],
  [0.017, 0, 2, 0, 1],
];

const MOON_DISTANCE_TERMS = [
  // [coefficient, D, Mm, Ms, F] — cosine terms, in Earth radii
  [-0.58, -2, 1, 0, 0],
  [-0.46, 2, 0, 0, 0],
];

/** Sum a table of periodic terms against the four fundamental lunar arguments. */
function sumPeriodicTerms(terms, trigFn, { D, Mm, Ms, F }) {
  return terms.reduce(
    (total, [coefficient, dMul, mmMul, msMul, fMul]) =>
      total + coefficient * trigFn(dMul * D + mmMul * Mm + msMul * Ms + fMul * F),
    0,
  );
}

/**
 * Position of the moon.
 *
 * Three steps: solve the moon's own ellipse, rotate that orbital plane into
 * ecliptic coordinates (the moon's orbit is inclined ~5° to the ecliptic, so
 * unlike the sun it needs the full 3-D treatment), then apply the perturbation
 * tables above before converting to equatorial coordinates.
 *
 * @param {number} epochDays
 * @returns {SkyPosition}
 */
export function moonPosition(epochDays) {
  // Orbital elements of the moon.
  const ascendingNode = normalizeDegrees(125.1228 - 0.0529538083 * epochDays);
  const inclination = 5.1454;
  const argumentOfPerigee = normalizeDegrees(318.0634 + 0.1643573223 * epochDays);
  const semiMajorAxisEarthRadii = 60.2666;
  const eccentricity = 0.0549;
  const meanAnomaly = normalizeDegrees(115.3654 + 13.0649929509 * epochDays);

  const eccentricAnomaly = solveKepler(meanAnomaly, eccentricity, 4);

  // Position within the orbital plane.
  const orbitalX = semiMajorAxisEarthRadii * (cosDeg(eccentricAnomaly) - eccentricity);
  const orbitalY =
    semiMajorAxisEarthRadii *
    Math.sqrt(1 - eccentricity * eccentricity) *
    sinDeg(eccentricAnomaly);
  const orbitalRadius = Math.sqrt(orbitalX * orbitalX + orbitalY * orbitalY);
  const trueAnomaly = atan2Deg(orbitalY, orbitalX);

  // Rotate the orbital plane into ecliptic coordinates: swing by the argument
  // of perigee plus true anomaly, tilt by the inclination, swing by the node.
  const angleInOrbit = trueAnomaly + argumentOfPerigee;
  const eclipticX =
    orbitalRadius *
    (cosDeg(ascendingNode) * cosDeg(angleInOrbit) -
      sinDeg(ascendingNode) * sinDeg(angleInOrbit) * cosDeg(inclination));
  const eclipticY =
    orbitalRadius *
    (sinDeg(ascendingNode) * cosDeg(angleInOrbit) +
      cosDeg(ascendingNode) * sinDeg(angleInOrbit) * cosDeg(inclination));
  const eclipticZ = orbitalRadius * sinDeg(angleInOrbit) * sinDeg(inclination);

  let longitude = atan2Deg(eclipticY, eclipticX);
  let latitude = atan2Deg(eclipticZ, Math.hypot(eclipticX, eclipticY));
  let distance = Math.hypot(eclipticX, eclipticY, eclipticZ);

  // The four fundamental arguments the perturbation tables are built from.
  const sun = sunPosition(epochDays);
  const moonMeanLongitude = normalizeDegrees(ascendingNode + argumentOfPerigee + meanAnomaly);
  const args = {
    D: normalizeDegrees(moonMeanLongitude - sun.eclipticLongitude),
    Mm: meanAnomaly,
    Ms: normalizeDegrees(356.047 + 0.9856002585 * epochDays),
    F: normalizeDegrees(moonMeanLongitude - ascendingNode),
  };

  longitude += sumPeriodicTerms(MOON_LONGITUDE_TERMS, sinDeg, args);
  latitude += sumPeriodicTerms(MOON_LATITUDE_TERMS, sinDeg, args);
  distance += sumPeriodicTerms(MOON_DISTANCE_TERMS, cosDeg, args);

  const x = distance * cosDeg(longitude) * cosDeg(latitude);
  const y = distance * sinDeg(longitude) * cosDeg(latitude);
  const z = distance * sinDeg(latitude);

  const equatorial = eclipticToEquatorial(x, y, z, obliquityOfEcliptic(epochDays));
  return { ...equatorial, eclipticLongitude: normalizeDegrees(longitude) };
}

/* ---------------------------------------------------------------- *
 * Moon phase
 * ---------------------------------------------------------------- */

const PHASE_NAMES = [
  'New Moon',
  'Waxing Crescent',
  'First Quarter',
  'Waxing Gibbous',
  'Full Moon',
  'Waning Gibbous',
  'Last Quarter',
  'Waning Crescent',
];

/**
 * Illuminated fraction and traditional name of the moon phase.
 *
 * Illumination follows from the elongation (the sun-earth-moon angle): at 0°
 * the lit face points away from us, at 180° it faces us squarely.
 *
 * The name comes from how far the moon has pulled ahead of the sun in ecliptic
 * longitude, which is what actually defines the phases. Each of the eight names
 * covers an eighth of the cycle, centred on its exact moment — so "New Moon"
 * straddles the wrap point at 0.
 *
 * @param {number} epochDays
 * @returns {{illuminatedFraction: number, name: string, waxing: boolean,
 *   cycleFraction: number}}
 */
export function moonPhase(epochDays) {
  const moon = moonPosition(epochDays);
  const sun = sunPosition(epochDays);

  const elongation = acosDeg(
    sinDeg(moon.declination) * sinDeg(sun.declination) +
      cosDeg(moon.declination) * cosDeg(sun.declination) * cosDeg(moon.rightAscension - sun.rightAscension),
  );
  const illuminatedFraction = (1 - cosDeg(elongation)) / 2;

  const cycleFraction = normalizeDegrees(moon.eclipticLongitude - sun.eclipticLongitude) / 360;
  const eighth = cycleFraction * PHASE_NAMES.length;
  const nameIndex = Math.round(eighth) % PHASE_NAMES.length;

  return {
    illuminatedFraction,
    name: PHASE_NAMES[nameIndex],
    // How far through the cycle, 0 at new and 0.5 at full. Callers use it to
    // find the exact moment of a new or full moon, which the illuminated
    // fraction can't give them: it sits at 100% for a day and a half either
    // side of full, so it says "nearly full" for three days running.
    cycleFraction,
    // Which limb is lit. Drawing the phase needs this and the fraction alone
    // can't supply it: at 23% lit, waxing and waning are mirror images.
    waxing: cycleFraction < 0.5,
  };
}

/* ---------------------------------------------------------------- *
 * Rise, set, and transit times
 * ---------------------------------------------------------------- */

/**
 * Altitude at which the sun's upper limb touches the horizon: half a degree of
 * apparent radius plus about a third of a degree of atmospheric refraction.
 */
export const SUN_HORIZON_ALTITUDE_DEG = -0.833;

/**
 * The moon's horizon altitude. It's positive because the moon is close enough
 * that parallax (we observe from the surface, not the centre, of the Earth)
 * outweighs refraction and its apparent radius.
 */
export const MOON_HORIZON_ALTITUDE_DEG = 0.125;

/**
 * Greenwich mean sidereal time at 00:00 UT, in degrees.
 *
 * Sidereal time is "which right ascension is currently on the Greenwich
 * meridian". Schlyter's shortcut: at midnight UT that's the sun's *mean*
 * longitude plus 180°. It has to be the mean longitude — sidereal time tracks
 * the fictitious uniformly-moving sun that clocks are based on, so using the
 * true longitude here would fold the equation of time into every rise and set.
 */
function greenwichSiderealTimeAtMidnight(epochDays) {
  return normalizeDegrees(sunPosition(epochDays).meanLongitude + 180);
}

/**
 * Find the local clock time at which a body reaches a given hour angle.
 *
 * The hour angle is how far the body is from the observer's meridian: 0° means
 * directly overhead (upper transit), 180° means directly underfoot (lower
 * transit), and ±H means the body is rising or setting, where H comes from the
 * standard spherical-trig formula for the horizon crossing.
 *
 * Both the body's position and sidereal time depend on the answer, so this is
 * solved by fixed-point iteration: guess local midday, compute where the body
 * would be at that moment, derive a better time, repeat. It converges fast
 * because the sky turns ~360°/day while the sun and moon drift only about 1°
 * and 13°/day, so each pass shrinks the error by more than an order of
 * magnitude.
 *
 * The astronomy is all in UT; the conversion to local time happens at the end
 * of each pass, and the result is wrapped into [0, 24) so the answer is always
 * the occurrence on the requested local day.
 *
 * Not every day has every event. Because the moon runs about 50 minutes late
 * each day, roughly once a month it rises just before midnight and then not
 * again until after the following midnight — so that day has no moonrise at
 * all. There's no fixed point to find on such a day, and the iteration instead
 * flip-flops between the events on either side of it, which is exactly how we
 * detect the case: see CONVERGENCE_TOLERANCE_HOURS below.
 *
 * Known limitation: the mirror-image case, a day with *two* moonrises, returns
 * only the one the iteration happens to settle on. Representing that properly
 * would mean giving up one-event-per-day, which isn't worth it for a calendar.
 *
 * @param {object}   options
 * @param {Function} options.positionFn      `sunPosition` or `moonPosition`.
 * @param {number}   options.midnightEpochDays Epoch-days at local midnight.
 * @param {number}   options.utcOffsetHours  Hours to add to local time to get UT.
 * @param {number}   options.latitude        Observer latitude in degrees.
 * @param {number}   options.longitude       Observer longitude in degrees, east positive.
 * @param {number}  [options.horizonAltitudeDeg] Set for a rise/set solve.
 * @param {number}  [options.direction]      -1 for rise, +1 for set. Pairs with horizonAltitudeDeg.
 * @param {number}  [options.hourAngleDeg]   Set instead for a transit solve (0 or 180).
 * @returns {number|null} Local hour in [0, 24), or null when the event doesn't
 *   happen on this day — either because the body stays above or below the
 *   horizon all day (polar summer or winter) or because of the skipped-day case
 *   described above.
 */
export function solveLocalEventHour({
  positionFn,
  midnightEpochDays,
  utcOffsetHours,
  latitude,
  longitude,
  horizonAltitudeDeg,
  direction,
  hourAngleDeg,
}) {
  const ITERATIONS = 8;
  let localHour = 12; // Start from midday; any starting guess in the day works.
  let previousHour = null;

  for (let i = 0; i < ITERATIONS; i++) {
    const epochDays = midnightEpochDays + localHour / 24;
    const position = positionFn(epochDays);
    const siderealTime = greenwichSiderealTimeAtMidnight(epochDays);

    let hourAngle;
    if (direction !== undefined) {
      // cos(H) = (sin(h) - sin(lat)·sin(dec)) / (cos(lat)·cos(dec))
      const cosHourAngle =
        (sinDeg(horizonAltitudeDeg) - sinDeg(latitude) * sinDeg(position.declination)) /
        (cosDeg(latitude) * cosDeg(position.declination));
      // Out of range means the body stays entirely above or below the horizon
      // for the whole day — polar summer or winter.
      if (cosHourAngle > 1 || cosHourAngle < -1) return null;
      hourAngle = direction * acosDeg(cosHourAngle);
    } else {
      hourAngle = hourAngleDeg;
    }

    // The body sits at `hourAngle` when local sidereal time equals RA + hourAngle.
    const utHour = (position.rightAscension + hourAngle - siderealTime - longitude) / 15;
    previousHour = localHour;
    localHour = normalizeHours(utHour - utcOffsetHours);
  }

  // A real event is a fixed point of that map, and the iteration lands on it to
  // well under a second. Anything still moving after eight passes is the
  // flip-flop described above, which means the event doesn't fall on this day.
  return hoursApart(localHour, previousHour) <= CONVERGENCE_TOLERANCE_HOURS ? localHour : null;
}

/**
 * How still the iteration has to be to count as converged, in hours.
 *
 * Genuine solutions settle to within a few milliseconds of a second, and the
 * flip-flop case stays tens of minutes apart, so anywhere in between works.
 * One minute sits comfortably in the middle of that gap.
 */
const CONVERGENCE_TOLERANCE_HOURS = 1 / 60;

/** Distance between two times of day, measuring across midnight if that's shorter. */
export function hoursApart(a, b) {
  const direct = Math.abs(a - b);
  return Math.min(direct, 24 - direct);
}
