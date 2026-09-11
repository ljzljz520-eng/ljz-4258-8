/**
 * 串口行协议解析（无 DOM 依赖，可单元测试）。
 * 天平：兼容 S 稳定标记的常见 ASCII 行，例如 "ST,GS,+142.35,g" / "S D 142.35 g" / "+142.35 g"
 * 振实计数器：每行脉冲数，"P,1" 为单脉冲；"R" 为复位；"H" 为保持/中断
 */

export interface BalanceReading {
  massG: number;
  stable: boolean;
  raw: string;
}

const NUMBER = /[-+]?\d+(?:\.\d+)?/;

export function parseBalanceLine(line: string): BalanceReading | null {
  const s = line.trim();
  if (!s) return null;
  const match = s.match(NUMBER);
  if (!match) return null;
  const massG = Number(match[0]);
  if (!Number.isFinite(massG)) return null;
  // 常见稳定标记：行首 ST/S、字段 ST，或显式 stable
  const stable = /(^|[,\s])(ST|S|STABLE|OK)([,\s]|$)/i.test(s) || /stable/i.test(s);
  return { massG, stable, raw: s };
}

export type CounterEvent =
  | { type: 'pulse'; count: number }
  | { type: 'reset' }
  | { type: 'hold' };

export function parseCounterLine(line: string): CounterEvent | null {
  const s = line.trim().toUpperCase();
  if (!s) return null;
  if (s.startsWith('R')) return { type: 'reset' };
  if (s.startsWith('H')) return { type: 'hold' };
  if (s.startsWith('P')) {
    const m = s.match(/\d+/);
    return { type: 'pulse', count: m ? parseInt(m[0], 10) : 1 };
  }
  const m = s.match(/\d+/);
  if (m) return { type: 'pulse', count: parseInt(m[0], 10) };
  return null;
}

/** 把字节流缓冲切为完整行 */
export function splitLines(buffer: string, chunk: string): { lines: string[]; rest: string } {
  const merged = buffer + chunk;
  const parts = merged.split(/\r\n|\r|\n/);
  const rest = parts.pop() ?? '';
  return { lines: parts, rest };
}
