import type {
  BulkResults,
  FlowResults,
  FormulaId,
  Run,
} from './types';

/** 按方法文件规定保留位数：密度 3 位小数，时间 2 位小数 */
export function roundDensity(v: number): number {
  return Math.round((v + Number.EPSILON) * 1000) / 1000;
}
export function roundTime(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

export function calcBulkDensity(
  netMassG: number,
  looseVolumeMl: number,
): number {
  if (!Number.isFinite(netMassG) || !Number.isFinite(looseVolumeMl)) {
    throw new Error('松装密度输入无效');
  }
  if (netMassG <= 0) throw new Error('净重必须为正（m1−m0 > 0）');
  if (looseVolumeMl <= 0) throw new Error('松装体积必须为正（V0 > 0）');
  return roundDensity(netMassG / looseVolumeMl);
}

export function calcTappedDensity(
  netMassG: number,
  tappedVolumeMl: number,
): number {
  if (!Number.isFinite(netMassG) || !Number.isFinite(tappedVolumeMl)) {
    throw new Error('振实密度输入无效');
  }
  if (netMassG <= 0) throw new Error('净重必须为正（m1−m0 > 0）');
  if (tappedVolumeMl <= 0) throw new Error('振实体积必须为正（Vt > 0）');
  return roundDensity(netMassG / tappedVolumeMl);
}

export function calcFlowTime(startEpochMs: number, endEpochMs: number): number {
  if (!Number.isFinite(startEpochMs) || !Number.isFinite(endEpochMs)) {
    throw new Error('流动时间戳无效');
  }
  const s = (endEpochMs - startEpochMs) / 1000;
  if (s < 0) throw new Error('结束时间早于开始时间');
  return roundTime(s);
}

/** 仅允许已批准公式 id；未列出的指标（如冲调性）系统不计算 */
export function assertApprovedFormula(
  allowed: FormulaId[],
  id: FormulaId,
): void {
  if (!allowed.includes(id)) {
    throw new Error(`公式 ${id} 不在已批准方法中，禁止计算`);
  }
}

export function computeBulkResults(
  allowed: FormulaId[],
  netMassG: number,
  looseVolumeMl: number,
  tappedVolumeMl: number | null,
): BulkResults {
  assertApprovedFormula(allowed, 'bulk-density-q-phy-01');
  const bulkDensityGPerMl = calcBulkDensity(netMassG, looseVolumeMl);
  let tappedDensityGPerMl: number | null = null;
  if (tappedVolumeMl != null) {
    assertApprovedFormula(allowed, 'tapped-density-q-phy-01');
    tappedDensityGPerMl = calcTappedDensity(netMassG, tappedVolumeMl);
  }
  return {
    netMassG: Math.round((netMassG + Number.EPSILON) * 100) / 100,
    bulkDensityGPerMl,
    tappedDensityGPerMl,
  };
}

export function computeFlowResults(
  allowed: FormulaId[],
  flowTimeS: number,
): FlowResults {
  assertApprovedFormula(allowed, 'flow-time-100ml-q-phy-01');
  return { flowTimeS: roundTime(flowTimeS) };
}

export interface RunSummary {
  validBulk: number;
  meanBulkDensity: number | null;
  meanTappedDensity: number | null;
  validFlow: number;
  meanFlowTimeS: number | null;
}

/** 按有效测次汇总；有效判定由复核层给出（这里只收 acceptedReplicate 的记录） */
export function summarizeRuns(runs: Run[], isValid: (r: Run) => boolean): RunSummary {
  const bulk = runs.filter((r) => r.kind === 'bulk' && isValid(r)) as Extract<
    Run,
    { kind: 'bulk' }
  >[];
  const flow = runs.filter((r) => r.kind === 'flow' && isValid(r)) as Extract<
    Run,
    { kind: 'flow' }
  >[];

  const bd = bulk
    .map((r) => {
      const g = r.grossMassG;
      const t = r.tareMassG;
      const v0 = r.looseVolumeMl;
      if (g == null || t == null || v0 == null) return null;
      try {
        return calcBulkDensity(g - t, v0);
      } catch {
        return null;
      }
    })
    .filter((v): v is number => v != null);
  const td = bulk
    .map((r) => {
      const g = r.grossMassG;
      const t = r.tareMassG;
      const vt = r.tappedVolumeMl;
      if (g == null || t == null || vt == null) return null;
      try {
        return calcTappedDensity(g - t, vt);
      } catch {
        return null;
      }
    })
    .filter((v): v is number => v != null);
  const ft = flow
    .map((r) => r.flowTimeS)
    .filter((v): v is number => v != null);

  const mean = (xs: number[]) =>
    xs.length ? roundDensity(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
  const meanT = (xs: number[]) =>
    xs.length ? roundTime(xs.reduce((a, b) => a + b, 0) / xs.length) : null;

  return {
    validBulk: bulk.length,
    meanBulkDensity: mean(bd),
    meanTappedDensity: mean(td),
    validFlow: flow.length,
    meanFlowTimeS: meanT(ft),
  };
}
