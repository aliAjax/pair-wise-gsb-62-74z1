import { HttpClient } from '@angular/common/http'
import { Injectable, inject } from '@angular/core'
import { Observable, catchError, of } from 'rxjs'
import type { TailingsDataset, ThresholdPublishRequest } from '../domain'
import { hash32 } from '../domain/threshold-trial'
import { seedDataset } from '../data/seed'

@Injectable({ providedIn: 'root' })
export class TailingsApiService {
  private readonly http = inject(HttpClient)
  private readonly baseUrl = (globalThis as { __TAILINGS_API__?: string }).__TAILINGS_API__ ?? '/api'

  loadDataset(): Observable<TailingsDataset> {
    return this.http.get<TailingsDataset>(`${this.baseUrl}/tailings/snapshot`).pipe(catchError(() => of(structuredClone(seedDataset))))
  }

  exportPackage(payload: unknown): Observable<Blob> {
    return this.http.post(`${this.baseUrl}/tailings/export`, payload, { responseType: 'blob' }).pipe(catchError(() => of(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))))
  }

  /**
   * 整批发布阈值版本与异常结果。仅提交未生效项；模拟通道里部分项首次写入失败，
   * 第二次重试成功，演示“写入失败保留原数据，重试只补未生效项”。
   */
  publishThresholdBatch(request: ThresholdPublishRequest, keys: string[]): Observable<{ key: string; ok: boolean; error?: string }[]> {
    return this.http.post<{ key: string; ok: boolean; error?: string }[]>(`${this.baseUrl}/tailings/threshold-release`, { request, keys }).pipe(
      catchError(() => of(this.simulateBatchWrite(request, keys)))
    )
  }

  private simulateBatchWrite(request: ThresholdPublishRequest, keys: string[]): { key: string; ok: boolean; error?: string }[] {
    return keys.map((key) => {
      // 确定性地让每批部分项在首次尝试失败，第二次重试成功，演示“失败保留原数据、重试只补未生效项”
      const slot = parseInt(hash32(`${request.batchId}|${key}`), 36)
      const isFirstAttempt = !this.retryMarked.has(`${request.batchId}|${key}`)
      const fail = isFirstAttempt && slot % 3 === 1
      this.retryMarked.add(`${request.batchId}|${key}`)
      return fail
        ? { key, ok: false, error: key === 'threshold-set' ? '阈值版本写入超时，已回滚保持现行版本' : '异常结果写入冲突（记录被复核锁定），原记录保留' }
        : { key, ok: true }
    })
  }

  private retryMarked = new Set<string>()
}
