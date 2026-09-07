/**
 * Choosing a location: the little map panel, and the picker it opens.
 *
 * Two very different things to test. The panel is arithmetic — Web Mercator
 * tile placement — and gets tested like arithmetic. The picker is Leaflet in a
 * dialog, which needs a browser, so what's pinned here is only the part that
 * can go wrong silently: how the script is fetched, and what happens when it
 * isn't.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { LEAFLET, loadLeaflet } from '../src/views/location-map.js';
import { renderLocationThumbnail } from '../src/views/location-thumbnail.js';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const html = read('../index.html');

const TILE = 256;

/**
 * Render the panel into a fake box and pull the tiles back out.
 *
 * The module only ever touches the container it's handed, so a plain object
 * with the two properties it uses is a complete stand-in for an element.
 */
function renderThumbnail({ latitude, longitude, width = 240, height = 104 }) {
  let markup = '';
  renderLocationThumbnail({
    container: {
      getBoundingClientRect: () => ({ width, height }),
      set innerHTML(value) {
        markup = value;
      },
    },
    latitude,
    longitude,
  });

  const tiles = [...markup.matchAll(
    /tile\.openstreetmap\.org\/(\d+)\/(\d+)\/(\d+)\.png[^>]*left:(-?\d+)px;top:(-?\d+)px/g,
  )].map(([, z, x, y, left, top]) => ({
    z: +z, x: +x, y: +y, left: +left, top: +top,
  }));

  return { markup, tiles, width, height };
}

/** The same projection the module uses, written out independently. */
function project(latitude, longitude, zoom) {
  const worldSize = TILE * 2 ** zoom;
  const sine = Math.sin((latitude * Math.PI) / 180);
  return {
    x: ((longitude + 180) / 360) * worldSize,
    y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * worldSize,
  };
}

describe('the location panel', () => {
  test('it covers the whole box', () => {
    const { tiles, width, height } = renderThumbnail({ latitude: 32.7157, longitude: -117.1611 });
    assert.ok(tiles.length > 0, 'drew no tiles at all');

    // Every pixel of the box has to be inside some tile, or the panel shows
    // bare background down one edge — the bug this arithmetic exists to avoid.
    for (const [px, py] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]]) {
      const covering = tiles.some(
        (t) => px >= t.left && px < t.left + TILE && py >= t.top && py < t.top + TILE,
      );
      assert.ok(covering, `nothing covers the corner at ${px},${py}`);
    }
  });

  test('the chosen spot lands dead centre, which is where the pin is drawn', () => {
    // The pin is positioned by CSS at 50%/50% and never moves, so the tiles
    // have to be offset to put the location under it. Every tile independently
    // implies where the centre of the box is; they must all agree, and agree
    // with the projection.
    const latitude = 36.8;
    const longitude = -121.8;
    const { tiles, width, height } = renderThumbnail({ latitude, longitude });
    const expected = project(latitude, longitude, tiles[0].z);

    for (const tile of tiles) {
      assert.ok(
        Math.abs(tile.x * TILE - tile.left + width / 2 - expected.x) <= 1,
        `tile ${tile.x} puts the centre in the wrong place horizontally`,
      );
      assert.ok(
        Math.abs(tile.y * TILE - tile.top + height / 2 - expected.y) <= 1,
        `tile ${tile.y} puts the centre in the wrong place vertically`,
      );
    }
  });

  test('a spot on the date line wraps east-west instead of asking for a tile off the grid', () => {
    const { tiles } = renderThumbnail({ latitude: -16.5, longitude: 179.98 });
    const perSide = 2 ** tiles[0].z;
    const columns = new Set(tiles.map((t) => t.x));

    for (const tile of tiles) {
      assert.ok(tile.x >= 0 && tile.x < perSide, `tile x ${tile.x} is off the grid`);
    }
    // The box straddles the seam, so it must pull from both ends of the world.
    assert.ok(columns.has(0) && columns.has(perSide - 1), `expected a wrap, got columns ${[...columns]}`);
  });

  test('a spot near the pole asks for no tiles above the top of the world', () => {
    // North-south doesn't wrap: there is no row above 0, and requesting one
    // gets a 404 rather than blank sea.
    const { tiles } = renderThumbnail({ latitude: 84.9, longitude: 0 });
    const perSide = 2 ** tiles[0].z;
    for (const tile of tiles) {
      assert.ok(tile.y >= 0 && tile.y < perSide, `tile y ${tile.y} is off the grid`);
    }
  });

  test('a box with no size yet draws nothing rather than dividing by it', () => {
    const { markup } = renderThumbnail({ latitude: 0, longitude: 0, width: 0, height: 0 });
    assert.equal(markup, '', 'drew tiles into a box with no size');
  });

  test('the tiles are credited', () => {
    // Required wherever they're shown, small print or not.
    const { markup } = renderThumbnail({ latitude: 32.7157, longitude: -117.1611 });
    assert.match(markup, /OpenStreetMap/);
  });
});

