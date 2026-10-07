import { createReducer, on } from '@ngrx/store'
import type { Anomaly, AuditEntry, RawReading, TailingsDataset, Threshold, ThresholdTrial } from '../domain'
import { seedDataset } from '../data/seed'
import { buildChanges, buildTrial, mergePublishResults, readingsSnapshotId } from '../domain/threshold-trial'
import { TailingsActions } from './tailings.actions'

export interface PendingPublish {
  request: ReturnType<typeof buildPublishRequest>
  changes: ReturnType<typeof buildChanges>
  startedAt: string
  lastError: string
}

export interface TailingsState {
  dataset: TailingsDataset
  loading: boolean
  error: string
  selectedAnomalyId: string
  keyword: string
  status: Anomaly['status'] | '全部'
  /** 试算会话（候选阈值与依据快照），发布或放弃后清空 */
  trialSession: {
    batchId: string
    createdAt: string
    operator: string
    note: string
    draft: Threshold[]
    startSnapshotId: string
    startReadingVersion: number
  } | null
  /** 未全部生效的发布批次；重试只补未生效项 */
  pendingPublish: PendingPublish | null
  publishing: boolean
}

export function buildPublishRequest(trial: ThresholdTrial, changes: ReturnType<typeof buildChanges>, operator: string, note: string) {
  return {
    batchId: trial.batchId,
    candidateThresholds: trial.candidateThresholds,
    diffs: trial.diffs,
    snapshotId: trial.snapshotId,
    readingVersion: trial.readingVersion,
    operator,
    note
  }
}

export const initialTailingsState: TailingsState = {
  dataset: structuredClone(seedDataset),
  loading: false,
  error: '',
  selectedAnomalyId: seedDataset.anomalies[0]?.id ?? '',
  keyword: '',
  status: '全部',
  trialSession: null,
  pendingPublish: null,
  publishing: false
}

let idSeed = 50
const audit = (entityId: string, action: string, operator: string, detail: string): AuditEntry => ({
  id: `AUD-${Date.now()}-${idSeed++}`, entityId, action, operator, detail, createdAt: new Date().toISOString()
})

const newBatchId = (): string => `TRY-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${(idSeed++).toString(36).toUpperCase()}`

