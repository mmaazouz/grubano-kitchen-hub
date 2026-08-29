import { NextResponse } from 'next/server'
import { z } from 'zod'
import { reverseGeocode } from '@/lib/geocode'

// ── GET /api/geo/reverse?lat=..&lng=.. — reverse-geocoding consommateur (WAVE 2) ──
//
// Transforme la position (accordée explicitement par l'utilisateur) en localisation
// LISIBLE (« 8 Place de l'Hôtel de Ville 75004 Paris »). PROXY SERVEUR volontaire :
// le navigateur ne parle jamais au tiers, un seul point de sortie à tracer.
//
// PRIVACY (runbook) : DATA SENT = lat/lng uniquement → PROVIDER = Géoplateforme IGN
// (data.geopf.fr, service public, gratuit, sans clé, licence etalab-2.0) → PURPOSE =
// affichage d'une adresse lisible + contexte de tri par proximité. Aucune donnée
// n'est persistée ici ; aucune conformité juridique n'est déclarée par ce commentaire.
//
// Échec du tiers → 200 { status:'unavailable' } : l'UI reste honnête (« position
// active ») sans jamais inventer une adresse, et le tri par distance continue.

export const dynamic = 'force-dynamic'

const Query = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
})

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const parsed = Query.safeParse({ lat: searchParams.get('lat'), lng: searchParams.get('lng') })
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_coords' }, { status: 400 })
  }
  const res = await reverseGeocode(parsed.data.lat, parsed.data.lng)
  if (res.status !== 'ok') return NextResponse.json({ status: res.status })
  return NextResponse.json({
    status: 'ok',
    label: res.label,
    city: res.city,
    postcode: res.postcode,
    district: res.district,
  })
}
