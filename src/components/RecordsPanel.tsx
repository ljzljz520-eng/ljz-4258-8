import { component$, useContext } from '@builder.io/qwik';
import {
  CONDITIONING_LABEL,
  FILL_MODE_LABEL,
  type BulkRun,
  type FlowRun,
  type Run,
} from '../domain/types';
import { calcBulkDensity, calcTappedDensity, summarizeRuns } from '../domain/formulas';
import { LabStoreContext } from '../state/store';

const dt = (iso: string) => new Date(iso).toLocaleString('zh-CN', { hour12: false });

function bulkMetrics(r: BulkRun): { bulk: number | null; tapped: number | null } {
  let bulk: number | null = null;
  let tapped: number | null = null;
  if (r.grossMassG != null && r.tareMassG != null && r.looseVolumeMl != null) {
    try {
      bulk = calcBulkDensity(r.grossMassG - r.tareMassG, r.looseVolumeMl);
    } catch {
      bulk = null;
    }
  }
  if (r.grossMassG != null && r.tareMassG != null && r.tappedVolumeMl != null) {
    try {
      tapped = calcTappedDensity(r.grossMassG - r.tareMassG, r.tappedVolumeMl);
    } catch {
      tapped = null;
    }
  }
  return { bulk, tapped };
}

const RunRow = component$<{ run: Run }>(({ run }) => {
  const valid = run.flags.acceptedReplicate;
  const exposed = !!run.provenance?.exposureSessionId;
  if (run.kind === 'bulk') {
    const m = valid ? bulkMetrics(run) : { bulk: null, tapped: null };
    return (
      <tr class={valid ? (exposed ? 'exposed-row' : '') : 'invalid'}>
        <td>{dt(run.createdAt)}</td>
        <td>
          {exposed ? run.provenance?.subCode : run.snapshot.sampleCode}
          <small>
            {exposed
              ? `暴露后子样（原样 ${run.snapshot.sampleCode} · 批 ${run.snapshot.batchNo}）`
              : `批 ${run.snapshot.batchNo}`}
          </small>
        </td>
        <td>
          {exposed ? '暴露后·松装/振实' : '松装/振实'}
          <small>{FILL_MODE_LABEL[run.fillMode]}</small>
        </td>
        <td>
          m0 {run.tareMassG ?? '—'} / m1 {run.grossMassG ?? '—'}
          <small>
            V0 {run.looseVolumeMl ?? '—'} / Vt {run.tappedVolumeMl ?? '—'} mL；
            {run.tapCount}/{run.tapTarget}
            {run.tapInterrupted ? '（中断）' : ''}
          </small>
        </td>
        <td class="num">
          {valid ? (
            <>
              {m.bulk?.toFixed(3)}
              <small>振实 {m.tapped?.toFixed(3) ?? '—'}</small>
            </>
          ) : (
            <span class="tag invalid">无效留档·不计算</span>
          )}
        </td>
        <td>
          {exposed && <span class="tag exposed">暴露后子样</span>}
          {valid ? <span class="tag ok">有效测次</span> : <span class="tag invalid">不计入</span>}
          {run.note && <small>{run.note}</small>}
        </td>
      </tr>
    );
  }
  const f = run as FlowRun;
  return (
    <tr class={valid ? (exposed ? 'exposed-row' : '') : 'invalid'}>
      <td>{dt(f.createdAt)}</td>
      <td>
        {exposed ? f.provenance?.subCode : f.snapshot.sampleCode}
        <small>
          {exposed
            ? `暴露后子样（原样 ${f.snapshot.sampleCode} · 批 ${f.snapshot.batchNo}）`
            : `批 ${f.snapshot.batchNo}`}
        </small>
      </td>
      <td>
        {exposed ? '暴露后·漏斗流动' : '漏斗流动'}
        <small>{CONDITIONING_LABEL[f.snapshot.conditioning]}</small>
      </td>
      <td>
        装粉 {f.chargeMassG ?? '—'} g
        <small>
          残留 {f.residueMassG ?? '—'} g{f.outletSticking ? '；口粘粉' : ''}
        </small>
      </td>
      <td class="num">
        {valid ? (
          f.flowTimeS?.toFixed(2)
        ) : (
          <span class="tag invalid">无效留档·不计算</span>
        )}
      </td>
      <td>
        {exposed && <span class="tag exposed">暴露后子样</span>}
        {valid ? <span class="tag ok">有效测次</span> : <span class="tag invalid">不计入</span>}
        {f.note && <small>{f.note}</small>}
      </td>
    </tr>
  );
});

