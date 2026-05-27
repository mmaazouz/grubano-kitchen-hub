import { NextResponse } from 'next/server'

const FRANCHISE_BRANDS = [
  {
    id:          'gnocchi-bar',
    name:        'Gnocchi Bar',
    cuisine:     'Italien',
    emoji:       '🥟',
    description: 'Gnocchi artisanaux, sauces maison. Concept fort, forte demande.',
    avgRevenue:  8200,
    setupCost:   2500,
    royaltyRate: 0.06,
    citiesAvail: ['Paris', 'Lyon', 'Marseille', 'Bordeaux'],
    available:   true,
  },
  {
    id:          'riz-gourmand',
    name:        'Riz Gourmand',
    cuisine:     'Asiatique',
    emoji:       '🍚',
    description: "Bols de riz généreux aux saveurs d'Asie. Simple, rapide, rentable.",
    avgRevenue:  7400,
    setupCost:   2000,
    royaltyRate: 0.05,
    citiesAvail: ['Paris', 'Lyon', 'Lille'],
    available:   true,
  },
  {
    id:          'pasta-fresca',
    name:        'Pasta Fresca',
    cuisine:     'Méditerranéen',
    emoji:       '🍝',
    description: 'Pâtes fraîches et salades généreuses. Adapté aux cuisines compactes.',
    avgRevenue:  6800,
    setupCost:   2000,
    royaltyRate: 0.05,
    citiesAvail: ['Paris', 'Nice', 'Montpellier'],
    available:   true,
  },
  {
    id:          'rollix',
    name:        'Rollix',
    cuisine:     'Fusion',
    emoji:       '🌯',
    description: "Rouleaux fusion premium. Zone exclusive — liste d'attente active.",
    avgRevenue:  9400,
    setupCost:   3000,
    royaltyRate: 0.07,
    citiesAvail: ['Paris'],
    available:   false,
  },
  {
    id:          'bowl-healthy',
    name:        'Bowl Healthy',
    cuisine:     'Wellness',
    emoji:       '🥗',
    description: 'Bols nutritifs, tendance santé. Croissance +40% en 2024.',
    avgRevenue:  7100,
    setupCost:   1800,
    royaltyRate: 0.05,
    citiesAvail: ['Paris', 'Lyon', 'Bordeaux', 'Nantes'],
    available:   true,
  },
]

export async function GET() {
  return NextResponse.json({ brands: FRANCHISE_BRANDS })
}
