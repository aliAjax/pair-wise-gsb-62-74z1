import { CommonModule } from '@angular/common'
import { Component, inject } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatCheckboxModule } from '@angular/material/checkbox'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatSelectModule } from '@angular/material/select'
import { MatTableModule } from '@angular/material/table'
import { Store } from '@ngrx/store'
import { map } from 'rxjs'
import type { TrialBatch } from '../domain'
import { TailingsActions } from '../store/tailings.actions'
import { selectDataset, selectTrialBatches } from '../store/tailings.selectors'

@Component({
  selector: 'app-trial-page',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatTableModule],
  template: `
    <section class="page">
      <div class="page-head">
        <div><h2>阈值试算发布</h2><p>按新阈值与原始读数试算候选结果，确认前不覆盖复核、审批和审计记录；读数或方案变化时旧候选自动失效并按最新快照重算。</p></div>
      </div>
      <div class="split">
        <div class="panel propose">
          <h3>试算方案</h3>
          <mat-form-field appearance="outline"><mat-label>阈值类型</mat-label><mat-select [(ngModel)]="thresholdId" (ngModelChange)="prefill()"><mat-option *ngFor="let item of (dataset$ | async)?.thresholds" [value]="item.id">{{ item.type }} · 当前V{{ item.version }}</mat-option></mat-select></mat-form-field>
          <div class="grid3">
            <mat-form-field appearance="outline"><mat-label>预警值</mat-label><input matInput type="number" [(ngModel)]="warning" /></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>报警值</mat-label><input matInput type="number" [(ngModel)]="alarm" /></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>变化速率</mat-label><input matInput type="number" [(ngModel)]="changeRate" /></mat-form-field>
          </div>
          <button mat-flat-button color="primary" (click)="propose()">{{ (activeBatch$ | async) ? '再次改版并重算' : '开始试算' }}</button>
          <p class="hint">试算只生成候选批次，不改动阈值版本、异常、复核与审批记录。</p>
        </div>
        <div class="panel batch" *ngIf="activeBatch$ | async as batch">
          <div class="batch-head">
            <div><span class="batch-id">批次 {{ batch.id }}</span><h3>{{ batch.type }}阈值 V{{ batch.fromVersion }} → V{{ batch.toVersion }}</h3><small>快照 {{ batch.snapshotAt.replace('T', ' ').slice(0, 19) }} · 读数摘要 {{ batch.readingDigest }} · 试算人 {{ batch.operator }}</small></div>
            <span class="chip" [class.warn]="batch.status === '部分失败'">{{ batch.status }}</span>
          </div>
          <table mat-table [dataSource]="batch.candidates">
            <ng-container matColumnDef="point"><th mat-header-cell *matHeaderCellDef>测点</th><td mat-cell *matCellDef="let row">{{ row.pointName }}<small class="sub">{{ row.pointId }}</small></td></ng-container>
            <ng-container matColumnDef="current"><th mat-header-cell *matHeaderCellDef>当前</th><td mat-cell *matCellDef="let row">{{ row.currentStatus }}</td></ng-container>
            <ng-container matColumnDef="candidate"><th mat-header-cell *matHeaderCellDef>试算</th><td mat-cell *matCellDef="let row"><b>{{ row.candidateStatus }}</b></td></ng-container>
            <ng-container matColumnDef="change"><th mat-header-cell *matHeaderCellDef>变化</th><td mat-cell *matCellDef="let row"><span class="change" [attr.data-change]="row.change">{{ row.change }}</span></td></ng-container>
            <ng-container matColumnDef="basis"><th mat-header-cell *matHeaderCellDef>依据</th><td mat-cell *matCellDef="let row"><small>{{ row.basis }}</small></td></ng-container>
            <ng-container matColumnDef="applied"><th mat-header-cell *matHeaderCellDef>生效</th><td mat-cell *matCellDef="let row">{{ row.applied ? '已生效' : '待补写' }}</td></ng-container>
            <tr mat-header-row *matHeaderRowDef="columns"></tr><tr mat-row *matRowDef="let row; columns: columns"></tr>
          </table>
          <div class="closed" *ngIf="batch.closedNotes.length">
            <h4>已关闭异常差异（当时依据保留）</h4>
            <article *ngFor="let note of batch.closedNotes"><b>{{ note.anomalyId }} · {{ note.title }}</b><span>关闭于 {{ note.closedAt.replace('T', ' ').slice(0, 16) }} · 依据：{{ note.basis }}</span><small>{{ note.note }}</small></article>
          </div>
          <div class="actions">
            <mat-checkbox [(ngModel)]="simulateFailure" [disabled]="batch.status !== '待确认'">模拟部分写入失败</mat-checkbox>
            <button mat-flat-button color="primary" *ngIf="batch.status === '待确认'" (click)="confirm(batch)">确认发布（整批切换）</button>
            <button mat-flat-button color="warn" *ngIf="batch.status === '部分失败'" (click)="retry(batch)">重试未生效项</button>
          </div>
        </div>
      </div>
      <div class="panel history">
        <h3>批次记录（页面与审阅包同一批次号）</h3>
        <table mat-table [dataSource]="(batches$ | async) ?? []">
          <ng-container matColumnDef="id"><th mat-header-cell *matHeaderCellDef>批次</th><td mat-cell *matCellDef="let row"><b>{{ row.id }}</b><small class="sub" *ngIf="row.replacesId">接替 {{ row.replacesId }}</small></td></ng-container>
          <ng-container matColumnDef="type"><th mat-header-cell *matHeaderCellDef>类型</th><td mat-cell *matCellDef="let row">{{ row.type }} · V{{ row.fromVersion }}→V{{ row.toVersion }}</td></ng-container>
          <ng-container matColumnDef="status"><th mat-header-cell *matHeaderCellDef>状态</th><td mat-cell *matCellDef="let row"><span class="chip" [class.warn]="row.status === '部分失败'" [class.done]="row.status === '已发布'">{{ row.status }}</span></td></ng-container>
          <ng-container matColumnDef="snapshot"><th mat-header-cell *matHeaderCellDef>快照时间</th><td mat-cell *matCellDef="let row">{{ row.snapshotAt.replace('T', ' ').slice(0, 19) }}</td></ng-container>
          <ng-container matColumnDef="summary"><th mat-header-cell *matHeaderCellDef>候选差异</th><td mat-cell *matCellDef="let row">{{ summary(row) }}</td></ng-container>
          <ng-container matColumnDef="note"><th mat-header-cell *matHeaderCellDef>说明</th><td mat-cell *matCellDef="let row"><small>{{ row.note || '—' }}</small></td></ng-container>
          <tr mat-header-row *matHeaderRowDef="historyColumns"></tr><tr mat-row *matRowDef="let row; columns: historyColumns"></tr>
        </table>
      </div>
    </section>
  `,
  styles: [`
    .page { padding: 22px 28px 45px; }.page-head { margin-bottom: 14px; }.page-head h2 { margin: 0 0 5px; font-size: 20px; }.page-head p { margin: 0; color: #72807d; font-size: 12px; }
    .split { display: grid; grid-template-columns: 340px 1fr; gap: 14px; align-items: start; margin-bottom: 14px; }.panel { background: white; border: 1px solid #d9e1df; padding: 16px; } table { width: 100%; }
    .propose h3, .history h3 { font-size: 14px; margin: 0 0 12px; }.propose mat-form-field { width: 100%; }.grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }.hint { color: #8a9693; font-size: 11px; margin: 10px 0 0; }
    .batch { padding: 0; }.batch-head { display: flex; justify-content: space-between; align-items: start; padding: 14px 16px; border-bottom: 1px solid #e2e7e6; }.batch-head h3 { margin: 4px 0; font-size: 16px; }.batch-head small { color: #74827f; font-size: 10px; }.batch-id { color: #8a6720; font-size: 11px; font-weight: 600; }
    .chip { padding: 3px 8px; border-radius: 3px; background: #eef3f2; color: #4d6560; font-size: 11px; }.chip.warn { background: #fae8e6; color: #a43c35; }.chip.done { background: #e7f3ee; color: #2e765a; }
    .sub { display: block; color: #7c8986; font-size: 10px; margin-top: 3px; }
    .change { padding: 2px 7px; border-radius: 3px; font-size: 11px; background: #eef3f2; color: #5c6b68; }.change[data-change='新增'] { background: #e7f3ee; color: #2e765a; }.change[data-change='升级'] { background: #fae7e5; color: #a23b34; }.change[data-change='消失'] { background: #e8edf5; color: #3d5a80; }.change[data-change='降级'] { background: #f8efd9; color: #936d20; }
    .closed { padding: 12px 16px; border-top: 1px solid #e2e7e6; }.closed h4 { margin: 0 0 8px; font-size: 12px; color: #5c6b68; }.closed article { display: grid; gap: 3px; border-left: 3px solid #8a9693; background: #f5f8f7; padding: 8px 10px; margin-bottom: 7px; }.closed span { font-size: 11px; color: #4d5a57; }.closed small { color: #8a9693; font-size: 10px; }
    .actions { display: flex; align-items: center; gap: 14px; padding: 12px 16px; border-top: 1px solid #e2e7e6; }
  `]
})
export class TrialPageComponent {
  private readonly store = inject(Store)
  readonly dataset$ = this.store.select(selectDataset)
  readonly batches$ = this.store.select(selectTrialBatches)
  readonly activeBatch$ = this.batches$.pipe(map((batches) => batches.find((batch) => batch.thresholdId === this.thresholdId && (batch.status === '待确认' || batch.status === '部分失败'))))
  readonly columns = ['point', 'current', 'candidate', 'change', 'basis', 'applied']
  readonly historyColumns = ['id', 'type', 'status', 'snapshot', 'summary', 'note']
  thresholdId = 'T-D'
  warning = 10
  alarm = 16
  changeRate = 3
  simulateFailure = false

