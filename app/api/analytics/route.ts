import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const now       = new Date()
    const today     = new Date(now); today.setHours(0, 0, 0, 0)
    const tomorrow  = new Date(today); tomorrow.setDate(today.getDate() + 1)
    const weekAgo   = new Date(today); weekAgo.setDate(today.getDate() - 7)
    const monthAgo  = new Date(today); monthAgo.setDate(today.getDate() - 30)

    const [allOrders, recentOrders, brands] = await Promise.all([
      prisma.loyaltyOrder.findMany({
        where:   { validatedAt: { gte: monthAgo } },
        include: { brand: { select: { name: true, emoji: true } } },
        orderBy: { validatedAt: 'asc' },
      }),
      prisma.loyaltyOrder.findMany({
        where:   { validatedAt: { gte: weekAgo } },
        include: { brand: { select: { name: true } } },
      }),
      prisma.brand.findMany({ select: { id: true, name: true, emoji: true } }),
    ])

    // Revenue by day (last 7 days)
    const revenueByDay: Record<string, number> = {}
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today); d.setDate(today.getDate() - i)
      revenueByDay[d.toISOString().split('T')[0]] = 0
    }
    for (const o of recentOrders) {
      const day = new Date(o.validatedAt).toISOString().split('T')[0]
      if (day in revenueByDay) revenueByDay[day] += o.amount
    }

    const revenueChart = Object.entries(revenueByDay).map(([date, amount]) => ({
      date,
      label: new Intl.DateTimeFormat('fr-FR', { weekday: 'short' }).format(new Date(date + 'T12:00:00')),
      amount: Math.round(amount * 100) / 100,
    }))

    // Revenue by brand (last 30 days)
    const brandRevenue: Record<string, { name: string; emoji: string; amount: number; count: number }> = {}
    for (const o of allOrders) {
      if (!brandRevenue[o.brandId]) {
        brandRevenue[o.brandId] = { name: o.brand.name, emoji: o.brand.emoji, amount: 0, count: 0 }
      }
      brandRevenue[o.brandId].amount += o.amount
      brandRevenue[o.brandId].count  += 1
    }
    const brandStats = Object.values(brandRevenue).sort((a, b) => b.amount - a.amount)

    // Peak hours (last 7 days)
    const hourMap: Record<number, number> = {}
    for (let h = 0; h < 24; h++) hourMap[h] = 0
    for (const o of recentOrders) {
      const h = new Date(o.validatedAt).getHours()
      hourMap[h] = (hourMap[h] ?? 0) + 1
    }
    const peakHours = Object.entries(hourMap)
      .map(([h, count]) => ({ hour: Number(h), count }))
      .filter(x => x.hour >= 10 && x.hour <= 23)

    // Today KPIs
    const todayOrders  = allOrders.filter(o => new Date(o.validatedAt) >= today && new Date(o.validatedAt) < tomorrow)
    const totalRevenue = allOrders.reduce((s, o) => s + o.amount, 0)
    const totalOrders  = allOrders.length
    const avgOrder     = totalOrders > 0 ? totalRevenue / totalOrders : 0

    return NextResponse.json({
      revenueChart,
      brandStats,
      peakHours,
      kpis: {
        todayRevenue:  Math.round(todayOrders.reduce((s, o) => s + o.amount, 0) * 100) / 100,
        todayOrders:   todayOrders.length,
        totalRevenue:  Math.round(totalRevenue * 100) / 100,
        avgOrder:      Math.round(avgOrder * 100) / 100,
        totalOrders,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
