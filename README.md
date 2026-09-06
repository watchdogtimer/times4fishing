# Tide & Moon / Low Water

Two four-week calendars from one codebase:

- **times4fishing.com** ranks days by when the sun, moon and tide line up to put
  fish on the feed.
- **times4tidepooling.com** ranks days by when the tide drops far enough, for
  long enough, in daylight.

No build step, no dependencies, no accounts — plain ES modules served as static
files (Cloudflare Workers assets, see `wrangler.jsonc`). Which site you get is
decided by hostname at runtime, so both run from a single deployment.

## Running it

There's still nothing to compile, but there are now two ways to run it depending
on what you're working on.

**The app on its own.** Any static file server will do:

```bash
python3 -m http.server 8788
```

**The Worker as well**, which is what you want for the server-rendered pages,
the hostname routing and the caching:

```bash
npx wrangler dev --persist-to ../.times4-wrangler-state
```

Tide data needs network access to NOAA either way.

> The `--persist-to` matters. `assets.directory` is the repo root, so wrangler
> watches it — including the `.wrangler/` state directory it writes into. Left
> alone, every write triggers a reload that causes another write, and the dev
> server spins forever without answering a request. Pointing the state outside
> the repo breaks the loop.

Both sites run from one tree, so locally you pick between them with a query
parameter rather than a hosts file:

```
http://localhost:8788/?profile=tidepooling
http://localhost:8790/spots/san-diego-ca/?profile=tidepooling
```

The override is refused on the production hostnames, which matters more than it
looks: `times4fishing.com/?profile=tidepooling` would otherwise serve one site's
content under the other's URL, and that's the duplicate-content pattern search
engines penalise.

## Layout

```
index.html          Profile-agnostic shell: the controls and the empty containers
style.css           All styling, including the chart and both palettes
src/
  main.js           Entry point: UI state, event wiring, render orchestration
  config.js         Which profile answers on which hostname
  core/             Knows nothing about fishing or tidepooling
    astronomy.js      Sun and moon positions, phase, rise/set/transit solver
    day.js            One day's physical facts, plus generic window ranking
    tides.js          NOAA CO-OPS client and tide-curve interpolation
    time.js           Clock-time, calendar-date and timezone helpers
  profiles/         The only place a "good day" is defined
    fishing.js        Solunar windows, scored against sun and tide
    tidepooling.js    Low-water windows, scored on depth, duration and daylight
  views/            Driven entirely by the profile's vocabulary
    calendar-grid.js  The four-week grid
    day-detail.js     The panel shown when a day is clicked
    tide-chart.js     The SVG tide chart
```

Dependencies point one way: `core/` depends on nothing else, `profiles/` uses
`core/`, `views/` uses both, and `main.js` uses everything. Nothing outside
`views/` touches the DOM, which is what makes the maths testable in plain Node
and lets the same modules server-render pages in a Worker.

## Two ways in

The site has two front doors and they're built for different readers.

`/` is the **interactive calendar**: geolocation, an arbitrary lat/lon, any NOAA
station, four weeks at a time. It's a client-side app and always has been.

`/tides/san-diego-ca/` (and `/spots/…` on the tidepooling site) is a
**server-rendered page** for one curated location. Every number is in the HTML
before a line of script runs.

That second door exists because the app is invisible to most of what decides
whether a site gets found. Google renders JavaScript eventually and on a second
pass; the AI crawlers that increasingly choose what to cite mostly don't run it
at all and would otherwise see an empty div. So those pages lead with a plain
sentence stating the answer, put the data in a real `<table>`, and carry
`Dataset` and `FAQPage` JSON-LD. `/robots.txt`, `/sitemap.xml` and `/llms.txt`
are generated per hostname.

The pages contain **nothing that varies by reader** — no geolocation, no
preferences, no clock beyond the local date. That's a deliberate constraint
rather than a missing feature: it means one render is correct for everyone until
that place's midnight, which is exactly how long it's cached for
(`s-maxage` = seconds to local midnight). A cold render costs about half a
second, mostly waiting on NOAA; a cached one is single-digit milliseconds.

## The two profiles

A profile owns the wording, the palette hook, the rating tiers, and one
function: `rateDay(facts, settings)`, which turns a day's physical facts into
scored windows and a 0-5 rating. `core/day.js` computes the facts and does the
ranking; it has no opinion about what makes a day good.

The split matters because the two models genuinely disagree rather than being
reskins of each other:

|                  | fishing                        | tidepooling                          |
| ---------------- | ------------------------------ | ------------------------------------ |
| Windows built by | moon transits, rise and set    | the tide curve dropping below a threshold |
| Tide's role      | a bonus when it lines up       | the entire signal                    |
| Time of day      | soft discount, toggleable      | close to a gate                      |
| Moon phase       | scored                         | deliberately **not** scored          |
| Without a station| still useful                   | useless, and says so                 |

Moon phase is the one worth spelling out. Fishing scores it because the moon is
a proxy for water movement. Tidepooling doesn't, because NOAA's predicted
heights already contain the spring/neap and perigean effects, so a phase bonus
would count the same thing twice.

Adding a third site should mean one file in `src/profiles/` and one line in
`src/config.js`.

## How it fits together

`main.js` holds a small `state` object (location, NOAA station, which four-week
page is showing). Any change to it calls `refresh()`, which re-fetches tides if
needed and re-renders the whole grid. At 28 cells that's cheap, and it means
there's no incremental-update logic to get wrong.

