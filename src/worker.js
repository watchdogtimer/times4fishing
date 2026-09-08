/**
 * The Cloudflare Worker: hostname routing, server-rendered pages, and caching.
 *
 * Three jobs, in order of how much they matter:
 *
 *  1. **Decide which site this is.** One deployment answers on both domains, so
 *     the hostname picks the profile and the shell's `<head>` is rewritten to
 *     match before it leaves the edge. Doing it here rather than in the browser
 *     is the whole reason the Worker exists: link previews and crawlers read
 *     the title and description without running a line of JavaScript.
 *
 *  2. **Render the content pages.** `/tides/san-diego-ca/` and its tidepooling
 *     twin are built here, numbers and all, so anything that fetches the URL
 *     gets the answer rather than an empty div.
 *
 *  3. **Cache them for the rest of the local day.** These pages have no
 *     per-reader content at all: no geolocation, no preferences, nothing but a
 *     place and a date. So one render is correct for every reader until that
 *     place's midnight, and that is exactly how long it's cached for.
 *
 * Everything else — the app shell's CSS and modules — is served straight from
 * static assets, untouched.
 */

import {
  activeProfile,
  canonicalOrigin,
  isProductionHostname,
  supportLinkHtml,
  swapIconProfile,
} from './config.js';
import { bestDay, forecastRange } from './core/schedule.js';
import { secondsUntilMidnightInZone } from './core/time.js';
import { locationBySlug } from './locations.js';
import { escapeHtml, renderIndexPage, renderLocationPage } from './render/html.js';

/* ---------------------------------------------------------------- *
 * Caching
 * ---------------------------------------------------------------- */

/**
 * Whether pages may be cached at all.
 *
 * Off by default, and deliberately so while the sites are new. Pushing is
 * releasing here, and a deploy that takes an hour to become visible costs more
 * in confusion than the caching saves at this traffic. Set `PAGE_CACHE` to
 * "on" in wrangler.jsonc once things settle down.
 *
 * Anything other than the exact string "on" means off, so a typo or a dropped
 * variable fails towards "correct but slower" rather than "fast but stale".
 *
 * This only governs what the Worker sets. Static assets (style.css, src/*.js)
 * skip the Worker entirely, and Cloudflare already serves those
 * `max-age=0, must-revalidate` with an ETag, so they revalidate on every
 * request and were never the stale ones.
 */
export function cachingEnabled(env) {
  return env?.PAGE_CACHE === 'on';
}

/**
 * The `cache-control` for something the Worker produced.
 *
 * `s-maxage` is what the edge honours; browsers get a shorter window so a
 * reader who leaves a tab open overnight isn't stuck on yesterday.
 *
 * @param {number} sMaxAgeSeconds Edge lifetime when caching is on.
 * @param {number} [browserCapSeconds] Upper bound on the browser's own copy.
 */
export function cacheControl(env, sMaxAgeSeconds, browserCapSeconds = 900) {
  if (!cachingEnabled(env)) return 'no-store';
  const maxAge = Math.min(sMaxAgeSeconds, browserCapSeconds);
  return `public, max-age=${maxAge}, s-maxage=${sMaxAgeSeconds}`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const profile = activeProfile(url);

    const indexable = isProductionHostname(url.hostname);
    if (url.pathname === '/robots.txt') return robotsTxt(env, profile, indexable);
    if (url.pathname === '/llms.txt') return llmsTxt(env, profile);
    if (url.pathname === '/sitemap.xml') return sitemapXml(env, profile);

    const moved = legacyRedirect(profile, url);
    if (moved) return moved;

    const contentPath = matchContentPath(profile, url.pathname);
    if (contentPath) {
      return serveContentPage({
        ctx,
        profile,
        url,
        // Falls back to a constant rather than something random: a per-request
        // value would make every request a cache miss, which is a far worse
        // failure than serving one deployment's pages under a stale label.
        env,
        version: env.VERSION?.id ?? 'dev',
        // A preview or dev host renders the same pages, but tells crawlers to
        // leave them alone so a throwaway URL can't compete with the real site.
        noindex: !isProductionHostname(url.hostname),
        ...contentPath,
      });
    }

    // The app shell: served from assets, with its head rewritten for this site.
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return rewriteShell(await env.ASSETS.fetch(request), profile, env);
    }

    return env.ASSETS.fetch(request);
  },
};

/* ---------------------------------------------------------------- *
 * Routing
 * ---------------------------------------------------------------- */

