'use client'

/**
 * /design/gb-foundation — INTERNAL preview of the gb-* DESIGN FOUNDATION.
 *
 * Renders every base component extracted VERBATIM from Claude-Design's code
 * (app/gb-foundation/gb-tokens.css + gb-components.css) in LIGHT and FIXED-DARK,
 * so Agent 0 / the QA pass can compare each one to the CD code icon-by-icon.
 *
 * Dev/catalogue surface only (public via the /design path policy in middleware) —
 * NOT a real consumer screen, no business/auth/money logic. Material Symbols icons
 * (not lucide); --gb-* tokens; no shadcn, no Tailwind utilities for the components.
 */

import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'
import * as React from 'react'

// Verbatim brand SVGs used by the OAuth social buttons.
function GoogleLogo() {
  // Multicolor Google "G" (standard 4-colour brand mark). CSS sizes it to 18px.
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09a6.6 6.6 0 0 1 0-4.18V7.07H2.18a11 11 0 0 0 0 9.86l3.66-2.84z" />
      <path fill="#EA4335" d="M12 4.75c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.46 14.97.5 12 .5A11 11 0 0 0 2.18 7.07l3.66 2.84C6.71 7.31 9.14 4.75 12 4.75z" />
    </svg>
  )
}
function AppleLogo() {
  // Apple logo — verbatim from the CD code (fill=currentColor → inherits the label ink).
  return (
    <svg viewBox="0 0 384 512" fill="currentColor" aria-hidden="true"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5c0 26.2 4.8 53.3 14.4 81.2 12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" /></svg>
  )
}

// A small Material icon helper (ligature span).
function Ms({ name, style }: { name: string; style?: React.CSSProperties }) {
  return <span className="ms" style={style} aria-hidden="true">{name}</span>
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <p style={{ font: '700 11px/1 var(--gb-font-ui)', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--gb-muted)', margin: '0 0 10px' }}>{title}</p>
      {children}
    </section>
  )
}

