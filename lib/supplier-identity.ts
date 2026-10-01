import type { SupplierIdentity } from '@/components/supplier/SupplierShell'

// Shared builder for the SupplierShell topbar identity (used by every /supplier/*
// page from B2 onward). Pure — no DB, no money. `acceptingOrders` is derived from
// the real profile status (honest; there is no persisted accepting-orders flag).

function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '—'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

export function buildSupplierIdentity(p: {
  companyName: string
  contactName: string | null
  status: string
}): SupplierIdentity {
  return {
    companyName:     p.companyName,
    companyInitials: initials(p.companyName),
    profileName:     (p.contactName ?? '').split(/\s+/)[0] || p.companyName,
    profileInitials: initials(p.contactName ?? p.companyName),
    acceptingOrders: p.status === 'active',
  }
}
