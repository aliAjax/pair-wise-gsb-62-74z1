import { createReducer, on } from '@ngrx/store'
import type { Anomaly, AuditEntry, MonitoringType, PointStatus, TailingsDataset, Threshold, TrialBatch, TrialCandidate, TrialChange } from '../domain'
import { seedDataset } from '../data/seed'
import { TailingsActions } from './tailings.actions'

export interface TailingsState {
  dataset: TailingsDataset
  trialBatches: TrialBatch[]
  loading: boolean
  error: string
  selectedAnomalyId: string
  keyword: string
  status: Anomaly['status'] | '全部'
}

export const initialTailingsState: TailingsState = {
  dataset: structuredClone(seedDataset),
  trialBatches: [],
  loading: false,
  error: '',
  selectedAnomalyId: seedDataset.anomalies[0]?.id ?? '',
  keyword: '',
  status: '全部'
}

let idSeed = 50
const audit = (entityId: string, action: string, operator: string, detail: string): AuditEntry => ({
  id: `AUD-${Date.now()}-${idSeed++}`, entityId, action, operator, detail, createdAt: new Date().toISOString()
})

const statusRank: Record<PointStatus, number> = { 正常: 0, 预警: 1, 异常: 2 }
const evaluateStatus = (value: number, threshold: { warning: number; alarm: number }): PointStatus =>
  value >= threshold.alarm ? '异常' : value >= threshold.warning ? '预警' : '正常'
const severityOf = (status: PointStatus): Anomaly['severity'] => (status === '异常' ? '重大' : '关注')
const diffOf = (current: PointStatus, candidate: PointStatus): TrialChange => {
  const delta = statusRank[candidate] - statusRank[current]
  if (delta === 0) return '维持'
  if (delta > 0) return current === '正常' ? '新增' : '升级'
  return candidate === '正常' ? '消失' : '降级'
}

const digestReadings = (dataset: TailingsDataset, type: MonitoringType): string => {
  const pointIds = new Set(dataset.points.filter((point) => point.type === type).map((point) => point.id))
  const relevant = dataset.readings.filter((reading) => pointIds.has(reading.pointId))
  const latest = relevant.map((reading) => reading.capturedAt).sort().at(-1) ?? ''
  return `${relevant.length}@${latest}`
}

const buildBatch = (dataset: TailingsDataset, threshold: Threshold, proposal: TrialBatch['proposal'], operator: string, replacesId = ''): TrialBatch => {
  const now = new Date().toISOString()
  const points = dataset.points.filter((point) => point.type === threshold.type)
  const candidates: TrialCandidate[] = points.map((point) => {
    const reading = dataset.readings
      .filter((item) => item.pointId === point.id && item.quality !== '无效')
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0]
    const value = reading ? reading.value : point.currentValue
    const candidateStatus = evaluateStatus(value, proposal)
    return {
      pointId: point.id,
      pointName: point.name,
      currentStatus: point.status,
      candidateStatus,
      change: diffOf(point.status, candidateStatus),
      readingId: reading?.id ?? '',
      readingValue: `${value} ${point.unit}`,
      basis: reading
        ? `${reading.id} 读数 ${value} ${point.unit}，对照预警${proposal.warning}/报警${proposal.alarm} ${point.unit}`
        : `无有效读数，沿用当前值 ${value} ${point.unit}`,
      applied: false
    }
  })
  const closedNotes = dataset.anomalies
    .filter((anomaly) => anomaly.status === '已关闭' && points.some((point) => point.id === anomaly.pointId))
    .map((anomaly) => {
      const point = points.find((item) => item.id === anomaly.pointId)
      const reassessed = point ? evaluateStatus(point.currentValue, proposal) : '正常'
      return {
        anomalyId: anomaly.id,
        title: anomaly.title,
        closedAt: anomaly.closedAt,
        basis: anomaly.observedValue,
        note: `当时依据保留，不随批次改写；当前值按新阈值评估为${reassessed}`
      }
    })
  return {
    id: `TB-${now.slice(0, 10).replaceAll('-', '')}-${String(idSeed++).padStart(3, '0')}`,
    thresholdId: threshold.id,
    type: threshold.type,
    fromVersion: threshold.version,
    toVersion: threshold.version + 1,
    proposal,
    snapshotAt: now,
    readingDigest: digestReadings(dataset, threshold.type),
    candidates,
    closedNotes,
    status: '待确认',
    note: '',
    operator,
    createdAt: now,
    publishedAt: '',
    replacesId
  }
}

