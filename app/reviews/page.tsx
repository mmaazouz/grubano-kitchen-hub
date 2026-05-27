'use client'

import { useState } from 'react'
import { Star, MessageSquare, Clock, Sparkles, RefreshCw, Check, Filter } from 'lucide-react'
import { Card } from '@/components/grubano/Card'

// ── Mock reviews (real platform API — Phase 2) ────────────────────────────────

type Review = {
  id:       string
  platform: string
  author:   string
  rating:   number
  text:     string
  time:     string
  answered: boolean
  urgent:   boolean
}

const MOCK_REVIEWS: Review[] = [
  { id: 'r1', platform: 'UberEats',  author: 'Sarah K.',  rating: 5, text: 'Best gnocchi in Paris! La sauce était parfaite, livraison rapide. Bravo !',         time: '1h',  answered: false, urgent: false },
  { id: 'r2', platform: 'Deliveroo', author: 'Anonyme',   rating: 1, text: 'Froid à la livraison, sans sauce. Complètement raté.',                               time: '2h',  answered: false, urgent: true  },
  { id: 'r3', platform: 'Just Eat',  author: 'Tom B.',    rating: 4, text: 'Bon mais un peu long. Les plats étaient bons mais j\'ai attendu 50 min.',            time: '5h',  answered: false, urgent: false },
  { id: 'r4', platform: 'UberEats',  author: 'Léa M.',    rating: 5, text: 'Toujours au top ! Le butter chicken est incroyable. J\'en commande toutes les semaines.', time: '8h', answered: true,  urgent: false },
  { id: 'r5', platform: 'Deliveroo', author: 'Karim Z.',  rating: 3, text: 'Correct sans plus. La présentation pourrait être meilleure pour le prix.',           time: '1j',  answered: false, urgent: false },
]

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ReviewsPage() {
  const [reviews,  setReviews]  = useState<Review[]>(MOCK_REVIEWS)
  const [drafts,   setDrafts]   = useState<Record<string, string>>({})
  const [loading,  setLoading]  = useState<Record<string, boolean>>({})
  const [sent,     setSent]     = useState<Set<string>>(new Set())
  const [filter,   setFilter]   = useState<'all' | 'low' | 'unanswered'>('all')

  const filtered = reviews.filter(r => {
    if (filter === 'low')        return r.rating <= 2
    if (filter === 'unanswered') return !r.answered && !sent.has(r.id)
    return true
  })

  const avgRating = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
  const unanswered = reviews.filter(r => !r.answered && !sent.has(r.id)).length

  async function generateDraft(review: Review) {
    setLoading(l => ({ ...l, [review.id]: true }))
    try {
      const r = await fetch('/api/reviews/generate-reply', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          platform:   review.platform,
          authorName: review.author,
          rating:     review.rating,
          text:       review.text,
        }),
      })
      if (r.ok) {
        const d = await r.json()
        setDrafts(prev => ({ ...prev, [review.id]: d.reply }))
      }
    } finally {
      setLoading(l => ({ ...l, [review.id]: false }))
    }
  }

  function sendReply(reviewId: string) {
    setSent(prev => new Set([...prev, reviewId]))
    setReviews(prev => prev.map(r => r.id === reviewId ? { ...r, answered: true } : r))
  }

  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
      <h1 className="mb-1 text-2xl font-display font-bold tracking-tight">Avis</h1>
      <p className="mb-1 text-sm text-muted-foreground">
        Toutes plateformes · Réponses IA
      </p>

      {/* Stats */}
      <div className="mb-4 grid grid-cols-3 gap-2">
        <div className="rounded-2xl border border-border bg-card p-3 text-center">
          <p className="text-base font-bold">{avgRating.toFixed(1)}★</p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Note moyenne</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-3 text-center">
          <p className="text-base font-bold">{reviews.length}</p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Avis total</p>
        </div>
        <div className={`rounded-2xl border p-3 text-center ${unanswered > 0 ? 'border-warning/30 bg-warning/10' : 'border-border bg-card'}`}>
          <p className="text-base font-bold">{unanswered}</p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Sans réponse</p>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex gap-2">
        {(['all', 'low', 'unanswered'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`flex-1 rounded-xl py-2 text-[11px] font-semibold transition ${
              filter === f ? 'bg-navy text-navy-foreground' : 'border border-border bg-card text-muted-foreground'
            }`}>
            {f === 'all' ? 'Tous' : f === 'low' ? '1-2★' : 'Sans réponse'}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.map(r => {
          const draft      = drafts[r.id]
          const isLoading  = loading[r.id]
          const isSent     = sent.has(r.id) || r.answered

          return (
            <Card key={r.id} className={r.urgent ? '!border-destructive/40' : ''}>
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase text-muted-foreground">{r.platform}</span>
                  <span className="text-xs font-semibold">{r.author}</span>
                  <span className="text-[10px] text-muted-foreground">{r.time}</span>
                </div>
                <span className="inline-flex items-center gap-0.5">
                  {Array.from({ length: r.rating }).map((_, i) => (
                    <Star key={i} size={11} className="fill-warning text-warning" />
                  ))}
                  {Array.from({ length: 5 - r.rating }).map((_, i) => (
                    <Star key={i} size={11} className="text-muted-foreground/30" />
                  ))}
                </span>
              </div>

              <p className="mt-2 text-sm">{r.text}</p>

              {r.urgent && (
                <p className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-destructive">
                  <Clock size={10} /> Répondre dans les 2h
                </p>
              )}

              {isSent ? (
                <p className="mt-2 inline-flex items-center gap-1 text-[10px] text-success">
                  <MessageSquare size={10} /> Répondu
                </p>
              ) : (
                <>
                  {/* AI Draft area */}
                  {draft ? (
                    <div className="mt-3 rounded-lg bg-accent p-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-[10px] font-bold uppercase text-primary">Brouillon IA</p>
                        <button onClick={() => generateDraft(r)} disabled={isLoading}
                          className="text-[10px] font-semibold text-primary hover:underline">
                          Régénérer
                        </button>
                      </div>
                      <textarea
                        value={draft}
                        onChange={e => setDrafts(prev => ({ ...prev, [r.id]: e.target.value }))}
                        rows={3}
                        className="w-full rounded-lg bg-transparent text-[12px] leading-snug focus:outline-none resize-none"
                      />
                    </div>
                  ) : (
                    <div className="mt-3 rounded-lg bg-accent p-2.5">
                      <p className="text-[10px] font-bold uppercase text-primary">Brouillon IA</p>
                      <p className="mt-1 text-[12px] italic text-muted-foreground">
                        {r.rating <= 2
                          ? 'Désolé pour cette expérience — nous aimerions y remédier. Répondez pour réclamer un plat offert.'
                          : r.rating === 3
                          ? 'Merci pour votre retour. Nous travaillons à améliorer nos délais de livraison.'
                          : 'Merci beaucoup pour votre avis, à très bientôt !'}
                      </p>
                    </div>
                  )}

                  <div className="mt-2 flex gap-2">
                    <button onClick={() => sendReply(r.id)}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary py-2 text-[11px] font-semibold text-primary-foreground">
                      <Check size={12} /> Envoyer
                    </button>
                    <button
                      onClick={() => generateDraft(r)}
                      disabled={isLoading}
                      className="flex items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-[11px] font-semibold disabled:opacity-60">
                      {isLoading ? <RefreshCw size={11} className="animate-spin" /> : <Sparkles size={11} />}
                      {draft ? 'Régénérer' : 'IA Draft'}
                    </button>
                  </div>
                </>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
