import './panier.css'

// Skeleton while the server page fetches the supplier + catalogue (flux acheteur, Lot E).
export default function Loading() {
  return (
    <section className="mkt-cart" aria-busy="true">
      <span className="op-sk" style={{ width: 120, height: 16, marginBottom: 14, display: 'block' }} />
      <span className="op-sk" style={{ width: 240, height: 26, marginBottom: 18, display: 'block' }} />
      <div className="cart-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <span className="op-sk" style={{ width: '100%', height: 76, borderRadius: 12, display: 'block' }} />
          <span className="op-sk" style={{ width: '100%', height: 240, borderRadius: 12, display: 'block' }} />
        </div>
        <span className="op-sk" style={{ width: '100%', height: 300, borderRadius: 12, display: 'block' }} />
      </div>
    </section>
  )
}
