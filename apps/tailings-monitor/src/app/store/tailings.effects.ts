import { Injectable, inject } from '@angular/core'
import { Actions, createEffect, ofType } from '@ngrx/effects'
import { Store } from '@ngrx/store'
import { catchError, map, of, switchMap, withLatestFrom } from 'rxjs'
import { TailingsApiService } from '../services/tailings-api.service'
import type { TailingsState } from './tailings.reducer'
import { TailingsActions } from './tailings.actions'
import { selectTailings } from './tailings.selectors'

@Injectable()
export class TailingsEffects {
  private readonly actions$ = inject(Actions)
  private readonly api = inject(TailingsApiService)
  private readonly store = inject(Store)

  loadDataset$ = createEffect(() => this.actions$.pipe(
    ofType(TailingsActions.loadDataset),
    switchMap(() => this.api.loadDataset().pipe(
      map((dataset) => TailingsActions.loadDatasetSuccess({ dataset })),
      catchError((error: Error) => of(TailingsActions.loadDatasetFailure({ error: error.message })))
    ))
  ))

  /**
   * 首次发布或失败重试都走同一通道：
   * 只提交“待写入/失败”项；已生效项不重发，重试只补未生效项。
   */
  publishThreshold$ = createEffect(() => this.actions$.pipe(
    ofType(TailingsActions.publishThresholdTrial, TailingsActions.retryThresholdPublish),
    withLatestFrom(this.store.select(selectTailings)),
    switchMap(([action, state]) => {
      const pending = state.pendingPublish
      if (!pending) return of()
      const keys = pending.changes.filter((item) => item.status !== '已生效').map((item) => item.key)
      return this.api.publishThresholdBatch(pending.request, keys).pipe(
        map((results) => TailingsActions.publishThresholdItemsSuccess({ request: pending.request, changes: pending.changes, results })),
        catchError((error: Error) => of(TailingsActions.publishThresholdFailure({ batchId: pending.request.batchId, error: error.message })))
      )
    })
  ))
}
