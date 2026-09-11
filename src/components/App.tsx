import {
  component$,
  useContext,
  useSignal,
  useVisibleTask$,
} from '@builder.io/qwik';
import { LabStoreContext } from '../state/store';
import { DeviceContext } from './context';
import { DeviceBar } from './DeviceBar';
import { Stepper } from './Stepper';
import { ScenarioPanel } from './ScenarioPanel';
import { RecordsPanel } from './RecordsPanel';
import {
  StepFill,
  StepFlow,
  StepLoose,
  StepReview,
  StepSample,
  StepTap,
} from './steps';
import { clearLocalData } from '../db/idb';

export const App = component$(() => {
  const store = useContext(LabStoreContext);
  const devices = useContext(DeviceContext);
  const tab = useSignal<'wizard' | 'records'>('wizard');
  const ready = useSignal(false);
  const tick = useSignal(0);

  // 设备状态（串口对象不在 IndexedDB 内）→ 驱动本组件树刷新
  useVisibleTask$(() => {
    ready.value = true;
    const unsub = devices.subscribe(() => {
      tick.value++;
    });
    const t = setInterval(() => {
      tick.value++;
    }, 2000);
    return () => {
      unsub();
      clearInterval(t);
    };
  });

  const step = store.state.wizard.step;

  return (
    <div class="app" data-tick={tick.value}>
      <header class="topbar">
        <div>
          <h1>奶粉粉体物性试验台</h1>
          <p class="subtitle">
            松装密度 · 振实密度 · 漏斗流动时间 ｜ 纯前端无服务器，样品/方法版本/测次仅保存在本机 IndexedDB
          </p>
        </div>
        <div class="scope">
          <strong>范围声明</strong>
          <span>按已批准方法读数、复核与计算；不评价冲调体验，不推荐生产参数。</span>
        </div>
      </header>

      <DeviceBar />

      <div class="tabs">
        <button class={tab.value === 'wizard' ? 'tab on' : 'tab'} onClick$={() => (tab.value = 'wizard')}>
          分步试验
        </button>
        <button class={tab.value === 'records' ? 'tab on' : 'tab'} onClick$={() => (tab.value = 'records')}>
          本机记录与汇总
        </button>
      </div>

      {tab.value === 'wizard' && (
        <>
          <Stepper />
          {store.state.wizard.uiError && (
            <div class="banner err" role="alert">
              {store.state.wizard.uiError}
            </div>
          )}
          <main class="content">
            {step === 'sample' && <StepSample />}
            {step === 'fill' && <StepFill />}
            {step === 'loose' && <StepLoose />}
            {step === 'tap' && <StepTap />}
            {step === 'flow' && <StepFlow />}
            {step === 'review' && <StepReview />}
          </main>
          <ScenarioPanel />
        </>
      )}

      {tab.value === 'records' && (
        <main class="content">
          <RecordsPanel />
        </main>
      )}

      <footer class="footer">
        <span>
          状态：{ready.value ? '已在本机浏览器运行' : '加载中…'} ｜ 串口仅经 Web Serial 直连天平/计数器
        </span>
        <button
          class="btn small ghost danger"
          onClick$={async () => {
            if (confirm('确定清空本机 IndexedDB 中的全部样品/测次？此操作不可恢复。')) {
              await clearLocalData();
              location.reload();
            }
          }}
        >
          清空本机数据
        </button>
      </footer>
    </div>
  );
});
