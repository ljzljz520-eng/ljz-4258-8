import { component$, useContext, useSignal } from '@builder.io/qwik';
import { LabStoreContext, type ScenarioId } from '../state/store';

const SCENARIOS: { id: ScenarioId; title: string; desc: string }[] = [
  { id: 'wrong_tare', title: '量筒皮重错用', desc: '实测皮重 58.4 g 与台账 46.2 g 不符' },
  { id: 'tilt', title: '粉面倾斜', desc: '周向读数差 6 mL 超过 2 mL 限值' },
  { id: 'tap_interrupt', title: '振实计数中断', desc: '463/500 且脉冲中断，判废' },
  { id: 'funnel_stick', title: '漏斗口粘粉', desc: '出口挂粉、残留 3.4 g' },
  { id: 'moisture', title: '等待期吸湿', desc: '开封暴露超过 10 min 限值' },
];

/** 五个指定测试场景的一键演练：注入演示样与草案并跳到复核页 */
export const ScenarioPanel = component$(() => {
  const store = useContext(LabStoreContext);
  const last = useSignal<string | null>(null);
  return (
    <section class="card scenario">
      <h3>异常场景自检（本机演练）</h3>
      <p class="muted small">
        点击后生成演示生产样与已读数草案并直接进入“读数复核”，观察系统如何按已批准方法判废；不影响正常手工流程。
      </p>
      <div class="scenario-grid">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            class="scenario-btn"
            onClick$={() => {
              last.value = store.injectScenario(s.id);
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