export const tailingsReducer = createReducer(
  initialTailingsState,
  on(TailingsActions.loadDataset, (state) => ({ ...state, loading: true, error: '' })),
  on(TailingsActions.loadDatasetSuccess, (state, { dataset }) => ({ ...state, dataset, loading: false, selectedAnomalyId: dataset.anomalies[0]?.id ?? '' })),
  on(TailingsActions.loadDatasetFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(TailingsActions.submitFieldReview, (state, { anomalyId, review }) => {
    const dataset = structuredClone(state.dataset)
    const anomaly = dataset.anomalies.find((item) => item.id === anomalyId)
    if (!anomaly || !review.observed || !review.evidence || !review.reassessment) return state
    anomaly.fieldReviews.unshift({ ...review, version: anomaly.fieldReviews.length + 1 })
    anomaly.status = '原因调查中'
    anomaly.version += 1
    dataset.audit.unshift(audit(anomalyId, '提交现场复核', review.inspector, review.reassessment))
    return { ...state, dataset }
  }),
  on(TailingsActions.addExpertOpinion, (state, { anomalyId, opinion }) => {
    const dataset = structuredClone(state.dataset)
    const anomaly = dataset.anomalies.find((item) => item.id === anomalyId)
    if (!anomaly || !opinion.content) return state
    anomaly.opinions.unshift(opinion)
    anomaly.version += 1
    dataset.audit.unshift(audit(anomalyId, '补充专业意见', opinion.specialist, `${opinion.conclusion}：${opinion.content}`))
    return { ...state, dataset }
  }),
  on(TailingsActions.saveDispositionPlan, (state, { anomalyId, plan }) => {
    const dataset = structuredClone(state.dataset)
    const anomaly = dataset.anomalies.find((item) => item.id === anomalyId)
    if (!anomaly || !plan.owner || !plan.deadline || !plan.conditions) return state
    anomaly.plan = { ...plan, approvedBy: '', approvedAt: '' }
    anomaly.status = '待负责人审批'
    anomaly.version += 1
    dataset.audit.unshift(audit(anomalyId, '提交处置方案', '当前用户', `${plan.action}，责任方${plan.owner}`))
    return { ...state, dataset }
  }),
  on(TailingsActions.approvePlan, (state, { anomalyId, approver, note }) => {
    const dataset = structuredClone(state.dataset)
    const anomaly = dataset.anomalies.find((item) => item.id === anomalyId)
    if (!anomaly) return state
    if (anomaly.severity === '重大' && !anomaly.plan.emergencyLinked) return state
    anomaly.plan.approvedBy = approver
    anomaly.plan.approvedAt = new Date().toISOString()
    anomaly.version += 1
    dataset.audit.unshift(audit(anomalyId, '审批处置方案', approver, note || '同意执行'))
    return { ...state, dataset }
  }),
  on(TailingsActions.closeAnomaly, (state, { anomalyId, note }) => {
    const dataset = structuredClone(state.dataset)
    const anomaly = dataset.anomalies.find((item) => item.id === anomalyId)
    if (!anomaly || !anomaly.plan.approvedBy || !anomaly.fieldReviews.length || !note.trim()) return state
    anomaly.status = '已关闭'
    anomaly.closedAt = new Date().toISOString()
    anomaly.version += 1
    dataset.audit.unshift(audit(anomalyId, '关闭异常', anomaly.plan.approvedBy, note))
    return { ...state, dataset }
  }),
  on(TailingsActions.createEmergencyLink, (state, { anomalyId, note }) => {
    const dataset = structuredClone(state.dataset)
    const anomaly = dataset.anomalies.find((item) => item.id === anomalyId)
    if (!anomaly) return state
    anomaly.plan.emergencyLinked = true
    anomaly.status = '应急联动'
    anomaly.version += 1
    dataset.audit.unshift(audit(anomalyId, '启动应急联动', '值班负责人', note))
    return { ...state, dataset }
  }),
  on(TailingsActions.selectAnomaly, (state, { anomalyId }) => ({ ...state, selectedAnomalyId: anomalyId })),
  on(TailingsActions.updateKeyword, (state, { keyword }) => ({ ...state, keyword })),
  on(TailingsActions.updateStatus, (state, { status }) => ({ ...state, status: status as TailingsState['status'] })),
  on(TailingsActions.addAudit, (state, { entry }) => ({ ...state, dataset: { ...state.dataset, audit: [entry, ...state.dataset.audit] } })),

  on(TailingsActions.startThresholdTrial, (state, { operator, note }) => {
    // 有未全部生效的批次时禁止新建试算，必须先重试补齐
    if (state.pendingPublish) return state
    const now = new Date().toISOString()
    return {
      ...state,
      trialSession: {
        batchId: newBatchId(),
        createdAt: now,
        operator,
        note,
        draft: structuredClone(state.dataset.thresholds),
        startSnapshotId: readingsSnapshotId(state.dataset),
        startReadingVersion: state.dataset.readingVersion
      }
    }
  }),
  on(TailingsActions.editDraftThreshold, (state, { thresholdId, patch }) => {
    if (!state.trialSession) return state
    const draft = state.trialSession.draft.map((item) => (item.id === thresholdId ? { ...item, ...patch } : item))
    return { ...state, trialSession: { ...state.trialSession, draft } }
  }),
  on(TailingsActions.ingestReadings, (state, { readings }) => {
    if (!readings.length) return state
    const dataset: TailingsDataset = structuredClone(state.dataset)
    const accepted: RawReading[] = []
    for (const reading of readings) {
      if (dataset.readings.some((item) => item.id === reading.id)) continue
      dataset.readings.push(reading)
      accepted.push(reading)
    }
    if (!accepted.length) return state
    dataset.readingVersion += 1
    // 同步测点当前值，但状态不改：是否预警/异常由阈值引擎在发布时判定
    for (const reading of accepted) {
      const point = dataset.points.find((item) => item.id === reading.pointId)
      if (point && reading.quality === '有效') point.currentValue = reading.value
    }
    dataset.audit.unshift(audit('原始读数', '接入原始读数', '采集网关', `读数版本升至R${dataset.readingVersion}，接入${accepted.map((item) => item.id).join('、')}；阈值试算按最新快照重算`))
    return { ...state, dataset }
  }),
  on(TailingsActions.publishThresholdTrial, (state, { batchId }) => {
    if (state.publishing) return state
    if (state.pendingPublish) return state
    if (!state.trialSession || state.trialSession.batchId !== batchId) return state
    const trial = buildTrial(state.dataset, state.trialSession)
    const changes = buildChanges(trial)
    const request = buildPublishRequest(trial, changes, state.trialSession.operator, state.trialSession.note)
    return {
      ...state,
      publishing: true,
      pendingPublish: { request, changes, startedAt: new Date().toISOString(), lastError: '' }
    }
  }),
  on(TailingsActions.retryThresholdPublish, (state) => {
    if (state.publishing || !state.pendingPublish) return state
    return { ...state, publishing: true }
  }),
  on(TailingsActions.publishThresholdItemsSuccess, (state, { request, changes, results }) => {
    const pending = state.pendingPublish
    if (!pending || pending.request.batchId !== request.batchId) return state
    // 成功项落库、失败项原数据保留；全部生效才结束批次
    const { dataset, changes: mergedChanges, finalized } = mergePublishResults(state.dataset, request, changes, results, new Date().toISOString())
    if (finalized) {
      return { ...state, dataset, publishing: false, pendingPublish: null, trialSession: null }
    }
    return {
      ...state,
      dataset,
      publishing: false,
      pendingPublish: {
        ...pending,
        changes: mergedChanges,
        lastError: mergedChanges.filter((item) => item.status === '失败').map((item) => `${item.key}：${item.error}`).join('；')
      }
    }
  }),
  on(TailingsActions.publishThresholdFailure, (state, { batchId, error }) => {
    if (!state.pendingPublish || state.pendingPublish.request.batchId !== batchId) return state
    return { ...state, publishing: false, pendingPublish: { ...state.pendingPublish, lastError: error } }
  }),
  on(TailingsActions.abandonThresholdTrial, (state) => {
    // 已部分写入的批次不能放弃，避免页面与数据跨批次
    if (state.pendingPublish) return state
    return { ...state, trialSession: null }
  }),
  on(TailingsActions.resetDemo, () => ({ ...initialTailingsState, dataset: structuredClone(seedDataset), selectedAnomalyId: seedDataset.anomalies[0].id }))
)
