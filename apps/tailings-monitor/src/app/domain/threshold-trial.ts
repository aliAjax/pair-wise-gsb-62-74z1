import type {
  Anomaly,
  AnomalyStatus,
  AppliedChange,
  DiffKind,
  MonitoringPoint,
  RawReading,
  TailingsDataset,
  Threshold,
  ThresholdDiff,
  ThresholdPublishRequest,
  ThresholdRelease,
  ThresholdTrial,
  TrialLevel
} from '../domain'

export interface LevelResult {
  level: TrialLevel
  basis: string
  readingId: string
  readingValue: number
  capturedAt: string
  rateText: string
}

const severityOf = (level: TrialLevel): Anomaly['severity'] => (level === '异常' ? '重大' : '较高')

/** 单测点在给定阈值集下，依据最新有效原始读数分级；原始读数只读，不参与任何修改 */
export function classifyPoint(point: MonitoringPoint, readings: RawReading[], threshold: Threshold | undefined): LevelResult {
  const none: LevelResult = { level: '正常', basis: '无有效读数或阈值未启用', readingId: '', readingValue: 0, capturedAt: '', rateText: '' }
  const valid = readings
    .filter((reading) => reading.pointId === point.id && reading.quality === '有效')
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
  // 无显式原始读数时，回退到测点当前值（即最近一期采集值的测点镜像）
  const series: RawReading[] = valid.length
    ? valid
    : [{ id: `CUR-${point.id}`, pointId: point.id, value: point.currentValue, unit: point.unit, capturedAt: point.lastInspectionAt, deviceId: '当前值', quality: '有效' as const }]
  const latest = series[0]
  if (!threshold || !threshold.enabled) return none

  const value = latest.value
  const valueHit: TrialLevel = value >= threshold.alarm ? '异常' : value >= threshold.warning ? '预警' : '正常'

  // 原始读数为整点快照：直接取相邻两期有效读数的变化量与变化率阈值比较
  const previous = series[1]
  const delta = previous ? latest.value - previous.value : null
  const rateHit = delta !== null && Math.abs(delta) >= threshold.changeRate
  const rateText = delta === null
    ? '单点读数，无变化率'
    : `相邻读数变化${delta >= 0 ? '+' : ''}${delta.toFixed(2)}${latest.unit}，速率阈值${threshold.changeRate}${threshold.unit}`

  const reasons: string[] = []
  if (value >= threshold.alarm) reasons.push(`读数${value}${latest.unit}≥报警值${threshold.alarm}`)
  else if (value >= threshold.warning) reasons.push(`读数${value}${latest.unit}≥预警值${threshold.warning}`)
  if (rateHit) reasons.push(rateText)
  if (reasons.length === 0) reasons.push(`读数${value}${latest.unit}低于预警值${threshold.warning}`)

  const level: TrialLevel = valueHit === '异常' || (valueHit === '预警' && rateHit) ? '异常' : valueHit === '预警' || rateHit ? '预警' : '正常'
  return {
    level,
    basis: `${reasons.join('；')}（阈值V${threshold.version}）`,
    readingId: latest.id,
    readingValue: value,
    capturedAt: latest.capturedAt,
    rateText
  }
}

const diffOf = (current: TrialLevel, candidate: TrialLevel): DiffKind => {
  const rank: Record<TrialLevel, number> = { 正常: 0, 预警: 1, 异常: 2 }
  if (rank[candidate] === 0 && rank[current] > 0) return '消失'
  if (rank[current] === 0 && rank[candidate] > 0) return '新增'
  if (rank[candidate] > rank[current]) return '升级'
  if (rank[candidate] < rank[current]) return '降级'
  return '保留'
}

