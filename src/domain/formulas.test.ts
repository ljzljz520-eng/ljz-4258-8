import { describe, expect, it } from 'vitest';
import {
  calcBulkDensity,
  calcFlowTime,
  calcTappedDensity,
  computeBulkResults,
  computeFlowResults,
  summarizeRuns,
} from './formulas';
import type { BulkRun, FlowRun } from './types';

const ALLOWED = [
  'bulk-density-q-phy-01',
  'tapped-density-q-phy-01',
  'flow-time-100ml-q-phy-01',
] as const;

describe('approved formulas', () => {
  it('bulk density ρb=(m1−m0)/V0, 3 decimals', () => {
    // m0=46.20 m1=102.30 V0=78 -> 56.10/78 = 0.71923 -> 0.719
    expect(calcBulkDensity(102.3 - 46.2, 78)).toBe(0.719);
  });

  it('tapped density ρt=(m1−m0)/Vt', () => {
    expect(calcTappedDensity(56.1, 68)).toBe(0.825);
  });

  it('flow time t=t2−t1, 2 decimals', () => {
    expect(calcFlowTime(0, 18640)).toBe(18.64);
  });

  it('rejects non-positive inputs', () => {
    expect(() => calcBulkDensity(0, 10)).toThrow();
    expect(() => calcTappedDensity(10, 0)).toThrow();
    expect(() => calcFlowTime(100, 90)).toThrow();
  });

  it('computeBulkResults uses only approved ids', () => {
    const r = computeBulkResults([...ALLOWED], 56.1, 78, 68);
    expect(r.bulkDensityGPerMl).toBe(0.719);
    expect(r.tappedDensityGPerMl).toBe(0.825);
    // 未批准的公式禁止计算
    expect(() =>
      computeBulkResults(['bulk-density-q-phy-01'], 56.1, 78, 68),
    ).toThrow(/禁止计算/);
  });

  it('flow result rounding', () => {
    expect(computeFlowResults([...ALLOWED], 18.6456).flowTimeS).toBe(18.65);
    expect(() => computeFlowResults([], 1)).toThrow();
  });

  it('summarizeRuns counts accepted replicates only', () => {
    const snapshot = { sampleCode: 'S', batchNo: 'B', openedAt: '', conditioning: 'as_received' as const };
    const base = {
      id: '', sampleId: '', aliquotId: '', snapshot, methodId: 'm',
      flags: { caking: false, bridging: false, spillage: false, acceptedReplicate: true, moistureAbsorbed: false },
      exposureMin: 1, note: '', createdAt: '',
    };
    const runs: (BulkRun | FlowRun)[] = [
      {
        ...base, kind: 'bulk', cylinderId: 'c', cylinderListedTareG: 46.2, fillMode: 'free_pour',
        looseVolumeMl: 78, looseVolumeMaxMl: 79, looseVolumeMinMl: 77,
        grossMassG: 102.3, tareMassG: 46.2, tapTarget: 500, tapCount: 500,
        tapInterrupted: false, tappedVolumeMl: 68,
      } as BulkRun,
      {
        ...base, kind: 'bulk', cylinderId: 'c', cylinderListedTareG: 46.2, fillMode: 'free_pour',
        looseVolumeMl: 80, looseVolumeMaxMl: 80, looseVolumeMinMl: 80,
        grossMassG: 102.0, tareMassG: 46.2, tapTarget: 500, tapCount: 500,
        tapInterrupted: false, tappedVolumeMl: 70,
        flags: { ...base.flags, acceptedReplicate: false },
      } as BulkRun,
      { ...base, id: 'f', kind: 'flow', chargeMassG: 100, flowTimeS: 18.6, residueMassG: 0.1, outletSticking: false } as FlowRun,
    ];
    const s = summarizeRuns(runs, (r) => r.flags.acceptedReplicate);
    expect(s.validBulk).toBe(1);
    expect(s.meanBulkDensity).toBe(0.719);
    expect(s.validFlow).toBe(1);
    expect(s.meanFlowTimeS).toBe(18.6);
  });
});
