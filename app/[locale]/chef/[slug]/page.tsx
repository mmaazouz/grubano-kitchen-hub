import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { prisma } from '@/lib/prisma'
import { readCreatorRoles } from '@/lib/creator-roles'
import ChefPublicPage from '@/components/chef/ChefPublicPage'

// ── /chef/[slug] — the PUBLIC creator (chef) page — Mission 1 Creator Studio ──
//
// The pivot's heart: a chef lives on ROYALTIES (2 % of adopted-recipe sales),
// and this page sends their audience to THE RESTAURANTS SERVING THEIR
// CREATIONS. A click from here NEVER triggers the affiliation rail (/ref +
// 30 % stays the influencer tool) — it carries the CONTRIBUTION tracking
// (grubano_chef cookie via /api/chef-visit, pure stat).
//
// Server wrapper: locale + TEXT-ONLY metadata (no dynamic OG image — FTP
// incident of June 4). The interactive page is the client island below; it
// fetches the extended GET /api/creators/public/[slug].

export const dynamic = 'force-dynamic'

export async function generateMetadata(props: {
  params: { locale: string; slug: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale: props.params.locale, namespace: 'chef' })
  try {
    const raw = decodeURIComponent(props.params.slug ?? '').trim()
    const candidates = Array.from(new Set([raw, raw.toLowerCase(), raw.toUpperCase()]))
    const creator = await prisma.creator.findFirst({
      where: {
        OR: [
          { referralLinkSlug: { in: candidates } },
          { referralCode:     { in: candidates } },
        ],
      },
      select: { id: true, name: true, bio: true },
    })
    if (!creator) return {}
    // Mission 14B — a pure influencer's metadata must not say "Chef créateur".
    const roles          = await readCreatorRoles(creator.id)
    const influencerOnly = roles.isInfluencer && !roles.isChef
    const description = (creator.bio ?? '').trim() ||
      (influencerOnly
        ? t('influencerMetaFallbackDesc', { name: creator.name })
        : t('metaFallbackDesc', { name: creator.name }))
    return {
      title: influencerOnly
        ? t('influencerMetaTitle', { name: creator.name })
        : t('metaTitle', { name: creator.name }),
      description: description.slice(0, 200),
    }
  } catch {
    return {}
  }
}

export default function ChefPage(props: { params: { locale: string; slug: string } }) {
  setRequestLocale(props.params.locale)
  return <ChefPublicPage slug={props.params.slug} />
}
