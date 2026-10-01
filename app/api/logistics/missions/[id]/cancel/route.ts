import { handleCourierMissionStep } from '../step-handler'

export const dynamic = 'force-dynamic'

// ── POST /api/logistics/missions/[id]/cancel — the ASSIGNED courier drops out of a mission
// they took (accepted|picked_up→cancelled). NEUTRAL terminal: no penalty/score is EVER stored
// (courier autonomy, doc §8). Gated → 404 when OFF. Owner-scoped + atomic; an invalid step →
// 422, a status that moved underneath → 409. NO money. See step-handler for details.
export function POST(_req: Request, { params }: { params: { id: string } }) {
  return handleCourierMissionStep(params.id, 'cancelled')
}
