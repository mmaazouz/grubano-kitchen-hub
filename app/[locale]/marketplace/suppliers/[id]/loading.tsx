import './supplier-catalog.css'

// Skeleton while the server page fetches the supplier + catalogue (flux acheteur, Lot D).
// Matches the CD --op- loading state; renders under the OperatorShell.
export default function Loading() {
  return (
    <section className="mkt-sd" aria-busy="true">
      <span className="op-sk" style={{ width: 120, height: 16, marginBottom: 14, display: 'block' }} />
      <span className="op-sk" style={{ width: '100%', height: 120, borderRadius: 12, marginBottom: 16, display: 'block' }} />
      <span className="op-sk" style={{ width: '100%', height: 44, borderRadius: 8, marginBottom: 16, display: 'block' }} />
      <div className="op-card">
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[0, 1, 2, 3].map((i) => <span key={i} className="op-sk" style={{ width: '100%', height: 52 }} />)}
        </div>
      </div>
    </section>
  )
}