`computeDayForecast()` in `core/day.js` is the centre of it: give it a date, a
latitude/longitude, that day's tide extremes and a profile, and it returns
everything the views need for one day — sun and moon times, the scored windows,
and the rating.

## The weather overlay

The next week or so of each calendar carries air temperature, wind and (where
the station has a thermometer) water temperature, from the National Weather
Service. NWS rather than the friendlier alternatives specifically because it's
US public domain with no non-commercial restriction, which matters for a site
that may carry an ad, and its coverage is the same US footprint as the NOAA tide
stations everything else already depends on.

**It never feeds the rating.** The calendar runs four weeks and the forecast
reaches about seven days, so scoring it would judge the first week on different
evidence from the rest — the same day would change rating as it drifted into the
horizon, which is worse than useless for planning. Cells beyond the horizon
simply have no strip, so the edge of what's known is visible without explaining
it.

It's also **only on the interactive calendar, not the server-rendered pages.**
Those are cached until the location's midnight precisely because nothing on them
goes stale sooner, and a forecast that updates hourly would break that. Tide
times and astronomy are the durable, uniquely-computed content worth being cited
for anyway.

Surf and swell are still missing, and they matter more for tidepooling than
anything else here. `waveHeight` does exist in the NWS gridpoint response but
comes back degenerate at coastal land points — a single zero spanning the whole
week — and a surf number that's silently wrong is worse than none on a page
someone might make a safety call from. NDBC buoys are the likely answer.

## Deployment

One Worker, two custom domains. `src/worker.js` picks the profile from the
request hostname, rewrites the app shell's `<head>` with `HTMLRewriter` on the
way out, and renders the location pages itself. Everything else — `style.css`,
the client modules — is served straight from static assets and never touches the
Worker.

`assets.run_worker_first` lists the paths the Worker must see before the
static-asset handler does. Without it, `/` would be served straight off disk
with whichever site's `<head>` happens to be in `index.html`, which defeats the
point.

## Conventions

- **Angles are degrees**, not radians, throughout `astronomy.js`. The `sinDeg` /
  `cosDeg` helpers convert, so the formulas read like the published ones.
- **Times of day are "local hours"**: a float in `[0, 24)` where `6.5` means
  6:30 AM local. `null` means the event doesn't happen that day, which is a real
  case — the moon skips a rise about once a month, and the sun skips one for
  months at a time inside the polar circles.
- **Astronomical time is `epochDays`**: days since 1999-12-31 00:00 UT, the
  epoch the orbital elements are defined against.
- **Timezone is the caller's problem.** `computeDayFacts` defaults to the
  running environment's UTC offset, which is right in a browser and wrong in a
  Worker (which runs in UTC). Server-side callers pass the location's offset
  from `utcOffsetHoursInZone`.

## Accuracy

The astronomy uses [Paul Schlyter's low-precision
formulas](https://stjarnhimlen.se/comp/ppcomp.html). Sunrise and sunset agree
with NOAA's solar calculator to within about two minutes worldwide, which is far
better than the rating model needs.

The tide *times and heights* are NOAA's own predictions. The *curve between*
them is interpolated (see `sampleTideCurve`) and is an approximation.

## The fishing rating

`SCORING` holds every weight, and `RATING_SCALE` holds the two reference days
the 0-5 rating is stretched between. Both are judgement calls, not a fitted
model, but the scale is calibrated so real days actually spread across it: about
3% one star, 20% two, 41% three, 27% four and 9% five, measured over 1825
day/location forecasts.

Windows outside `SCORING.fishableHours` (6 AM to 10 PM) are discounted to
`offHoursWeight`, because a major period at 1 AM is real astronomy that almost
nobody acts on. The "include sleeping hours" toggle turns that off, which is why
there are two entries in `RATING_SCALE`: the two modes have genuinely different
ceilings, and sharing one scale would push every unrestricted day to five stars.

Windows carry a `rank` (1 is the day's best) alongside both an `intrinsicScore`
and the time-discounted `score` the ranking actually uses. The two disagree
about which window is strongest on 40% of days, which is why there is exactly
one ranking in the UI — the practical one — and `strongestOffHoursWindow()`
exists to call out the other case in words instead of contradicting it.

Solunar theory has a plausible physical basis but its sharp "best window" claims
are folk science — the code says so, and so does the app.

## The tidepooling rating

Same structure, different shape. `SCORING` in `profiles/tidepooling.js` holds
the weights and `RATING_SCALE` the two reference days.

The threshold for "the water is low" is a **percentile of the station's own
predicted lows**, not a height in feet. It has to be: -1.0 ft MLLW is a
red-letter day in San Diego and an ordinary Tuesday in Anchorage, where the
range is six times larger. Deriving it from the predictions already loaded means
it costs no extra request.

Measured over 2190 day/station forecasts (six stations across 2026): 18% zero,
21% one, 15% two, 22% three, 17% four, 7% five. That floor is real and not a
modelling failure — a day whose only lows come at night offers nothing, and on
the Pacific coast the extreme lows swap between daytime in winter and the middle
of the night in summer, so half the year genuinely is better than the other
half. It also varies a lot by coast (Seattle scores 1% zeroes, Miami 35%), which
is a fair description of the tidepooling on offer rather than noise.

Surf and swell matter enormously for both safety and visibility and aren't
modelled yet. The app says so.
