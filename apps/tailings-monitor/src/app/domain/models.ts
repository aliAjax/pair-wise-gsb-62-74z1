export type MonitoringType = '位移' | '水位' | '渗流' | '降雨'
export type PointStatus = '正常' | '预警' | '异常'
export type AnomalyStatus = '待现场复核' | '原因调查中' | '待负责人审批' | '应急联动' | '已关闭' | '阈值切换关闭'
export type Severity = '关注' | '较高' | '重大'

export interface MonitoringPoint {
  id: string
  name: string
  zone: string
  type: MonitoringType
  longitude: number
  latitude: number
  status: PointStatus
  currentValue: number
  unit: string
  thresholdId: string
  lastInspectionAt: string
}

export interface Threshold {
  id: string
  type: MonitoringType
  warning: number
  alarm: number
  changeRate: number
  unit: string
  enabled: boolean
  version: number
}

/** 阈值试算的变更类型：消失＝不再触发；新增＝新触发；升级/降级＝级别变化；保留＝级别不变 */
export type DiffKind = '新增' | '消失' | '升级' | '降级' | '保留'
export type TrialLevel = '正常' | '预警' | '异常'

/** 单测点在“现行阈值 / 候选阈值”下的试算差异 */
export interface ThresholdDiff {
  pointId: string
  pointName: string
  type: MonitoringType
  readingId: string
  readingValue: number
  unit: string
  capturedAt: string
  currentLevel: TrialLevel
  candidateLevel: TrialLevel
  diff: DiffKind
  /** 触发依据：级别、命中的阈值行与原始读数 */
  currentBasis: string
  candidateBasis: string
  /** 差异关联的现行异常（可能已关闭，已关闭异常保留当时依据并列入差异） */
  anomalyId: string
  anomalyStatus: AnomalyStatus | ''
  anomalyClosed: boolean
}

/** 一次阈值试算批次（候选，不覆盖复核/审批/审计） */
export interface ThresholdTrial {
  batchId: string
  createdAt: string
  operator: string
  note: string
  /** 试算所依据的最新快照标识：读数与阈值草稿的版本指纹 */
  snapshotId: string
  baseSnapshotId: string
  readingVersion: number
  readingsChanged: boolean
  /** 候选阈值（阈值改版后整体重算） */
  candidateThresholds: Threshold[]
  diffs: ThresholdDiff[]
}

/** 批次内单条异常切换结果（部分写入失败时按项重试） */
export interface AppliedChange {
  key: string
  pointId: string
  anomalyId: string
  diff: DiffKind
  status: '待写入' | '已生效' | '失败'
  error: string
  attempts: number
}

/** 已发布的阈值版本批次 */
export interface ThresholdRelease {
  batchId: string
  publishedAt: string
  operator: string
  note: string
  snapshotId: string
  readingVersion: number
  thresholds: Threshold[]
  changes: AppliedChange[]
  /** 全部批次项生效后补齐；部分失败重试期间为空 */
  finalizedAt: string
}

/** 阈值批次发布请求（供“写入失败重试”模拟） */
export interface ThresholdPublishRequest {
  batchId: string
  candidateThresholds: Threshold[]
  diffs: ThresholdDiff[]
  snapshotId: string
  readingVersion: number
  operator: string
  note: string
}

export interface RawReading {
  id: string
  pointId: string
  value: number
  unit: string
  capturedAt: string
  deviceId: string
  quality: '有效' | '可疑' | '无效'
}

export interface ExpertOpinion {
  id: string
  specialist: string
  discipline: '坝体' | '水文' | '岩土' | '应急'
  content: string
  conclusion: '支持结论' | '提出异议' | '补充证据'
  createdAt: string
}

export interface FieldReview {
  id: string
  inspector: string
  arrivedAt: string
  observed: string
  evidence: string
  reassessment: string
  version: number
}

export interface DispositionPlan {
  id: string
  action: '加密监测' | '降低库水位' | '疏通排水' | '应急撤离准备' | '工程加固'
  owner: string
  deadline: string
  conditions: string
  emergencyLinked: boolean
  approvedBy: string
  approvedAt: string
}

export interface Anomaly {
  id: string
  pointId: string
  title: string
  severity: Severity
  status: AnomalyStatus
  openedAt: string
  owner: string
  triggerReadingId: string
  observedValue: string
  fieldReviews: FieldReview[]
  opinions: ExpertOpinion[]
  plan: DispositionPlan
  closedAt: string
  version: number
  /** 阈值批次切换关闭时的说明；复核、审批等历史记录原样保留 */
  thresholdNote?: string
}

export interface AuditEntry {
  id: string
  entityId: string
  action: string
  operator: string
  detail: string
  createdAt: string
}

export interface TailingsDataset {
  points: MonitoringPoint[]
  thresholds: Threshold[]
  readings: RawReading[]
  anomalies: Anomaly[]
  audit: AuditEntry[]
  /** 已发布批次（阈值版本与异常结果整批切换的留痕） */
  releases: ThresholdRelease[]
  /** 单调递增的读数版本：接入新读数即 +1，使旧候选失效 */
  readingVersion: number
}
