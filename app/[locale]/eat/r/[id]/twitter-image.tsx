// Twitter large-summary card reuses the per-restaurant OG image verbatim.
// `runtime` must be a literal (Next can't trace it through a re-export), so it's
// declared here directly; the rest is re-exported from the OG route.
export const runtime = 'nodejs'
export { default, alt, size, contentType } from './opengraph-image'
