import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { listProcesses } from '@/lib/process-center'
import { controlResearchCampaign, reconcileResearchCampaign, restartResearchCampaign } from '@/lib/research-campaign-engine'
import { RunValidationError } from '@/lib/runner'
import { activeRunIds, cancelRun } from '@/lib/run-registry'
import { activeModelOperationIds, cancelModelOperation } from '@/lib/model-operation-registry'
import { abortContourOperation, contourOperationIsActive, getContourState, saveContourState, type ContourState } from '@/lib/contour-operations'
import { safeParse } from '@/lib/serialize'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId')
  const allProjects = url.searchParams.get('allProjects') === '1'
  try {
    const processes = await listProcesses({ projectId, allProjects })
    return NextResponse.json({ processes, generatedAt: new Date().toISOString(), scope: allProjects ? 'all-projects' : 'current-project' })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Некорректный JSON.' }, { status: 400 })
  const projectId = typeof body.projectId === 'string' ? body.projectId : ''
  const id = typeof body.id === 'string' ? body.id : ''
  const type = typeof body.type === 'string' ? body.type : ''
  const action = typeof body.action === 'string' ? body.action : ''
  const basis = typeof body.basis === 'string' ? body.basis.trim() : ''
  if (!projectId || !id || !type || !action) return NextResponse.json({ error: 'Нужны projectId, type, id и action.' }, { status: 400 })
  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true } })
  if (!project) return NextResponse.json({ error: 'Проект не найден.' }, { status: 404 })
  try {
    if (type === 'campaign') {
      const campaign = await db.researchCampaign.findFirst({ where: { id, projectId }, select: { id: true, versionId: true, status: true } })
      if (!campaign) return NextResponse.json({ error: 'Кампания не принадлежит выбранному проекту.' }, { status: 404 })
      if (action === 'pause' || action === 'stop') return NextResponse.json({ campaign: await controlResearchCampaign(projectId, campaign.versionId, id, action === 'pause' ? 'pause' : 'cancel'), localStop: 'Запрос обработан владельцем кампании. Внешнее вычисление провайдера не подтверждается.' })
      if (action === 'continue') {
        if (campaign.status === 'running') return NextResponse.json({ campaign, driveRequired: true })
        const command = campaign.status === 'prepared' ? 'start' : 'resume'
        return NextResponse.json({ campaign: await controlResearchCampaign(projectId, campaign.versionId, id, command), driveRequired: true })
      }
      if (action === 'restart') return NextResponse.json({ campaign: await restartResearchCampaign(projectId, campaign.versionId, id) }, { status: 201 })
      if (action === 'reconcile') return NextResponse.json({ campaign: await reconcileResearchCampaign(projectId, campaign.versionId, id, basis, new Set(activeRunIds())) })
      return NextResponse.json({ error: 'Это действие не поддерживается для кампании.' }, { status: 400 })
    }

    if (type === 'run') {
      const run = await db.run.findFirst({ where: { id, projectId } })
      if (!run) return NextResponse.json({ error: 'Run не принадлежит выбранному проекту.' }, { status: 404 })
      if (run.campaignActionId) return NextResponse.json({ error: 'Этот Run управляется родительской кампанией. Откройте кампанию для остановки или сверки.' }, { status: 409 })
      if (action === 'stop') {
        if (run.status !== 'running') return NextResponse.json({ error: 'Run уже не выполняется.' }, { status: 409 })
        if (!activeRunIds().includes(id)) return NextResponse.json({ error: 'Активный локальный исполнитель не найден. Используйте явную сверку; запрос к провайдеру нельзя считать остановленным.' }, { status: 409 })
        cancelRun(id)
        const updated = await db.run.updateMany({ where: { id, projectId, status: 'running' }, data: { status: 'cancelled', error: null, finishedAt: new Date() } })
        if (!updated.count) return NextResponse.json({ error: 'Статус Run изменился во время остановки.' }, { status: 409 })
        return NextResponse.json({ status: 'cancelled', localStop: 'S2 прервал локальное соединение; завершение удалённого вычисления у провайдера неизвестно.' })
      }
      if (action === 'reconcile') {
        if (run.status !== 'running') return NextResponse.json({ error: 'Сверка доступна только для Run со статусом running.' }, { status: 409 })
        if (activeRunIds().includes(id)) return NextResponse.json({ error: 'Обнаружен живой локальный исполнитель. Сначала отправьте штатный запрос остановки.' }, { status: 409 })
        if (basis.length < 8) return NextResponse.json({ error: 'Укажите основание сверки (не менее 8 символов).' }, { status: 400 })
        const input = safeParse<Record<string, unknown>>(run.input, {})
        const history = Array.isArray(input.processControlHistory) ? input.processControlHistory : []
        const processControlHistory = [...history, { at: new Date().toISOString(), action: 'force-close-after-reconciliation', basis, result: 'local-owner-not-found; provider-result-unknown' }]
        const updated = await db.run.updateMany({ where: { id, projectId, status: 'running' }, data: { status: 'failed', error: `Закрыт после сверки: ${basis}. Внешний результат неизвестен.`, finishedAt: new Date(), input: JSON.stringify({ ...input, processControlHistory }) } })
        if (!updated.count) return NextResponse.json({ error: 'Статус Run изменился во время сверки.' }, { status: 409 })
        return NextResponse.json({ status: 'failed', verdict: 'unknown', historyRecorded: true })
      }
      return NextResponse.json({ error: 'Для отдельного Run поддержаны только остановка и явная сверка.' }, { status: 400 })
    }

    if (type === 'model-call') {
      const call = await db.modelCall.findFirst({ where: { id, projectId } })
      if (!call || call.runId) return NextResponse.json({ error: 'Независимый ModelCall не найден в выбранном проекте.' }, { status: 404 })
      if (action === 'stop') {
        if (call.status !== 'running' || !cancelModelOperation(id)) return NextResponse.json({ error: 'Живой локальный вызов не найден. Нужна сверка; статус не был изменён.' }, { status: 409 })
        return NextResponse.json({ status: 'stop-requested', localStop: 'S2 отправил abort текущему локальному соединению. Ответ и удалённое вычисление могут оставаться неизвестными до завершения запроса.' })
      }
      if (action === 'reconcile') {
        if (call.status !== 'running' || activeModelOperationIds().includes(id)) return NextResponse.json({ error: 'Сверка возможна только для running ModelCall без живого локального владельца.' }, { status: 409 })
        if (basis.length < 8) return NextResponse.json({ error: 'Укажите основание сверки (не менее 8 символов).' }, { status: 400 })
        const metadata = safeParse<Record<string, unknown>>(call.contextMetadata, {})
        const history = Array.isArray(metadata.processControlHistory) ? metadata.processControlHistory : []
        const changed = await db.modelCall.updateMany({ where: { id, projectId, status: 'running' }, data: { status: 'failed', contextMetadata: JSON.stringify({ ...metadata, processControlHistory: [...history, { at: new Date().toISOString(), action: 'force-close-after-reconciliation', basis, result: 'local-owner-not-found; provider-result-unknown' }] }) } })
        if (!changed.count) return NextResponse.json({ error: 'Состояние ModelCall изменилось во время сверки.' }, { status: 409 })
        return NextResponse.json({ status: 'failed', verdict: 'unknown', historyRecorded: true })
      }
      return NextResponse.json({ error: 'Для ModelCall поддержаны только остановка и явная сверка.' }, { status: 400 })
    }

    if (type === 'contour') {
      const analysis = await db.analysis.findFirst({ where: { id, projectId, type: 'functional-semantic-contour' } })
      if (!analysis) return NextResponse.json({ error: 'Contour операция не принадлежит выбранному проекту.' }, { status: 404 })
      const version = await db.documentVersion.findFirst({ where: { id: analysis.versionId, projectId }, select: { id: true } })
      if (!version) return NextResponse.json({ error: 'Версия contour недоступна.' }, { status: 404 })
      const found = await getContourState(projectId, version.id)
      if (!found || found.analysis.id !== id || !found.state) return NextResponse.json({ error: 'Состояние contour повреждено или недоступно; автоматическое закрытие запрещено.' }, { status: 409 })
      const state = found.state as ContourState
      if (action === 'stop') {
        if (state.status !== 'running' || !contourOperationIsActive(id)) return NextResponse.json({ error: 'Активный локальный шаг contour не найден. Нужна явная сверка, а не остановка ожидающей записи.' }, { status: 409 })
        abortContourOperation(id)
        const runningBlock = state.blocks.find((block) => block.status === 'running')
        if (runningBlock) runningBlock.status = 'interrupted'
        state.status = 'cancelled'
        state.diagnostics.processControlHistory = [...(Array.isArray(state.diagnostics.processControlHistory) ? state.diagnostics.processControlHistory as unknown[] : []), { at: new Date().toISOString(), action: 'stop-requested', result: 'local-request-aborted; provider-result-unknown' }]
        await saveContourState(id, state, 'Пользователь остановил contour. Внешнее вычисление не подтверждено.')
        return NextResponse.json({ status: 'stopped', localStop: 'S2 прервал локальный запрос; внешнее вычисление не подтверждено.' })
      }
      if (action === 'reconcile') {
        if (contourOperationIsActive(id)) return NextResponse.json({ error: 'Contour шаг всё ещё выполняется в локальном процессе.' }, { status: 409 })
        if (basis.length < 8) return NextResponse.json({ error: 'Укажите основание сверки (не менее 8 символов).' }, { status: 400 })
        const runningBlock = state.blocks.find((block) => block.status === 'running')
        if (runningBlock) { runningBlock.status = 'interrupted'; runningBlock.error = 'Закрыт после явной сверки; результат внешнего вызова неизвестен.' }
        state.status = 'failed'
        state.diagnostics.lastError = 'Незавершённый шаг закрыт после явной сверки; процесс не отмечен как completed.'
        state.diagnostics.processControlHistory = [...(Array.isArray(state.diagnostics.processControlHistory) ? state.diagnostics.processControlHistory as unknown[] : []), { at: new Date().toISOString(), action: 'force-close-after-reconciliation', basis, result: 'incomplete; provider-result-unknown' }]
        await saveContourState(id, state)
        return NextResponse.json({ status: 'failed', verdict: 'unknown', historyRecorded: true })
      }
    }
    return NextResponse.json({ error: 'Тип процесса или действие не поддерживаются.' }, { status: 400 })
  } catch (error) {
    const status = error instanceof RunValidationError ? error.status : 500
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status })
  }
}
