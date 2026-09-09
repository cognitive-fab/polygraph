// The one place the wordmark and tagline live. Every diagram's footer line is
// (brand, tagline); nothing else in the renderer knows these strings.
//
// Precedence, lowest to highest:
//   these defaults  <  model.meta / polyviz.annotations.json  <  CLI flags
//
// Overriding is a first-class use: a different org renders with its own
// wordmark, and `--no-brand` renders with none at all.

export const DEFAULT_BRAND = 'COGNITIVE FAB · POLYGRAPH';
export const DEFAULT_FOOTER = 'Provable Trust';

/**
 * Fold CLI brand overrides into a viz-model's meta. Returns the same model
 * when there is nothing to override, a shallow copy otherwise (the caller's
 * parsed JSON is never mutated).
 *
 * `noBrand` wins over everything and blanks both lines — chrome() skips empty
 * strings, so the footer row disappears rather than falling back to a default.
 */
export function applyBrandOverrides(model, { brand, footer, noBrand } = {}) {
  const meta = {};
  if (noBrand) { meta.brand = ''; meta.footer = ''; }
  if (typeof brand === 'string') meta.brand = brand;
  if (typeof footer === 'string') meta.footer = footer;
  if (!Object.keys(meta).length) return model;
  return { ...model, meta: { ...(model.meta ?? {}), ...meta } };
}

/** Resolve the footer pair a diagram should draw. */
export function brandOf(meta = {}) {
  return {
    brand: meta.brand ?? DEFAULT_BRAND,
    footer: meta.footer ?? DEFAULT_FOOTER
  };
}
