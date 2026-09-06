/**
 * The drawn moon.
 *
 * The classic bug here is a mirrored phase: a waxing crescent lit on the wrong
 * limb looks perfectly plausible and is wrong every time. So rather than
 * checking the path string, these tests read the geometry back out of it and
 * check the area actually enclosed, which is the thing a reader perceives.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { moonPhase, toEpochDays } from '../src/core/astronomy.js';
import { renderMoonPhase } from '../src/views/moon-phase.js';

const RADIUS = 46;

/** Pull the two arcs back out of the rendered path. */
function readGeometry(svg) {
  const path = svg.match(/class="moon-lit" d="([^"]+)"/)[1];
  const arcs = [...path.matchAll(/A ([\d.]+),([\d.]+) 0 0 ([01])/g)];
  assert.equal(arcs.length, 2, `expected two arcs in ${path}`);
  return {
    limbSweep: Number(arcs[0][3]),
    terminatorHalfWidth: Number(arcs[1][1]),
    terminatorSweep: Number(arcs[1][3]),
  };
}

/**
 * The fraction of the disc the path encloses.
 *
 * The shape is a semicircle plus or minus a half-ellipse, so its area is
 * (pi*r/2)(r +/- rx) against a disc of pi*r^2. The terminator bows towards the
 * lit limb while the moon is a crescent, which removes area, and away from it
 * once gibbous, which adds.
 */
function litFraction({ limbSweep, terminatorHalfWidth, terminatorSweep }, waxing) {
  const bowsTowardsLitLimb = terminatorSweep === (waxing ? 0 : 1);
  const signed = bowsTowardsLitLimb ? -terminatorHalfWidth : terminatorHalfWidth;
  assert.equal(limbSweep, waxing ? 1 : 0, 'lit limb is on the wrong side');
  return (RADIUS + signed) / (2 * RADIUS);
}

describe('drawn moon phase', () => {
  test('the area drawn matches the illumination, at every phase', () => {
    for (let percent = 0; percent <= 100; percent += 5) {
      for (const waxing of [true, false]) {
        const phase = { illuminatedFraction: percent / 100, waxing };
        const drawn = litFraction(readGeometry(renderMoonPhase(phase)), waxing);
        assert.ok(
          Math.abs(drawn - phase.illuminatedFraction) < 0.001,
          `${percent}% ${waxing ? 'waxing' : 'waning'}: drew ${(drawn * 100).toFixed(1)}%`,
        );
      }
    }
  });

  test('waxing and waning at the same illumination are mirror images', () => {
    // The whole reason `waxing` has to be carried alongside the fraction.
    const waxing = readGeometry(renderMoonPhase({ illuminatedFraction: 0.23, waxing: true }));
    const waning = readGeometry(renderMoonPhase({ illuminatedFraction: 0.23, waxing: false }));
    assert.notEqual(waxing.limbSweep, waning.limbSweep);
    assert.equal(waxing.terminatorHalfWidth, waning.terminatorHalfWidth);
  });

  test('a quarter moon draws a straight terminator, not an arc', () => {
    const { terminatorHalfWidth } = readGeometry(
      renderMoonPhase({ illuminatedFraction: 0.5, waxing: true }),
    );
    assert.equal(terminatorHalfWidth, 0);
  });

  test('new and full are the degenerate ends, not special cases', () => {
    assert.equal(
      readGeometry(renderMoonPhase({ illuminatedFraction: 0, waxing: true })).terminatorHalfWidth,
      RADIUS,
    );
    assert.equal(
      readGeometry(renderMoonPhase({ illuminatedFraction: 1, waxing: true })).terminatorHalfWidth,
      RADIUS,
    );
  });

  test('an out-of-range fraction is clamped rather than drawn inside out', () => {
    for (const fraction of [-0.2, 1.4]) {
      const { terminatorHalfWidth } = readGeometry(
        renderMoonPhase({ illuminatedFraction: fraction, waxing: true }),
      );
      assert.ok(terminatorHalfWidth <= RADIUS, `${fraction} gave ${terminatorHalfWidth}`);
    }
  });

  test('it is labelled for screen readers only when it carries meaning', () => {
    const phase = { illuminatedFraction: 0.5, waxing: true };
    assert.match(renderMoonPhase(phase, { label: 'First Quarter' }), /aria-label="First Quarter"/);
    assert.match(renderMoonPhase(phase), /aria-hidden="true"/);
  });

  test('real phases from the astronomy come through the right way round', () => {
    // Waxing runs new -> full, so illumination must rise across those days.
    const waxingDay = moonPhase(toEpochDays(2026, 9, 15, 12));
    const nextDay = moonPhase(toEpochDays(2026, 9, 16, 12));
    if (waxingDay.waxing) {
      assert.ok(nextDay.illuminatedFraction > waxingDay.illuminatedFraction);
    } else {
      assert.ok(nextDay.illuminatedFraction < waxingDay.illuminatedFraction);
    }
  });
});
