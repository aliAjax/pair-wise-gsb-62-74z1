import { CommonModule } from '@angular/common'
import { Component, inject } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatTableModule } from '@angular/material/table'
import { Store } from '@ngrx/store'
import { map } from 'rxjs'
import { TailingsApiService } from '../services/tailings-api.service'
import { selectActiveTrial, selectCurrentBatchId, selectDataset, selectPendingPublish } from '../store/tailings.selectors'

@Component({
  selector: 'app-audit-page',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatTableModule],
  template: `
    <section class="page">
      <div class="head"><div><h2>审计与版本追溯</h2><p>异常创建、原始读数、现场复核、专业意见、处置方案、审批、关闭与阈值批次切换全部留痕。</p></div><button mat-flat-button color="primary" (click)="exportPackage()">导出审阅包</button></div>

      <div class="batch-band" *ngIf="(batchId$ | async) as batchId">
        <span>审阅包当前批次</span><b>{{ batchId }}</b>
        <i>{{ (pending$ | async) ? '发布进行中/存在未生效项，包内标注为“切换中”' : '候选试算中，包内标注为“试算未发布”' }}</i>
      </div>

      <div class="releases panel" *ngIf="(dataset$ | async)?.releases.length">
        <h3>阈值发布批次</h3>
        <article *ngFor="let release of (dataset$ | async)?.releases">
          <div><b>{{ release.batchId }}</b><span>{{ release.publishedAt.replace('T', ' ').slice(0, 16) }} · {{ release.operator }}</span></div>
          <span class="state" [class.done]="!!release.finalizedAt">{{ release.finalizedAt ? '全部生效 ' + release.finalizedAt.replace('T', ' ').slice(0, 16) : '部分生效，等待重试补齐' }}</span>
          <small>读数快照 R{{ release.readingVersion }} · {{ release.snapshotId.slice(0, 30) }}…</small>
          <p>{{ release.note }}</p>
        </article>
      </div>

      <div class="toolbar"><mat-form-field appearance="outline"><mat-label>搜索实体、动作、操作人</mat-label><input matInput [(ngModel)]="keyword" /></mat-form-field><span>共{{ (filtered$ | async)?.length }}条事件</span></div>
      <table mat-table [dataSource]="filtered$ | async" class="panel">
        <ng-container matColumnDef="time"><th mat-header-cell *matHeaderCellDef>时间</th><td mat-cell *matCellDef="let row">{{ row.createdAt.replace('T', ' ').slice(0, 16) }}</td></ng-container>
        <ng-container matColumnDef="entity"><th mat-header-cell *matHeaderCellDef>实体</th><td mat-cell *matCellDef="let row">{{ row.entityId }}</td></ng-container>
        <ng-container matColumnDef="action"><th mat-header-cell *matHeaderCellDef>动作</th><td mat-cell *matCellDef="let row"><span [class.batch-action]="row.entityId.startsWith('TRY-')">{{ row.action }}</span></td></ng-container>
        <ng-container matColumnDef="operator"><th mat-header-cell *matHeaderCellDef>操作人</th><td mat-cell *matCellDef="let row">{{ row.operator }}</td></ng-container>
        <ng-container matColumnDef="detail"><th mat-header-cell *matHeaderCellDef>说明</th><td mat-cell *matCellDef="let row">{{ row.detail }}</td></ng-container>
        <tr mat-header-row *matHeaderRowDef="columns"></tr><tr mat-row *matRowDef="let row; columns: columns"></tr>
      </table>
    </section>
  `,
  styles: [`
    .page { padding: 22px 28px 45px; }.head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }.head h2 { margin: 0 0 5px; font-size: 20px; }.head p { margin: 0; color: #72807d; font-size: 12px; }
    .batch-band { background: #213a44; color: white; padding: 10px 16px; display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }.batch-band span { color: #a9bbc1; font-size: 10px; }.batch-band b { font-size: 13px; }.batch-band i { font-style: normal; color: #d8b96f; font-size: 10px; }
    .releases { padding: 14px 16px; margin-bottom: 12px; }.releases h3 { margin: 0 0 9px; font-size: 14px; }.releases article { border-left: 3px solid #315d6e; background: #f5f8f7; padding: 9px 12px; margin-bottom: 7px; display: grid; grid-template-columns: 1fr auto; gap: 3px 14px; }.releases article div span, .releases small { display: block; color: #7c8986; font-size: 10px; }.releases .state { font-size: 10px; color: #a23b34; }.releases .state.done { color: #2e765a; }.releases p { grid-column: 1 / -1; margin: 0; font-size: 11px; color: #55635f; }
    .toolbar { display: flex; align-items: center; gap: 12px; }.toolbar span { color: #72807d; font-size: 11px; }.panel { width: 100%; background: white; border: 1px solid #d9e1df; }.batch-action { color: #315d6e; font-weight: 600; }
  `]
})
export class AuditPageComponent {
  private readonly store = inject(Store)
  private readonly api = inject(TailingsApiService)
  keyword = ''
  readonly columns = ['time', 'entity', 'action', 'operator', 'detail']
  readonly dataset$ = this.store.select(selectDataset)
  readonly trial$ = this.store.select(selectActiveTrial)
  readonly pending$ = this.store.select(selectPendingPublish)
  readonly batchId$ = this.store.select(selectCurrentBatchId)
  readonly filtered$ = this.store.select(selectDataset).pipe(map((dataset) => dataset.audit.filter((item) => !this.keyword || `${item.entityId} ${item.action} ${item.operator} ${item.detail}`.includes(this.keyword))))
  exportPackage(): void {
    this.dataset$.subscribe((dataset) => {
      this.trial$.subscribe((trial) => {
        this.pending$.subscribe((pending) => {
          // 审阅包与页面显示同一批次，并显式标注批次所处阶段
          const payload = {
            packageType: '尾矿库监测阈值与异常审阅包',
            exportedAt: new Date().toISOString(),
            currentBatch: {
              batchId: pending?.request.batchId ?? trial?.batchId ?? dataset.releases[0]?.batchId ?? '',
              phase: pending ? '切换中（部分项待重试补齐）' : trial ? '试算中（候选未发布，复核/审批/审计未改动）' : '无进行中批次',
              snapshotId: pending?.request.snapshotId ?? trial?.snapshotId ?? '',
              candidateDiffs: trial?.diffs ?? []
            },
            releases: dataset.releases,
            dataset
          }
          this.api.exportPackage(payload).subscribe((blob) => {
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a'); anchor.href = url; anchor.download = `尾矿库审阅包_${payload.currentBatch.batchId || '无批次'}.json`; anchor.click(); URL.revokeObjectURL(url)
          })
        }).unsubscribe()
      }).unsubscribe()
    }).unsubscribe()
  }
}
