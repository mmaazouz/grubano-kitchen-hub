// lib/claim-email-shell.ts — D′ L9.1: the e-mail CHROME, extracted so two senders can share it.
//
// WHY THIS FILE EXISTS. The restaurant post-money notice became CLAIM-AGNOSTIC (founder arbitration of
// 2026-09-27): a support refund can legitimately have no `Claim`, so the sender had to leave
// `lib/claim-emails` — a module the support route is forbidden to import (spec v2 §6.3) and whose direct
// importers are pinned to a closed list. The three helpers below were the only thing the two senders needed
// in common. Copying eight lines of markup into the new module would have been the smaller change and the
// worse one: two renderings of the same notice drift, and this lot already had to fix one figure that was
// computed two ways.
//
// A DELIBERATE LEAF: zero imports, so it adds no reach to anything that pulls it in. H15's reachability walk
// from the sender modules is therefore unaffected by its existence, which is what makes it safe to share.

/** HTML-escape a value interpolated into an e-mail body. */
export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * An amount in euros, in the RECIPIENT's locale. Never `.toFixed(2)`, which put a decimal POINT in FR/ES/IT
 * e-mails (found in an earlier review).
 *
 * D′ L10 — THE TAG IS RESOLVED, NOT PASSED THROUGH, and Arabic is why. A bare `'ar'` makes Intl choose a
 * region, and it chose one that formats with a decimal POINT: an Arabic recipient read « 12.50 € » in the
 * e-mail while every Arabic SCREEN of the app showed « 12,50 € », because lib/format-money resolves `ar` to
 * `ar-MA`. Two figures for one amount, from one refund. The same map is used here so the e-mail and the screen
 * cannot disagree — and an unknown tag falls back to `fr-FR` deterministically rather than to whatever ICU
 * version the host happens to ship. Found by this lot's adversarial review.
 */
const EMAIL_INTL_LOCALE: Record<string, string> = {
  fr: 'fr-FR', en: 'en-US', es: 'es-ES', it: 'it-IT', ar: 'ar-MA',
}
export const euros = (locale: string, cents: number): string =>
  new Intl.NumberFormat(EMAIL_INTL_LOCALE[locale] ?? 'fr-FR', { style: 'currency', currency: 'EUR' })
    .format(cents / 100)

/**
 * The sober local template (the `renderNudgeHtml` / `admin-alerts` pattern — the rail's own `shell()` is
 * private). No redesign: the strict minimum, plus RTL for Arabic.
 */
export function claimShell(p: { title: string; bodyHtml: string; footer: string; rtl: boolean }): string {
  return `
    <div dir="${p.rtl ? 'rtl' : 'ltr'}" style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;color:#1a1a2e">
      <h2 style="color:#F97316">${p.title}</h2>
      ${p.bodyHtml}
      <p style="font-size:12px;color:#9ca3af;margin-top:28px">${p.footer}</p>
    </div>`
}