/** 按候选阈值与原始读数对每个测点试算，输出现行/候选差异；已关闭异常保留当时依据并列入差异 */
export function computeDiffs(dataset: TailingsDataset, candidateThresholds: Threshold[]): ThresholdDiff[] {
  const diffs: ThresholdDiff[] = []
  for (const point of dataset.points) {
    const currentThreshold = dataset.thresholds.find((item) => item.id === point.thresholdId)
    const candidateThreshold = candidateThresholds.find((item) => item.id === point.thresholdId)
    const current = classifyPoint(point, dataset.readings, currentThreshold)
    const candidate = classifyPoint(point, dataset.readings, candidateThreshold)
    const linked = [...dataset.anomalies].reverse().find((item) => item.pointId === point.id)
    const closed = linked?.status === '已关闭'
    const diff = diffOf(current.level, candidate.level)

    // 正常→正常的测点不进差异；但若存在已关闭异常，保留其当时依据并列入差异
    if (current.level === '正常' && candidate.level === '正常' && !closed) continue

    diffs.push({
      pointId: point.id,
      pointName: point.name,
      type: point.type,
      readingId: candidate.readingId || current.readingId,
      readingValue: candidate.readingValue || current.readingValue,
      unit: point.unit,
      capturedAt: candidate.capturedAt || current.capturedAt,
      currentLevel: current.level,
      candidateLevel: candidate.level,
      // 已关闭异常再次触发候选时按新增看待；否则只按引擎分级差异
      diff: closed && candidate.level !== '正常' ? '新增' : diff,
      currentBasis: closed && linked ? `【已关闭·当时依据】${linked.observedValue}` : current.basis,
      candidateBasis: candidate.basis.replace(/（阈值V\d+）/, `（候选V${(candidateThreshold?.version ?? 0) + 1}）`),
      anomalyId: linked?.id ?? '',
      anomalyStatus: (linked?.status ?? '') as AnomalyStatus | '',
      anomalyClosed: closed
    })
  }
  return diffs.sort((a, b) => a.pointId.localeCompare(b.pointId))
}

/** 原始读数快照指纹：试算期间接入新读数即变化，旧候选随之失效 */
export function readingsSnapshotId(dataset: TailingsDataset): string {
  const material = dataset.readings.map((reading) => `${reading.id}:${reading.value}:${reading.capturedAt}:${reading.quality}`).join('|')
  return `SNAP-R${dataset.readingVersion}-${hash32(material)}`
}

export function thresholdsSnapshotId(thresholds: Threshold[]): string {
  const material = thresholds.map((item) => `${item.id}:${item.enabled ? 1 : 0}:${item.warning}:${item.alarm}:${item.changeRate}`).join('|')
  return `D-${hash32(material)}`
}

export function hash32(input: string): string {
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(7, '0')
}

export function buildTrial(dataset: TailingsDataset, session: {
  batchId: string
  createdAt: string
  operator: string
  note: string
  draft: Threshold[]
  startSnapshotId: string
  startReadingVersion: number
}): ThresholdTrial {
  const readingSnapshot = readingsSnapshotId(dataset)
  const draftSnapshot = thresholdsSnapshotId(session.draft)
  return {
    batchId: session.batchId,
    createdAt: session.createdAt,
    operator: session.operator,
    note: session.note,
    snapshotId: `${readingSnapshot}--${draftSnapshot}`,
    baseSnapshotId: session.startSnapshotId,
    readingVersion: dataset.readingVersion,
    readingsChanged: readingSnapshot !== session.startSnapshotId || dataset.readingVersion !== session.startReadingVersion,
    candidateThresholds: session.draft,
    diffs: computeDiffs(dataset, session.draft)
  }
}

export const THRESHOLD_SET_KEY = 'threshold-set'

