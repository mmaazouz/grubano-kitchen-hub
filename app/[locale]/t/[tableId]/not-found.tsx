import { SearchX } from 'lucide-react'

// Sober 404 for an unknown / inactive table QR.
export default function TableNotFound() {
  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center bg-background px-6 text-center text-foreground">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-muted text-muted-foreground">
        <SearchX size={22} />
      </span>
      <p className="mt-4 text-lg font-semibold">Table introuvable</p>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground">
        Ce QR ne correspond à aucune table active. Demandez au personnel.
      </p>
      <p className="mt-10 text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
        Grubano
      </p>
    </main>
  )
}
