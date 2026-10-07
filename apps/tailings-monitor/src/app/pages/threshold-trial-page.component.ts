import { CommonModule } from '@angular/common'
import { Component, inject } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatTableModule } from '@angular/material/table'
import { Store } from '@ngrx/store'
import type { AppliedChange, RawReading, TailingsDataset, Threshold, ThresholdDiff } from '../domain'
import { TailingsActions } from '../store/tailings.actions'
import { selectActiveTrial, selectDataset, selectLatestRelease, selectPendingPublish, selectPublishing } from '../store/tailings.selectors'

@Component({
  selector: 'app-threshold-trial-page',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatTableModule],
  template: `
    <section class="page">
      <!-- 未开始试算 -->
      <div class="panel start" *ngIf="!(trial$ | async) as trial; else trialTpl">
        <ng-container *ngIf="pending$ | async as pending; else idleTpl">
          <h2>批次 {{ pending.request.batchId }} 存在未生效项</h2>
          <p>阈值版本与异常结果仅部分写入，现行数据保持一致；请先重试补齐后再发起新的试算。</p>
          <div class="changes">
            <article *ngFor="let item of pending.changes" [class.fail]="item.status === '失败'" [class.ok]="item.status === '已生效'">
              <b>{{ labelOf(item) }}</b><span>{{ item.status }}<ng-container *ngIf="item.attempts"> · 第{{ item.attempts }}次尝试</ng-container></span><small *ngIf="item.error">{{ item.error }}</small>
            </article>
          </div>
          <p class="error" *ngIf="pending.lastError">最近错误：{{ pending.lastError }}</p>
          <button mat-flat-button color="primary" [disabled]="(publishing$ | async)" (click)="retry(pending.request.batchId)">{{ (publishing$ | async) ? '重试写入中…' : '重试未生效项' }}</button>
        </ng-container>
        <ng-template #idleTpl>
          <h2>阈值试算发布</h2>
          <p>按候选阈值和<b>原始读数</b>计算每个测点“新增、消失、升级、降级、保留”的候选结果；试算不覆盖现行阈值，也不写入现场复核、负责人审批和审计记录。</p>
          <ul class="rules">
            <li>试算期间接入新读数或再次改版阈值，旧候选立即失效，按最新快照整体重算。</li>
            <li>确认后整批切换阈值版本与异常结果；写入失败的项保留原数据，重试只补未生效项。</li>
            <li>已关闭异常保留关闭当时的依据并列入差异；再次触发时新建异常，不重写历史。</li>
          </ul>
          <div class="start-form">
            <mat-form-field appearance="outline"><mat-label>发布说明</mat-label><input matInput [(ngModel)]="note" placeholder="如：汛期前收紧位移与降雨阈值" /></mat-form-field>
            <button mat-flat-button color="primary" (click)="start()">开始试算</button>
          </div>
        </ng-template>
      </div>

      <ng-template #trialTpl let-trial>
        <!-- 批次横幅：页面与审阅包显示同一批次 -->
        <div class="batch-band">
          <div><b>试算批次 {{ trial.batchId }}</b><span>发起 {{ trial.createdAt.replace('T', ' ').slice(0, 16) }} · {{ trial.operator }} · 读数版本 R{{ trial.readingVersion }}</span></div>
          <span class="snapshot">候选快照 {{ trial.snapshotId.slice(0, 26) }}…</span>
        </div>

        <div class="stale" *ngIf="trial.readingsChanged">
          ⚠ 试算期间接入了新原始读数（读数版本 R{{ trial.readingVersion }}），早前候选已失效；以下差异已按<b>最新读数快照</b>重算，发布依据为重算后的批次。
        </div>

        <div class="summary">
          <article class="add"><span>新增</span><strong>{{ count(trial.diffs, '新增') }}</strong></article>
          <article class="gone"><span>消失</span><strong>{{ count(trial.diffs, '消失') }}</strong></article>
          <article class="up"><span>升级</span><strong>{{ count(trial.diffs, '升级') }}</strong></article>
          <article class="down"><span>降级</span><strong>{{ count(trial.diffs, '降级') }}</strong></article>
          <article class="keep"><span>保留/已关闭</span><strong>{{ count(trial.diffs, '保留') }}</strong></article>
        </div>

        <div class="split">
          <!-- 候选阈值编辑 -->
          <div class="panel">
            <h3>候选阈值（再次改版即时重算）</h3>
            <table mat-table [dataSource]="trial.candidateThresholds">
              <ng-container matColumnDef="type"><th mat-header-cell *matHeaderCellDef>类型</th><td mat-cell *matCellDef="let row">{{ row.type }}</td></ng-container>
              <ng-container matColumnDef="warning"><th mat-header-cell *matHeaderCellDef>预警</th><td mat-cell *matCellDef="let row"><input class="num" type="number" [ngModel]="row.warning" (ngModelChange)="edit(row, 'warning', $event)" /></td></ng-container>
              <ng-container matColumnDef="alarm"><th mat-header-cell *matHeaderCellDef>报警</th><td mat-cell *matCellDef="let row"><input class="num" type="number" [ngModel]="row.alarm" (ngModelChange)="edit(row, 'alarm', $event)" /></td></ng-container>
              <ng-container matColumnDef="changeRate"><th mat-header-cell *matHeaderCellDef>变化率</th><td mat-cell *matCellDef="let row"><input class="num" type="number" [ngModel]="row.changeRate" (ngModelChange)="edit(row, 'changeRate', $event)" /></td></ng-container>
              <tr mat-header-row *matHeaderRowDef="draftColumns"></tr><tr mat-row *matRowDef="let row; columns: draftColumns"></tr>
            </table>
            <p class="hint">单位沿用现行版本；发布成功后版本号整批 +1：{{ versionLabel(trial) }}</p>

            <h3>试算期间接入新原始读数</h3>
            <div class="ingest">
              <select [(ngModel)]="ingestPointId">
                <option *ngFor="let point of (dataset$ | async)?.points" [value]="point.id">{{ point.id }} · {{ point.name }}</option>
              </select>
              <input class="num wide" type="number" [(ngModel)]="ingestValue" placeholder="读数" />
              <button mat-button (click)="ingest()">接入并按最新快照重算</button>
            </div>
            <p class="hint">原始读数只读追加，读数版本 +1；候选差异自动失效重算。</p>
          </div>

          <!-- 差异清单 -->
          <div class="panel diffs">
            <h3>候选差异（{{ trial.diffs.length }} 项）— 不触碰复核、审批与审计</h3>
            <article *ngFor="let diff of trial.diffs" [class]="'diff ' + kindClass(diff)">
              <div class="diff-head"><span class="tag">{{ kindLabel(diff) }}</span><b>{{ diff.pointId }} · {{ diff.pointName }}</b><span class="levels">{{ diff.currentLevel }} → {{ diff.candidateLevel }}</span></div>
              <p class="basis"><small>现行依据</small>{{ diff.currentBasis }}</p>
              <p class="basis cand"><small>候选依据</small>{{ diff.candidateBasis }}</p>
              <p class="closed-note" *ngIf="diff.anomalyClosed">已关闭异常 {{ diff.anomalyId }} 保留关闭当时依据；候选再次触发将新建异常，不重写历史记录。</p>
              <p class="reading" *ngIf="diff.readingId">原始读数 {{ diff.readingId }}：{{ diff.readingValue }} {{ diff.unit }} · {{ diff.capturedAt.replace('T', ' ').slice(0, 16) }}</p>
            </article>
            <p class="empty" *ngIf="!trial.diffs.length">候选阈值与现行结果一致，无差异。</p>
          </div>
        </div>

        <div class="actions">
          <button mat-flat-button color="primary" [disabled]="(publishing$ | async)" (click)="publish(trial.batchId)">确认整批切换发布</button>
          <button mat-button [disabled]="(publishing$ | async)" (click)="abandon()">放弃试算</button>
          <span class="tip">发布为整批操作：阈值版本与异常结果同时切换；模拟通道部分项首次写入会失败，可重试只补未生效项。</span>
        </div>
      </ng-template>

      <!-- 最近批次记录 -->
      <div class="panel releases" *ngIf="(release$ | async) as release">
        <h3>最近发布批次 {{ release.batchId }}<span class="final" [class.done]="!!release.finalizedAt">{{ release.finalizedAt ? '已全部生效 ' + release.finalizedAt.replace('T', ' ').slice(0, 16) : '部分生效，待重试' }}</span></h3>
        <div class="changes">
          <article *ngFor="let item of release.changes" [class.fail]="item.status === '失败'" [class.ok]="item.status === '已生效'">
            <b>{{ labelOf(item) }}</b><span>{{ item.diff !== '保留' ? item.diff + ' · ' : '' }}{{ item.status }}</span><small *ngIf="item.error">{{ item.error }}</small>
          </article>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .page { padding: 22px 28px 45px; }.panel { background: white; border: 1px solid #d9e1df; padding: 16px 18px; }.start h2 { margin: 0 0 8px; font-size: 19px; }.start p { color: #667572; font-size: 12px; max-width: 820px; }.rules { color: #5c6b67; font-size: 12px; margin: 10px 0 16px; padding-left: 20px; display: grid; gap: 5px; }.start-form { display: flex; align-items: center; gap: 12px; max-width: 640px; }.start-form mat-form-field { flex: 1; }
    .batch-band { background: #213a44; color: white; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; }.batch-band b, .batch-band span { display: block; }.batch-band span { color: #a9bbc1; font-size: 10px; margin-top: 3px; }.snapshot { font-family: monospace; font-size: 10px !important; }
    .stale { background: #fbf0d6; border-left: 3px solid #c28d27; padding: 10px 14px; font-size: 12px; color: #7a5d16; margin: 12px 0; }
    .summary { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin: 14px 0; }.summary article { background: white; border: 1px solid #d9e1df; padding: 12px 14px; display: grid; gap: 4px; }.summary span { font-size: 11px; color: #72807d; }.summary strong { font-size: 24px; color: #245060; }.summary .add strong { color: #a23b34; }.summary .gone strong { color: #2e765a; }.summary .up strong { color: #b06a18; }.summary .down strong { color: #315d6e; }
    .split { display: grid; grid-template-columns: minmax(420px, 0.9fr) 1.1fr; gap: 14px; align-items: start; }.panel h3 { font-size: 14px; margin: 4px 0 10px; } table { width: 100%;; }.num { width: 74px; padding: 5px 7px; border: 1px solid #c3cdca; border-radius: 3px; font-size: 12px; }.hint { color: #8a9693; font-size: 10px; margin: 8px 0 16px; }
    .ingest { display: flex; gap: 8px; align-items: center; }.ingest select, .ingest .num { padding: 7px; border: 1px solid #c3cdca; border-radius: 3px; font-size: 12px; }.ingest .wide { width: 120px; }
    .diffs { display: grid; gap: 9px; }.diff { border: 1px solid #e2e7e6; border-left-width: 4px; padding: 10px 12px; display: grid; gap: 5px; }.diff.新增 { border-left-color: #b84038; }.diff.消失 { border-left-color: #3e8a6b; }.diff.升级 { border-left-color: #c28d27; }.diff.降级 { border-left-color: #315d6e; }.diff.保留 { border-left-color: #9aa6a3; }.diff-head { display: flex; align-items: center; gap: 9px; }.diff-head b { font-size: 13px; }.levels { margin-left: auto; color: #5c6b67; font-size: 11px; }.tag { padding: 2px 8px; border-radius: 3px; font-size: 11px; background: #eef2f1; color: #3a4a46; }.diff.新增 .tag { background: #fae7e5; color: #a23b34; }.diff.消失 .tag { background: #e7f3ee; color: #2e765a; }.diff.升级 .tag { background: #f8efd9; color: #936d20; }.diff.降级 .tag { background: #e6eef2; color: #315d6e; }
    .basis { margin: 0; font-size: 11px; color: #55635f; }.basis small { display: inline-block; min-width: 56px; color: #93a09c; }.basis.cand { color: #334941; }.closed-note { margin: 0; font-size: 10px; color: #8e681d; background: #faf4e3; padding: 5px 8px; }.reading { margin: 0; font-size: 10px; color: #8a9693; }.empty { color: #93a09c; font-size: 12px; }
    .actions { display: flex; align-items: center; gap: 12px; margin-top: 14px; }.tip { color: #8a9693; font-size: 10px; }
    .releases { margin-top: 14px; }.releases h3 { display: flex; align-items: center; gap: 10px; }.final { font-size: 10px; color: #a23b34; }.final.done { color: #2e765a; }.changes { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; margin-top: 8px; }.changes article { border: 1px solid #e2e7e6; padding: 8px 10px; display: grid; gap: 3px; }.changes article.ok { border-left: 3px solid #3e8a6b; }.changes article.fail { border-left: 3px solid #b84038; background: #fdf4f3; }.changes b { font-size: 12px; }.changes span { font-size: 10px; color: #5c6b67; }.changes small { font-size: 10px; color: #a23b34; }.error { color: #a23b34 !important; }
  `]
})
export class ThresholdTrialPageComponent {
  private readonly store = inject(Store)
  readonly trial$ = this.store.select(selectActiveTrial)
  readonly pending$ = this.store.select(selectPendingPublish)
  readonly publishing$ = this.store.select(selectPublishing)
  readonly dataset$ = this.store.select(selectDataset)
  readonly release$ = this.store.select(selectLatestRelease)
  readonly draftColumns = ['type', 'warning', 'alarm', 'changeRate']
  note = ''
  ingestPointId = ''
  ingestValue: number | null = null
  private dataset: TailingsDataset | null = null

