'use client'

import { useState } from 'react'
import { Check, Clock, ChefHat, AlertTriangle } from 'lucide-react'
import { Card } from '@/components/grubano/Card'
import { SectionTitle } from '@/components/grubano/SectionTitle'

const prepTasks = [
  { id: 1, task: 'Mariner le poulet (x4 kg)',        time: '30 min', done: false, priority: 'high'   },
  { id: 2, task: 'Préparer la sauce pesto (x2 L)',   time: '20 min', done: false, priority: 'high'   },
  { id: 3, task: 'Cuire le riz basmati (x5 kg)',     time: '25 min', done: true,  priority: 'medium' },
  { id: 4, task: 'Découper les légumes (salade)',    time: '15 min', done: true,  priority: 'low'    },
  { id: 5, task: 'Préparer les bases de gnocchi',   time: '45 min', done: false, priority: 'high'   },
  { id: 6, task: 'Monter les tiramisus (x20)',       time: '30 min', done: false, priority: 'medium' },
]

export default function PrepPage() {
  const [tasks, setTasks] = useState(prepTasks)
  const done  = tasks.filter(t => t.done).length
  const total = tasks.length

  return (
    <div className="px-5 pb-8 pt-4 max-w-lg mx-auto md:max-w-3xl">
      <h1 className="mb-1 text-2xl font-display font-bold tracking-tight">Préparation</h1>
      <p className="mb-4 text-sm text-muted-foreground">Mise en place du service</p>

      {/* Progress */}
      <Card className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <ChefHat size={16} className="text-primary" />
            <span className="text-sm font-bold">Avancement</span>
          </div>
          <span className="text-sm font-bold text-primary">{done}/{total}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(done / total) * 100}%` }} />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Temps restant estimé : {tasks.filter(t => !t.done).reduce((s, t) => s + parseInt(t.time), 0)} min
        </p>
      </Card>

      <SectionTitle>Tâches de mise en place</SectionTitle>
      <div className="space-y-2">
        {tasks.map((t) => (
          <button key={t.id}
            onClick={() => setTasks(tasks.map(x => x.id === t.id ? { ...x, done: !x.done } : x))}
            className={`w-full flex items-center gap-3 rounded-xl border p-3 text-left transition ${
              t.done ? 'border-success/20 bg-success/5' : 'border-border bg-card'
            }`}>
            <div className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition ${
              t.done ? 'border-success bg-success text-success-foreground' : 'border-border'
            }`}>
              {t.done && <Check size={12} />}
            </div>
            <div className="flex-1">
              <p className={`text-sm font-semibold ${t.done ? 'line-through text-muted-foreground' : ''}`}>
                {t.task}
              </p>
              <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                <Clock size={9} /> {t.time}
              </p>
            </div>
            {!t.done && t.priority === 'high' && (
              <AlertTriangle size={13} className="text-warning shrink-0" />
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
