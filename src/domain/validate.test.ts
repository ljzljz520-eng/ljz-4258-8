import { describe, expect, it } from 'vitest';
import { seedCylinders, seedMethods } from './seed';
import { validateBulk, validateFlow, hasFatal } from './validate';
import { newBulkDraft, newFlowDraft } from '../state/store';

const method = seedMethods[0];
const cyl = seedCylinders[0];

function goodBulk() {
  const d = newBulkDraft(500);
  Object.assign(d, {
    tareMassG: 46.3,
    grossMassG: 102.3,
    looseVolumeMl: 78,
    looseVolumeMaxMl: 79,
    looseVolumeMinMl: 77,
    tapCount: 500,
    tappedVolumeMl: 68,
  });
  return d;
}
function goodFlow() {
  const d = newFlowDraft();
  Object.assign(d, { chargeMassG: 100, flowTimeS: 18.6, residueMassG: 0.1 });
  return d;
}

describe('五个指定测试场景', () => {
  it('量筒皮重错用 -> TARE_MISMATCH 判废', () => {
    const d = goodBulk();
    d.tareMassG = 58.4; // 与台账 46.2 g 明显不符
    const issues = validateBulk(method, cyl, d);
    expect(issues.map((i) => i.code)).toContain('TARE_MISMATCH');
    expect(hasFatal(issues)).toBe(true);
  });

  it('粉面倾斜超差 -> SURFACE_TILT；正常皮重不误报', () => {
    const d = goodBulk();
    d.looseVolumeMaxMl = 82;
    d.looseVolumeMinMl = 76; // 差 6 mL > 2 mL
    const issues = validateBulk(method, cyl, d);
    const codes = issues.map((i) => i.code);
    expect(codes).toContain('SURFACE_TILT');
    expect(codes).not.toContain('TARE_MISMATCH');
    expect(hasFatal(issues)).toBe(true);
  });

  it('振实计数中断 -> TAP_SHORT + TAP_INTERRUPTED', () => {
    const d = goodBulk();
    d.tapCount = 463;
    d.tapInterrupted = true;
    d.tappedVolumeMl = null;
    const codes = validateBulk(method, cyl, d).map((i) => i.code);
    expect(codes).toContain('TAP_SHORT');
    expect(codes).toContain('TAP_INTERRUPTED');
    expect(codes).toContain('TAPPED_VOL_MISSING');
  });

  it('漏斗口粘粉 -> OUTLET_STICKING；残留称量留档', () => {
    const d = goodFlow();
    d.outletSticking = true;
    d.residueMassG = 3.4;
    const issues = validateFlow(method, d);
    expect(issues.map((i) => i.code)).toContain('OUTLET_STICKING');
    expect(hasFatal(issues)).toBe(true);
  });

  it('等待期间吸湿超限 -> MOISTURE_EXPOSURE_FLOW / MOISTURE_EXPOSURE', () => {
    const f = goodFlow();
    const flowIssues = validateFlow(method, f, method.maxExposureMin + 3);
    expect(flowIssues.map((i) => i.code)).toContain('MOISTURE_EXPOSURE_FLOW');
    const b = goodBulk();
    const bulkIssues = validateBulk(method, cyl, b, method.maxExposureMin + 1);
    expect(bulkIssues.map((i) => i.code)).toContain('MOISTURE_EXPOSURE');
    // 未超限不误报
    expect(validateFlow(method, f, 2).map((i) => i.code)).not.toContain('MOISTURE_EXPOSURE_FLOW');
  });

  it('实验员确认结团/架桥/洒失均为判废项', () => {
    const d = goodBulk();
    d.flags.caking = true;
    d.flags.bridging = true;
    d.flags.spillage = true;
    const codes = validateBulk(method, cyl, d).map((i) => i.code);
    expect(codes).toContain('CAKING');
    expect(codes).toContain('BRIDGING_BULK');
    expect(codes).toContain('SPILLAGE');
  });

  it('合格草案无 error', () => {
    expect(hasFatal(validateBulk(method, cyl, goodBulk()))).toBe(false);
    expect(hasFatal(validateFlow(method, goodFlow()))).toBe(false);
  });

  it('勾选有效测次但存在判废项时给出警示且不应计入', () => {
    const d = goodBulk();
    d.tareMassG = 58.4;
    d.flags.acceptedReplicate = true;
    const codes = validateBulk(method, cyl, d).map((i) => i.code);
    expect(codes).toContain('ACCEPTED_WITH_ERROR');
  });
});
