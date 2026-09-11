import { describe, expect, it } from 'vitest';
import { parseBalanceLine, parseCounterLine, splitLines } from './parsers';

describe('balance parser', () => {
  it('parses stable S/ST lines', () => {
    expect(parseBalanceLine('ST,GS,+102.35,g')).toMatchObject({ massG: 102.35, stable: true });
    expect(parseBalanceLine('S D 46.20 g')).toMatchObject({ massG: 46.2, stable: true });
    expect(parseBalanceLine('US,GS,102.30,g')?.stable).toBe(false);
    expect(parseBalanceLine('+102.30 g')?.stable).toBe(false);
    expect(parseBalanceLine('')).toBeNull();
    expect(parseBalanceLine('overflow')).toBeNull();
  });
});

describe('counter parser', () => {
  it('parses pulses / reset / hold', () => {
    expect(parseCounterLine('P,1')).toEqual({ type: 'pulse', count: 1 });
    expect(parseCounterLine('P,12')).toEqual({ type: 'pulse', count: 12 });
    expect(parseCounterLine('37')).toEqual({ type: 'pulse', count: 37 });
    expect(parseCounterLine('R')).toEqual({ type: 'reset' });
    expect(parseCounterLine('H')).toEqual({ type: 'hold' });
    expect(parseCounterLine('')).toBeNull();
  });

  it('splits byte stream into lines', () => {
    const a = splitLines('', 'P,1\nP,1\n');
    expect(a.lines).toEqual(['P,1', 'P,1']);
    expect(a.rest).toBe('');
    const b = splitLines('P,', '2\nH');
    expect(b.lines).toEqual(['P,2']);
    expect(b.rest).toBe('H');
  });
});