export const RecordsPanel = component$(() => {
  const store = useContext(LabStoreContext);
  const { state } = store;
  const summary = summarizeRuns(state.runs, (r) => r.flags.acceptedReplicate);
  const method = state.methods[0];

  return (
    <section class="card records">
      <h3>本机测次记录（IndexedDB）</h3>
      <div class="summary">
        <div>
          原样有效松装/振实测次 <strong>{summary.validBulk}</strong>
          <small>
            平均 ρb {summary.meanBulkDensity?.toFixed(3) ?? '—'} g/mL · 平均 ρt{' '}
            {summary.meanTappedDensity?.toFixed(3) ?? '—'} g/mL
          </small>
        </div>
        <div>
          原样有效流动测次 <strong>{summary.validFlow}</strong>
          <small>平均 t {summary.meanFlowTimeS?.toFixed(2) ?? '—'} s</small>
        </div>
        <div>
          暴露后子样有效测次 <strong>{summary.exposedValidBulk + summary.exposedValidFlow}</strong>
          <small>
            松装/振实 {summary.exposedValidBulk} · 流动 {summary.exposedValidFlow}（单独成组，不并入原样）
          </small>
        </div>
        <div class="muted small">方法要求有效测次 ≥ {method?.minValidReplicates ?? '—'}</div>
      </div>

      <div class="table-wrap">
        <table class="rec-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>生产样</th>
              <th>类型</th>
              <th>关键读数</th>
              <th>结果</th>
              <th>测次状态</th>
            </tr>
          </thead>
          <tbody>
            {state.runs
              .slice()
              .reverse()
              .map((r) => (
                <RunRow key={r.id} run={r} />
              ))}
            {state.runs.length === 0 && (
              <tr>
                <td colSpan={6} class="muted center">
                  暂无记录
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <details class="aliquots">
        <summary>分装 aliquot 台账（{state.aliquots.length}）——阶段锁定审计</summary>
        <ul>
          {state.aliquots
            .slice()
            .reverse()
            .map((a) => {
              const s = state.samples.find((x) => x.id === a.sampleId);
              const sub = a.subSampleId
                ? state.subSamples.find((x) => x.id === a.subSampleId)
                : null;
              return (
                <li key={a.id} class={`phase-${a.phase}`}>
                  <code>{a.phase}</code> {sub ? sub.subCode : s?.sampleCode ?? a.sampleId} ·{' '}
                  {a.kind}
                  {sub ? '（暴露后子样）' : ''} · 分装于 {dt(a.preparedAt)}
                  {a.note ? <small> {a.note}</small> : null}
                </li>
              );
            })}
        </ul>
      </details>

      <details class="aliquots">
        <summary>
          高湿暴露会话台账（{state.exposureSessions.length}）——敞口/曲线/取走/结露审计
        </summary>
        <ul>
          {state.exposureSessions
            .slice()
            .reverse()
            .map((s) => {
              const sample = state.samples.find((x) => x.id === s.sampleId);
              const statusTxt =
                s.status === 'invalid'
                  ? '已判废'
                  : s.status === 'closed'
                    ? '已封口'
                    : '敞口中';
              return (
                <li key={s.id} class={s.status === 'invalid' ? 'exp-invalid' : ''}>
                  <code>{statusTxt}</code> {sample?.sampleCode} · {s.trayId} · 敞口{' '}
                  {dt(s.openedAt)}
                  {s.closedAt ? ` → 封口 ${dt(s.closedAt)}` : ''}
                  <small>
                    厚度 {s.layerThicknessMm ?? '—'}
                    {s.layerThicknessAfterMm != null
                      ? `→${s.layerThicknessAfterMm}`
                      : ''}{' '}
                    mm｜曲线 {s.curve.length} 点｜取走 {s.withdrawals.length} 笔
                    {s.localCondensation ? '｜局部结露' : ''}
                    {s.loggerStartedAt
                      ? `｜记录器较敞口 ${(
                          (Date.parse(s.loggerStartedAt) - Date.parse(s.openedAt)) /
                          60000
                        ).toFixed(1)} min`
                      : '｜记录器未启动'}
                    {s.note ? `｜${s.note}` : ''}
                  </small>
                  <ul>
                    {state.subSamples
                      .filter((x) => x.exposureSessionId === s.id)
                      .map((sub) => (
                        <li key={sub.id}>
                          子样 <strong>{sub.subCode}</strong> · {sub.massG ?? '—'} g
                        </li>
                      ))}
                  </ul>
                </li>
              );
            })}
        </ul>
      </details>
    </section>
  );
});