/** 发布初始批次项：阈值集为整批原子项，每个有动作的测点一项；已关闭异常不重写 */
export function buildChanges(trial: ThresholdTrial): AppliedChange[] {
  const changes: AppliedChange[] = [{ key: THRESHOLD_SET_KEY, pointId: '', anomalyId: '', diff: '保留', status: '待写入', error: '', attempts: 0 }]
  for (const diff of trial.diffs) {
    if (diff.anomalyClosed) {
      if (diff.diff === '保留' && diff.candidateLevel === '正常') {
        // 已关闭且候选仍正常：历史记录原样保留，无写入动作
        changes.push({ key: diff.pointId, pointId: diff.pointId, anomalyId: diff.anomalyId, diff: '保留', status: '已生效', error: '', attempts: 0 })
        continue
      }
      // 已关闭异常再次触发：不重写历史，按“新增”创建一条新异常
      changes.push({ key: diff.pointId, pointId: diff.pointId, anomalyId: '', diff: '新增', status: '待写入', error: '', attempts: 0 })
      continue
    }
    if (diff.diff === '保留' && diff.candidateLevel === '正常') continue
    changes.push({ key: diff.pointId, pointId: diff.pointId, anomalyId: diff.anomalyId, diff: diff.diff, status: '待写入', error: '', attempts: 0 })
  }
  return changes
}

export interface ItemApplication {
  dataset: TailingsDataset
  audit: { entityId: string; action: string; operator: string; detail: string }[]
}

/**
 * 应用单个批次项：仅在该项“写入成功”后修改数据；调用方负责失败项保留原数据。
 * 阈值集成功 → 整批切换阈值版本；测点项成功 → 新增/降级/升级/消失异常结果。
 */
export function applyItem(dataset: TailingsDataset, request: ThresholdPublishRequest, key: string, operator: string, now: string): ItemApplication {
  const next: TailingsDataset = structuredClone(dataset)
  const audit: ItemApplication['audit'] = []

  if (key === THRESHOLD_SET_KEY) {
    next.thresholds = request.candidateThresholds.map((candidate) => ({ ...candidate, version: candidate.version + 1 }))
    audit.push({
      entityId: request.batchId,
      action: '整批切换阈值版本',
      operator,
      detail: `批次${request.batchId}生效：${next.thresholds.map((item) => `${item.type}V${item.version}`).join('、')}`
    })
    return { dataset: next, audit }
  }

  const diff = request.diffs.find((item) => item.pointId === key)
  const point = next.points.find((item) => item.id === key)
  if (!diff || !point) return { dataset: next, audit }
  const anomaly = next.anomalies.find((item) => item.id === diff.anomalyId)

  if (diff.diff === '新增') {
    const id = `AN-${request.batchId.replace(/^TRY-/, '')}-${point.id.slice(2)}`
    // 重试补写时幂等：同批次同测点的异常已存在则不再重复创建
    if (next.anomalies.some((item) => item.id === id)) {
      return { dataset: next, audit }
    }
    const created: Anomaly = {
      id,
      pointId: point.id,
      title: `${point.name}触发候选阈值（${diff.candidateLevel}）`,
      severity: severityOf(diff.candidateLevel),
      status: '待现场复核',
      openedAt: now,
      owner: '待分派',
      triggerReadingId: diff.readingId,
      observedValue: diff.candidateBasis,
      fieldReviews: [],
      opinions: [],
      plan: { id: '', action: '加密监测', owner: '', deadline: '', conditions: '', emergencyLinked: false, approvedBy: '', approvedAt: '' },
      closedAt: '',
      version: 1
    }
    next.anomalies.push(created)
    point.status = diff.candidateLevel
    audit.push({ entityId: id, action: '阈值批次新增异常', operator, detail: `批次${request.batchId}：${diff.candidateBasis}` })
  } else if (diff.diff === '消失' && anomaly) {
    // 不删除、不覆盖既有复核与审批，仅按新阈值标记切换关闭，全部记录原样保留
    anomaly.status = '阈值切换关闭'
    anomaly.closedAt = now
    anomaly.version += 1
    anomaly.thresholdNote = `批次${request.batchId}按新阈值不再触发；历史复核、审批与依据原样保留`
    point.status = '正常'
    audit.push({ entityId: anomaly.id, action: '阈值批次切换关闭', operator, detail: `批次${request.batchId}：候选判定正常，${diff.candidateBasis}` })
  } else if ((diff.diff === '升级' || diff.diff === '降级') && anomaly) {
    const before = anomaly.severity
    anomaly.severity = severityOf(diff.candidateLevel)
    anomaly.status = diff.candidateLevel === '异常' && anomaly.status !== '已关闭' ? '应急联动' : anomaly.status
    anomaly.version += 1
    point.status = diff.candidateLevel
    audit.push({ entityId: anomaly.id, action: `阈值批次${diff.diff}异常`, operator, detail: `批次${request.batchId}：级别${before}→${anomaly.severity}，${diff.candidateBasis}` })
  } else if (diff.diff === '保留') {
    point.status = diff.candidateLevel === '正常' ? point.status : diff.candidateLevel
    audit.push({ entityId: anomaly?.id ?? point.id, action: '阈值批次核对保留', operator, detail: `批次${request.batchId}：判定仍为${diff.candidateLevel}，依据不变` })
  }

  return { dataset: next, audit }
}

