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
  if (run.kind === 'bulk') {
    const m = valid ? bulkMetrics(run) : { bulk: null, tapped: null };
    return (
      <tr class={valid ? '' : 'invalid'}>
        <td>{dt(run.createdAt)}</td>
        <td>
          {run.snapshot.sampleCode}
          <small>批 {run.snapshot.batchNo}</small>
        </td>
        <td>
          松装/振实
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
          {valid ? (
            <span class="tag ok">有效测次</span>
          ) : (
            <span class="tag invalid">不计入</span>
          )}
          {run.note && <small>{run.note}</small>}
        </td>
      </tr>
    );
  }
  const f = run as FlowRun;
  return (
    <tr class={valid ? '' : 'invalid'}>
      <td>{dt(f.createdAt)}</td>
      <td>
        {f.snapshot.sampleCode}
        <small>批 {f.snapshot.batchNo}</small>
      </td>
      <td>
        漏斗流动
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
          有效松装/振实测次 <strong>{summary.validBulk}</strong>
          <small>
            平均 ρb {summary.meanBulkDensity?.toFixed(3) ?? '—'} g/mL · 平均 ρt{' '}
            {summary.meanTappedDensity?.toFixed(3) ?? '—'} g/mL
          </small>
        </div>
        <div>
          有效流动测次 <strong>{summary.validFlow}</strong>
          <small>平均 t {summary.meanFlowTimeS?.toFixed(2) ?? '—'} s</small>
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
              return (
                <li key={a.id} class={`phase-${a.phase}`}>
                  <code>{a.phase}</code> {s?.sampleCode ?? a.sampleId} · {a.kind} · 分装于{' '}
                  {dt(a.preparedAt)}
                  {a.note ? <small> {a.note}</small> : null}
                </li>
              );
            })}
        </ul>
      </details>
    </section>
  );
});
