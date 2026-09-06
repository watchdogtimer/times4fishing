/**
 * Which site are we?
 *
 * One repo, one deployment, two domains. The profile decides the copy, the
 * colours, what a "good day" means and whether a tide station is optional, and
 * everything else in `src/` is shared. Adding a third site should mean adding
 * one file under `src/profiles/` and one entry here.
 *
 * Selection is by hostname so it works identically in the browser and in the
 * Worker that server-renders the pages, with no build step and no env plumbing.
 */

import fishing from './profiles/fishing.js';
import tidepooling from './profiles/tidepooling.js';

/**
 * @typedef {object} Profile
 * @property {string} id           Stable slug, also used as a CSS hook.
 * @property {string[]} hostnames  Domains this profile answers on.
 * @property {string} siteName     Short name, e.g. "Tide & Moon".
 * @property {string} title        Full <title>.
 * @property {string} tagline      One-line description, used in the header and meta.
 * @property {string} activity     Gerund used in generated prose, e.g. "fishing".
 * @property {string} windowNoun   e.g. "fishing window".
 * @property {boolean} requiresTideStation Whether the site is useless without tides.
 * @property {{min: number, name: string, className: string}[]} ratingTiers
 *   Highest `min` first; the first match wins.
 * @property {(facts: object, settings: object) => {windows: object[], score: number, rating: number}} rateDay
 */

export const PROFILES = { fishing, tidepooling };

/** The profile served on `hostname`, falling back to fishing. */
export function profileForHostname(hostname = '') {
  const host = hostname.toLowerCase().replace(/:\d+$/, '');

  const exact = Object.values(PROFILES).find((profile) => profile.hostnames.includes(host));
  if (exact) return exact;

  // Local dev and preview deployments: ?profile=tidepooling, or a hostname that
  // merely contains the id, so *.times4tidepooling.workers.dev works too.
  const byName = Object.values(PROFILES).find((profile) => host.includes(profile.id));
  return byName ?? fishing;
}

/** Every hostname a real site answers on. */
const PRODUCTION_HOSTNAMES = new Set(
  Object.values(PROFILES).flatMap((profile) => profile.hostnames),
);

/**
 * The profile for a request, honouring a `?profile=` override off production.
 *
 * The override exists so both sites can be checked from one `wrangler dev`
 * without editing hosts files. It is refused on the live domains, which matters
 * more than it looks: `times4fishing.com/?profile=tidepooling` would otherwise
 * serve the other site's content under this site's URL, and duplicate content
 * under a second URL is exactly what search engines penalise.
 *
 * @param {{hostname: string, search?: string}} location A URL or `window.location`.
 */
export function activeProfile(location = globalThis.location) {
  const hostname = location?.hostname ?? '';
  if (!PRODUCTION_HOSTNAMES.has(hostname.toLowerCase())) {
    const requested = new URLSearchParams(location?.search ?? '').get('profile');
    if (PROFILES[requested]) return PROFILES[requested];
  }
  return profileForHostname(hostname);
}
