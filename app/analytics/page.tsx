import { Fragment } from 'react'
import { TrendingDown, TrendingUp, Users } from 'lucide-react'
import { Card } from '@/components/grubano/Card'
import { SectionTitle } from '@/components/grubano/SectionTitle'

const hours = ['10','11','12','13','14','15','16','17','18','19','20','21','22']
const days  = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

export default function AnalyticsPage() {
  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
      <h1 className="mb-1 text-2xl font-display font-bold tracking-tight">Intelligence</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        Chiffres réels, sans fioritures
        <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-bold text-success">Live</span>
      </p>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Marge nette aujourd&apos;hui</p>
          <p className="mt-1 text-2xl font-bold">€1 684</p>
          <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-success">
            <TrendingUp size={11} /> +9% vs moy.
          </p>
        </Card>
        <Card>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">LTV client</p>
          <p className="mt-1 text-2xl font-bold">€87</p>
          <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-success">
            <Users size={11} /> 3,4 cmds moy.
          </p>
        </Card>
      </div>

      <SectionTitle hint="Par commande, après commission">Marge par plateforme</SectionTitle>
      <div className="space-y-2">
        {[
          { p: 'UberEats',  gross: 18.5, com: 25, net: 7.2 },
          { p: 'Deliveroo', gross: 19.1, com: 30, net: 6.4 },
          { p: 'Just Eat',  gross: 17.8, com: 22, net: 7.9 },
          { p: 'Direct',    gross: 18.5, com: 0,  net: 11.1 },
        ].map((r) => (
          <Card key={r.p} className="flex items-center justify-between !p-3">
            <div>
              <p className="text-sm font-semibold">{r.p}</p>
              <p className="text-[11px] text-muted-foreground">€{r.gross.toFixed(2)} brut · −{r.com}% commission</p>
            </div>
            <p className="text-base font-bold text-success">€{r.net.toFixed(2)}</p>
          </Card>
        ))}
      </div>

      <SectionTitle hint="7 derniers jours">Heatmap horaire</SectionTitle>
      <Card>
        <div className="grid gap-1" style={{ gridTemplateColumns: `auto repeat(${hours.length}, 1fr)` }}>
          <div />
          {hours.map((h) => (
            <div key={h} className="text-center text-[8px] font-medium text-muted-foreground">{h}</div>
          ))}
          {days.map((d, di) => (
            <Fragment key={`row-${di}`}>
              <div className="text-[10px] font-semibold text-muted-foreground">{d}</div>
              {hours.map((_, hi) => {
                const v = Math.abs(Math.sin((di + 1) * (hi + 3)))
                return (
                  <div
                    key={`${di}-${hi}`}
                    className="aspect-square rounded-[3px] bg-primary"
                    style={{ opacity: v * 0.80 + 0.08 }}
                  />
                )
              })}
            </Fragment>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">Pic : vendredi 19h–21h · Creux : lundi 15h</p>
      </Card>

      <SectionTitle>Annulations</SectionTitle>
      <Card>
        <div className="flex items-baseline justify-between">
          <p className="text-2xl font-bold">2,4%</p>
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-destructive">
            <TrendingDown size={11} /> +0,3 cette semaine
          </span>
        </div>
        <div className="mt-3 space-y-2">
          {[
            { c: 'Rupture de stock',   p: 42 },
            { c: 'Temps de prépa long', p: 28 },
            { c: 'Livreur indisponible', p: 18 },
            { c: 'Demande client',      p: 12 },
          ].map((r) => (
            <div key={r.c}>
              <div className="mb-1 flex justify-between text-[11px]">
                <span>{r.c}</span>
                <span className="font-semibold">{r.p}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${r.p}%` }} />
              </div>
            </div>
          ))}
        </div>
      </Card>

      <SectionTitle>Benchmark zone</SectionTitle>
      <Card>
        <p className="text-[11px] text-muted-foreground">Anonymisé vs top 3 de votre zone</p>
        <div className="mt-3 space-y-2">
          {[
            { n: 'Vous (Grubano)',   r: 4.8, you: true },
            { n: 'Concurrent A',    r: 4.6 },
            { n: 'Concurrent B',    r: 4.5 },
            { n: 'Concurrent C',    r: 4.3 },
          ].map((c) => (
            <div key={c.n} className={`flex items-center justify-between rounded-lg px-2 py-1.5 ${c.you ? 'bg-accent' : ''}`}>
              <span className={`text-sm ${c.you ? 'font-bold text-primary' : 'text-foreground'}`}>{c.n}</span>
              <span className="text-sm font-bold">{c.r}★</span>
            </div>
          ))}
        </div>
      </Card>

      <SectionTitle hint="7 prochains jours">Prévision de revenu</SectionTitle>
      <Card>
        <div className="flex h-28 items-end gap-2">
          {[2.4, 2.6, 2.5, 2.9, 3.4, 3.7, 3.1].map((v, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
              <div
                className="w-full rounded-t-md bg-gradient-to-t from-primary to-primary/40"
                style={{ height: `${(v / 3.7) * 100}%` }}
              />
              <span className="text-[10px] text-muted-foreground">{days[i]}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Total estimé : <span className="font-bold text-foreground">€20,6k</span> · +12% vs semaine dernière
        </p>
      </Card>
    </div>
  )
}
