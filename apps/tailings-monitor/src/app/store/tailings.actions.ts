import { createActionGroup, emptyProps, props } from '@ngrx/store'
import type {
  AppliedChange,
  AuditEntry,
  DispositionPlan,
  ExpertOpinion,
  FieldReview,
  RawReading,
  TailingsDataset,
  Threshold,
  ThresholdPublishRequest
} from '../domain'

export const TailingsActions = createActionGroup({
  source: 'Tailings',
  events: {
    'Load Dataset': emptyProps(),
    'Load Dataset Success': props<{ dataset: TailingsDataset }>(),
    'Load Dataset Failure': props<{ error: string }>(),
    'Submit Field Review': props<{ anomalyId: string; review: FieldReview }>(),
    'Add Expert Opinion': props<{ anomalyId: string; opinion: ExpertOpinion }>(),
    'Save Disposition Plan': props<{ anomalyId: string; plan: DispositionPlan }>(),
    'Approve Plan': props<{ anomalyId: string; approver: string; note: string }>(),
    'Close Anomaly': props<{ anomalyId: string; note: string }>(),
    'Create Emergency Link': props<{ anomalyId: string; note: string }>(),
    'Select Anomaly': props<{ anomalyId: string }>(),
    'Update Keyword': props<{ keyword: string }>(),
    'Update Status': props<{ status: string }>(),
    'Add Audit': props<{ entry: AuditEntry }>(),
    /** 开始阈值试算：复制现行阈值为候选草稿，不改动阈值、复核、审批与审计 */
    'Start Threshold Trial': props<{ operator: string; note: string }>(),
    /** 编辑候选阈值（再次改版）；候选按最新快照重算 */
    'Edit Draft Threshold': props<{ thresholdId: string; patch: Partial<Pick<Threshold, 'warning' | 'alarm' | 'changeRate' | 'enabled'>> }>(),
    /** 试算期间接入新原始读数：读数版本 +1，旧候选快照失效并重算 */
    'Ingest Readings': props<{ readings: RawReading[] }>(),
    /** 确认发布：整批切换阈值版本与异常结果；部分失败时只重试未生效项 */
    'Publish Threshold Trial': props<{ batchId: string }>(),
    'Retry Threshold Publish': props<{ batchId: string }>(),
    'Publish Threshold Items Success': props<{ request: ThresholdPublishRequest; changes: AppliedChange[]; results: { key: string; ok: boolean; error?: string }[] }>(),
    'Publish Threshold Failure': props<{ batchId: string; error: string }>(),
    /** 放弃试算，候选与差异整体丢弃；未全部生效的批次不允许放弃 */
    'Abandon Threshold Trial': emptyProps(),
    'Reset Demo': emptyProps()
  }
})
