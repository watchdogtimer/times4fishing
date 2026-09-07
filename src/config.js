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
 * @property {string} siteName     Brand name, e.g. "Tide & Moon". Used where a
 *   publisher is meant — JSON-LD, llms.txt — not as the page's headline.
 * @property {string} headline     The <h1>, e.g. "Best times for ocean fishing".
 *   Says what the site is for; `siteName` says who it is.
 * @property {string} title        Full <title>.
 * @property {string} pathPrefix   First URL segment for location pages. Both
 *   sites use the same one: the hostname already decides which site you are on,
 *   so the path never had to carry that too.
 * @property {string[]} [legacyPathPrefixes] Prefixes this site used to answer
 *   on. Kept so old URLs redirect rather than 404 — cheap now, and the only
 *   thing that makes renaming a published path safe.
 * @property {string} factsHeading Heading over the sun/moon column.
 * @property {(forecast: object) => [string, number|null][]} dayFacts
 *   The labelled times worth listing for this activity.
 * @property {(phase: object) => string} moonCaption
 *   How to name a moon phase for this audience.
 * @property {string} tagline      One-line description, used in the header and meta.
 * @property {string} activity     Gerund used in generated prose, e.g. "fishing".
 * @property {string} windowNoun   e.g. "fishing window".
 * @property {boolean} requiresTideStation Whether the site is useless without tides.
 * @property {{min: number, name: string, className: string}[]} ratingTiers
 *   Highest `min` first; the first match wins.
 * @property {(facts: object, settings: object) => {windows: object[], score: number, rating: number}} rateDay
 */

export const PROFILES = { fishing, tidepooling };

/**
 * Where to send someone who wants to chip in. Empty means no link is shown.
 *
 * One account covers both sites: the reader is thanking whoever built the
 * thing, not the domain they happened to land on. Put the full URL here —
 * "https://ko-fi.com/yourname" or "https://buymeacoffee.com/yourname" — and it
 * appears in the footer of every page.
 *
 * The canonical username URL rather than the page id Ko-fi's embed snippet
 * uses, since the id just redirects here and a redirect on every click is a
 * hop for nothing.
 *
 * Ko-fi's own recommendation is a script tag from storage.ko-fi.com that draws
 * a button. Not used. The page does now carry one third-party script — Leaflet,
 * for the map — so the argument isn't "never any", it's that this one buys
 * nothing: a link does the same job with no dependency, no latency, nothing
 * watching who clicks it, and in the site's own colours. A donation widget that
 * phones home on every page view is a different trade from a map.
 */
export const SUPPORT_URL = 'https://ko-fi.com/tomhartwell';

/** The label on that link. Kept beside the URL so the tone stays together. */
export const SUPPORT_LABEL = 'Buy me a coffee';

/**
 * The footer support link, or an empty string when none is configured.
 *
 * `noopener` because it opens a payment page, and `nofollow` because a donation
 * link is not an editorial endorsement and shouldn't pass ranking.
 */
export function supportLinkHtml() {
  if (!SUPPORT_URL) return '';
  const url = SUPPORT_URL.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `<a class="support-link" href="${url}" rel="noopener nofollow" target="_blank">${SUPPORT_LABEL}</a>`;
}

/** Every hostname a real site answers on. */
const PRODUCTION_HOSTNAMES = new Set(
  Object.values(PROFILES).flatMap((profile) => profile.hostnames),
);

/**
 * The origin a profile's pages always point at, whatever host served them.
 *
 * Canonical URLs must not be built from the request, because the Worker answers
 * on more than its production hostname: `wrangler versions upload` gives every
 * preview its own `*.workers.dev` URL, and a preview that emits canonicals
 * pointing at itself is asking to be indexed in place of the real site. The
 * first entry in `hostnames` is the site's true home; everything else is an
 * alias that should defer to it.
 */
export function canonicalOrigin(profile) {
  return `https://${profile.hostnames[0]}`;
}

/**
 * Whether a hostname is one of the real sites.
 *
 * Anything else — a preview deployment, a local dev server — gets `noindex`, so
 * a throwaway URL can't end up competing with the site it was testing.
 */
export function isProductionHostname(hostname = '') {
  return PRODUCTION_HOSTNAMES.has(hostname.toLowerCase().replace(/:\d+$/, ''));
}

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
  if (!isProductionHostname(hostname)) {
    const requested = new URLSearchParams(location?.search ?? '').get('profile');
    if (PROFILES[requested]) return PROFILES[requested];
  }
  return profileForHostname(hostname);
}
