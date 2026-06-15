import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { llmComplete } from '@/lib/llm'
import nodemailer from 'nodemailer'

// ── Clients ───────────────────────────────────────────────────────────────────

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || 'mail.grubano.com',
  port:   587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER || 'contact@grubano.com',
    pass: process.env.SMTP_PASS,
  },
})

// ── Helpers ───────────────────────────────────────────────────────────────────

async function generateEmail(prompt: string): Promise<{ html: string; tokens: number }> {
  const { text, usage } = await llmComplete({ task: 'email_agent', content: prompt })
  return { html: text, tokens: usage.inputTokens + usage.outputTokens }
}

async function sendAndLog(
  to: string,
  subject: string,
  html: string,
  trigger: string,
  tokens?: number,
) {
  await transporter.sendMail({
    from: '"Grubano" <contact@grubano.com>',
    to,
    subject,
    html,
  })
  await prisma.emailLog.create({
    data: { recipient: to, subject, trigger, status: 'sent', claudeTokens: tokens },
  })
}

// ── POST /api/email-agent ─────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Verify CRON_SECRET to prevent unauthorized calls
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const results: Array<Record<string, unknown>> = []

  // ── TRIGGER 1: Re-engage inactive customers (14 days without order) ─────────
  try {
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
    const inactive = await prisma.loyaltyCustomer.findMany({
      where:  { orders: { every: { validatedAt: { lt: cutoff } } } },
      take:   50,
    })

    for (const customer of inactive) {
      if (!customer.email) continue

      // Rate-limit: don't re-send the same trigger within 7 days
      const alreadySent = await prisma.emailLog.findFirst({
        where: {
          recipient: customer.email,
          trigger:   'inactive_14d',
          sentAt:    { gt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      })
      if (alreadySent) continue

      const promoCode = `RETOUR${Math.random().toString(36).substring(2, 8).toUpperCase()}`
      const { html, tokens } = await generateEmail(
        `Write a warm, friendly re-engagement email in French for ${customer.name},
         a customer who hasn't ordered in 14 days on Grubano, a dark kitchen food platform.
         Include promo code "${promoCode}" for 15% off, valid 48 hours.
         Format as HTML with a clean, modern look. Maximum 150 words.
         End with a "Commander maintenant" call-to-action button.`,
      )
      await sendAndLog(customer.email, 'Vous nous manquez ! 🍽️', html, 'inactive_14d', tokens)
      results.push({ trigger: 'inactive_14d', customer: customer.name, promoCode })
    }
  } catch (e) {
    results.push({ trigger: 'inactive_14d', error: String(e) })
  }

  // ── TRIGGER 2: Points milestone emails ──────────────────────────────────────
  try {
    const milestones = [500, 1000, 2000, 5000]
    const customers  = await prisma.loyaltyCustomer.findMany({
      where: { pointsBalance: { in: milestones } },
    })

    for (const customer of customers) {
      if (!customer.email) continue
      const alreadySent = await prisma.emailLog.findFirst({
        where: {
          recipient: customer.email,
          trigger:   `milestone_${customer.pointsBalance}`,
        },
      })
      if (alreadySent) continue

      const { html, tokens } = await generateEmail(
        `Write a congratulatory email in French for ${customer.name} who just reached
         ${customer.pointsBalance} loyalty points on Grubano food platform.
         Mention their tier: ${customer.tier}. Be enthusiastic and warm.
         Format as HTML. Maximum 120 words.`,
      )
      await sendAndLog(
        customer.email,
        `🏆 Félicitations — vous avez ${customer.pointsBalance} points !`,
        html,
        `milestone_${customer.pointsBalance}`,
        tokens,
      )
      results.push({ trigger: `milestone_${customer.pointsBalance}`, customer: customer.name })
    }
  } catch (e) {
    results.push({ trigger: 'milestone', error: String(e) })
  }

  // ── TRIGGER 3: Creator dish approved ────────────────────────────────────────
  try {
    const recentlyApproved = await prisma.creatorDish.findMany({
      where: {
        status:    'approved',
        createdAt: { gt: new Date(Date.now() - 2 * 60 * 60 * 1000) }, // last 2h
      },
      include: { creator: true },
    })

    for (const dish of recentlyApproved) {
      const alreadySent = await prisma.emailLog.findFirst({
        where: { trigger: `dish_approved_${dish.id}` },
      })
      if (alreadySent) continue

      const { html, tokens } = await generateEmail(
        `Write an exciting approval notification email in French for ${dish.creator.name},
         a food creator on Grubano. Their dish "${dish.name}" has just been approved and
         is now available for dark kitchens to adopt. Mention they earn ${dish.commission * 100}%
         commission on every sale. Format as HTML. Maximum 130 words.`,
      )
      await sendAndLog(
        dish.creator.email,
        `✅ Votre plat "${dish.name}" est approuvé !`,
        html,
        `dish_approved_${dish.id}`,
        tokens,
      )
      results.push({ trigger: 'dish_approved', dish: dish.name, creator: dish.creator.name })
    }
  } catch (e) {
    results.push({ trigger: 'dish_approved', error: String(e) })
  }

  // ── TRIGGER 4: Weekly digest — Mondays at 08:xx only ────────────────────────
  const now = new Date()
  if (now.getDay() === 1 && now.getHours() === 8) {
    try {
      const restaurants = await prisma.operator.findMany({
        where: { role: 'restaurant', status: 'active' },
      })

      for (const restaurant of restaurants) {
        if (!restaurant.email) continue

        const alreadySent = await prisma.emailLog.findFirst({
          where: {
            recipient: restaurant.email,
            trigger:   'weekly_digest',
            sentAt:    { gt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000) },
          },
        })
        if (alreadySent) continue

        const { html, tokens } = await generateEmail(
          `Write a weekly performance digest email in French for ${restaurant.name},
           a restaurant on Grubano dark kitchen platform. Be encouraging, give 3 actionable
           tips to increase orders this week. Sign as "L'équipe Grubano".
           Format as HTML with clear sections. Maximum 200 words.`,
        )
        await sendAndLog(
          restaurant.email,
          `📊 Votre bilan de la semaine — ${restaurant.name}`,
          html,
          'weekly_digest',
          tokens,
        )
        results.push({ trigger: 'weekly_digest', restaurant: restaurant.name })
      }
    } catch (e) {
      results.push({ trigger: 'weekly_digest', error: String(e) })
    }
  }

  return NextResponse.json({
    success:   true,
    processed: results.length,
    results,
    timestamp: new Date().toISOString(),
  })
}
