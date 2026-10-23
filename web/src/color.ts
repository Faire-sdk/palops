/** Colour maths for WCAG contrast (the same formula as the antislop contrast checker). */

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** WCAG relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** Contrast ratio between two #rrggbb colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Moves a colour toward `target` by `t` (0 to 1). */
function mix(hex: string, target: string, t: number): string {
  const from = channels(hex);
  const to = channels(target);
  return `#${from.map((v, i) => Math.round(v + (to[i]! - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * The nearest shade of `hex` that reaches `ratio` against every background:
 * darker on light backgrounds, lighter on dark ones. Returns the colour
 * unchanged when it already passes.
 */
export function readableShade(hex: string, backgrounds: string[], ratio = 4.5): string {
  const color = hex.toLowerCase();
  const passes = (c: string) => backgrounds.every((bg) => contrast(c, bg) >= ratio);
  if (passes(color)) return color;
  const target = luminance(backgrounds[0]!) > 0.5 ? '#000000' : '#ffffff';
  for (let t = 0.02; t <= 1; t += 0.02) {
    const shade = mix(color, target, t);
    if (passes(shade)) return shade;
  }
  return target;
}
