# Tide & Moon

A four-week fishing calendar that ranks days by when the sun, moon and tide line
up. No build step, no dependencies, no accounts — plain ES modules served as
static files (Cloudflare Workers assets, see `wrangler.jsonc`).

## Running it

Any static file server will do, since there's nothing to compile:

```bash
python3 -m http.server 8788
```

Then open <http://localhost:8788>. Tide data needs network access to NOAA.

## Layout

```
index.html          Markup and the control bar
style.css           All styling, including the chart
src/
  main.js           Entry point: UI state, event wiring, render orchestration
  astronomy.js      Sun and moon positions, phase, rise/set/transit solver
  solunar.js        Fishing windows and the 0-5 day rating
  tides.js          NOAA CO-OPS client and tide-curve interpolation
  time.js           Clock-time and calendar-date helpers
  views/
    calendar-grid.js  The four-week grid
    day-detail.js     The panel shown when a day is clicked
    tide-chart.js     The SVG tide chart
```

Dependencies point one way: `views/` uses the model modules, `main.js` uses
everything, and nothing in `astronomy.js`, `solunar.js`, `tides.js` or `time.js`
touches the DOM. That last part is what makes the maths testable in plain Node.

## How it fits together

`main.js` holds a small `state` object (location, NOAA station, which four-week
page is showing). Any change to it calls `refresh()`, which re-fetches tides if
needed and re-renders the whole grid. At 28 cells that's cheap, and it means
there's no incremental-update logic to get wrong.

`computeDayForecast()` in `solunar.js` is the centre of it: give it a date, a
latitude/longitude and that day's tide extremes, and it returns everything the
views need for one day — sun and moon times, the scored fishing windows, and the
rating.

## Conventions

- **Angles are degrees**, not radians, throughout `astronomy.js`. The `sinDeg` /
  `cosDeg` helpers convert, so the formulas read like the published ones.
- **Times of day are "local hours"**: a float in `[0, 24)` where `6.5` means
  6:30 AM local. `null` means the event doesn't happen that day, which is a real
  case — the moon skips a rise about once a month, and the sun skips one for
  months at a time inside the polar circles.
- **Astronomical time is `epochDays`**: days since 1999-12-31 00:00 UT, the
  epoch the orbital elements are defined against.

## Accuracy

The astronomy uses [Paul Schlyter's low-precision
formulas](https://stjarnhimlen.se/comp/ppcomp.html). Sunrise and sunset agree
with NOAA's solar calculator to within about two minutes worldwide, which is far
better than the rating model needs.

The tide *times and heights* are NOAA's own predictions. The *curve between*
them is interpolated (see `sampleTideCurve`) and is an approximation.

The rating weights in `SCORING` are a judgement call, not a fitted model.
Solunar theory has a plausible physical basis but its sharp "best window" claims
are folk science — the file says so, and so does the app.