/**
 * Match `/tides/` and `/tides/<slug>/` for the active profile.
 *
 * Only this profile's own prefix matches, so `/spots/` on the fishing domain
 * falls through to assets and 404s rather than quietly serving the other site's
 * URL shape. Two domains sharing one deployment shouldn't mean two ways to
 * reach the same page.
 */
/**
 * Send a retired path to its replacement, permanently.
 *
 * The location pages were first published under a prefix that described the
 * data rather than the page — /tides on the fishing site, /spots on the other.
 * Renaming a URL orphans whatever already points at it, so the old shapes keep
 * answering with a 301 instead of a 404. This costs one string comparison and
 * removes the only real reason not to fix a bad path.
 *
 * @returns {Response|null}
 */
function legacyRedirect(profile, url) {
  const segments = url.pathname.replace(/^\/|\/$/g, '').split('/');
  if (!profile.legacyPathPrefixes?.includes(segments[0])) return null;

  segments[0] = profile.pathPrefix;
  const destination = `/${segments.join('/')}${segments.length > 1 ? '/' : '/'}`;
  return Response.redirect(new URL(destination + url.search, url.origin), 301);
}

function matchContentPath(profile, pathname) {
  const segments = pathname.replace(/^\/|\/$/g, '').split('/');
  if (segments[0] !== profile.pathPrefix) return null;
  if (segments.length === 1) return { kind: 'index' };
  if (segments.length === 2) {
    const location = locationBySlug(segments[1]);
    return location ? { kind: 'location', location } : null;
  }
  return null;
}

/* ---------------------------------------------------------------- *
 * Content pages
 * ---------------------------------------------------------------- */

async function serveContentPage({ ctx, profile, url, kind, location, env, version, noindex }) {
  const caching = cachingEnabled(env);
  const cache = caches.default;

  // The cache key deliberately drops the incoming query string. Nothing about
  // these pages varies by it, and leaving it in would let anyone mint unlimited
  // cache entries for the same content just by appending junk.
  //
  // It carries the profile, because two sites share these paths, and the
  // deployment version, because `caches.default` outlives a deploy. Without the
  // version a fix to any of this would sit invisible behind a cached copy until
  // that location's midnight — which is a poor property anywhere, and a bad one
  // in a repo where pushing is releasing.
  const cacheKey = new Request(
    `${url.origin}${url.pathname}?p=${profile.id}&v=${version}`,
    { method: 'GET' },
  );
  // Skipped wholesale when caching is off: `caches.default` outlives a deploy,
  // so consulting it at all would reintroduce the staleness the switch exists
  // to remove.
  if (caching) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  let response;

  if (kind === 'index') {
    response = htmlResponse(env, renderIndexPage({ profile, noindex }), 3600);
  } else {
    const { days, tideError } = await forecastRange({ profile, location });

    // Without tides there's no honest page to serve, so say so and let the
    // cache expire quickly rather than freezing a NOAA outage in place for a day.
    if (tideError && profile.requiresTideStation) {
      return htmlResponse(env, renderErrorPage(profile, location, tideError), 60, 503);
    }

    response = htmlResponse(
      env,
      renderLocationPage({ profile, location, days, best: bestDay(days), noindex }),
      secondsUntilMidnightInZone(location.timeZone),
    );
  }

  if (caching) ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

function htmlResponse(env, html, maxAgeSeconds, status = 200) {
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': cacheControl(env, maxAgeSeconds),
    },
  });
}

function renderErrorPage(profile, location, message) {
  return `<!DOCTYPE html><html lang="en" data-profile="${escapeHtml(profile.id)}"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tide data unavailable — ${escapeHtml(location.name)}</title>
<meta name="robots" content="noindex">
<link rel="stylesheet" href="/style.css"></head>
<body><div class="wrap"><header><div>
<h1>Tide data unavailable</h1>
<p>NOAA didn't return predictions for ${escapeHtml(location.name)} just now: ${escapeHtml(message)}.
Nothing on this page would be true without them, so here's nothing instead. Try again shortly, or
<a href="/">use the interactive calendar</a>.</p>
</div></header></div></body></html>`;
}

/* ---------------------------------------------------------------- *
 * The app shell
 * ---------------------------------------------------------------- */

/**
 * Rewrite the static shell's head for whichever site asked for it.
 *
 * `main.js` sets the same strings on load, so this is belt and braces for
 * anything with a browser. It's the only path that works for anything without
 * one, which is most of what decides whether the site gets found.
 */
