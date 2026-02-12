/**
 * Semantic color utilities wrapping ansis.
 *
 * All color output should flow through this module so NO_COLOR,
 * FORCE_COLOR, and non-TTY contexts are handled consistently.
 * Ansis handles NO_COLOR natively -- colors degrade to plain text
 * automatically when the environment does not support them.
 */

import ansis, { green, yellow, red, cyan, bold, dim, hex } from 'ansis';

export const colors = {
  // Status colors (semantic)
  ok: green,
  warning: yellow,
  error: red,
  blocked: red.bold,

  // Structural colors
  header: bold.cyan,
  label: dim,
  value: bold,
  slug: cyan,
  hint: dim,

  // Environment colors (pass-through hex)
  envColor: (hexColor: string) => hex(hexColor),

  // Check if colors are supported in current environment
  isSupported: ansis.isSupported,
};

/**
 * Safe color wrapper -- returns plain text when colors are not supported,
 * colored text when supported. Use this when you are unsure about the
 * output context. The ansis color functions already handle NO_COLOR
 * natively, so direct use of colors.ok(), colors.error(), etc. is also fine.
 */
export function colorize(
  text: string,
  colorFn: (s: string) => string,
): string {
  if (!ansis.isSupported()) return text;
  return colorFn(text);
}
