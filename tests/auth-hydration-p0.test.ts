// ── P0 AUTH HYDRATION HOTFIX (2026-09-06) — regression guards ─────────────────
//
// Measured incident: a `[no-restart]` deploy (run 34006442266 → fb994f6) replaced
// .next/static on the server while the previous build's Next.js process kept running.
// That process snapshots the static file list at boot ⇒ every new asset 404, every
// deleted one 400 ⇒ the webpack runtime never loaded ⇒ NO client JavaScript on any
// page ⇒ /fr/auth/magic stayed on its Suspense skeleton forever and /fr/eat/auth was
// inert, on app.grubano.com AND business.grubano.com (same app root).
//
// These tests pin the three layers of the fix:
//   1. the staging workflow ALWAYS restarts Passenger after shipping a build and ends
//      with a BLOCKING client-bundle integrity gate (served HTML → assets 200);
//   2. a real-browser smoke (scripts/qa/auth-hydration-smoke.mjs) exists and checks
//      the exact symptoms (skeleton gone, email + submit visible, no pageerror);
//   3. the auth pages keep the shape the smoke relies on, the consumer auth page routes
//      an already-authenticated visitor, and the magic-link contract facts hold
//      (link 15 min, code 10 min, clickable anchor + raw URL + text part).
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

const ROOT = path.resolve(__dirname, '..')
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const workflow = read('.github/workflows/deploy-staging.yml')
const smoke = read('scripts/qa/auth-hydration-smoke.mjs')
const magicPage = read('app/[locale]/auth/magic/page.tsx')
const eatAuthPage = read('app/[locale]/eat/auth/page.tsx')
const magicRoute = read('app/api/auth/magic-link/route.ts')

describe('deploy-staging.yml — a shipped build ALWAYS restarts Passenger', () => {
  it('the three restart steps still exist', () => {
    expect(workflow).toContain('name: Post-deploy server tasks')
    expect(workflow).toContain('name: Fix permissions and restart')
    expect(workflow).toContain('name: Trigger Passenger restart via FTPS (independent of SSH)')
    expect(workflow.match(/touch (~\/app\.grubano\.com\/)?tmp\/restart\.txt/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  it('no step is conditional on a `[no-restart]` commit marker any more', () => {
    expect(workflow).not.toMatch(/contains\(github\.event\.head_commit\.message,\s*'\[no-restart\]'\)/)
    // the marker may only survive inside the incident comment (backticked), never as YAML logic
    const nonComment = workflow.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')
    expect(nonComment).not.toContain('no-restart')
  })

  it('ends with a BLOCKING client-bundle integrity gate on both auth pages', () => {
    const idx = workflow.indexOf('name: Client bundle integrity')
    expect(idx).toBeGreaterThan(0)
    const step = workflow.slice(idx)
    expect(step).toContain('/fr/auth/magic')
    expect(step).toContain('/fr/eat/auth')
    expect(step).toContain('chunks/webpack-')
    expect(step).toContain('/_next/static/')
    expect(step).toMatch(/"\$CODE" != "200"/)
    expect(step.trim().endsWith('exit 1')).toBe(true)
    expect(step).not.toContain('continue-on-error: true')
    // it runs AFTER the SHA health check (a swapped process is the precondition)
    expect(workflow.indexOf('name: Health check (staging @ expected SHA)')).toBeLessThan(idx)
  })
})

describe('scripts/qa/auth-hydration-smoke.mjs — real-browser regression of the symptom', () => {
  it('covers both auth surfaces at desktop and mobile', () => {
    expect(smoke).toContain("'/fr/auth/magic'")
    expect(smoke).toContain("'/fr/eat/auth'")
    expect(smoke).toContain("name: 'desktop'")
    expect(smoke).toContain("name: 'mobile'")
  })
  it('asserts the exact P0 symptoms: skeleton gone, email + submit visible, sign-up link, no pageerror, no hydration error, assets < 400', () => {
    expect(smoke).toContain('[aria-hidden="true"] .animate-pulse')
    expect(smoke).toContain('input[type="email"]')
    expect(smoke).toContain('button[type="submit"]')
    expect(smoke).toContain('a[href*="/business/start"]')
    expect(smoke).toContain("page.on('pageerror'")
    expect(smoke).toMatch(/hydrat/i)
    expect(smoke).toContain("r.status() >= 400")
    expect(smoke).toContain('typing not reflected')
  })
  it('is side-effect free: never submits the form, fresh profile per run', () => {
    expect(smoke).not.toMatch(/\.click\(\)\s*;?\s*\/\/\s*submit|keyboard\.press\(['"]Enter['"]\)|form\.submit\(/)
    expect(smoke).toContain('mkdtempSync')
    expect(smoke).toContain('example.invalid')
  })
})

describe('auth pages — shape the smoke depends on', () => {
  it('/auth/magic: the dynamic card is the ONLY thing under Suspense and its fallback is the skeleton', () => {
    expect(magicPage).toContain('<Suspense fallback={<CardSkeleton />}>')
    expect(magicPage).toContain('<MagicCard />')
    expect(magicPage).toContain('aria-hidden="true"')
    expect(magicPage).toContain('animate-pulse')
    // signup link outside the boundary (server-rendered even with zero JS)
    const suspenseEnd = magicPage.indexOf('</Suspense>')
    expect(magicPage.indexOf('href="/business/start"')).toBeGreaterThan(suspenseEnd)
  })
  it('/auth/magic: the resolved card renders an email Input and a submit Button', () => {
    expect(magicPage).toMatch(/<Input[\s\S]*?type="email"/)
    expect(magicPage).toMatch(/<Button type="submit"/)
  })
  it('/eat/auth: an already-authenticated visitor is routed to their space (no inert login form)', () => {
    expect(eatAuthPage).toContain("fetch('/api/auth/session', { cache: 'no-store' })")
    expect(eatAuthPage).toMatch(/if \(!cancelled && s\?\.user\) void routeByRole\(router\)/)
    // and the password + magic paths are untouched
    expect(eatAuthPage).toContain("signIn('credentials', { email, password, redirect: false })")
    expect(eatAuthPage).toContain("router.push('/eat/magic')")
  })
})

describe('magic-link contract facts (unchanged by the hotfix)', () => {
  it('link TTL = 15 min, code TTL = 10 min', async () => {
    const { MAGIC_TTL_MS } = await import('@/lib/magic-link')
    const { OTP_TTL_MS } = await import('@/lib/email-otp')
    expect(MAGIC_TTL_MS).toBe(15 * 60 * 1000)
    expect(OTP_TTL_MS).toBe(10 * 60 * 1000)
  })
  it('the email carries a clickable button anchor AND a visible raw-URL anchor on the same link, plus a text part', () => {
    expect(magicRoute.match(/<a href="\$\{link\}"/g)?.length).toBe(2)
    expect(magicRoute).toMatch(/token=\$\{encodeURIComponent\(token\)\}/)
    // plain-text alternative built from the same link (multipart/alternative)
    expect(magicRoute).toMatch(/const text = \[/)
    expect(magicRoute).toMatch(/^\s+text,\s*$/m)
  })
  it('consumption route exists: CredentialsProvider authorizes magicToken via authorizeMagicLink', () => {
    const auth = read('lib/auth.ts')
    expect(auth).toContain("import { authorizeMagicLink } from '@/lib/magic-link'")
    expect(auth).toContain('credentials?.magicToken')
  })
})
