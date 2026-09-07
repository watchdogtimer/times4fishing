/**
 * The little map panel in the controls that shows where you've chosen.
 *
 * Deliberately not a second Leaflet map. This one is on screen for everybody on
 * every visit, so it's a handful of `<img>` tags positioned by hand: no script
 * to fetch, nothing to initialise, and it renders the same whether or not the
 * picker's Leaflet ever loads. The interactive map is a separate thing that
 * appears only when you open the picker — see `location-map.js`.
 *
 * The maths is the standard Web Mercator tile scheme, which is worth stating
 * plainly because it's the only reason this is more than four lines: tiles are
 * 256-pixel squares on a grid that doubles with every zoom level, so putting a
 * given point in the middle of a given box means working out which squares
 * overlap it and by how much.
 */

const TILE_SIZE = 256;

/** Close enough to place a stretch of coast, wide enough to recognise it. */
const THUMBNAIL_ZOOM = 8;

/**
 * Where a coordinate lands in the whole world's pixel grid at this zoom.
 *
 * @returns {{x: number, y: number, worldSize: number}} Pixels from the top-left
 *   of the map of the world, and how big that map is on a side.
 */
function project(latitude, longitude, zoom) {
  const worldSize = TILE_SIZE * 2 ** zoom;
  const sine = Math.sin((latitude * Math.PI) / 180);
  return {
    x: ((longitude + 180) / 360) * worldSize,
    // The Mercator y. Clamped by the caller's latitude limits rather than here:
    // the poles project to infinity and nobody fishes there.
    y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * worldSize,
    worldSize,
  };
}

/**
 * Draw the panel centred on a location.
 *
 * Called again on every location change; it replaces its own contents rather
 * than diffing, which at four tiles is not worth being clever about.
 *
 * @param {object} options
 * @param {HTMLElement|null} options.container The fixed-size box to fill.
 * @param {number} options.latitude
 * @param {number} options.longitude
 */
export function renderLocationThumbnail({ container, latitude, longitude }) {
  if (!container) return;

  const { width, height } = container.getBoundingClientRect();
  // Called before the element has been laid out — nothing sensible to draw yet,
  // and the next call (there always is one) will have real numbers.
  if (!width || !height) return;

  const zoom = THUMBNAIL_ZOOM;
  const { x, y, worldSize } = project(latitude, longitude, zoom);
  const tilesPerSide = 2 ** zoom;

  // The box, expressed in world pixels, with the chosen point at its centre.
  const left = x - width / 2;
  const top = y - height / 2;

  const tiles = [];
  for (let tileX = Math.floor(left / TILE_SIZE); tileX <= Math.floor((left + width) / TILE_SIZE); tileX++) {
    for (let tileY = Math.floor(top / TILE_SIZE); tileY <= Math.floor((top + height) / TILE_SIZE); tileY++) {
      // Above the north edge or below the south: there is no tile, and asking
      // for one gets a 404 rather than blank water.
      if (tileY < 0 || tileY >= tilesPerSide) continue;
      // East-west does wrap, so a box straddling the date line keeps working.
      const wrappedX = ((tileX % tilesPerSide) + tilesPerSide) % tilesPerSide;
      tiles.push(
        `<img src="https://tile.openstreetmap.org/${zoom}/${wrappedX}/${tileY}.png" alt="" ` +
          `loading="lazy" width="${TILE_SIZE}" height="${TILE_SIZE}" ` +
          `style="left:${Math.round(tileX * TILE_SIZE - left)}px;top:${Math.round(tileY * TILE_SIZE - top)}px">`,
      );
    }
  }

  container.innerHTML =
    `<span class="map-thumb-tiles">${tiles.join('')}</span>` +
    // The pin is always dead centre, because that's what the box was built around.
    '<span class="map-pin-dot map-thumb-pin"></span>' +
    // Required wherever the tiles are shown, small print or not.
    '<span class="map-thumb-credit">&copy; OpenStreetMap</span>';
}
