import {
  parseBalanceLine,
  parseCounterLine,
  splitLines,
  type BalanceReading,
  type CounterEvent,
} from './parsers';

/**
 * Web Serial 设备管理：
 * - 真实设备：navigator.serial.requestPort()，天平按行读稳定质量，计数器按脉冲累加
 * - 模拟设备：无串口硬件/非 HTTPS 环境下用于演示与场景演练（中断、粘粉等）
 * 串口对象本身不可序列化，因此设备状态不进入 IndexedDB。
 */

export type SerialKind = 'real' | 'simulated';
export type DeviceStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface BalanceState {
  status: DeviceStatus;
  kind: SerialKind | null;
  portName: string | null;
  latest: BalanceReading | null;
  /** 天平最后一次“稳定”读数（只有稳定读数允许引用到读数单） */
  stable: BalanceReading | null;
  message: string | null;
}

export interface CounterState {
  status: DeviceStatus;
  kind: SerialKind | null;
  portName: string | null;
  count: number;
  running: boolean;
  /** 中断保持标记：脉冲丢失或人工暂停 */
  interrupted: boolean;
  lastEventAt: string | null;
  message: string | null;
}

interface SerialLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  releaseLock?(): void;
}

interface NavigatorSerial {
  requestPort(options?: { filters?: unknown[] }): Promise<SerialLike>;
  getPorts(): Promise<SerialLike[]>;
}

function getSerial(): NavigatorSerial | null {
  const nav = globalThis.navigator as Navigator & { serial?: NavigatorSerial };
  return nav.serial ?? null;
}

export function serialSupported(): boolean {
  return getSerial() != null;
}

export function isSecureContextForSerial(): boolean {
  if (typeof window === 'undefined') return false;
  return window.isSecureContext === true;
}

type Listener = () => void;

class BalanceDevice {
  state: BalanceState = {
    status: 'disconnected',
    kind: null,
    portName: null,
    latest: null,
    stable: null,
    message: null,
  };
  private port: SerialLike | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private sim: BalanceSim | null = null;

  constructor(private emit: Listener) {}

  async connectReal(): Promise<void> {
    const serial = getSerial();
    if (!serial) throw new Error('浏览器不支持 Web Serial（或当前非安全上下文）');
    this.setState({ status: 'connecting', message: '正在选择天平串口…' });
    const port = await serial.requestPort({
      filters: [{ usbVendorId: undefined }],
    });
    await port.open({ baudRate: 9600 });
    this.port = port;
    this.setState({
      status: 'connected',
      kind: 'real',
      portName: '串口天平',
      message: '已连接，等待稳定读数',
    });
    void this.readLoop(port);
  }

  connectSimulated(startG = 46.2): void {
    this.sim?.stop();
    const sim = new BalanceSim((line) => this.ingest(line), startG);
    this.sim = sim;
    sim.start();
    this.setState({
      status: 'connected',
      kind: 'simulated',
      portName: '模拟天平',
      message: '模拟天平已连接',
    });
  }

  simSetMass(g: number): void {
    this.sim?.setTarget(g);
  }

  private async readLoop(port: SerialLike): Promise<void> {
    let buffer = '';
    try {
      while (port.readable) {
        this.reader = port.readable.getReader();
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) {
          const chunk = new TextDecoder().decode(value);
          const { lines, rest } = splitLines(buffer, chunk);
          buffer = rest;
          for (const line of lines) this.ingest(line);
        }
      }
    } catch (e) {
      this.setState({ status: 'error', message: `天平串口错误：${(e as Error).message}` });
    }
  }

  private ingest(line: string): void {
    const reading = parseBalanceLine(line);
    if (!reading) return;
    const next: BalanceState = {
      ...this.state,
      latest: reading,
      stable: reading.stable ? reading : this.state.stable,
      message: reading.stable ? '稳定' : '读数变动中…',
    };
    this.state = next;
    this.emit();
  }

  private setState(patch: Partial<BalanceState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  async disconnect(): Promise<void> {
    this.sim?.stop();
    this.sim = null;
    try {
      this.reader?.cancel();
    } catch {
      /* ignore */
    }
    this.reader?.releaseLock?.();
    this.reader = null;
    try {
      await this.port?.close();
    } catch {
      /* ignore */
    }
    this.port = null;
    this.state = {
      status: 'disconnected',
      kind: null,
      portName: null,
      latest: null,
      stable: null,
      message: null,
    };
    this.emit();
  }
}

class BalanceSim {
  private current: number;
  private target: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private tick = 0;

  constructor(
    private send: (line: string) => void,
    startG: number,
  ) {
    this.current = startG;
    this.target = startG;
  }

  start(): void {
    this.timer = setInterval(() => {
      this.tick++;
      // 一阶逼近目标，加入 ±0.02 g 抖动
      this.current += (this.target - this.current) * 0.35;
      const jitter = (Math.random() - 0.5) * 0.04;
      const shown = this.current + jitter;
      // 逼近后输出 ST（稳定）行，否则 US（动态）
      const stable = Math.abs(this.target - shown) < 0.03;
      this.send(`${stable ? 'ST' : 'US'},GS,${shown.toFixed(2)},g`);
    }, 350);
  }

