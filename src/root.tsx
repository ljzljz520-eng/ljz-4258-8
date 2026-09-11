import {
  component$,
  useContextProvider,
  useSignal,
  useVisibleTask$,
} from '@builder.io/qwik';
import {
  createLabStore,
  LabStoreContext,
} from './state/store';
import { createInitialState, loadState } from './db/idb';
import { DeviceManager } from './device/serial';
import { DeviceContext } from './components/context';
import { App } from './components/App';

export const Root = component$(() => {
  // 首屏先用受控种子渲染，挂载后异步加载 IndexedDB 中的本机数据
  const storeSig = useSignal(createLabStore(createInitialState()));
  const deviceSig = useSignal<DeviceManager | null>(null);
  const loaded = useSignal(false);

  useVisibleTask$(async () => {
    const initial = await loadState();
    storeSig.value = createLabStore(initial);
    deviceSig.value = new DeviceManager();
    loaded.value = true;
  });

  return (
    <>
      {loaded.value && deviceSig.value ? (
        <Providers store={storeSig.value} device={deviceSig.value} />
      ) : (
        <p class="boot">正在从本机 IndexedDB 载入样品与方法版本…</p>
      )}
    </>
  );
});

const Providers = component$<{
  store: ReturnType<typeof createLabStore>;
  device: DeviceManager;
}>(({ store, device }) => {
  useContextProvider(LabStoreContext, store);
  useContextProvider(DeviceContext, device);
  return <App />;
});
