import { handleCourierMissionStep } from '../step-handler'

export const dynamic = 'force-dynamic'

// ── POST /api/logistics/missions/[id]/pickup — the ASSIGNED courier marks the mission
// picked up (accepted→picked_up). Gated → 404 when OFF. Owner-scoped + atomic; an invalid
// step → 422, a status that moved underneath → 409. NO money. See step-handler for details.
export function POST(_req: Request, { params }: { params: { id: string } }) {
  return handleCourierMissionStep(params.id, 'picked_up')
}
