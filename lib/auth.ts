import CredentialsProvider from 'next-auth/providers/credentials'
import { PrismaAdapter }    from '@auth/prisma-adapter'
import type { NextAuthOptions } from 'next-auth'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'

export const authOptions: NextAuthOptions = {
  adapter:   PrismaAdapter(prisma) as NextAuthOptions['adapter'],
  session:   { strategy: 'jwt' },
  pages:     { signIn: '/login' },

  providers: [
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
  ],

  callbacks: {
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