  constructor() {
    this.dataset$.subscribe((dataset) => { this.dataset = dataset })
  }

  start(): void {
    this.store.dispatch(TailingsActions.startThresholdTrial({ operator: '值班员 赵澄', note: this.note || '阈值调整试算' }))
  }
  edit(row: Threshold, field: 'warning' | 'alarm' | 'changeRate', value: number): void {
    if (Number.isNaN(Number(value))) return
    this.store.dispatch(TailingsActions.editDraftThreshold({ thresholdId: row.id, patch: { [field]: Number(value) } }))
  }
  ingest(): void {
    const points = this.dataset?.points ?? []
    const point = points.find((item) => item.id === this.ingestPointId) ?? points[0]
    if (!point || this.ingestValue === null) return
    const reading: RawReading = {
      id: `RX-${Date.now()}`,
      pointId: point.id,
      value: this.ingestValue,
      unit: point.unit,
      capturedAt: new Date().toISOString().slice(0, 19),
      deviceId: `DEV-${point.id}`,
      quality: '有效'
    }
    this.store.dispatch(TailingsActions.ingestReadings({ readings: [reading] }))
    this.ingestValue = null
  }
  publish(batchId: string): void { this.store.dispatch(TailingsActions.publishThresholdTrial({ batchId })) }
  retry(batchId: string): void { this.store.dispatch(TailingsActions.retryThresholdPublish({ batchId })) }
  abandon(): void { this.store.dispatch(TailingsActions.abandonThresholdTrial()) }

  count(diffs: ThresholdDiff[], kind: ThresholdDiff['diff']): number { return diffs.filter((item) => item.diff === kind).length }
  versionLabel(trial: { candidateThresholds: Threshold[] }): string {
    return trial.candidateThresholds.map((item) => `${item.type} V${item.version}→V${item.version + 1}`).join('、')
  }
  kindClass(diff: ThresholdDiff): string { return diff.diff }
  kindLabel(diff: ThresholdDiff): string {
    if (diff.anomalyClosed && diff.diff === '新增') return '新增(已关闭项再触发)'
    return diff.diff
  }
  labelOf(item: AppliedChange): string { return item.key === 'threshold-set' ? '阈值版本集（整批切换）' : `测点 ${item.pointId}` }
}