function rewriteShell(assetResponse, profile, env) {
  const response = new HTMLRewriter()
    .on('title', { element: (element) => element.setInnerContent(profile.title) })
    .on('meta[name="description"]', {
      element: (element) => element.setAttribute('content', profile.tagline),
    })
    .on('html', { element: (element) => element.setAttribute('data-profile', profile.id) })
    // The shell ships the fishing icons hard-coded, since a static file can
    // only name one set. Every icon lives under /icons/<profile id>/, so
    // swapping that one path segment is the whole rewrite.
    .on('link[href^="/icons/"]', {
      element: (element) => {
        element.setAttribute('href', swapIconProfile(element.getAttribute('href') ?? '', profile));
      },
    })
    .on('#headline', { element: (element) => element.setInnerContent(profile.headline) })
    .on('#support', {
      element: (element) => {
        const link = supportLinkHtml();
        // The slot ships hidden so nothing flashes up before the script runs;
        // filling it has to lift that, or the link renders invisibly.
        if (!link) return;
        element.setInnerContent(link, { html: true });
        element.removeAttribute('hidden');
      },
    })
    .on('#tagline', { element: (element) => element.setInnerContent(profile.tagline) })
    .on('#aboutBody', {
      element: (element) => element.setInnerContent(profile.aboutHtml, { html: true }),
    })
    .on('#legendTiers', {
      element: (element) =>
        element.setInnerContent(
          profile.ratingTiers
            .map((tier) => `<span><i class="dot ${tier.className}"></i> ${escapeHtml(tier.name)}</span>`)
            .join(''),
          { html: true },
        ),
    })
    .on('#sleepingToggle', {
      element: (element) => {
        if (profile.id !== 'fishing') element.setAttribute('hidden', '');
      },
    })
    .transform(assetResponse);

  // The shell is identical for everyone on a given domain, so it caches hard —
  // once caching is switched on at all.
  const headers = new Headers(response.headers);
  headers.set('cache-control', cacheControl(env, 3600, 300));
  return new Response(response.body, { status: response.status, headers });
}

/* ---------------------------------------------------------------- *
 * Crawler files
 * ---------------------------------------------------------------- */

/**
 * Explicitly welcome the AI crawlers.
 *
 * Allowing everything is already the default, so this is a statement of intent
 * rather than a functional change: the retrieval bots (OAI-SearchBot,
 * PerplexityBot, ClaudeBot) are the ones that decide whether an assistant
 * answering "when's the best tidepooling in San Diego" cites this site, and
 * being cited is the point.
 */
function robotsTxt(env, profile, indexable) {
  // A preview deployment disallows everything: it serves the same pages as the
  // real site, and letting a throwaway hostname get crawled is how a preview
  // ends up outranking the thing it was previewing.
  const body = indexable
    ? `User-agent: *
Allow: /

Sitemap: ${canonicalOrigin(profile)}/sitemap.xml
`
    : `User-agent: *
Disallow: /
`;

  return new Response(
    body,
    { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': cacheControl(env, 86400) } },
  );
}

/**
 * https://llmstxt.org — a plain-language map of the site for language models.
 *
 * An emerging convention rather than a standard, and cheap enough that it's
 * worth having if it turns out to matter.
 */
function llmsTxt(env, profile) {
  const origin = canonicalOrigin(profile);
  const places = profile.locations
    .map(
      (location) =>
        `- [${location.name}, ${location.region}](${origin}/${profile.pathPrefix}/${location.slug}/)`,
    )
    .join('\n');

  return new Response(
    `# ${profile.siteName}

> ${profile.tagline}

${profile.llmsSummary}

Tide predictions come from NOAA CO-OPS and are real published predictions, not
estimates. Sun and moon positions are computed from Paul Schlyter's low-precision
formulas and agree with NOAA's solar calculator to within about two minutes.

## Locations

${places}
`,
    { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': cacheControl(env, 86400) } },
  );
}

function sitemapXml(env, profile) {
  const origin = canonicalOrigin(profile);
  const urls = [
    `${origin}/`,
    `${origin}/${profile.pathPrefix}/`,
    ...profile.locations.map((location) => `${origin}/${profile.pathPrefix}/${location.slug}/`),
  ];

  const body = urls
    .map((location) => `  <url><loc>${escapeHtml(location)}</loc><changefreq>daily</changefreq></url>`)
    .join('\n');

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>`,
    { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': cacheControl(env, 86400) } },
  );
}
