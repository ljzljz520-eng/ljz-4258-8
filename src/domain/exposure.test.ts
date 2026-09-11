import { describe, expect, it } from 'vitest';
import type { ExposureSession, FunnelStatus, Sample, SubSample } from './types';
import {
  EXPOSURE_RULES,
  checkFunnelCleanliness,
  isExposureUsable,
  validateExposure,
  validateSubSampleMass,
} from './exposure';

const base = new Date('2026-09-11T10:00:00Z').getTime();
const iso = (minFromStart: number) => new Date(base + minFromStart * 60000).toISOString();

function curve(startMin = 0, n = 11, gap = 3): { at: string; rh: number; tempC: number }[] {
  return Array.from({ length: n }, (_, i) => ({
    at: iso(startMin + i * gap),
    rh: 88,
    tempC: 25,
  }));
}

function makeSession(over: Partial<ExposureSession> = {}): ExposureSession {
  return {
    id: 'exp-1',
    sampleId: 'smp-1',
    openedAt: iso(0),
    closedAt: iso(30),
    status: 'closed',
    trayId: '盘A',
    layerThicknessMm: 10,
    layerThicknessAfterMm: null,
    initialPowderMassG: 150,
    trayTareG: 30,
    loggerStartedAt: iso(0),
    localCondensation: false,
    withdrawals: [],
    curve: curve(),
    note: '',
    createdAt: iso(-1),
    ...over,
  };
}

