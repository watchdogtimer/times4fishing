/**
 * HTML escaping, shared by everything that builds markup as a string.
 *
 * Lives in core rather than in the renderer because the Worker, the
 * server-rendered pages and the browser all need it, and none of them should
 * have to pull in the whole page renderer to get three lines.
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ESCAPES[character]);
}