  prefill(): void {
    this.dataset$.pipe(map((dataset) => dataset.thresholds.find((item) => item.id === this.thresholdId))).subscribe((threshold) => {
      if (threshold) {
        this.warning = threshold.warning
        this.alarm = threshold.alarm
        this.changeRate = threshold.changeRate
      }
    }).unsubscribe()
  }

  propose(): void {
    this.store.dispatch(TailingsActions.proposeTrial({ thresholdId: this.thresholdId, warning: Number(this.warning), alarm: Number(this.alarm), changeRate: Number(this.changeRate), operator: '值班工程师 林舟' }))
  }

  confirm(batch: TrialBatch): void {
    this.store.dispatch(TailingsActions.confirmTrial({ batchId: batch.id, simulateFailure: this.simulateFailure }))
    this.simulateFailure = false
  }

  retry(batch: TrialBatch): void {
    this.store.dispatch(TailingsActions.retryTrial({ batchId: batch.id }))
  }

  summary(batch: TrialBatch): string {
    const counts = new Map<string, number>()
    batch.candidates.forEach((candidate) => counts.set(candidate.change, (counts.get(candidate.change) ?? 0) + 1))
    return ['新增', '消失', '升级', '降级', '维持'].filter((key) => counts.has(key)).map((key) => `${key}${counts.get(key)}`).join('，')
  }
}