/** 合并某次写入响应，成功项落库、失败项保留原数据；返回更新后的数据集与批次发布记录 */
export function mergePublishResults(
  dataset: TailingsDataset,
  request: ThresholdPublishRequest,
  changes: AppliedChange[],
  results: { key: string; ok: boolean; error?: string }[],
  now: string
): { dataset: TailingsDataset; changes: AppliedChange[]; finalized: boolean } {
  let working = structuredClone(dataset)
  const nextChanges = structuredClone(changes)
  const orderedResults = [...results].sort((a, b) => (a.key === THRESHOLD_SET_KEY ? -1 : b.key === THRESHOLD_SET_KEY ? 1 : 0))
  for (const result of orderedResults) {
    const change = nextChanges.find((item) => item.key === result.key)
    if (!change) continue
    // 阈值集是整批切换的前置项：未生效前，测点项即使返回成功也不落库，保持原数据
    const thresholdSwitchApplied = nextChanges.some((item) => item.key === THRESHOLD_SET_KEY && item.status === '已生效')
    change.attempts += 1
    if (result.ok && (result.key === THRESHOLD_SET_KEY || thresholdSwitchApplied)) {
      const applied = applyItem(working, request, result.key, request.operator, now)
      working = applied.dataset
      const entries: TailingsDataset['audit'] = applied.audit.map((entry, index) => ({
        ...entry,
        id: `AUD-${request.batchId}-${hash32(result.key)}-${index}`,
        createdAt: now
      }))
      working.audit = [...entries, ...working.audit]
      change.status = '已生效'
      change.error = ''
    } else {
      change.status = '失败'
      change.error = result.ok ? '阈值集尚未生效，测点项暂不落库' : (result.error ?? '写入失败')
      working.audit = [
        { id: `AUD-${request.batchId}-${hash32(result.key + change.attempts + now)}`, entityId: request.batchId, action: '批次项写入失败', operator: request.operator, detail: `${result.key} 写入失败，原数据保留：${change.error}`, createdAt: now },
        ...working.audit
      ]
    }
  }

  const finalized = nextChanges.every((item) => item.status === '已生效')
  const release: ThresholdRelease = {
    batchId: request.batchId,
    publishedAt: working.releases.find((item) => item.batchId === request.batchId)?.publishedAt ?? now,
    operator: request.operator,
    note: request.note,
    snapshotId: request.snapshotId,
    readingVersion: request.readingVersion,
    thresholds: working.thresholds,
    changes: nextChanges,
    finalizedAt: finalized ? now : ''
  }
  working.releases = [release, ...working.releases.filter((item) => item.batchId !== request.batchId)]
  return { dataset: working, changes: nextChanges, finalized }
}