describe('高湿暴露分支：五个新增异常场景', () => {
  it('记录器晚启动 > 容差 -> LOGGER_LATE_START，会话不可用', () => {
    const s = makeSession({
      loggerStartedAt: iso(8),
      curve: curve(8),
    });
    const codes = validateExposure(s).map((i) => i.code);
    expect(codes).toContain('LOGGER_LATE_START');
    expect(codes).toContain('ENV_CURVE_HEAD_GAP');
    expect(isExposureUsable(s)).toBe(false);
  });

  it('记录器在容差内晚启动只给 warning，不判废', () => {
    const s = makeSession({ loggerStartedAt: iso(1), curve: curve(1) });
    const issues = validateExposure(s);
    expect(issues.some((i) => i.level === 'error')).toBe(false);
    expect(issues.map((i) => i.code)).toContain('LOGGER_SLIGHT_LATE');
    expect(isExposureUsable(s)).toBe(true);
  });

  it('记录器未启动 -> LOGGER_NOT_STARTED', () => {
    const s = makeSession({ loggerStartedAt: null, curve: [] });
    const codes = validateExposure(s).map((i) => i.code);
    expect(codes).toContain('LOGGER_NOT_STARTED');
    expect(codes).toContain('ENV_CURVE_EMPTY');
  });

  it('样盘局部结露 -> DISH_CONDENSATION，整盘判废不可取子样', () => {
    const s = makeSession({ localCondensation: true });
    const codes = validateExposure(s).map((i) => i.code);
    expect(codes).toContain('DISH_CONDENSATION');
    expect(isExposureUsable(s)).toBe(false);
  });

  it('暴露中取走一部分：登记+复测厚度+衡算通过，会话仍可用', () => {
    const s = makeSession({
      withdrawals: [
        { id: 'w1', at: iso(12), massG: 40, purpose: '水分快测' },
      ],
      layerThicknessAfterMm: 9,
    });
    const issues = validateExposure(s);
    expect(issues.some((i) => i.level === 'error')).toBe(false);
    expect(isExposureUsable(s)).toBe(true);
  });

  it('取走后未复测厚度 -> LAYER_THICKNESS_UNVERIFIED 判废', () => {
    const s = makeSession({
      withdrawals: [
        { id: 'w1', at: iso(12), massG: 40, purpose: '水分快测' },
      ],
      layerThicknessAfterMm: null,
    });
    const codes = validateExposure(s).map((i) => i.code);
    expect(codes).toContain('LAYER_THICKNESS_UNVERIFIED');
    expect(isExposureUsable(s)).toBe(false);
  });

  it('取走时间在敞口窗口外 -> WITHDRAWAL_OUTSIDE_WINDOW', () => {
    const s = makeSession({
      withdrawals: [
        { id: 'w1', at: iso(35), massG: 10, purpose: '封口后取走' },
      ],
      layerThicknessAfterMm: 8,
    });
    expect(validateExposure(s).map((i) => i.code)).toContain(
      'WITHDRAWAL_OUTSIDE_WINDOW',
    );
  });

  it('取走合计超过初始粉量 -> WITHDRAWAL_MASS_BALANCE', () => {
    const s = makeSession({
      withdrawals: [
        { id: 'w1', at: iso(10), massG: 100, purpose: 'a' },
        { id: 'w2', at: iso(20), massG: 60, purpose: 'b' },
      ],
      layerThicknessAfterMm: 5,
    });
    expect(validateExposure(s).map((i) => i.code)).toContain(
      'WITHDRAWAL_MASS_BALANCE',
    );
  });

  it('取走后厚度反而增大 -> LAYER_THICKNESS_INCONSISTENT', () => {
    const s = makeSession({
      withdrawals: [{ id: 'w1', at: iso(12), massG: 10, purpose: 'x' }],
      layerThicknessAfterMm: 12,
    });
    expect(validateExposure(s).map((i) => i.code)).toContain(
      'LAYER_THICKNESS_INCONSISTENT',
    );
  });

  it('子样质量不足：流动 60g<100g / 松装 40g<50g -> SUBSAMPLE_MASS_SHORT', () => {
    const sub: SubSample = {
      id: 'sub-1',
      exposureSessionId: 'exp-1',
      sourceSampleId: 'smp-1',
      subCode: 'S-RH-1',
      massG: 60,
      createdAt: iso(0),
    };
    expect(validateSubSampleMass(sub, 'flow').map((i) => i.code)).toContain(
      'SUBSAMPLE_MASS_SHORT',
    );
    const sub2 = { ...sub, massG: 40 };
    expect(validateSubSampleMass(sub2, 'bulk').map((i) => i.code)).toContain(
      'SUBSAMPLE_MASS_SHORT',
    );
    // 足量通过
    expect(validateSubSampleMass({ ...sub, massG: 100 }, 'flow')).toHaveLength(0);
    expect(
      validateSubSampleMass({ ...sub, massG: EXPOSURE_RULES.minBulkAliquotMassG }, 'bulk'),
    ).toHaveLength(0);
  });

  it('两种奶粉共用未清洁漏斗 -> FUNNEL_NOT_CLEANED；同产品已清洁不报', () => {
    const funnel: FunnelStatus = {
      lastProductName: '全脂乳粉',
      lastSampleRef: 'A',
      lastUsedAt: iso(-15),
      cleanedSinceLastUse: false,
    };
    const other: Sample = {
      id: 'smp-b',
      sampleCode: 'B',
      productName: '脱脂乳粉',
      batchNo: 'B1',
      producedAt: iso(0),
      openedAt: iso(0),
      conditioning: 'as_received',
      createdAt: iso(0),
    };
    expect(checkFunnelCleanliness(funnel, other).map((i) => i.code)).toContain(
      'FUNNEL_NOT_CLEANED',
    );
    // 清洁后不报
    expect(
      checkFunnelCleanliness({ ...funnel, cleanedSinceLastUse: true }, other),
    ).toHaveLength(0);
  });

  it('环境曲线采样间隔过大 -> ENV_CURVE_GAP', () => {
    const s = makeSession({
      curve: [
        { at: iso(0), rh: 88, tempC: 25 },
        { at: iso(3), rh: 88, tempC: 25 },
        { at: iso(15), rh: 88, tempC: 25 }, // 12 min 间隔
      ],
    });
    expect(validateExposure(s).map((i) => i.code)).toContain('ENV_CURVE_GAP');
  });
});
