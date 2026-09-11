import {
  component$,
  useContext,
  useSignal,
  useStore,
  useVisibleTask$,
  type Signal,
} from '@builder.io/qwik';
import {
  CONDITIONING_LABEL,
  FILL_MODE_LABEL,
  type Conditioning,
  type Draft,
  type FillMode,
} from '../domain/types';
import { LabStoreContext, previewBulk } from '../state/store';
import { DeviceContext } from './context';
import { CylinderGauge } from './CylinderGauge';
import { FunnelDiagram } from './FunnelDiagram';

const fmt = (v: number | null | undefined, d = 2) =>
  v == null || !Number.isFinite(v) ? '—' : v.toFixed(d);
const fmtDt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '—';

function num(el: EventTarget | null): number | null {
  const v = (el as HTMLInputElement).value;
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function exposureOf(iso: string, at = new Date()): number {
  return Math.round(((at.getTime() - Date.parse(iso)) / 60000) * 10) / 10;
}

function useTickExposure(startIso: string | null): Signal<number | null> {
  const value = useSignal<number | null>(startIso ? exposureOf(startIso) : null);
  useVisibleTask$(({ cleanup }) => {
    value.value = startIso ? exposureOf(startIso) : null;
    const t = setInterval(() => {
      value.value = startIso ? exposureOf(startIso) : null;
    }, 5000);
    cleanup(() => clearInterval(t));
  });
  return value;
}

/* ---------------- 步骤 0：样品/方法 ---------------- */

export const StepSample = component$(() => {
  const store = useContext(LabStoreContext);
  const { state } = store;
  const form = useStore({
    sampleCode: '',
    productName: '',
    batchNo: '',
    producedAt: '',
    openedAt: new Date().toISOString().slice(0, 16),
    conditioning: 'as_received' as Conditioning,
    note: '',
  });
  const err = useSignal<string | null>(null);
  const method = state.methods.find((m) => m.id === state.wizard.methodId);

  return (
    <div class="grid two">
      <section class="card">
        <h3>1. 登记 / 选择生产样</h3>
        <label>
          生产样编号
          <input value={form.sampleCode} placeholder="如 MPS-20260911-A" onInput$={(e) => (form.sampleCode = (e.target as HTMLInputElement).value)} />
        </label>
        <label>
          产品名称
          <input value={form.productName} placeholder="如 全脂乳粉" onInput$={(e) => (form.productName = (e.target as HTMLInputElement).value)} />
        </label>
        <label>
          批号
          <input value={form.batchNo} placeholder="生产批号" onInput$={(e) => (form.batchNo = (e.target as HTMLInputElement).value)} />
        </label>
        <div class="row">
          <label>
            生产/取样时间
            <input type="datetime-local" value={form.producedAt} onInput$={(e) => (form.producedAt = (e.target as HTMLInputElement).value)} />
          </label>
          <label>
            开封时间
            <input type="datetime-local" value={form.openedAt} onInput$={(e) => (form.openedAt = (e.target as HTMLInputElement).value)} />
          </label>
        </div>
        <label>
          调湿状态
          <select
            value={form.conditioning}
            onChange$={(e) =>
              (form.conditioning = (e.target as HTMLSelectElement).value as Conditioning)
            }
          >
            {(Object.keys(CONDITIONING_LABEL) as Conditioning[]).map((k) => (
              <option value={k}>{CONDITIONING_LABEL[k]}</option>
            ))}
          </select>
        </label>
        <label>
          备注
          <input value={form.note} onInput$={(e) => (form.note = (e.target as HTMLInputElement).value)} />
        </label>
        {err.value && <p class="inline-err">{err.value}</p>}
        <button
          class="btn primary"
          onClick$={() => {
            err.value = store.addSample({
              sampleCode: form.sampleCode,
              productName: form.productName,
              batchNo: form.batchNo,
              producedAt: form.producedAt,
              openedAt: form.openedAt,
              conditioning: form.conditioning,
              note: form.note,
            });
          }}
        >
          登记样品（仅存本机）
        </button>

        <h4>本机已有样品</h4>
        <ul class="pick-list">
          {state.samples.map((s) => (
            <li key={s.id}>
              <label class="pick">
                <input
                  type="radio"
                  name="sample"
                  checked={state.wizard.sampleId === s.id}
                  onChange$={() => (state.wizard.sampleId = s.id)}
                />
                <span>
                  <strong>{s.sampleCode}</strong> {s.productName} · 批 {s.batchNo}
                  <small>
                    开封 {fmtDt(s.openedAt)} · {CONDITIONING_LABEL[s.conditioning]}
                  </small>
                </span>
              </label>
            </li>
          ))}
          {state.samples.length === 0 && <li class="muted">尚无样品</li>}
        </ul>
      </section>

      <section class="card">
        <h3>2. 方法版本与试验类型</h3>
        <div class="method-box">
          {state.methods.map((m) => (
            <label class="pick method" key={m.id}>
              <input
                type="radio"
                name="method"
                checked={state.wizard.methodId === m.id}
                onChange$={() => store.setMethod(m.id)}
              />
              <span>
                <strong>
                  {m.code} {m.version}
                </strong>{' '}
                {m.title}
                <small>
                  {m.approvedBy} · 批准日期 {m.approvedAt} · 有效测次 ≥ {m.minValidReplicates}
                </small>
              </span>
            </label>
          ))}
        </div>
        <h4>已批准公式（系统仅计算下列指标）</h4>
        <ul class="formula-list">
          {(method?.formulas ?? []).map((f) => (
            <li key={f.id}>
              <code>{f.expression}</code> {f.title}（{f.unit}）
            </li>
          ))}
        </ul>
        <p class="muted small">
          不评价冲调体验，不推荐任何生产参数；未批准的指标本系统不计算。
        </p>

        <div class="seg">
          <button
            class={state.wizard.kind === 'bulk' ? 'seg-btn on' : 'seg-btn'}
            onClick$={() => store.setKind('bulk')}
          >
            松装/振实密度
          </button>
          <button
            class={state.wizard.kind === 'flow' ? 'seg-btn on' : 'seg-btn'}
            onClick$={() => store.setKind('flow')}
          >
            漏斗流动时间
          </button>
        </div>
        <button
          class="btn primary big"
          disabled={!state.wizard.sampleId}
          onClick$={() =>
            state.wizard.sampleId &&
            store.startWizard(state.wizard.kind, state.wizard.sampleId)
          }
        >
          开始分步试验（取一份新 aliquot）
        </button>
      </section>
    </div>
  );
});

/* ---------------- 步骤 1：装粉 ---------------- */

export const StepFill = component$(() => {
  const store = useContext(LabStoreContext);
  const { state } = store;
  const method = state.methods.find((m) => m.id === state.wizard.methodId);
  const cyl = state.cylinders.find((c) => c.id === state.wizard.cylinderId);
  const fillMode = useSignal<FillMode>('free_pour');
  if (!method || !cyl) return <p class="muted">方法/量筒缺失</p>;

  return (
    <div class="grid two">
      <section class="card">
        <h3>装粉前核对</h3>
        <CheckList
          items={[
            '生产样编号、批号与开封时间已核对（见右侧样品信息）',
            state.wizard.kind === 'bulk'
              ? `量筒已选：${cyl.name}，分度 ${cyl.graduationMl} mL，台账皮重 ${cyl.listedTareG} g`
              : `标准漏斗装粉量 ${method.flowChargeG} g`,
            `调湿状态与方法一致；分装时刻起算暴露计时（限值 ${method.maxExposureMin} min）`,
            `振实目标 ${method.tapTarget} 次，计数中断即按方法判废`,
            '每次装粉都分装一份新 aliquot；该 aliquot 振实后不得再作为初始松装样',
          ]}
        />
        {state.wizard.kind === 'bulk' && (
          <label>
            量筒
            <select
              value={state.wizard.cylinderId ?? ''}
              onChange$={(e) => store.setCylinder((e.target as HTMLSelectElement).value)}
            >
              {state.cylinders
                .filter((c) => c.active)
                .map((c) => (
                  <option value={c.id}>{`${c.name}（${c.nominalMl} mL，皮重 ${c.listedTareG} g）`}</option>
                ))}
            </select>
          </label>
        )}
        <label>
          装粉方式
          <select
            value={fillMode.value}
            onChange$={(e) =>
              (fillMode.value = (e.target as HTMLSelectElement).value as FillMode)
            }
          >
            {(Object.keys(FILL_MODE_LABEL) as FillMode[]).map((k) => (
              <option value={k}>{FILL_MODE_LABEL[k]}</option>
            ))}
          </select>
        </label>
        <button class="btn primary big" onClick$={() => store.startFill(fillMode.value)}>
          分装新 aliquot 并开始装粉
        </button>
        <p class="muted small">
          已振实/已流完/已废弃的 aliquot 不会被复用；继续试验必须重新分装。
        </p>
      </section>
      <section class="card">
        <SampleInfo />
        <div class="center">
          <CylinderGauge
            nominalMl={cyl.nominalMl}
            graduationMl={cyl.graduationMl}
            looseVolumeMl={null}
            phase="fresh"
          />
        </div>
      </section>
    </div>
  );
});

/* ---------------- 步骤 2：松装读数 ---------------- */

export const StepLoose = component$(() => {
  const store = useContext(LabStoreContext);
  const devices = useContext(DeviceContext);
  const { state } = store;
  const d = state.wizard.draft;
  const cyl = state.cylinders.find((c) => c.id === state.wizard.cylinderId);
  const exposure = useTickExposure(d?.exposureStartedAt ?? null);
  const method = state.methods.find((m) => m.id === state.wizard.methodId);
  if (!d || d.kind !== 'bulk' || !cyl || !method) return <p class="muted">无松装草案</p>;

  const tilt =
    d.looseVolumeMaxMl != null && d.looseVolumeMinMl != null
      ? d.looseVolumeMaxMl - d.looseVolumeMinMl
      : null;

  return (
    <div class="grid two">
      <section class="card">
        <h3>初始松装读数 V0（未经任何振实）</h3>
        <div class="read-row">
          <label>
            空筒皮重 m0 (g)
            <input
              type="number"
              step="0.01"
              value={d.tareMassG ?? ''}
              onInput$={(e) => store.setBulkField('tareMassG', num(e.target))}
            />
          </label>
          <button
            class="btn"
            onClick$={() => {
              const r = devices.balance.state.stable;
              if (!r) {
                state.wizard.uiError = '天平尚无稳定读数（ST），请等待稳定后再引用';
                return;
              }
              store.setBulkField('tareMassG', Math.round(r.massG * 100) / 100);
              state.wizard.uiError = null;
            }}
          >
            引用天平稳定读数
          </button>
        </div>
        <p class="muted small">台账皮重 {cyl.listedTareG} g（实测差 &gt;0.5 g 复核判废）</p>

        <div class="read-row">
          <label>
            量筒+粉毛重 m1 (g)
            <input
              type="number"
              step="0.01"
              value={d.grossMassG ?? ''}
              onInput$={(e) => store.setBulkField('grossMassG', num(e.target))}
            />
          </label>
          <button
            class="btn"
            onClick$={() => {
              const r = devices.balance.state.stable;
              if (!r) {
                state.wizard.uiError = '天平尚无稳定读数（ST）';
                return;
              }
              store.setBulkField('grossMassG', Math.round(r.massG * 100) / 100);
              state.wizard.uiError = null;
            }}
          >
            引用天平稳定读数
          </button>
        </div>

        <div class="row">
          <label>
            松装体积 V0 (mL)
            <input
              type="number"
              step="0.5"
              value={d.looseVolumeMl ?? ''}
              onInput$={(e) => store.setBulkField('looseVolumeMl', num(e.target))}
            />
          </label>
          <label>
            周向最高 (mL)
            <input
              type="number"
              step="0.5"
              value={d.looseVolumeMaxMl ?? ''}
              onInput$={(e) => store.setBulkField('looseVolumeMaxMl', num(e.target))}
            />
          </label>
          <label>
            周向最低 (mL)
            <input
              type="number"
              step="0.5"
              value={d.looseVolumeMinMl ?? ''}
              onInput$={(e) => store.setBulkField('looseVolumeMinMl', num(e.target))}
            />
          </label>
        </div>
        {tilt != null && (
          <p class={tilt > cyl.maxTiltDeltaMl ? 'inline-err' : 'ok-text'}>
            粉面周向读数差 {tilt} mL（限值 {cyl.maxTiltDeltaMl} mL）
            {tilt > cyl.maxTiltDeltaMl ? '：粉面倾斜超差，需刮平重读' : '：合格'}
          </p>
        )}

        <ExposureBadge min={exposure.value} limit={method.maxExposureMin} />

        <div class="nav-row">
          <button class="btn ghost" onClick$={() => store.gotoStep('fill')}>
            返回
          </button>
          <button
            class="btn primary"
            disabled={d.looseVolumeMl == null}
            onClick$={() => store.gotoStep('tap')}
          >
            固定 V0，进入振实（不可再回改松装）
          </button>
        </div>
        <p class="muted small">
          进入振实后 aliquot 阶段推进；把振实粉回退当初始松装会被系统阻止。
        </p>
      </section>
      <section class="card center">
        <CylinderGauge
          nominalMl={cyl.nominalMl}
          graduationMl={cyl.graduationMl}
          looseVolumeMl={d.looseVolumeMl}
          maxMl={d.looseVolumeMaxMl}
          minMl={d.looseVolumeMinMl}
          tiltBad={tilt != null && tilt > cyl.maxTiltDeltaMl}
          phase="loose"
        />
      </section>
    </div>
  );
});

/* ---------------- 步骤 3：振实 ---------------- */

export const StepTap = component$(() => {
  const store = useContext(LabStoreContext);
  const devices = useContext(DeviceContext);
  const { state } = store;
  const d = state.wizard.draft;
  const cyl = state.cylinders.find((c) => c.id === state.wizard.cylinderId);
  const method = state.methods.find((m) => m.id === state.wizard.methodId);
  const exposure = useTickExposure(d?.exposureStartedAt ?? null);

  useVisibleTask$(() => {
    const unsub = devices.subscribe(() => {
      const c = devices.counter.state;
      if (state.wizard.step === 'tap' && state.wizard.draft?.kind === 'bulk') {
        store.setTap(c.count, c.interrupted);
      }
    });
    return () => unsub();
  });

  if (!d || d.kind !== 'bulk' || !cyl || !method) return <p class="muted">无振实草案</p>;
  const progress = Math.min(1, d.tapCount / d.tapTarget);
  const preview = previewBulk(
    d,
    method.formulas.map((f) => f.id),
  );

  return (
    <div class="grid two">
      <section class="card">
        <h3>振实计数与 Vt 读数</h3>
        <div class="counter-box">
          <div class="counter-num">
            {d.tapCount}
            <small>{` / ${d.tapTarget} 次`}</small>
          </div>
          <div class="bar">
            <div
              class={d.tapInterrupted ? 'bar-fill bad' : 'bar-fill'}
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <div class="btn-row wrap">
            <button class="btn small" onClick$={() => devices.counter.manualPulse()}>
              手动 +1
            </button>
            <button
              class="btn small"
              onClick$={() => store.setTap(d.tapCount + 10, d.tapInterrupted)}
            >
              +10
            </button>
            <button
              class="btn small warn"
              onClick$={() => {
                devices.counter.interrupt();
                store.setTap(d.tapCount, true);
              }}
            >
              模拟计数中断
            </button>
            <button
              class="btn small ghost"
              onClick$={() => {
                devices.counter.resetCount();
                store.setTap(0, false);
              }}
            >
              复位计数器（须另取新样重测）
            </button>
          </div>
          {d.tapInterrupted && (
            <p class="inline-err">
              振实计数中断已锁定：按方法本测次判废，同一 aliquot 不得续数或回当松装样；请丢弃并分装新
              aliquot。
            </p>
          )}
        </div>

        <label>
          振实后体积 Vt (mL)
          <input
            type="number"
            step="0.5"
            value={d.tappedVolumeMl ?? ''}
            onInput$={(e) => store.setBulkField('tappedVolumeMl', num(e.target))}
          />
        </label>

        <ExposureBadge min={exposure.value} limit={method.maxExposureMin} />

        <h4>实验员现场确认</h4>
        <Flags kind="bulk" />

        <div class="nav-row">
          <button class="btn ghost" onClick$={() => store.gotoStep('loose')}>
            返回
          </button>
          <button
            class="btn ghost warn"
            onClick$={() => {
              if (confirm('丢弃当前 aliquot？该份试样将标记为已废弃，需重新分装。'))
                store.discardAliquot('振实阶段手动丢弃');
            }}
          >
            丢弃 aliquot 另取新样
          </button>
          <button class="btn primary" onClick$={() => store.gotoStep('review')}>
            进入读数复核
          </button>
        </div>
      </section>
      <section class="card center">
        <CylinderGauge
          nominalMl={cyl.nominalMl}
          graduationMl={cyl.graduationMl}
          looseVolumeMl={d.looseVolumeMl}
          tappedVolumeMl={d.tappedVolumeMl}
          maxMl={d.looseVolumeMaxMl}
          minMl={d.looseVolumeMinMl}
          phase={d.tappedVolumeMl != null || d.tapCount >= d.tapTarget ? 'tapped' : 'loose'}
        />
        <p class="muted small">
          松装密度预览 {fmt(preview.bulk, 3)} g/mL；振实密度预览 {fmt(preview.tapped, 3)} g/mL
          （预览非正式结果，复核通过才随有效测次记录）
        </p>
      </section>
    </div>
  );
});

/* ---------------- 步骤 4：漏斗流动 ---------------- */

export const StepFlow = component$(() => {
  const store = useContext(LabStoreContext);
  const devices = useContext(DeviceContext);
  const { state } = store;
  const d = state.wizard.draft;
  const method = state.methods.find((m) => m.id === state.wizard.methodId);
  const exposure = useTickExposure(d?.exposureStartedAt ?? null);
  const flowStart = useSignal<number | null>(null);
  const live = useSignal<number | null>(null);
  const aliquot = state.aliquots.find((a) => a.id === d?.aliquotId);

  useVisibleTask$(({ cleanup }) => {
    const t = setInterval(() => {
      if (flowStart.value != null) live.value = (Date.now() - flowStart.value) / 1000;
    }, 100);
    cleanup(() => clearInterval(t));
  });

  if (!d || d.kind !== 'flow' || !method) return <p class="muted">无流动草案</p>;

  // 装粉量经“称取并锁定”后随 aliquot 阶段锁定，禁止再改写称量值
  const chargeLocked = aliquot != null && aliquot.phase !== 'fresh';

  const fstate = d.outletSticking
    ? 'stuck'
    : aliquot?.phase === 'flow_discharged'
      ? 'done'
      : flowStart.value != null
        ? 'discharging'
        : aliquot?.phase === 'flow_loaded'
          ? 'loaded'
          : 'empty';

  return (
    <div class="grid two">
      <section class="card">
        <h3>{`漏斗流动时间（标准装粉 ${method.flowChargeG} g）`}</h3>
        <div class="read-row">
          <label>
            装粉量 (g)
            <input
              type="number"
              step="0.1"
              value={d.chargeMassG ?? ''}
              disabled={chargeLocked}
              onInput$={(e) => store.setFlowField('chargeMassG', num(e.target))}
            />
          </label>
          <button
            class="btn"
            disabled={chargeLocked}
            onClick$={() => {
              const r = devices.balance.state.stable;
              if (!r) {
                state.wizard.uiError = '天平尚无稳定读数（ST）';
                return;
              }
              state.wizard.uiError =
                store.startFlowLoad(Math.round(r.massG * 100) / 100) ?? null;
            }}
          >
            称取并锁定“已装粉”
          </button>
        </div>
        {chargeLocked && (
          <p class="muted small">
            装粉量已锁定（aliquot 已装粉/已流出），不得改写；如需更改请丢弃当前 aliquot 另取新样。
          </p>
        )}

        <div class="counter-box">
          <div class="counter-num">
            {live.value != null ? live.value.toFixed(2) : fmt(d.flowTimeS)} s
          </div>
          <div class="btn-row wrap">
            <button
              class="btn primary"
              disabled={aliquot?.phase !== 'flow_loaded' || flowStart.value != null}
              onClick$={() => {
                flowStart.value = Date.now();
              }}
            >
              放开漏斗（开始 t1）
            </button>
            <button
              class="btn"
              disabled={flowStart.value == null}
              onClick$={() => {
                if (flowStart.value == null) return;
                const t = (Date.now() - flowStart.value) / 1000;
                state.wizard.uiError = store.markFlowDischarged(t) ?? null;
                flowStart.value = null;
                live.value = null;
              }}
            >
              最后一粒落下（停止 t2）
            </button>
          </div>
        </div>

        <div class="read-row">
          <label>
            漏斗残留质量 (g)
            <input
              type="number"
              step="0.01"
              value={d.residueMassG ?? ''}
              onInput$={(e) => store.setFlowField('residueMassG', num(e.target))}
            />
          </label>
          <button
            class="btn"
            onClick$={() => {
              const r = devices.balance.state.stable;
              if (!r) {
                state.wizard.uiError = '天平尚无稳定读数（ST）';
                return;
              }
              store.setFlowField('residueMassG', Math.round(r.massG * 100) / 100);
              state.wizard.uiError = null;
            }}
          >
            天平称残留
          </button>
        </div>
        <label class="check">
          <input
            type="checkbox"
            checked={d.outletSticking}
            onChange$={(e) =>
              store.setFlowField('outletSticking', (e.target as HTMLInputElement).checked)
            }
          />
          确认漏斗口粘粉（流道挂粉、出口堵塞）
        </label>

        <ExposureBadge min={exposure.value} limit={method.maxExposureMin} />
        <h4>实验员现场确认</h4>
        <Flags kind="flow" />

        <div class="nav-row">
          <button class="btn ghost" onClick$={() => store.gotoStep('fill')}>
            返回
          </button>
          <button
            class="btn ghost warn"
            onClick$={() => {
              if (confirm('丢弃当前 aliquot？')) store.discardAliquot('流动阶段手动丢弃');
            }}
          >
            丢弃 aliquot
          </button>
          <button class="btn primary" onClick$={() => store.gotoStep('review')}>
            进入读数复核
          </button>
        </div>
      </section>
      <section class="card center">
        <FunnelDiagram state={fstate} residueG={d.residueMassG} />
      </section>
    </div>
  );
});

/* ---------------- 步骤 5：复核 ---------------- */

export const StepReview = component$(() => {
  const store = useContext(LabStoreContext);
  const { state } = store;
  const d = state.wizard.draft;
  const method = state.methods.find((m) => m.id === state.wizard.methodId);
  const cyl = state.cylinders.find((c) => c.id === state.wizard.cylinderId);
  const exposure = useTickExposure(d?.exposureStartedAt ?? null);
  const savedId = useSignal<string | null>(null);

  if (!d || !method) return <p class="muted">无待复核数据</p>;
  const issues = store.review();
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  const bulkPreview =
    d.kind === 'bulk' && cyl
      ? previewBulk(
          d,
          method.formulas.map((f) => f.id),
        )
      : null;

  return (
    <div class="grid two">
      <section class="card">
        <h3>读数复核（按已批准方法 {method.code} {method.version}）</h3>
        <SampleInfo compact />
        <table class="review-table">
          <tbody>
            {d.kind === 'bulk' && (
              <>
                <tr>
                  <th>量筒</th>
                  <td>
                    {cyl?.name}（台账皮重 {cyl?.listedTareG} g）
                  </td>
                </tr>
                <tr>
                  <th>装粉方式</th>
                  <td>{FILL_MODE_LABEL[d.fillMode]}</td>
                </tr>
                <tr>
                  <th>皮重 m0</th>
                  <td>{fmt(d.tareMassG)} g</td>
                </tr>
                <tr>
                  <th>毛重 m1</th>
                  <td>{fmt(d.grossMassG)} g</td>
                </tr>
                <tr>
                  <th>净重 m1−m0</th>
                  <td>{fmt(bulkPreview?.net ?? null)} g</td>
                </tr>
                <tr>
                  <th>松装体积 V0</th>
                  <td>
                    {fmt(d.looseVolumeMl, 1)} mL（周向 {fmt(d.looseVolumeMinMl, 0)}–
                    {fmt(d.looseVolumeMaxMl, 0)}）
                  </td>
                </tr>
                <tr>
                  <th>振实 Vt</th>
                  <td>{fmt(d.tappedVolumeMl, 1)} mL</td>
                </tr>
                <tr>
                  <th>振实次数</th>
                  <td>
                    {`${d.tapCount}/${d.tapTarget}`}
                    {d.tapInterrupted ? '，中断' : ''}
                  </td>
                </tr>
              </>
            )}
            {d.kind === 'flow' && (
              <>
                <tr>
                  <th>装粉量</th>
                  <td>
                    {`${fmt(d.chargeMassG)} g（标准 ${method.flowChargeG} g）`}
                  </td>
                </tr>
                <tr>
                  <th>流出时间</th>
                  <td>{fmt(d.flowTimeS)} s</td>
                </tr>
                <tr>
                  <th>残留质量</th>
                  <td>{fmt(d.residueMassG)} g</td>
                </tr>
                <tr>
                  <th>漏斗口粘粉</th>
                  <td>{d.outletSticking ? '是' : '否'}</td>
                </tr>
              </>
            )}
            <tr>
              <th>暴露时长</th>
              <td>
                {`${fmt(exposure.value, 1)} min（限值 ${method.maxExposureMin}）`}
              </td>
            </tr>
            <tr>
              <th>备注</th>
              <td>{d.note || '—'}</td>
            </tr>
          </tbody>
        </table>

        <h4>实验员确认（可在此修改）</h4>
        <Flags kind={d.kind} />
        <label>
          备注
          <textarea
            rows={2}
            value={d.note}
            onInput$={(e) => store.setNote(d.kind, (e.target as HTMLTextAreaElement).value)}
          />
        </label>

        {errors.length > 0 && (
          <div class="issue-box err">
            <h4>判废项（{errors.length}）</h4>
            <ul>
              {errors.map((i) => (
                <li key={i.code}>
                  <code>{i.code}</code> {i.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {warnings.length > 0 && (
          <div class="issue-box warn">
            <h4>提示（{warnings.length}）</h4>
            <ul>
              {warnings.map((i) => (
                <li key={i.code}>
                  <code>{i.code}</code> {i.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div class="nav-row">
          <button
            class="btn ghost"
            onClick$={() => store.gotoStep(d.kind === 'bulk' ? 'tap' : 'flow')}
          >
            返回修改
          </button>
          <button
            class="btn ghost warn"
            onClick$={() => {
              if (confirm('中止本测次？aliquot 将标记为已废弃。'))
                store.abortWizard('复核阶段中止');
            }}
          >
            中止并废弃 aliquot
          </button>
          <button
            class={errors.length === 0 && d.flags.acceptedReplicate ? 'btn primary' : 'btn'}
            disabled={d.flags.acceptedReplicate && errors.length > 0}
            onClick$={() => {
              const r = store.saveRun();
              if (r.runId) savedId.value = r.runId;
            }}
          >
            {d.flags.acceptedReplicate
              ? errors.length > 0
                ? '存在判废项，不能记为有效测次'
                : '确认保存为有效测次'
              : '留档保存（不计入有效测次）'}
          </button>
        </div>
        {savedId.value && (
          <p class="ok-text">已保存到本机 IndexedDB，记录号 {savedId.value}</p>
        )}
      </section>

      <section class="card">
        <h3>结果（仅已批准公式）</h3>
        {d.kind === 'bulk' ? (
          errors.length === 0 ? (
            <div class="result-box">
              <div>
                ρb = (m1−m0)/V0 = <strong>{fmt(bulkPreview?.bulk ?? null, 3)}</strong> g/mL
              </div>
              <div>
                ρt = (m1−m0)/Vt = <strong>{fmt(bulkPreview?.tapped ?? null, 3)}</strong> g/mL
              </div>
              <p class="muted small">Vt 未读数时 ρt 暂缺；密度保留 3 位小数。</p>
            </div>
          ) : (
            <p class="inline-err">
              存在判废项：系统不给出密度结果，请按判废提示纠正并另取 aliquot。
            </p>
          )
        ) : errors.length === 0 ? (
          <div class="result-box">
            t = t2−t1 = <strong>{fmt(d.flowTimeS)}</strong> s（保留 2 位小数）
          </div>
        ) : (
          <p class="inline-err">存在判废项：流动时间不具代表性，系统不计为有效结果。</p>
        )}
        <p class="muted small">
          本系统仅记录与计算方法内的松装密度、振实密度、流动时间；不评价冲调性/口感，不输出生产参数建议。
        </p>
      </section>
    </div>
  );
});

/* ---------------- 公共小部件 ---------------- */

export const ExposureBadge = component$<{ min: number | null; limit: number }>(
  ({ min, limit }) => {
    if (min == null) return null;
    const over = min > limit;
    return (
      <p class={over ? 'inline-err' : 'ok-text'}>
        开封暴露计时：{min.toFixed(1)} min / 限值 {limit} min
        {over ? '（超限：等待吸湿判废）' : ''}
      </p>
    );
  },
);

export const Flags = component$<{ kind: 'bulk' | 'flow' }>(({ kind }) => {
  const store = useContext(LabStoreContext);
  const d: Draft | null = store.state.wizard.draft;
  if (!d || d.kind !== kind) return null;
  const items: [keyof typeof d.flags, string][] = [
    ['caking', '结团'],
    ['bridging', '架桥/成拱'],
    ['spillage', '洒失'],
    ['moistureAbsorbed', '等待期间疑似吸湿'],
    ['acceptedReplicate', '本测次读数有效（计入有效测次）'],
  ];
  return (
    <div class="flags">
      {items.map(([k, label]) => (
        <label class="check" key={k}>
          <input
            type="checkbox"
            checked={d.flags[k]}
            onChange$={(e) =>
              store.setFlag(kind, k, (e.target as HTMLInputElement).checked)
            }
          />
          {label}
        </label>
      ))}
    </div>
  );
});

export const SampleInfo = component$<{ compact?: boolean }>(({ compact }) => {
  const store = useContext(LabStoreContext);
  const s = store.state.samples.find((x) => x.id === store.state.wizard.sampleId);
  if (!s) return <p class="muted">未选择样品</p>;
  return (
    <div class={compact ? 'sample-info compact' : 'sample-info'}>
      <strong>{s.sampleCode}</strong> {s.productName} · 批 {s.batchNo}
      <div>开封时间：{fmtDt(s.openedAt)}</div>
      <div>调湿状态：{CONDITIONING_LABEL[s.conditioning]}</div>
      {!compact && <div>aliquot 阶段随试验推进并锁定（fresh → 松装 → 振实/已流完）</div>}
    </div>
  );
});

export const CheckList = component$<{ items: string[] }>(({ items }) => (
  <ul class="checklist">
    {items.map((t) => (
      <li key={t}>
        <span class="box">☐</span> {t}
      </li>
    ))}
  </ul>
));
