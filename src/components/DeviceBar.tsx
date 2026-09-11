import { component$, useContext, useSignal } from '@builder.io/qwik';
import { isSecureContextForSerial, serialSupported } from '../device/serial';
import { DeviceContext } from './context';

const statusClass: Record<string, string> = {
  connected: 'chip ok',
  connecting: 'chip warn',
  error: 'chip err',
  disconnected: 'chip',
};

export const DeviceBar = component$(() => {
  const devices = useContext(DeviceContext);
  const msg = useSignal<string | null>(null);

  return (
    <div class="devicebar">
      <div class="device-cell">
        <span class={statusClass[devices.balance.state.status]}>天平 · {label(devices.balance.state.status)}</span>
        <span class="device-detail">
          {devices.balance.state.portName ?? '未连接'}
          {devices.balance.state.stable
            ? `｜稳定 ${devices.balance.state.stable.massG.toFixed(2)} g`
            : devices.balance.state.latest
              ? `｜${devices.balance.state.latest.massG.toFixed(2)} g（变动中）`
              : ''}
        </span>
        <button
          class="btn small"
          onClick$={async () => {
            msg.value = null;
            try {
              await devices.balance.connectReal();
            } catch (e) {
              msg.value = (e as Error).message;
            }
          }}
        >
          连接串口天平
        </button>
        <button class="btn small ghost" onClick$={() => devices.balance.connectSimulated(46.2)}>
          模拟天平
        </button>
        <button class="btn small ghost" onClick$={() => void devices.balance.disconnect()}>
          断开
        </button>
      </div>

      <div class="device-cell">
        <span class={statusClass[devices.counter.state.status]}>振实计数器 · {label(devices.counter.state.status)}</span>
        <span class="device-detail">
          {devices.counter.state.portName ?? '未连接'}
          {devices.counter.state.status === 'connected'
            ? `｜${devices.counter.state.count} 次${devices.counter.state.interrupted ? '（已中断）' : ''}`
            : ''}
        </span>
        <button
          class="btn small"
          onClick$={async () => {
            msg.value = null;
            try {
              await devices.counter.connectReal();
            } catch (e) {
              msg.value = (e as Error).message;
            }
          }}
        >
          连接串口计数器
        </button>
        <button class="btn small ghost" onClick$={() => devices.counter.connectSimulated()}>
          模拟计数器
        </button>
        <button class="btn small ghost" onClick$={() => devices.counter.disconnect()}>
          断开
        </button>
      </div>

      <div class="device-note">
        {!serialSupported() || !isSecureContextForSerial()
          ? '当前环境不支持/不允许 Web Serial（需 Chrome/Edge 安全上下文），可用“模拟”设备演练；数据仍仅存本机。'
          : 'Web Serial 可用：读数只来自串口/模拟设备，不经网络。'}
        {msg.value ? <span class="inline-err"> {msg.value}</span> : null}
      </div>
    </div>
  );
});

function label(s: string): string {
  return s === 'connected'
    ? '已连接'
    : s === 'connecting'
      ? '连接中'
      : s === 'error'
        ? '错误'
        : '未连接';
}
