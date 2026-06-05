import CredentialsProvider from 'next-auth/providers/credentials'
import GoogleProvider from 'next-auth/providers/google'
import AppleProvider from 'next-auth/providers/apple'
import { PrismaAdapter }    from '@auth/prisma-adapter'
import type { NextAuthOptions } from 'next-auth'
import type { Provider } from 'next-auth/providers/index'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'

// Build the provider list dynamically. Google / Apple are only registered when
// their credentials exist in the environment, so the app never breaks when the
// OAuth apps aren't configured yet (the consumer auth page detects available
// providers via GET /api/auth/providers and falls back to a "bientôt" toast).
const providers: Provider[] = [
  CredentialsProvider({
    name: 'credentials',
    credentials: {
      email:    { label: 'Email',    type: 'email' },
      password: { label: 'Password', type: 'password' },
    },
    async authorize(credentials) {
      if (!credentials?.email || !credentials?.password) return null

      const operator = await prisma.operator.findUnique({
        where: { email: credentials.email },
      })
      if (!operator) return null

      // Partner accounts self-register in status 'pending' and must confirm their
      // email (GET /api/partners/verify-email → 'pending_review') before they can
      // sign in. A 'suspended' account is blocked by an admin (statusReason kept
      // for audit). Both refusals return null so the surfaced message stays a
      // generic "invalid credentials" — we never leak the account's real state.
      // 'active' and 'pending_review' (email verified, onboarding/profil access)
      // are allowed through.
      if (operator.status === 'pending' || operator.status === 'suspended') return null

      // Support both hashed passwords and plain text (for legacy seed data)
      let valid = false
      if (operator.password) {
        try {
          valid = await bcrypt.compare(credentials.password, operator.password)
        } catch {
          valid = credentials.password === operator.password
        }
      } else {
        // No password set — allow any password in dev (remove in prod)
        valid = process.env.NODE_ENV !== 'production'
      }

      if (!valid) return null

      return {
        id:    operator.id,
        name:  operator.name,
        email: operator.email,
        role:  operator.role,
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
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id   = token.sub
        ;(session.user as { role?: string }).role = token.role as string
      }
      return session
    },
  },
}
