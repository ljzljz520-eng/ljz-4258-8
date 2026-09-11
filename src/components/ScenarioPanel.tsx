import { component$, useContext, useSignal } from '@builder.io/qwik';
import {
  LabStoreContext,
  type ExposeScenarioId,
  type ScenarioId,
} from '../state/store';

const SCENARIOS: {
  id: ScenarioId;
  title: string;
  desc: string;
  kind: 'wizard-bulk' | 'wizard-flow';
}[] = [
  { id: 'wrong_tare', title: '量筒皮重错用', desc: '实测皮重 58.4 g 与台账 46.2 g 不符', kind: 'wizard-bulk' },
  { id: 'tilt', title: '粉面倾斜', desc: '周向读数差 6 mL 超过 2 mL 限值', kind: 'wizard-bulk' },
  { id: 'tap_interrupt', title: '振实计数中断', desc: '463/500 且脉冲中断，判废', kind: 'wizard-bulk' },
  { id: 'funnel_stick', title: '漏斗口粘粉', desc: '出口挂粉、残留 3.4 g', kind: 'wizard-flow' },
  { id: 'moisture', title: '等待期吸湿', desc: '开封暴露超过 10 min 限值', kind: 'wizard-flow' },
];

/** 高湿暴露分支新增的五个异常场景 */
const EXPOSURE_SCENARIOS: {
  id: ExposeScenarioId;
  title: string;
  desc: string;
  kind: 'exposure' | 'wizard-flow' | 'wizard-bulk';
}[] = [
  { id: 'logger_late', title: '记录器晚启动', desc: '晚于敞口 8 min，曲线前段缺失', kind: 'exposure' },
  { id: 'dish_condensation', title: '样盘局部结露', desc: '盘壁/粉面水珠，整盘判废', kind: 'exposure' },
  { id: 'mid_withdrawal', title: '暴露中取走一部分', desc: '取走 40 g 已登记并复测厚度', kind: 'exposure' },
  { id: 'subsample_short', title: '暴露子样质量不足', desc: '独立子样仅 60 g < 流动 100 g', kind: 'wizard-flow' },
  { id: 'funnel_shared_dirty', title: '共用未清洁漏斗', desc: '全脂 A 用完未清洁即测脱脂 B', kind: 'wizard-flow' },
];

/**
 * 指定测试场景一键演练：注入演示样/暴露会话/草案并直达对应页面。
 * 原 5 个场景进“读数复核”；暴露分支场景进“高湿暴露”或对应向导步。
 */
export const ScenarioPanel = component$<{
  onInjected?: (
    kind: 'exposure' | 'wizard-flow' | 'wizard-bulk',
  ) => void;
}>(({ onInjected }) => {
  const store = useContext(LabStoreContext);
  const last = useSignal<string | null>(null);
  return (
    <section class="card scenario">
      <h3>异常场景自检（本机演练）</h3>
      <p class="muted small">
        点击后生成演示数据并直达对应页面，观察系统如何按已批准方法判废；所有演示数据仅存本机，不影响正常流程，
        且暴露分支的演示数据不会回写任何原样。
      </p>
      <h4>常规物性试验（原样）</h4>
      <div class="scenario-grid">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            class="scenario-btn"
            onClick$={() => {
              last.value = store.injectScenario(s.id);
              onInjected?.(s.kind);
            }}
          >
            <strong>{s.title}</strong>
            <small>{s.desc}</small>
          </button>
        ))}
      </div>
      <h4>短时高湿暴露分支 / 共用漏斗</h4>
      <div class="scenario-grid exposure-grid">
        {EXPOSURE_SCENARIOS.map((s) => (
          <button
            key={s.id}
            class="scenario-btn exposure-btn"
            onClick$={() => {
              last.value = store.injectScenario(s.id);
              onInjected?.(s.kind);
            }}
          >
            <strong>{s.title}</strong>
            <small>{s.desc}</small>
          </button>
        ))}
      </div>
      {last.value && <p class="ok-text">{last.value}</p>}
    </section>
  );
});
