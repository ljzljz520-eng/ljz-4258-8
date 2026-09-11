import {
  component$,
  useContext,
  useSignal,
  useStore,
  useVisibleTask$,
} from '@builder.io/qwik';
import {
  CONDITIONING_LABEL,
  type ExposureSession,
  type ExposureStatus,
} from '../domain/types';
import { LabStoreContext } from '../state/store';
import {
  EXPOSURE_RULES,
  exposureDurationMin,
} from '../domain/exposure';

const fmt = (v: number | null | undefined, d = 2) =>
  v == null || !Number.isFinite(v) ? '—' : v.toFixed(d);
const dtLocal = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '—';
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
    d.getHours(),
  )}:${p(d.getMinutes())}`;
}

const STATUS_LABEL: Record<ExposureStatus, string> = {
  open: '敞口中',
  closed: '已封口（可用）',
  invalid: '已判废',
};

/* ============ 新建暴露会话 ============ */

const NewExposureForm = component$(() => {
  const store = useContext(LabStoreContext);
  const err = useSignal<string | null>(null);
  const form = useStore({
    sampleId: store.state.wizard.sampleId ?? '',
    trayId: '',
    openedAt: toLocalInput(new Date().toISOString()),
    loggerStartedAt: '',
    layerThicknessMm: '' as string | number,
    trayTareG: '' as string | number,
    initialPowderMassG: '' as string | number,
    note: '',
  });
  useVisibleTask$(() => {
    if (!form.sampleId && store.state.samples[0]) {
      form.sampleId = store.state.samples[0].id;
    }
  });

  return (
    <section class="card">
      <h3>新建短时高湿敞口暴露会话</h3>
      <p class="muted small">
        目标 ≥{EXPOSURE_RULES.targetRh}%RH、约 {EXPOSURE_RULES.targetDurationMin}{' '}
        min；记录敞口起止、样层厚度与环境曲线。暴露分支与原样常规试验数据隔离，
        <strong>不得用暴露后结果回写原样</strong>。
      </p>
      <label>
        暴露原样（仅引用，不修改其记录）
        <select
          value={form.sampleId}
          onChange$={(e) => (form.sampleId = (e.target as HTMLSelectElement).value)}
        >
          {store.state.samples.map((s) => (
            <option
              value={s.id}
              label={`${s.sampleCode} · ${s.productName} · 批 ${s.batchNo}`}
            />
          ))}
        </select>
      </label>
      <div class="row">
        <label>
          样盘编号
          <input
            value={form.trayId}
            placeholder="如 盘A"
            onInput$={(e) => (form.trayId = (e.target as HTMLInputElement).value)}
          />
        </label>
        <label>
          样盘皮重 (g)
          <input
            type="number"
            step="0.1"
            value={form.trayTareG}
            onInput$={(e) => (form.trayTareG = (e.target as HTMLInputElement).value)}
          />
        </label>
        <label>
          敞口粉层总质量 (g)
          <input
            type="number"
            step="0.1"
            value={form.initialPowderMassG}
            onInput$={(e) => (form.initialPowderMassG = (e.target as HTMLInputElement).value)}
          />
        </label>
      </div>
      <div class="row">
        <label>
          敞口开始（观察时刻）
          <input
            type="datetime-local"
            value={form.openedAt}
            onInput$={(e) => (form.openedAt = (e.target as HTMLInputElement).value)}
          />
        </label>
        <label>
          样层初始厚度 (mm)
          <input
            type="number"
            step="0.1"
            value={form.layerThicknessMm}
            onInput$={(e) => (form.layerThicknessMm = (e.target as HTMLInputElement).value)}
          />
        </label>
      </div>
      <label>
        湿度记录器启动时刻（晚于敞口 {EXPOSURE_RULES.maxLoggerLateMin} min 以上将判
        LOGGER_LATE_START；本次不启动请留空）
        <input
          type="datetime-local"
          value={form.loggerStartedAt}
          onInput$={(e) => (form.loggerStartedAt = (e.target as HTMLInputElement).value)}
        />
      </label>
      <label>
        备注
        <input
          value={form.note}
          onInput$={(e) => (form.note = (e.target as HTMLInputElement).value)}
        />
      </label>
      {err.value && <p class="inline-err">{err.value}</p>}
      <button
        class="btn primary big"
        disabled={!form.sampleId}
        onClick$={() => {
          err.value =
            store.createExposure({
              sampleId: form.sampleId,
              trayId: form.trayId,
              openedAt: form.openedAt || undefined,
              loggerStartedAt: form.loggerStartedAt || null,
              layerThicknessMm:
                form.layerThicknessMm === '' ? null : Number(form.layerThicknessMm),
              trayTareG: form.trayTareG === '' ? null : Number(form.trayTareG),
              initialPowderMassG:
                form.initialPowderMassG === '' ? null : Number(form.initialPowderMassG),
              note: form.note,
            }) ?? null;
        }}
      >
        开始敞口暴露（记录器曲线随后逐笔录入）
      </button>
    </section>
  );
});

/* ============ 单个暴露会话详情 ============ */

const SessionCard = component$<{ session: ExposureSession }>(({ session: s }) => {
  const store = useContext(LabStoreContext);
  const sample = store.state.samples.find((x) => x.id === s.sampleId);
  const tick = useSignal(0);
  const env = useStore({ rh: '' as string | number, tempC: '' as string | number, at: '' });
  const wd = useStore({ massG: '' as string | number, purpose: '', at: toLocalInput(new Date().toISOString()) });
  const closeAt = useSignal(toLocalInput(new Date().toISOString()));
  const newSub = useStore({ subCode: '', massG: '' as string | number });
  const envErr = useSignal<string | null>(null);
  const wdErr = useSignal<string | null>(null);
  const subErr = useSignal<string | null>(null);
  const closeErr = useSignal<string | null>(null);

  useVisibleTask$(({ cleanup }) => {
    const t = setInterval(() => (tick.value++), 5000);
    cleanup(() => clearInterval(t));
  });
  void tick.value;

  const issues = store.reviewExposure(s.id);
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  const dur = exposureDurationMin(s);
  const withdrawnTotal = s.withdrawals.reduce((a, w) => a + w.massG, 0);
  const maxRh = s.curve.length ? Math.max(...s.curve.map((p) => p.rh)) : null;
  const usable = s.status === 'closed' && errors.length === 0;
  const subs = store.state.subSamples.filter((x) => x.exposureSessionId === s.id);

  return (
    <section class={`card exposure ${s.status === 'invalid' ? 'invalid-card' : ''}`}>
      <div class="exp-head">
        <h3>
          暴露会话 <code>{s.id.slice(-6)}</code> · {s.trayId}
          <span class={`tag ${s.status === 'invalid' ? 'invalid' : s.status === 'closed' ? 'ok' : 'warn'}`}>
            {STATUS_LABEL[s.status]}
          </span>
        </h3>
        <div class="muted small">
          {sample?.sampleCode} {sample?.productName}（{CONDITIONING_LABEL[sample?.conditioning ?? 'as_received']}）
        </div>
      </div>

      <table class="review-table">
        <tbody>
          <tr><th>敞口开始</th><td>{dtLocal(s.openedAt)}</td></tr>
          <tr><th>封口时间</th><td>{dtLocal(s.closedAt)}</td></tr>
          <tr>
            <th>时长</th>
            <td>{dur != null ? `${dur.toFixed(1)} min（目标 ${EXPOSURE_RULES.targetDurationMin} min）` : '—'}</td>
          </tr>
          <tr>
            <th>记录器启动</th>
            <td>
              {dtLocal(s.loggerStartedAt)}
              {s.loggerStartedAt && (
                <small>
                  较敞口
                  {(
                    (Date.parse(s.loggerStartedAt) - Date.parse(s.openedAt)) /
                    60000
                  ).toFixed(1)}{' '}
                  min（容差 {EXPOSURE_RULES.maxLoggerLateMin}）
                </small>
              )}
            </td>
          </tr>
          <tr>
            <th>样层厚度</th>
            <td>
              初始 {fmt(s.layerThicknessMm, 1)} mm
              {s.layerThicknessAfterMm != null
                ? ` → 取走后 ${fmt(s.layerThicknessAfterMm, 1)} mm`
                : s.withdrawals.length
                  ? '（取走后厚度待复测）'
                  : ''}
            </td>
          </tr>
          <tr>
            <th>粉量衡算</th>
            <td>
              盘皮重 {fmt(s.trayTareG)} g｜敞口粉 {fmt(s.initialPowderMassG)} g｜取走合计{' '}
              {fmt(withdrawnTotal)} g
              {s.initialPowderMassG != null
                ? `｜剩余 ${fmt(s.initialPowderMassG - withdrawnTotal)} g`
                : ''}
            </td>
          </tr>
          <tr><th>曲线</th><td>{s.curve.length} 点{s.curve.length ? `，最高 ${fmt(maxRh, 0)}%RH` : ''}</td></tr>
          <tr><th>局部结露</th><td>{s.localCondensation ? '确认结露（判废）' : '未确认'}</td></tr>
          <tr><th>备注</th><td>{s.note || '—'}</td></tr>
        </tbody>
      </table>

      {errors.length > 0 && (
        <div class="issue-box err">
          <h4>判废项（{errors.length}）——本会话不得产生子样测次</h4>
          <ul>{errors.map((i) => <li key={i.code}><code>{i.code}</code> {i.message}</li>)}</ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div class="issue-box warn">
          <h4>提示（{warnings.length}）</h4>
          <ul>{warnings.map((i) => <li key={i.code}><code>{i.code}</code> {i.message}</li>)}</ul>
        </div>
      )}

      {/* 环境曲线录入 */}
      {!s.closedAt && (
        <div class="exp-sub">
          <h4>环境曲线采样（%RH / ℃）</h4>
          <div class="row">
            <label>时刻
              <input type="datetime-local" value={env.at} onInput$={(e) => (env.at = (e.target as HTMLInputElement).value)} />
            </label>
            <label>相对湿度 %RH
              <input type="number" step="1" value={env.rh} onInput$={(e) => (env.rh = (e.target as HTMLInputElement).value)} />
            </label>
            <label>温度 ℃
              <input type="number" step="0.1" value={env.tempC} onInput$={(e) => (env.tempC = (e.target as HTMLInputElement).value)} />
            </label>
          </div>
          {envErr.value && <p class="inline-err">{envErr.value}</p>}
          <button class="btn small" onClick$={() => {
            envErr.value = store.addEnvPoint(s.id, {
              rh: Number(env.rh),
              tempC: Number(env.tempC),
              at: env.at || undefined,
            });
            if (!envErr.value) { env.rh = ''; env.tempC = ''; }
          }}>追加采样点</button>
          {s.curve.length > 0 && (
            <ul class="point-list">
              {s.curve.slice(-5).map((p) => (
                <li key={p.at}>{dtLocal(p.at)}：{p.rh.toFixed(0)}%RH · {p.tempC.toFixed(1)}℃</li>
              ))}
              {s.curve.length > 5 && <li class="muted">…共 {s.curve.length} 点</li>}
            </ul>
          )}
        </div>
      )}

      {/* 暴露中取走一部分 */}
      {!s.closedAt && (
        <div class="exp-sub">
          <h4>暴露中取走一部分（逐笔登记）</h4>
          <div class="row">
            <label>取走时刻
              <input type="datetime-local" value={wd.at} onInput$={(e) => (wd.at = (e.target as HTMLInputElement).value)} />
            </label>
            <label>取走质量 g
              <input type="number" step="0.1" value={wd.massG} onInput$={(e) => (wd.massG = (e.target as HTMLInputElement).value)} />
            </label>
            <label>用途
              <input value={wd.purpose} placeholder="如 水分快测" onInput$={(e) => (wd.purpose = (e.target as HTMLInputElement).value)} />
            </label>
          </div>
          {wdErr.value && <p class="inline-err">{wdErr.value}</p>}
          <button class="btn small" onClick$={() => {
            wdErr.value = store.addWithdrawal(s.id, {
              at: wd.at || new Date().toISOString(),
              massG: Number(wd.massG),
              purpose: wd.purpose,
            });
            if (!wdErr.value) { wd.massG = ''; wd.purpose = ''; }
          }}>登记一笔取走</button>
          {s.withdrawals.length > 0 && (
            <ul class="point-list">
              {s.withdrawals.map((w) => (
                <li key={w.id}>{dtLocal(w.at)}：取走 {w.massG.toFixed(2)} g（{w.purpose}）</li>
              ))}
            </ul>
          )}
          <label>
            取走后复测样层厚度 (mm)
            <input
              type="number"
              step="0.1"
              value={s.layerThicknessAfterMm ?? ''}
              onInput$={(e) =>
                store.setExposureField(
                  s.id,
                  'layerThicknessAfterMm',
                  (e.target as HTMLInputElement).value === ''
                    ? null
                    : Number((e.target as HTMLInputElement).value),
                )
              }
            />
          </label>
        </div>
      )}

      {/* 现场确认 + 封口 */}
      {!s.closedAt && (
        <div class="exp-sub">
          <label class="check">
            <input
              type="checkbox"
              checked={s.localCondensation}
              onChange$={(e) =>
                store.setExposureField(s.id, 'localCondensation', (e.target as HTMLInputElement).checked)
              }
            />
            确认样盘局部结露（盘壁/粉面水珠）——勾选后封口将判 DISH_CONDENSATION，整盘废弃
          </label>
          <div class="row">
            <label>封口时间
              <input type="datetime-local" value={closeAt.value} onChange$={(e) => (closeAt.value = (e.target as HTMLInputElement).value)} />
            </label>
          </div>
          {closeErr.value && <p class="inline-err">{closeErr.value}</p>}
          <button class="btn primary" onClick$={() => {
            closeErr.value = store.closeExposure(s.id, closeAt.value || new Date().toISOString());
          }}>封口并复核（判废则该会话不可取子样）</button>
        </div>
      )}

      {s.status === 'invalid' && (
        <p class="inline-err">会话已判废：禁止从该盘取子样；如需暴露后数据，请另取原样重新暴露。</p>
      )}

      {/* 独立子样 */}
      {s.closedAt && (
        <div class="exp-sub">
          <h4>暴露后独立子样（独立编号，不复用原样编号；禁止回掺原样）</h4>
          {!usable && <p class="inline-err">会话存在判废项，以下子样不得用于物性试验。</p>}
          <ul class="sub-list">
            {subs.map((sub) => {
              const massOkBulk = sub.massG != null && sub.massG >= EXPOSURE_RULES.minBulkAliquotMassG;
              const massOkFlow = sub.massG != null && sub.massG >= EXPOSURE_RULES.minFlowAliquotMassG;
              return (
                <li key={sub.id}>
                  <strong>{sub.subCode}</strong> · {fmt(sub.massG)} g
                  <small>
                    松装/振实≥{EXPOSURE_RULES.minBulkAliquotMassG}g：
                    {massOkBulk ? '够' : '不足'}｜流动≥{EXPOSURE_RULES.minFlowAliquotMassG}g：
                    {massOkFlow ? '够' : '不足'}
                  </small>
                  <span class="btn-row">
                    <button
                      class="btn small"
                      disabled={!usable || !massOkBulk}
                      title={!massOkBulk ? '子样质量不足，不能做松装/振实' : ''}
                      onClick$={() => {
                        const e = store.startSubSampleWizard('bulk', sub.id);
                        if (e) closeErr.value = e;
                      }}
                    >
                      用此子样做松装/振实
                    </button>
                    <button
                      class="btn small"
                      disabled={!usable || !massOkFlow}
                      title={!massOkFlow ? '子样质量不足，不能做漏斗流动' : ''}
                      onClick$={() => {
                        const e = store.startSubSampleWizard('flow', sub.id);
                        if (e) closeErr.value = e;
                      }}
                    >
                      用此子样做漏斗流动
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
          {usable && (
            <div class="row">
              <label>新子样编号
                <input value={newSub.subCode} onInput$={(e) => (newSub.subCode = (e.target as HTMLInputElement).value)} placeholder={`如 ${sample?.sampleCode}-RH-S1`} />
              </label>
              <label>子样称取质量 g
                <input type="number" step="0.1" value={newSub.massG} onInput$={(e) => (newSub.massG = (e.target as HTMLInputElement).value)} />
              </label>
            </div>
          )}
          {subErr.value && <p class="inline-err">{subErr.value}</p>}
          {usable && (
            <button class="btn small" onClick$={() => {
              subErr.value = store.createSubSample(s.id, {
                subCode: newSub.subCode,
                massG: newSub.massG === '' ? null : Number(newSub.massG),
              });
              if (!subErr.value) { newSub.subCode = ''; newSub.massG = ''; }
            }}>称取并登记独立子样</button>
          )}
        </div>
      )}
    </section>
  );
});

/* ============ 暴露分支主面板 ============ */

export const ExposurePanel = component$(() => {
  const store = useContext(LabStoreContext);
  const sessions = store.state.exposureSessions;
  return (
    <main class="content">
      <div class="banner scope-banner">
        <strong>短时高湿暴露分支：</strong>
        记录敞口起止、样层厚度、环境曲线与取走登记；封口复核通过后以<strong>独立子样</strong>重复物性试验。
        暴露子样结果单独成组（记录标注“暴露后·子样编号”），<strong>绝不回写或并入原样</strong>。
      </div>
      <NewExposureForm />
      {sessions
        .slice()
        .reverse()
        .map((s) => (
          <SessionCard key={s.id} session={s} />
        ))}
      {sessions.length === 0 && (
        <section class="card muted center">尚无高湿暴露会话</section>
      )}
    </main>
  );
});
