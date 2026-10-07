import { createActionGroup, emptyProps, props } from '@ngrx/store'
import type { AuditEntry, DispositionPlan, ExpertOpinion, FieldReview, RawReading, TailingsDataset } from '../domain'

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
    'Propose Trial': props<{ thresholdId: string; warning: number; alarm: number; changeRate: number; operator: string }>(),
    'Confirm Trial': props<{ batchId: string; simulateFailure: boolean }>(),
    'Retry Trial': props<{ batchId: string }>(),
    'Add Reading': props<{ reading: RawReading }>(),
    'Reset Demo': emptyProps()
  }
})