  setTarget(g: number): void {
    this.target = g;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

class CounterDevice {
  state: CounterState = {
    status: 'disconnected',
    kind: null,
    portName: null,
    count: 0,
    running: false,
    interrupted: false,
    lastEventAt: null,
    message: null,
  };
  private port: SerialLike | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private sim: CounterSim | null = null;

  constructor(private emit: Listener) {}

  async connectReal(): Promise<void> {
    const serial = getSerial();
    if (!serial) throw new Error('浏览器不支持 Web Serial（或当前非安全上下文）');
    this.setState({ status: 'connecting', message: '正在选择振实计数器串口…' });
    const port = await serial.requestPort({});
    await port.open({ baudRate: 9600 });
    this.port = port;
    this.setState({
      status: 'connected',
      kind: 'real',
      portName: '串口振实计数器',
      running: true,
      message: '已连接，监听振实脉冲',
    });
    void this.readLoop(port);
  }

  connectSimulated(): void {
    this.sim?.stop();
    const sim = new CounterSim((line) => this.ingest(line));
    this.sim = sim;
    sim.start();
    this.setState({
      status: 'connected',
      kind: 'simulated',
      portName: '模拟振实计数器',
      running: true,
      interrupted: false,
      count: 0,
      message: '模拟计数器已连接（每 120 ms 一个脉冲）',
    });
  }

  /** 手动登记一次振实（真实机械计数器无串口时由实验员按键） */
  manualPulse(): void {
    if (this.state.status !== 'connected') return;
    this.ingest('P,1');
  }

  /** 测试点：振实计数中断——模拟脉冲丢失/人工暂停 */
  interrupt(): void {
    this.sim?.pause();
    if (this.state.status === 'connected') {
      this.ingest('H');
    }
  }

  resumeAfterInterrupt(): void {
    // 中断后按方法不得“续数”；这里恢复设备输出但保持 interrupted 标记，需复位重测
    this.sim?.resume();
    if (this.state.status === 'connected') {
      this.setState({ running: true, message: '设备恢复输出；本测次已中断，需复位后另取试样重测' });
    }
  }

  resetCount(): void {
    this.sim?.resume();
    this.ingest('R');
  }

  private async readLoop(port: SerialLike): Promise<void> {
    let buffer = '';
    try {
      while (port.readable) {
        this.reader = port.readable.getReader();
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) {
          const chunk = new TextDecoder().decode(value);
          const { lines, rest } = splitLines(buffer, chunk);
          buffer = rest;
          for (const line of lines) this.ingest(line);
        }
      }
    } catch (e) {
      this.setState({ status: 'error', message: `计数器串口错误：${(e as Error).message}` });
    }
  }

  private ingest(line: string): void {
    const evt: CounterEvent | null = parseCounterLine(line);
    if (!evt) return;
    const base = { ...this.state, lastEventAt: new Date().toISOString() };
    if (evt.type === 'reset') {
      this.state = {
        ...base,
        count: 0,
        running: true,
        interrupted: false,
        message: '计数已复位',
      };
    } else if (evt.type === 'hold') {
      this.sim?.pause();
      this.state = {
        ...base,
        running: false,
        interrupted: true,
        message: '计数中断（保持）：脉冲丢失/人工暂停，按方法本测次判废',
      };
    } else {
      if (!base.running && !base.interrupted) {
        base.running = true;
      }
      this.state = {
        ...base,
        count: base.count + evt.count,
        message: base.interrupted
          ? '中断后出现脉冲：该测次已判废，不得续数'
          : `已累计 ${base.count + evt.count} 次`,
      };
    }
    this.emit();
  }

  private setState(patch: Partial<CounterState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  async disconnect(): Promise<void> {
    this.sim?.stop();
    this.sim = null;
    try {
      this.reader?.cancel();
    } catch {
      /* ignore */
    }
    this.reader?.releaseLock?.();
    this.reader = null;
    try {
      await this.port?.close();
    } catch {
      /* ignore */
    }
    this.port = null;
    this.state = {
      status: 'disconnected',
      kind: null,
      portName: null,
      count: 0,
      running: false,
      interrupted: false,
      lastEventAt: null,
      message: null,
    };
    this.emit();
  }
}

class CounterSim {
  private timer: ReturnType<typeof setInterval> | null = null;
  private paused = false;

  constructor(private send: (line: string) => void) {}

  start(): void {
    this.paused = false;
    this.timer = setInterval(() => {
      if (!this.paused) this.send('P,1');
    }, 120);
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export class DeviceManager {
  readonly balance: BalanceDevice;
  readonly counter: CounterDevice;
  private listeners = new Set<Listener>();

  constructor() {
    const emit = () => this.listeners.forEach((l) => l());
    this.balance = new BalanceDevice(emit);
    this.counter = new CounterDevice(emit);
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  destroy(): void {
    void this.balance.disconnect();
    void this.counter.disconnect();
    this.listeners.clear();
  }
}