describe('how Leaflet is fetched', () => {
  test('one exact version, in both files', () => {
    // A floating version ("leaflet@1") would let the CDN change the script under
    // a live site with no deploy here — and would break these hashes when it did.
    assert.match(LEAFLET.version, /^\d+\.\d+\.\d+$/, 'not an exact version');
    for (const file of [LEAFLET.css, LEAFLET.js]) {
      assert.ok(file.url.includes(`leaflet@${LEAFLET.version}/`), `${file.url} is not the pinned version`);
      assert.match(file.url, /^https:\/\//);
      assert.match(file.integrity, /^sha256-[A-Za-z0-9+/=]+$/, `no integrity hash for ${file.url}`);
    }
  });

  test('both are requested with crossorigin, or the integrity check is skipped', () => {
    // Without it the browser can't read the response well enough to hash it and
    // silently doesn't try, which makes the hash decoration.
    const source = read('../src/views/location-map.js');
    assert.equal(source.match(/crossOrigin: 'anonymous'/g)?.length, 2,
      'both the stylesheet and the script must set crossOrigin');
  });

  test('nothing fetches Leaflet until the picker is opened', () => {
    // The whole reason it's loaded from JavaScript: a reader who only looks at
    // the calendar should fetch nothing from anyone but us.
    assert.doesNotMatch(html, /leaflet/i, 'the shell loads Leaflet up front');
  });

  test('a failed fetch rejects rather than hanging the picker open', async () => {
    // No `document` in Node, so the loader throws on the first DOM call. What's
    // being pinned is that the failure comes back as a rejected promise, which
    // is the path `openPicker` shows its fallback message from.
    await assert.rejects(() => loadLeaflet());
  });
});

describe('the picker in the shell', () => {
  test('it is a real dialog, so Escape and the backdrop are free', () => {
    assert.match(html, /<dialog class="picker" id="picker"/);
    assert.match(html, /<form method="dialog"/, 'the buttons need method="dialog" to close it');
  });

  test('confirming and cancelling are told apart by value, not by handler', () => {
    // Escape closes with an empty returnValue, which is why main.js checks for
    // "confirm" rather than checking for "cancel".
    assert.match(html, /<button value="cancel"/);
    assert.match(html, /<button value="confirm"/);
    assert.match(read('../src/main.js'), /returnValue !== 'confirm'/);
  });

  test('the title reads correctly on both sites before any script runs', () => {
    // main.js rewrites it per profile; the markup has to be true for both in
    // the meantime, so it must not name one activity.
    const title = html.match(/<h2 id="pickerTitle">([^<]*)</)?.[1];
    assert.ok(title, 'no picker title in the shell');
    assert.doesNotMatch(title, /fish|pool/i, `the static title names an activity: "${title}"`);
  });
});

describe('the coordinate inputs are gone', () => {
  test('the shell asks nobody to type a latitude', () => {
    // Nobody knows their fishing spot to four decimal places. The panel and the
    // picker replaced these; the numbers live in state and localStorage now.
    assert.doesNotMatch(html, /id="lat"|id="lon"/, 'a coordinate input is still in the shell');
    assert.doesNotMatch(html, />\s*Latitude\s*</i, 'a coordinate label is still in the shell');
  });

  test('the location still round-trips through storage, exactly like the station', () => {
    const main = read('../src/main.js');
    const saved = main.slice(main.indexOf('function rememberSettings'), main.indexOf('function rememberSettings') + 400);
    for (const field of ['latitude', 'longitude', 'stationId']) {
      assert.match(saved, new RegExp(`${field}:`), `${field} is not saved`);
    }
    // And comes back on the next visit. With no inputs left to read, storage is
    // the only thing standing between a reader and San Diego every morning.
    const restored = main.slice(main.indexOf('function restoreSavedSettings'), main.indexOf('function restoreSavedSettings') + 600);
    for (const field of ['latitude', 'longitude', 'stationId']) {
      assert.match(restored, new RegExp(`state\\.${field} = saved\\.`), `${field} is not restored`);
    }
  });
});
