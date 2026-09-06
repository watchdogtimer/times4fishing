/**
 * The moon, drawn rather than described.
 *
 * A phase is a shape, and a shape is easier to read at a glance than
 * "Waning Crescent, 23%". The text stays alongside it — the drawing tells you
 * roughly, the number tells you exactly.
 *
 * The geometry is two arcs. The lit limb is always a true semicircle, because
 * we see the moon lit by a light source effectively at infinity. The terminator
 * — the dividing line — is the moon's circular edge viewed at an angle, and a
 * circle seen at an angle projects to an ellipse. So the whole phase is one
 * semicircle plus one half-ellipse whose width tracks the phase:
 *
 *   new (0%)      ellipse as wide as the disc, cancelling the limb  → nothing lit
 *   crescent      narrow-ish ellipse bulging towards the lit side
 *   quarter (50%) ellipse of zero width, i.e. a straight line
 *   gibbous       ellipse bulging away, past the centre
 *   full (100%)   ellipse as wide as the disc, completing the circle
 *
 * That single formula covers every case including the degenerate ends, so there
 * are no special cases below.
 */

const VIEWBOX = 100;
const CENTRE = VIEWBOX / 2;
const RADIUS = 46;

/**
 * @param {{illuminatedFraction: number, waxing: boolean}} phase
 * @param {object} [options]
 * @param {string} [options.label] Accessible description. Omit for a decorative disc.
 * @returns {string} SVG markup, sized by CSS rather than by attributes.
 */
export function renderMoonPhase(phase, { label } = {}) {
  const lit = Math.min(1, Math.max(0, phase.illuminatedFraction));

  // Half-width of the terminator ellipse. Full disc at new and full moon, zero
  // at the quarters — which SVG draws as a straight line, exactly as wanted.
  const terminatorHalfWidth = RADIUS * Math.abs(1 - 2 * lit);

  // Sweep flags decide which way each arc bows. In SVG's y-down space, sweep 1
  // is clockwise: from the top that reaches the bottom via the right-hand side.
  const limbSweep = phase.waxing ? 1 : 0;
  // Coming back up the terminator, the bulge follows the lit side while the
  // moon is a crescent and swings past centre once it's gibbous.
  const terminatorSweep = lit < 0.5 === phase.waxing ? 0 : 1;

  const top = `${CENTRE},${CENTRE - RADIUS}`;
  const bottom = `${CENTRE},${CENTRE + RADIUS}`;
  const path = [
    `M ${top}`,
    `A ${RADIUS},${RADIUS} 0 0 ${limbSweep} ${bottom}`,
    `A ${terminatorHalfWidth.toFixed(2)},${RADIUS} 0 0 ${terminatorSweep} ${top}`,
    'Z',
  ].join(' ');

  const accessibility = label
    ? `role="img" aria-label="${escapeAttribute(label)}"`
    : 'role="presentation" aria-hidden="true"';

  return `
    <svg class="moon-disc" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}" ${accessibility}>
      <circle class="moon-dark" cx="${CENTRE}" cy="${CENTRE}" r="${RADIUS}"/>
      <path class="moon-lit" d="${path}"/>
    </svg>`;
}

function escapeAttribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
