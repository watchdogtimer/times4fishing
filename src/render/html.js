/**
 * Server-rendered pages.
 *
 * These exist because the interactive calendar is invisible to the things that
 * matter most for being found. Google renders JavaScript, eventually and on a
 * second pass; the AI crawlers that increasingly decide what gets cited mostly
 * do not run it at all, and would otherwise see an empty div. So every number
 * on these pages is in the HTML before any script runs.
 *
 * Three things follow from that, and they're why these pages look different
 * from the app:
 *
 *  - **The answer is a sentence, not a chart.** An extractive summariser quotes
 *    prose; it can't quote an SVG. The lead paragraph states the best day, the
 *    time and the height in a form that can be lifted verbatim.
 *  - **The data is a `<table>`.** Tables survive extraction. The interactive
 *    chart is for people and is left to the app.
 *  - **Nothing here varies by reader.** No geolocation, no preferences, no
 *    clock beyond the local date. One render is correct for everyone until that
 *    place's midnight, which is exactly what makes it cacheable.
 */

import { canonicalOrigin, iconLinksHtml, supportLinkHtml } from '../config.js';
import { escapeHtml } from '../core/html.js';
import { bestWindow } from '../core/day.js';
import { formatClockTime, toDateKey } from '../core/time.js';

/** Escape text for HTML. Everything interpolated below goes through this. */
export { escapeHtml };

