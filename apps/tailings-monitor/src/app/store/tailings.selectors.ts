import { createFeatureSelector, createSelector } from '@ngrx/store'
import type { ThresholdTrial } from '../domain'
import { buildTrial, readingsSnapshotId } from '../domain/threshold-trial'
import type { TailingsState } from './tailings.reducer'

export const selectTailings = createFeatureSelector<TailingsState>('tailings')
export const selectDataset = createSelector(selectTailings, (state) => state.dataset)
export const selectPoints = createSelector(selectDataset, (dataset) => dataset.points)
export const selectAnomalies = createSelector(selectDataset, (dataset) => dataset.anomalies)
export const selectSelectedAnomaly = createSelector(selectTailings, (state) => state.dataset.anomalies.find((item) => item.id === state.selectedAnomalyId) ?? state.dataset.anomalies[0])
export const selectFilteredAnomalies = createSelector(selectTailings, (state) => state.dataset.anomalies.filter((item) => {
  const point = state.dataset.points.find((value) => value.id === item.pointId)
  const text = `${item.id} ${item.title} ${item.owner} ${point?.name ?? ''}`.toLowerCase()
  return (!state.keyword || text.includes(state.keyword.toLowerCase())) && (state.status === '全部' || item.status === state.status)
}))

/** 试算期间只读原始数据可能变化或候选再次改版：每次选择都按最新快照重算候选 */
export const selectActiveTrial = createSelector(selectTailings, (state): ThresholdTrial | null => {
  if (state.pendingPublish || !state.trialSession) return null
  return buildTrial(state.dataset, state.trialSession)
})

/** 页面与审阅包共用的“同一批次”：发布中/待重试的批次优先，其次为进行中的试算 */
export const selectCurrentBatchId = createSelector(
  selectTailings,
  selectActiveTrial,
  (state, trial) => state.pendingPublish?.request.batchId ?? trial?.batchId ?? ''
)

export const selectPendingPublish = createSelector(selectTailings, (state) => state.pendingPublish)
export const selectPublishing = createSelector(selectTailings, (state) => state.publishing)
export const selectLatestRelease = createSelector(selectDataset, (dataset) => dataset.releases[0] ?? null)
export const selectReadingVersion = createSelector(selectDataset, (dataset) => dataset.readingVersion)
export const selectReadingsSnapshotId = createSelector(selectDataset, (dataset) => readingsSnapshotId(dataset))