const applyCandidate = (dataset: TailingsDataset, batch: TrialBatch, candidate: TrialCandidate, now: string): void => {
  const point = dataset.points.find((item) => item.id === candidate.pointId)
  if (!point) return
  point.status = candidate.candidateStatus
  const open = dataset.anomalies.filter((anomaly) => anomaly.pointId === candidate.pointId && anomaly.status !== '已关闭')
  if (candidate.change === '新增') {
    const anomaly: Anomaly = {
      id: `AN-${now.slice(2, 10).replaceAll('-', '')}-${String(idSeed++).padStart(2, '0')}`,
      pointId: candidate.pointId,
      title: `${candidate.pointName}命中新阈值${candidate.candidateStatus}`,
      severity: severityOf(candidate.candidateStatus),
      status: '待现场复核',
      openedAt: now,
      owner: '值班室',
      triggerReadingId: candidate.readingId,
      observedValue: `${candidate.readingValue}（批次${batch.id}试算命中）`,
      fieldReviews: [],
      opinions: [],
      plan: { id: `PL-${idSeed++}`, action: '加密监测', owner: '', deadline: '', conditions: '', emergencyLinked: false, approvedBy: '', approvedAt: '' },
      closedAt: '',
      version: 1
    }
    dataset.anomalies.unshift(anomaly)
    dataset.audit.unshift(audit(anomaly.id, '生成异常', '阈值引擎', `批次${batch.id}：${candidate.basis}`))
  }
  if (candidate.change === '消失') {
    open.forEach((anomaly) => {
      anomaly.status = '已关闭'
      anomaly.closedAt = now
      anomaly.version += 1
      dataset.audit.unshift(audit(anomaly.id, '批次切换关闭', '阈值引擎', `批次${batch.id}：新阈值下触发条件消失，历史复核、审批与审计记录保留`))
    })
  }
  if (candidate.change === '升级' || candidate.change === '降级') {
    open.forEach((anomaly) => {
      anomaly.severity = severityOf(candidate.candidateStatus)
      anomaly.version += 1
      dataset.audit.unshift(audit(anomaly.id, '批次切换调整级别', '阈值引擎', `批次${batch.id}：${candidate.currentStatus}→${candidate.candidateStatus}`))
    })
  }
  dataset.audit.unshift(audit(candidate.pointId, '试算结果生效', batch.operator, `批次${batch.id}：${candidate.currentStatus}→${candidate.candidateStatus}（${candidate.readingValue}）`))
}

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
  on(TailingsActions.proposeTrial, (state, { thresholdId, warning, alarm, changeRate, operator }) => {
    const threshold = state.dataset.thresholds.find((item) => item.id === thresholdId)
    if (!threshold || !(alarm > warning) || changeRate <= 0) return state
    const batch = buildBatch(state.dataset, threshold, { warning, alarm, changeRate }, operator)
    const trialBatches = [
      batch,
      ...state.trialBatches.map((item) =>
        item.status === '待确认' && item.thresholdId === thresholdId
          ? { ...item, status: '已失效' as const, note: `再次改版，旧候选失效，已按最新快照重算为批次${batch.id}` }
          : item
      )
    ]
    return { ...state, trialBatches }
  }),
  on(TailingsActions.confirmTrial, (state, { batchId, simulateFailure }) => {
    const batch = state.trialBatches.find((item) => item.id === batchId)
    if (!batch || batch.status !== '待确认') return state
    if (digestReadings(state.dataset, batch.type) !== batch.readingDigest) {
      const trialBatches = state.trialBatches.map((item) =>
        item.id === batchId ? { ...item, status: '已失效' as const, note: '确认时读数快照已变化，候选失效，请按最新快照重新试算' } : item
      )
      return { ...state, trialBatches }
    }
    const dataset = structuredClone(state.dataset)
    const threshold = dataset.thresholds.find((item) => item.id === batch.thresholdId)
    if (!threshold) return state
    const now = new Date().toISOString()
    threshold.warning = batch.proposal.warning
    threshold.alarm = batch.proposal.alarm
    threshold.changeRate = batch.proposal.changeRate
    threshold.version = batch.toVersion
    dataset.audit.unshift(audit(threshold.id, '切换阈值版本', batch.operator, `批次${batch.id}：V${batch.fromVersion}→V${batch.toVersion}，预警${batch.proposal.warning}、报警${batch.proposal.alarm}、变化率${batch.proposal.changeRate}`))
    let failBudget = simulateFailure ? Math.max(1, Math.ceil(batch.candidates.filter((item) => item.change !== '维持').length / 2)) : 0
    const candidates = batch.candidates.map((candidate) => {
      if (candidate.applied || candidate.change === '维持') return { ...candidate, applied: true }
      if (failBudget > 0) {
        failBudget -= 1
        return candidate
      }
      applyCandidate(dataset, batch, candidate, now)
      return { ...candidate, applied: true }
    })
    const pending = candidates.filter((item) => !item.applied).length
    if (pending) dataset.audit.unshift(audit(batch.thresholdId, '批次写入失败', '系统', `批次${batch.id}：${pending}项未生效，原数据保留，可重试补写`))
    const trialBatches = state.trialBatches.map((item) =>
      item.id === batchId ? { ...batch, candidates, status: (pending ? '部分失败' : '已发布') as TrialBatch['status'], publishedAt: now } : item
    )
    return { ...state, dataset, trialBatches }
  }),
  on(TailingsActions.retryTrial, (state, { batchId }) => {
    const batch = state.trialBatches.find((item) => item.id === batchId)
    if (!batch || batch.status !== '部分失败') return state
    const dataset = structuredClone(state.dataset)
    const now = new Date().toISOString()
    let filled = 0
    let skipped = 0
    const candidates = batch.candidates.map((candidate) => {
      if (candidate.applied) {
        skipped += 1
        return candidate
      }
      applyCandidate(dataset, batch, candidate, now)
      filled += 1
      return { ...candidate, applied: true }
    })
    dataset.audit.unshift(audit(batch.thresholdId, '重试试算批次', batch.operator, `批次${batch.id}：补写${filled}项，跳过已生效${skipped}项`))
    const trialBatches = state.trialBatches.map((item) => (item.id === batchId ? { ...batch, candidates, status: '已发布' as const } : item))
    return { ...state, dataset, trialBatches }
  }),
  on(TailingsActions.addReading, (state, { reading }) => {
    const dataset = structuredClone(state.dataset)
    const point = dataset.points.find((item) => item.id === reading.pointId)
    if (!point) return state
    dataset.readings.unshift(reading)
    point.currentValue = reading.value
    point.lastInspectionAt = reading.capturedAt
    const threshold = dataset.thresholds.find((item) => item.id === point.thresholdId)
    if (threshold && reading.quality !== '无效') point.status = evaluateStatus(reading.value, threshold)
    dataset.audit.unshift(audit(point.id, '接收原始读数', reading.deviceId, `${reading.value} ${reading.unit}（${reading.quality}）`))
    let trialBatches = state.trialBatches
    const active = state.trialBatches.find((item) => item.status === '待确认' && item.thresholdId === point.thresholdId)
    if (active && threshold && digestReadings(dataset, threshold.type) !== active.readingDigest) {
      const recomputed = buildBatch(dataset, threshold, active.proposal, active.operator, active.id)
      trialBatches = [
        recomputed,
        ...state.trialBatches.map((item) =>
          item.id === active.id ? { ...item, status: '已失效' as const, note: `试算期间接收到新读数${reading.id}，候选已按最新快照重算为批次${recomputed.id}` } : item
        )
      ]
      dataset.audit.unshift(audit(active.thresholdId, '试算批次重算', '系统', `批次${active.id}失效，按最新快照重算为批次${recomputed.id}`))
    }
    return { ...state, dataset, trialBatches }
  }),
  on(TailingsActions.selectAnomaly, (state, { anomalyId }) => ({ ...state, selectedAnomalyId: anomalyId })),
  on(TailingsActions.updateKeyword, (state, { keyword }) => ({ ...state, keyword })),
  on(TailingsActions.updateStatus, (state, { status }) => ({ ...state, status: status as TailingsState['status'] })),
  on(TailingsActions.addAudit, (state, { entry }) => ({ ...state, dataset: { ...state.dataset, audit: [entry, ...state.dataset.audit] } })),
  on(TailingsActions.resetDemo, () => ({ ...initialTailingsState, dataset: structuredClone(seedDataset), trialBatches: [], selectedAnomalyId: seedDataset.anomalies[0].id }))
)
