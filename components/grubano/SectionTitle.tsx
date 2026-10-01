export function SectionTitle({
  children,
  hint,
}: {
  children: React.ReactNode
  hint?: string
}) {
  return (
    <div className="mb-3 mt-5 flex items-center justify-between">
      <h2 className="text-sm font-bold">{children}</h2>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  )
}
