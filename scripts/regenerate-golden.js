/**
 * Rewrite the golden forecast file from the current models.
 *
 * Run this only when a change to the scoring is deliberate, then read the diff
 * before committing it. That diff is the change's actual effect on what the
 * calendar recommends, which is otherwise very difficult to see: ratings shift
 * silently, and "it still looks fine" is not a check.
 *
 *   npm run golden && git diff test/fixtures/golden-forecasts.json
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import fishing from '../src/profiles/fishing.js';
import tidepooling, { stationTideStats } from '../src/profiles/tidepooling.js';
import { forecastFixtureDays, loadTideEvents } from '../test/helpers.js';

const tideStats = stationTideStats(loadTideEvents());

const CASES = [
  ['fishing', fishing, {}],
  ['fishingAllHours', fishing, { includeSleepingHours: true }],
  ['tidepooling', tidepooling, { tideStats }],
];

const golden = {};
for (const [name, profile, settings] of CASES) {
  golden[name] = forecastFixtureDays({ profile, settings }).map((day) => {
    const best = day.windows.find((window) => window.rank === 1);
    return {
      date: day.date.toISOString().slice(0, 10),
      rating: day.rating,
      score: Number(day.score.toFixed(6)),
      windows: day.windows.length,
      best: best ? { label: best.label, start: Number(best.start.toFixed(6)) } : null,
    };
  });
}
golden._tideStats = {
  thresholdFeet: Number(tideStats.thresholdFeet.toFixed(6)),
  referenceDepthFeet: Number(tideStats.referenceDepthFeet.toFixed(6)),
};

const target = fileURLToPath(new URL('../test/fixtures/golden-forecasts.json', import.meta.url));
writeFileSync(target, `${JSON.stringify(golden, null, 1)}\n`);

for (const [name] of CASES) {
  const spread = golden[name].reduce((counts, day) => {
    counts[day.rating] = (counts[day.rating] ?? 0) + 1;
    return counts;
  }, {});
  console.log(`${name.padEnd(16)} rating spread:`, spread);
}
console.log(`\nWrote ${target}`);
