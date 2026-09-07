/**
 * The pick-a-spot map, and the Leaflet it runs on.
 *
 * Typing coordinates is precise and nobody knows theirs. This is the other way
 * in: open the picker, click the water you actually fish, and the calendar
 * follows.
 *
 * Leaflet is the one third-party dependency on the site, so it's worth saying
 * exactly what that costs. It is fetched on the first open of the picker and
 * never before, which means a reader who only ever looks at the calendar loads
 * nothing from anyone but us. Both files are pinned to an exact version and
 * carry an integrity hash, so the CDN can't change what runs here without the
 * browser refusing it. And if it doesn't arrive at all, `loadLeaflet` rejects,
 * the picker says so, and the coordinate inputs work exactly as they always
 * did. Losing the map should cost you the map and nothing else.
 *
 * Like everything in `views/`, this owns DOM and no arithmetic worth testing.
 */

/**
 * Exactly which Leaflet, and its hashes.
 *
 * The version is pinned rather than floating: `leaflet@1` would let the CDN
 * swap the script under a live site with no deploy here, and would break these
 * hashes the moment it did. Bumping it means recomputing both.
 */
export const LEAFLET = {
  version: '1.9.4',
  css: {
    url: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    integrity: 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=',
  },
  js: {
    url: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    integrity: 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=',
  },
};

/** Regional: enough coast on screen to recognise, close enough to aim with. */
const DEFAULT_ZOOM = 9;

/**
 * Below this, two coordinates are the same spot.
 *
 * Used so `moveTo` can tell "the app is telling me about the pin I just moved"
 * from "the app moved somewhere new", which keeps a click near the edge of the
 * map from yanking the view out from under the cursor. At 1e-9 degrees the two
 * readings are a fraction of a millimetre apart, so nothing a person could do
 * lands inside it by accident.
 */
const SAME_SPOT = 1e-9;

/** In flight or settled, so a second open doesn't fetch Leaflet again. */
let pending = null;

/**
 * Fetch Leaflet, once, and resolve with it.
 *
 * A failure clears the memo, so a reader who opens the picker on a dropped
 * connection and tries again gets a second attempt rather than the first
 * failure forever.
 *
 * @returns {Promise<object>} Leaflet's `L`.
 */
export function loadLeaflet() {
  if (globalThis.L) return Promise.resolve(globalThis.L);
  pending ??= new Promise((resolve, reject) => {
    // The stylesheet isn't awaited: Leaflet draws nothing until the map is
    // built, which is after the script has run, and a stylesheet that arrives
    // a moment late costs at most one unstyled frame.
    if (!document.querySelector(`link[href="${LEAFLET.css.url}"]`)) {
      document.head.append(
        Object.assign(document.createElement('link'), {
          rel: 'stylesheet',
          href: LEAFLET.css.url,
          integrity: LEAFLET.css.integrity,
          crossOrigin: 'anonymous',
        }),
      );
    }

    const script = Object.assign(document.createElement('script'), {
      src: LEAFLET.js.url,
      integrity: LEAFLET.js.integrity,
      // Required for the integrity check to happen at all: without it the
      // browser can't read the response well enough to hash it, and silently
      // skips the check rather than failing. The hash would be decoration.
      crossOrigin: 'anonymous',
      onload: () =>
        globalThis.L
          ? resolve(globalThis.L)
          : fail(new Error('the map script loaded but defined nothing')),
      onerror: () => fail(new Error('the map script could not be fetched')),
    });

    const fail = (error) => {
      pending = null;
      script.remove();
      reject(error);
    };

    document.head.append(script);
  });
  return pending;
}

/**
 * Put a slippy map in `container` and report the spot the pin is on.
 *
 * Call only once Leaflet has loaded and the container is visible — inside a
 * closed `<dialog>` it would measure zero and load no tiles. `refresh` covers
 * the case where it changes size later.
 *
 * @param {object} options
 * @param {HTMLElement} options.container
 * @param {number} options.latitude   Where to open.
 * @param {number} options.longitude
 * @param {(location: {latitude: number, longitude: number}) => void} options.onPick
 *   Called for a click on the map or a drag of the pin. Never called for a
 *   programmatic `moveTo`, so a caller can't feed its own updates back to itself.
 * @returns {{moveTo: Function, refresh: Function}}
 */
export function createLocationMap({ container, latitude, longitude, onPick }) {
  const L = globalThis.L;

  const map = L.map(container, {
    center: [latitude, longitude],
    zoom: DEFAULT_ZOOM,
    // Safe to leave on, unlike an inline map: there's a modal backdrop behind
    // this, so a wheel over it can't have been meant for the page.
    scrollWheelZoom: true,
  });

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    // Required by the tile usage policy, and fair besides.
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" rel="noopener">OpenStreetMap</a>',
  }).addTo(map);

  // A `divIcon` rather than Leaflet's default pin: it's drawn in the site's own
  // colours by style.css, and it costs no image request on top of the tiles.
  const pin = L.marker([latitude, longitude], {
    draggable: true,
    keyboard: false,
    icon: L.divIcon({
      className: 'map-pin',
      html: '<span class="map-pin-dot"></span>',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    }),
  }).addTo(map);

  const report = ({ lat, lng }) => onPick({ latitude: lat, longitude: lng });

  map.on('click', (event) => {
    pin.setLatLng(event.latlng);
    report(event.latlng);
  });
  pin.on('dragend', () => report(pin.getLatLng()));

  return {
    /**
     * Move the pin and the view to a location chosen somewhere else — the
     * coordinate inputs, or the browser's geolocation.
     *
     * A no-op when the pin is already there, which is the case every time this
     * is called in response to a pick made *on* the map. That's what stops an
     * off-centre click from recentring the map as a side effect of itself.
     */
    moveTo(nextLatitude, nextLongitude, { zoom } = {}) {
      const here = pin.getLatLng();
      if (
        Math.abs(here.lat - nextLatitude) < SAME_SPOT &&
        Math.abs(here.lng - nextLongitude) < SAME_SPOT
      ) {
        return;
      }
      pin.setLatLng([nextLatitude, nextLongitude]);
      map.setView([nextLatitude, nextLongitude], zoom ?? map.getZoom());
    },

    /**
     * Re-measure the container.
     *
     * Leaflet caches the size it was built at, and a map inside a dialog can be
     * reopened at a different one — a rotated phone, a resized window. Without
     * this it draws tiles for the old size and leaves grey where the map grew.
     */
    refresh() {
      map.invalidateSize();
    },
  };
}