// Every component, rendered once. Mounted inside a `.gb` root (light or dark).
function Showcase() {
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <Block title="Brand panel — navy / Sunrise (logo · pitch · deco circles)">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 14 }}>
          <div className="gb-brand">
            <div className="gb-brand__logo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/grubano-symbol-white.svg" alt="Grubano" />
              <b>Grubano</b>
            </div>
            <div className="gb-brand__pitch"><h2>Pull up a chair.</h2><p>Sign in to order, book a table and earn rewards.</p></div>
            <div className="gb-brand__meta"><span><Ms name="verified_user" style={{ fontSize: 17, color: '#41BD78' }} />Secure</span><span><Ms name="bolt" style={{ fontSize: 17, color: '#FF9A4D' }} />Passwordless</span></div>
          </div>
          <div className="gb-brand is-sunrise">
            <div className="gb-brand__logo" style={{ justifyContent: 'flex-end' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/grubano-symbol-white.svg" alt="Grubano" />
            </div>
            <div className="gb-brand__pitch"><h2 style={{ color: '#fff' }}>Join the table.</h2><p style={{ color: 'rgba(255,255,255,.92)' }}>Earn as you eat.</p></div>
            <div className="badge"><Ms name="redeem" style={{ fontSize: 17 }} />Welcome bonus</div>
          </div>
        </div>
      </Block>

      <Block title="Buttons — primary · white · line · social (Google + Apple)">
        <div style={{ display: 'grid', gap: 10, maxWidth: 380 }}>
          <button className="btn btn--primary">Continue</button>
          <button className="btn btn--white">Open mail app</button>
          <button className="btn btn--line"><Ms name="link" />Email me a magic link</button>
          <div className="oauth">
            <button className="btn-social"><GoogleLogo />Google</button>
            <button className="btn-social"><AppleLogo />Apple</button>
          </div>
        </div>
      </Block>

      <Block title="Field — label · input (Material icon + focus ring + eye) · strength meter">
        <div style={{ maxWidth: 380 }}>
          <div className="field">
            <div className="field__label"><span>Email</span></div>
            <div className="input"><Ms name="mail" /><input defaultValue="sofia@email.com" /></div>
          </div>
          <div className="field">
            <div className="field__label"><span>Password</span><a href="#" onClick={(e) => e.preventDefault()}>Forgot?</a></div>
            <div className="input"><Ms name="lock" /><input type="password" defaultValue="password" /><span className="ms toggle">visibility_off</span></div>
          </div>
          <div className="strength"><i className="on1" /><i className="on1" /><i className="on2" /><i /></div>
        </div>
      </Block>

      <Block title="Divider · Card · Success note · AI-soon tip">
        <div style={{ display: 'grid', gap: 12, maxWidth: 380 }}>
          <div className="divider">or continue with</div>
          <div className="card"><h3>Continue as guest</h3><p>We&apos;ll email a code to confirm your order — no password needed.</p><button className="btn btn--primary" style={{ fontSize: 13.5, padding: 12 }}>Email me a code</button></div>
          <div className="note"><Ms name="check_circle" /><span>Create a password later to save your details &amp; earn points.</span></div>
          <div className="tip"><Ms name="auto_awesome" /><span>Smart email tips to find the link faster</span><span className="soon">AI — soon</span></div>
        </div>
      </Block>

      <Block title="OTP boxes">
        <div className="otp" style={{ maxWidth: 320 }}><i className="active">3</i><i>9</i><i>2</i><i className="empty">—</i><i className="empty">—</i><i className="empty">—</i></div>
      </Block>

      <Block title="Hero icon (plain · halo) · Spinner · Dots">
        <div style={{ display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap' }}>
          <div className="hero-ico"><Ms name="password" /></div>
          <div className="hero"><Ms name="mark_email_unread" /></div>
          <div className="spin" />
          <div className="dots"><i /><i /><i /></div>
        </div>
      </Block>

      <Block title="Tags / chips · Title + sub">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
          <span className="tag-guest">Guest</span>
          <span className="ai-soon"><Ms name="auto_awesome" style={{ fontSize: 12 }} />AI — soon</span>
        </div>
        <h1 className="gb-title">Enter the code</h1>
        <p className="gb-sub">We sent a 6-digit code to <b>sofia@email.com</b>. It expires in 10 minutes.</p>
      </Block>

      <Block title="Payment bar (Confirm &amp; pay)">
        <div style={{ maxWidth: 420, border: '1px solid var(--gb-border)', borderRadius: 16, overflow: 'hidden' }}>
          <div className="paybar" style={{ borderTop: 'none' }}><div className="paybar__btn"><span>Confirm &amp; pay</span><b>€34.34</b></div></div>
        </div>
      </Block>
    </div>
  )
}

export default function GbFoundationPreview() {
  return (
    <div style={{ minHeight: '100vh', font: "400 14px/1.5 'Hanken Grotesk', system-ui, sans-serif" }}>
      <header style={{ padding: '20px 24px', borderBottom: '1px solid #e7e1d7' }}>
        <h1 style={{ font: '800 22px/1.1 Gabarito, sans-serif', letterSpacing: '-.02em', margin: 0, color: '#0F2742' }}>Grubano — gb-* foundation</h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6B7682' }}>Base components extracted verbatim from the Claude-Design code · light + fixed-dark · Material icons.</p>
      </header>

      {/* LIGHT */}
      <div className="gb" style={{ background: 'var(--gb-bg)', padding: 24 }}>
        <p style={{ font: '700 12px/1 Hanken Grotesk, sans-serif', color: 'var(--gb-muted)', margin: '0 0 18px' }}>● LIGHT</p>
        <Showcase />
      </div>

      {/* FIXED DARK — data-theme on the wrapper, independent of the app theme */}
      <div data-theme="dark">
        <div className="gb" style={{ background: 'var(--gb-bg)', padding: 24 }}>
          <p style={{ font: '700 12px/1 Hanken Grotesk, sans-serif', color: 'var(--gb-muted)', margin: '0 0 18px' }}>● DARK (fixed)</p>
          <Showcase />
        </div>
      </div>
    </div>
  )
}
