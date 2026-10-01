import './supply-orders.css'

// Skeleton while the server page fetches the resto's supply orders (flux acheteur, Lot F).
export default function Loading() {
  return (
    <section className="mkt-orders" aria-busy="true">
      <span className="op-sk" style={{ width: 260, height: 26, marginBottom: 18, display: 'block' }} />
      <span className="op-sk" style={{ width: 320, height: 40, borderRadius: 999, marginBottom: 18, display: 'block' }} />
      <div className="op-card">
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[0, 1, 2, 3].map((i) => <span key={i} className="op-sk" style={{ width: '100%', height: 54 }} />)}
        </div>
      </div>
    </section>
  )
}