/** "Saturday, 10 October 2026", in the location's own calendar. */
function longDate(date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function shortDate(date) {
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** `<time>` needs a machine-readable date, and crawlers do read it. */
function timeTag(date, hour, text) {
  const stamp = hour === null || hour === undefined ? toDateKey(date) : `${toDateKey(date)}T${clock24(hour)}`;
  return `<time datetime="${stamp}">${escapeHtml(text)}</time>`;
}

function clock24(hour) {
  const whole = Math.floor(hour);
  const minutes = Math.round((hour - whole) * 60);
  return `${String(whole % 24).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * The page skeleton.
 *
 * Shares `style.css` with the app, so the two never drift apart visually, and
 * carries no script at all: these pages are documents, not applications.
 */
export function layout({ profile, title, description, canonical, jsonLd, body, noindex }) {
  return `<!DOCTYPE html>
<html lang="en" data-profile="${escapeHtml(profile.id)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
${noindex ? '<meta name="robots" content="noindex,nofollow">' : ''}
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta name="twitter:card" content="summary">
${iconLinksHtml(profile)}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Work+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/style.css">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
<div class="wrap">
${body}
<footer class="page-footer">
  <p>Tide predictions from <a href="https://tidesandcurrents.noaa.gov/">NOAA CO-OPS</a>.
  Sun and moon positions computed from
  <a href="https://stjarnhimlen.se/comp/ppcomp.html">Paul Schlyter's formulas</a>.
  <a href="/">Open the interactive calendar</a> to change location or look at a
  single day in detail.</p>
  ${supportLinkHtml() ? `<p class="support">${supportLinkHtml()}</p>` : ''}
</footer>
</div>
</body>
</html>`;
}

/* ---------------------------------------------------------------- *
 * Location page
 * ---------------------------------------------------------------- */

/**
 * Four weeks for one place: the answer sentence, then the table behind it.
 *
 * @param {object} options
 * @param {import('../config.js').Profile} options.profile
 * @param {import('../locations.js').Location} options.location
 * @param {object[]} options.days
 * @param {object|null} options.best
 * @param {boolean} [options.noindex] Set on anything that isn't the real site.
 */
/**
 * The hand-written notes for this place, on the site they were written for.
 *
 * Keyed by profile because one page serves two sites: "the reef flats are
 * heavily trampled, watch your feet" is guidance for a tidepooler and noise for
 * an angler, and a note about tidepooling season on a fishing page is worse
 * than nothing. A site with nothing to say about a place says nothing.
 */
function renderLocalNotes(profile, location) {
  return [location.notes?.[profile.id], location.seasons?.[profile.id]]
    .filter(Boolean)
    .map((text) => `<p class="blurb">${escapeHtml(text)}</p>`)
    .join('');
}

export function renderLocationPage({ profile, location, days, best, noindex }) {
  const place = `${location.name}, ${location.region}`;
  const canonical = `${canonicalOrigin(profile)}/${profile.pathPrefix}/${location.slug}/`;
  const title = `${profile.pageTitleVerb} in ${place} — next four weeks`;
  const lead = profile.leadSentence(best, location);
  const range = `${shortDate(days[0].date)} to ${shortDate(days[days.length - 1].date)}`;

  const body = `
  <header>
    <div>
      <h1>${escapeHtml(profile.pageTitleVerb)} in ${escapeHtml(place)}</h1>
      <p>${escapeHtml(lead)}</p>
    </div>
  </header>

  ${renderLocalNotes(profile, location)}

  <h2>Day by day, ${escapeHtml(range)}</h2>
  ${renderDayTable(profile, days, location)}

  <h2>How these ratings are worked out</h2>
  <div class="about-body">${profile.aboutHtml}</div>

  <h2>Other places</h2>
  <p class="other-places">${renderPlaceLinks(profile, location)}</p>`;

  return layout({
    profile,
    title,
    description: lead,
    canonical,
    jsonLd: locationJsonLd({ profile, location, days, canonical, lead }),
    body,
    noindex,
  });
}

/**
 * The four weeks as a real table.
 *
 * A crawler that reads nothing else off this page can still read every row of
 * this, which is the entire reason the server-rendered pages exist.
 */
function renderDayTable(profile, days, location) {
  const rows = days
    .map((day) => {
      const window = bestWindow(day);
      const tier = profile.ratingTiers.find((candidate) => day.rating >= candidate.min);
      const time = window ? formatClockTime(profile.cellTime?.(window) ?? window.start) : '—';
      return `      <tr>
        <th scope="row">${timeTag(day.date, null, shortDate(day.date))}</th>
        <td>${day.rating} / 5</td>
        <td>${escapeHtml(tier.name)}</td>
        <td>${window ? timeTag(day.date, profile.cellTime?.(window) ?? window.start, time) : '—'}</td>
        <td>${escapeHtml(profile.tableDetail(day, window))}</td>
      </tr>`;
    })
    .join('\n');

  return `<div class="table-scroll">
  <table class="day-table">
    <caption>Daily ratings for ${escapeHtml(location.name)}, from NOAA station ${escapeHtml(location.stationId)}.</caption>
    <thead>
      <tr><th scope="col">Date</th><th scope="col">Rating</th><th scope="col">Verdict</th><th scope="col">${escapeHtml(profile.tableTimeHeading)}</th><th scope="col">${escapeHtml(profile.tableDetailHeading)}</th></tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>
</div>`;
}

function renderPlaceLinks(profile, current) {
  return profile.locations
    .filter((location) => location.slug !== current.slug)
    .map(
      (location) =>
        `<a href="/${profile.pathPrefix}/${location.slug}/">${escapeHtml(location.name)}, ${escapeHtml(location.region)}</a>`,
    )
    .join(' · ');
}

/**
 * Structured data.
 *
 * `Dataset` rather than anything fancier, because that's honestly what this is:
 * a table of computed values with a stated source and method. The FAQ entry
 * carries the answer sentence in the shape an assistant is most likely to lift.
 */
function locationJsonLd({ profile, location, days, canonical, lead }) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Dataset',
        name: `${profile.pageTitleVerb} in ${location.name}, ${location.region}`,
        description: lead,
        url: canonical,
        temporalCoverage: `${toDateKey(days[0].date)}/${toDateKey(days[days.length - 1].date)}`,
        spatialCoverage: {
          '@type': 'Place',
          name: `${location.name}, ${location.region}`,
          geo: {
            '@type': 'GeoCoordinates',
            latitude: location.latitude,
            longitude: location.longitude,
          },
        },
        isBasedOn: `https://tidesandcurrents.noaa.gov/stationhome.html?id=${location.stationId}`,
        creator: { '@type': 'Organization', name: profile.siteName },
        license: 'https://creativecommons.org/licenses/by/4.0/',
      },
      {
        '@type': 'FAQPage',
        mainEntity: [
          {
            '@type': 'Question',
            name: `When is the best ${profile.activity} in ${location.name}, ${location.region}?`,
            acceptedAnswer: { '@type': 'Answer', text: lead },
          },
        ],
      },
    ],
  };
}

/* ---------------------------------------------------------------- *
 * Index page
 * ---------------------------------------------------------------- */

/** The list of places, linked. Small, but it's what makes the rest crawlable. */
export function renderIndexPage({ profile, noindex }) {
  const canonical = `${canonicalOrigin(profile)}/${profile.pathPrefix}/`;
  const items = profile.locations
    .map(
      (location) =>
        `    <li><a href="/${profile.pathPrefix}/${location.slug}/">${escapeHtml(location.name)}, ${escapeHtml(location.region)}</a></li>`,
    )
    .join('\n');

  return layout({
    profile,
    title: `${profile.pageTitleVerb} by location`,
    description: `Four-week ${profile.activity} calendars for ${profile.locations.length} places on the US coast, computed from NOAA tide predictions.`,
    canonical,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: `${profile.pageTitleVerb} by location`,
      url: canonical,
    },
    noindex,
    body: `
  <header>
    <div>
      <h1>${escapeHtml(profile.pageTitleVerb)} by location</h1>
      <p>${escapeHtml(profile.tagline)}</p>
    </div>
  </header>
  <ul class="place-list">
${items}
  </ul>`,
  });
}
