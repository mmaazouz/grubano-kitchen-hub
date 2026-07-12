import CredentialsProvider from 'next-auth/providers/credentials'
import GoogleProvider from 'next-auth/providers/google'
import AppleProvider from 'next-auth/providers/apple'
import { PrismaAdapter }    from '@auth/prisma-adapter'
import type { NextAuthOptions } from 'next-auth'
import type { Provider } from 'next-auth/providers/index'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { authorizeMagicLink } from '@/lib/magic-link'
import { authorizeEmailOtpLogin, isEmailOtpEnabled } from '@/lib/email-otp'
import { readOperatorRoles } from '@/lib/operator-roles'

// Build the provider list dynamically. Google / Apple are only registered when
// their credentials exist in the environment, so the app never breaks when the
// OAuth apps aren't configured yet (the consumer auth page detects available
// providers via GET /api/auth/providers and falls back to a "bientôt" toast).
const providers: Provider[] = [
  CredentialsProvider({
    name: 'credentials',
    credentials: {
      email:      { label: 'Email',      type: 'email' },
      password:   { label: 'Password',   type: 'password' },
      // Phase 0 — passwordless magic-link sign-in. When present (and valid), it
      // authenticates WITHOUT a password; the email field is then optional (the
      // operator is derived from the token). The password path below is untouched.
      magicToken: { label: 'Magic token', type: 'text' },
      // Phase 3 (Agent 88) — passwordless EMAIL CODE sign-in (the 6-digit OTP sent in
      // the SAME email as the magic link). GATED by AUTH_EMAIL_OTP_ENABLED; the
      // magic-link + password paths are untouched.
      otp:        { label: 'Email code', type: 'text' },
    },
    async authorize(credentials) {
      // ── Magic-link path (passwordless) ──────────────────────────────────────
      // A valid single-use token signs the user in and is consumed. Self-contained
      // (operator derived from the token), so no email/password needed here.
      if (credentials?.magicToken) {
        const u = await authorizeMagicLink(credentials.magicToken)
        if (!u) return null
        // Phase 1 — attach the full role SET (primary role + OperatorRole rows).
        return { ...u, roles: await readOperatorRoles(u.id, u.role) }
      }

      // ── Email OTP path (passwordless code — Agent 88, GATED) ─────────────────
      // The 6-digit code from the login email. ONLY active when AUTH_EMAIL_OTP_ENABLED
      // (OFF → this branch is inert, the flow is byte-identical to before). Yields the
      // EXACT same user shape as the magic-link path → an identical session. The OTP is
      // single-use + consumed inside authorizeEmailOtpLogin. The magic-link + password
      // paths above/below are unchanged.
      if (isEmailOtpEnabled() && credentials?.email && credentials?.otp) {
        return await authorizeEmailOtpLogin(credentials.email, credentials.otp)
      }

      // ── Password path (existing — unchanged) ───────────────────────────────
      if (!credentials?.email || !credentials?.password) return null

      const operator = await prisma.operator.findUnique({
        where: { email: credentials.email },
      })
      if (!operator) return null

      // Partner accounts self-register in status 'pending' and must confirm their
      // email (GET /api/partners/verify-email → 'active') before they can
      // sign in. A 'suspended' account is blocked by an admin (statusReason kept
      // for audit). Both refusals return null so the surfaced message stays a
      // generic "invalid credentials" — we never leak the account's real state.
      // 'active' and 'pending_review' (email verified, onboarding/profil access)
      // are allowed through.
      if (operator.status === 'pending' || operator.status === 'suspended') return null

      // Password auth — bcrypt ONLY (hardened, P0-SEC-1). A stored value that isn't a
      // valid bcrypt hash (legacy plaintext) NEVER authenticates, and an account with no
      // password set can NEVER sign in by password — those accounts use magic-link / OAuth.
      // (Removed: the cleartext `===` fallback + the `NODE_ENV!=='production'` bypass that
      // accepted ANY password for passwordless accounts off-prod.)
      let valid = false
      if (operator.password) {
        try {
          valid = await bcrypt.compare(credentials.password, operator.password)
        } catch {
          valid = false
        }
      }

      if (!valid) return null

      return {
        id:    operator.id,
        name:  operator.name,
        email: operator.email,
        role:  operator.role,
        // Phase 1 — the full role SET (primary role + OperatorRole rows; tolerant).
        roles: await readOperatorRoles(operator.id, operator.role),
      }
    },
  }),
]

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    GoogleProvider({
      clientId:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  )
}

if (process.env.APPLE_CLIENT_ID && process.env.APPLE_CLIENT_SECRET) {
  providers.push(
    AppleProvider({
      clientId:     process.env.APPLE_CLIENT_ID,
      clientSecret: process.env.APPLE_CLIENT_SECRET,
    }),
  )
}

export const authOptions: NextAuthOptions = {
  adapter:   PrismaAdapter(prisma) as NextAuthOptions['adapter'],
  session:   { strategy: 'jwt' },
  // Single unified sign-in page (Bolt consumer design) handles ALL roles.
  pages:     { signIn: '/eat/auth' },

  providers,

  callbacks: {
    // Keep OAuth (e.g. Google) redirects inside the app; default consumers to /eat.
    async redirect({ url, baseUrl }) {
      // Relative callbackUrl → resolve against baseUrl
      if (url.startsWith('/')) return `${baseUrl}${url}`
      try {
        if (new URL(url).origin === baseUrl) return url
      } catch {
        /* ignore malformed url */
      }
      return `${baseUrl}/eat`
    },
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: string }).role ?? 'consumer'
        // Phase 1 multi-role — carry the full role SET. Fallback to the primary
        // role for OAuth / legacy users (no `roles` on the authorized user).
        token.roles = (user as { roles?: string[] }).roles ?? [token.role as string]
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id   = token.sub
        ;(session.user as { role?: string }).role = token.role as string
        // Phase 1 — expose the role SET (fallback to [role] for old JWTs).
        ;(session.user as { roles?: string[] }).roles =
          (token.roles as string[] | undefined) ?? (token.role ? [token.role as string] : [])
      }
      return session
    },
  },
}
