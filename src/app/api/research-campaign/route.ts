import { NextResponse } from 'next/server'
import { RunValidationError } from '@/lib/runner'
import { advanceResearchCampaign, buildCampaignPreview, controlResearchCampaign, createResearchCampaign, getResearchCampaign, reconcileResearchCampaign, restartResearchCampaign, updateCampaignActionBudget, type CampaignRunExecutor } from '@/lib/research-campaign-engine'
import { activeRunIds } from '@/lib/run-registry'

export function createResearchCampaignHandlers(dependencies: { runExecutor?: CampaignRunExecutor } = {}) {
  async function GET(req: Request) {
    const url = new URL(req.url)
    const projectId = url.searchParams.get('projectId') ?? ''
    const versionId = url.searchParams.get('versionId') ?? ''
    if (!projectId || !versionId) return NextResponse.json({ error: 'Укажите проект и версию.' }, { status: 400 })
    try {
      const [preview, state] = await Promise.all([buildCampaignPreview(projectId, versionId), getResearchCampaign(projectId, versionId)])
      return NextResponse.json({ preview, ...state })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return NextResponse.json({ error: message }, { status: error instanceof RunValidationError ? error.status : 500 })
    }
  }

  async function POST(req: Request) {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'Некорректный JSON.' }, { status: 400 })
    const projectId = typeof body.projectId === 'string' ? body.projectId : ''
    const versionId = typeof body.versionId === 'string' ? body.versionId : ''
    const action = typeof body.action === 'string' ? body.action : ''
    if (!projectId || !versionId) return NextResponse.json({ error: 'Укажите проект и версию.' }, { status: 400 })
    try {
      if (action === 'create') {
        const scope = body.scope && typeof body.scope === 'object' ? body.scope as Record<string, unknown> : {}
        const policy = body.policy && typeof body.policy === 'object' ? body.policy as Record<string, unknown> : {}
        const created = await createResearchCampaign({
          projectId, versionId,
          expectedHash: typeof body.expectedHash === 'string' ? body.expectedHash : '',
          idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined,
          scopeType: scope.type === 'version' || scope.type === 'sections' ? scope.type : 'positions',
          sectionPaths: Array.isArray(scope.sectionPaths) ? scope.sectionPaths.filter((value): value is string => typeof value === 'string') : [],
          positionIds: Array.isArray(scope.positionIds) ? scope.positionIds.filter((value): value is string => typeof value === 'string') : [],
          policy: {
            depth: (['interpretation', 'interactions', 'scenarios', 'full'].includes(String(policy.depth)) ? String(policy.depth) : 'full') as 'interpretation' | 'interactions' | 'scenarios' | 'full',
            maxScenariosPerPosition: Number(policy.maxScenariosPerPosition),
            maxModelActions: policy.maxModelActions === null ? null : Number(policy.maxModelActions),
            maxAdditionalChecksPerPosition: Number(policy.maxAdditionalChecksPerPosition),
            maxRetriesPerAction: Number(policy.maxRetriesPerAction),
            maxConcurrent: Number(policy.maxConcurrent),
            stopOnQuota: policy.stopOnQuota !== false,
            stopOnTechnicalError: policy.stopOnTechnicalError === true,
            allowRewriteExperiment: policy.allowRewriteExperiment === true,
          },
        })
        const state = await getResearchCampaign(projectId, versionId)
        const campaign = state.campaigns.find((row) => row.id === created.id)
        return NextResponse.json({ campaign }, { status: 201 })
      }
      const campaignId = typeof body.campaignId === 'string' ? body.campaignId : ''
      if (!campaignId) return NextResponse.json({ error: 'Укажите кампанию.' }, { status: 400 })
      if (action === 'advance') return NextResponse.json(await advanceResearchCampaign(projectId, versionId, campaignId, dependencies.runExecutor))
      if (action === 'start' || action === 'pause' || action === 'resume' || action === 'cancel') return NextResponse.json({ campaign: await controlResearchCampaign(projectId, versionId, campaignId, action) })
      if (action === 'restart') return NextResponse.json({ campaign: await restartResearchCampaign(projectId, versionId, campaignId) }, { status: 201 })
      if (action === 'reconcile') return NextResponse.json({ campaign: await reconcileResearchCampaign(projectId, versionId, campaignId, typeof body.basis === 'string' ? body.basis : '', new Set(activeRunIds())) })
      if (action === 'update-budget') {
        const value = body.maxModelActions === null ? null : typeof body.maxModelActions === 'number' ? body.maxModelActions : Number.NaN
        return NextResponse.json({ campaign: await updateCampaignActionBudget(projectId, versionId, campaignId, value) })
      }
      return NextResponse.json({ error: 'Неизвестное действие кампании.' }, { status: 400 })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return NextResponse.json({ error: message }, { status: error instanceof RunValidationError ? error.status : 500 })
    }
  }

  return { GET, POST }
}

const handlers = createResearchCampaignHandlers()
export const GET = handlers.GET
export const POST = handlers.POST
