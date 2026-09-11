import { describe, expect, it, vi } from 'vitest';
import { createLabStore } from './store';
import { createInitialState } from '../db/idb';
import type { ExposureSession, LabState, Sample } from '../domain/types';

const start = new Date('2026-09-11T10:00:00Z');

function makeStore() {
  const current = { t: start.getTime() };
  const persist = vi.fn(async (_s: LabState) => {});
  const store = createLabStore(createInitialState(), {
    persist,
    now: () => new Date(current.t),
  });
  return { store, current };
}

function addSample(store: ReturnType<typeof createLabStore>, code: string, product: string) {
  const err = store.addSample({
    sampleCode: code,
    productName: product,
    batchNo: `B-${code}`,
    producedAt: start.toISOString(),
    openedAt: start.toISOString(),
    conditioning: 'as_received',
  });
  expect(err).toBeNull();
  return store.state.samples.find((s) => s.sampleCode === code)!;
}

/** 建一个已封口、曲线完整、可用于取子样的暴露会话 */
function goodClosedSession(
  store: ReturnType<typeof createLabStore>,
  sample: Sample,
  current: { t: number },
): ExposureSession {
  current.t = start.getTime();
  expect(
    store.createExposure({
      sampleId: sample.id,
      trayId: '盘A',
      layerThicknessMm: 10,
      initialPowderMassG: 200,
      trayTareG: 30,
      loggerStartedAt: start.toISOString(),
      openedAt: start.toISOString(),
    }),
  ).toBeNull();
  const s = store.state.exposureSessions[0];
  for (let i = 0; i < 10; i++) {
    current.t = start.getTime() + i * 3 * 60000;
    expect(store.addEnvPoint(s.id, { rh: 88, tempC: 25 })).toBeNull();
  }
  current.t = start.getTime() + 30 * 60000;
  expect(store.closeExposure(s.id, new Date(current.t).toISOString())).toBeNull();
  return store.state.exposureSessions.find((x) => x.id === s.id)!;
}

describe('高湿暴露分支：状态机与数据隔离', () => {
  it('记录器晚启动的会话封口即判 invalid，且不能创建子样', () => {
    const { store, current } = makeStore();
    const sample = addSample(store, 'S-LOG', '全脂乳粉');
    current.t = start.getTime();
    store.createExposure({
      sampleId: sample.id,
      trayId: '盘A',
      layerThicknessMm: 10,
      initialPowderMassG: 120,
      trayTareG: 30,
      loggerStartedAt: new Date(start.getTime() + 8 * 60000).toISOString(), // 晚 8 min
      openedAt: start.toISOString(),
    });
    const s = store.state.exposureSessions[0];
    for (let i = 0; i < 8; i++) {
      current.t = start.getTime() + (8 + i * 3) * 60000;
      store.addEnvPoint(s.id, { rh: 88, tempC: 25 });
    }
    current.t = start.getTime() + 30 * 60000;
    const closeMsg = store.closeExposure(s.id, new Date(current.t).toISOString());
    expect(closeMsg).toMatch(/判废/);
    const reloaded = store.state.exposureSessions[0];
    expect(reloaded.status).toBe('invalid');
    expect(
      store.createSubSample(s.id, { subCode: 'S-LOG-RH-1', massG: 110 }),
    ).toMatch(/判废|不可|未封口/);
  });

  it('样盘局部结露：封口判废，整盘不可取子样', () => {
    const { store, current } = makeStore();
    const sample = addSample(store, 'S-COND', '脱脂乳粉');
    const s = goodClosedSession(store, sample, current);
    // 重新构造一个结露会话更直接：
    current.t = start.getTime();
    store.createExposure({
      sampleId: sample.id,
      trayId: '盘B',
      layerThicknessMm: 12,
      initialPowderMassG: 130,
      trayTareG: 30,
      loggerStartedAt: start.toISOString(),
      openedAt: start.toISOString(),
    });
    const s2 = store.state.exposureSessions[1];
    store.setExposureField(s2.id, 'localCondensation', true);
    current.t = start.getTime() + 30 * 60000;
    expect(store.closeExposure(s2.id, new Date(current.t).toISOString())).toMatch(/判废/);
    const codes = store.reviewExposure(s2.id).map((i) => i.code);
    expect(codes).toContain('DISH_CONDENSATION');
    expect(
      store.createSubSample(s2.id, { subCode: 'X1', massG: 110 }),
    ).toBeTruthy();
    expect(s.id).toBeTruthy(); // 前一个好会话不受影响
  });

  it('暴露中取走一部分：登记+复测厚度后会话仍可用', () => {
    const { store, current } = makeStore();
    const sample = addSample(store, 'S-WD', '全脂乳粉');
    current.t = start.getTime();
    store.createExposure({
      sampleId: sample.id,
      trayId: '盘C',
      layerThicknessMm: 12,
      initialPowderMassG: 200,
      trayTareG: 30,
      loggerStartedAt: start.toISOString(),
      openedAt: start.toISOString(),
    });
    const s = store.state.exposureSessions[0];
    current.t = start.getTime() + 12 * 60000;
    expect(
      store.addWithdrawal(s.id, {
        at: new Date(current.t).toISOString(),
        massG: 40,
        purpose: '水分快测',
      }),
    ).toBeNull();
    // 窗口外取走被拒（早于敞口开始）
    expect(
      store.addWithdrawal(s.id, {
        at: new Date(start.getTime() - 5 * 60000).toISOString(),
        massG: 5,
        purpose: '敞口前',
      }),
    ).toMatch(/早于敞口开始/);
    store.setExposureField(s.id, 'layerThicknessAfterMm', 9);
    for (let i = 0; i < 10; i++) {
      current.t = start.getTime() + i * 3 * 60000;
      store.addEnvPoint(s.id, { rh: 88, tempC: 25 });
    }
    current.t = start.getTime() + 30 * 60000;
    expect(store.closeExposure(s.id, new Date(current.t).toISOString())).toBeNull();
    expect(store.state.exposureSessions[0].status).toBe('closed');
  });

  it('子样质量不足：不能开始装粉；足量可以并完成暴露后 bulk 测次（不回写原样）', () => {
    const { store, current } = makeStore();
    const sample = addSample(store, 'S-SHORT', '全脂乳粉');
    const s = goodClosedSession(store, sample, current);

    // 不足量子样
    expect(store.createSubSample(s.id, { subCode: 'S-SHORT-LOW', massG: 40 })).toBeNull();
    const low = store.state.subSamples.find((x) => x.subCode === 'S-SHORT-LOW')!;
    expect(store.startSubSampleWizard('bulk', low.id)).toMatch(/SUBSAMPLE_MASS_SHORT|不足/);

    // 足量子样
    expect(store.createSubSample(s.id, { subCode: 'S-SHORT-OK', massG: 110 })).toBeNull();
    const ok = store.state.subSamples.find((x) => x.subCode === 'S-SHORT-OK')!;
    expect(store.startSubSampleWizard('bulk', ok.id)).toBeNull();
    expect(store.state.wizard.provenance?.subCode).toBe('S-SHORT-OK');
    // 装粉应通过并带上溯源
    store.startFill('spoon');
    const d = store.state.wizard.draft!;
    expect(d.kind).toBe('bulk');
    expect(d.aliquotMassG).toBe(110);
    expect(d.exposureStartedAt).toBeNull(); // 暴露子样不套用开封 10min 计时
    store.setBulkField('tareMassG', 46.3);
    store.setBulkField('grossMassG', 102.3);
    store.setBulkField('looseVolumeMl', 78);
    store.setBulkField('looseVolumeMaxMl', 79);
    store.setBulkField('looseVolumeMinMl', 77);
    current.t += 30 * 60000; // 即使等待很久也不触发 MOISTURE_EXPOSURE
    store.gotoStep('tap');
    store.setTap(500, false);
    store.setBulkField('tappedVolumeMl', 68);
    store.setFlag('bulk', 'acceptedReplicate', true);
    const codes = store.review().map((i) => i.code);
    expect(codes).not.toContain('MOISTURE_EXPOSURE');
    const r = store.saveRun();
    expect(r.ok).toBe(true);
    const run = store.state.runs[0];
    expect(run.provenance?.exposureSessionId).toBe(s.id);
    expect(run.provenance?.subCode).toBe('S-SHORT-OK');
    expect(run.sampleId).toBe(sample.id); // 来源仍是原样，但带 provenance
    expect(run.flags.acceptedReplicate).toBe(true);
    // 向导 provenance 已清空
    expect(store.state.wizard.provenance).toBeNull();
  });

  it('两种奶粉共用未清洁漏斗 -> 装粉/复核均拦截 FUNNEL_NOT_CLEANED；清洁后放行', () => {
    const { store, current } = makeStore();
    const a = addSample(store, 'MILK-A', '全脂乳粉');
    const b = addSample(store, 'MILK-B', '脱脂乳粉');

    // A 完成一次流动，漏斗被占用且未清洁
    current.t = start.getTime();
    store.startWizard('flow', a.id);
    store.startFill('funnel');
    store.startFlowLoad(100);
    store.markFlowDischarged(18.0);
    store.setFlowField('residueMassG', 0.1);
    store.saveRun();
    // 保存后漏斗被标记为“上次 A 使用、未清洁”
    expect(store.state.funnel.cleanedSinceLastUse).toBe(false);
    expect(store.state.funnel.lastSampleRef).toBe('MILK-A');

    // B 不清洁直接装粉 -> 拦截
    store.startWizard('flow', b.id);
    store.startFill('funnel');
    expect(store.startFlowLoad(100)).toMatch(/FUNNEL_NOT_CLEANED|清洁/);
    // 复核也报
    const d = store.state.wizard.draft!;
    expect(d.kind).toBe('flow');
    store.setFlowField('chargeMassG', 100);
    expect(store.review().map((i) => i.code)).toContain('FUNNEL_NOT_CLEANED');

    // 清洁确认后放行
    store.setFunnelCleaned(true);
    expect(store.startFlowLoad(100)).toBeNull();
    expect(store.review().map((i) => i.code)).not.toContain('FUNNEL_NOT_CLEANED');
  });

  it('暴露后子样结果不并入原样汇总（分组隔离）', async () => {
    const { summarizeRuns } = await import('../domain/formulas');
    const { store, current } = makeStore();
    const sample = addSample(store, 'S-GRP', '全脂乳粉');

    // 原样一条有效 bulk
    store.startWizard('bulk', sample.id);
    store.startFill('free_pour');
    store.setBulkField('tareMassG', 46.3);
    store.setBulkField('grossMassG', 102.3);
    store.setBulkField('looseVolumeMl', 80);
    store.setBulkField('looseVolumeMaxMl', 81);
    store.setBulkField('looseVolumeMinMl', 79);
    store.setTap(500, false);
    store.setBulkField('tappedVolumeMl', 70);
    store.setFlag('bulk', 'acceptedReplicate', true);
    store.saveRun();

    // 暴露后一条有效 bulk
    const s = goodClosedSession(store, sample, current);
    store.createSubSample(s.id, { subCode: 'S-GRP-RH1', massG: 110 });
    const sub = store.state.subSamples[0];
    store.startSubSampleWizard('bulk', sub.id);
    store.startFill('spoon');
    store.setBulkField('tareMassG', 46.3);
    store.setBulkField('grossMassG', 100);
    store.setBulkField('looseVolumeMl', 82);
    store.setBulkField('looseVolumeMaxMl', 83);
    store.setBulkField('looseVolumeMinMl', 81);
    store.setTap(500, false);
    store.setBulkField('tappedVolumeMl', 66);
    store.setFlag('bulk', 'acceptedReplicate', true);
    store.saveRun();

    const summary = summarizeRuns(store.state.runs, (r) => r.flags.acceptedReplicate);
    expect(summary.validBulk).toBe(1); // 原样仅 1 条
    expect(summary.exposedValidBulk).toBe(1); // 暴露子样单独 1 条
    expect(store.state.runs).toHaveLength(2);
  });

  it('场景注入：funnel_shared_dirty 直接构造未清洁漏斗与跨产品流动草案', () => {
    const { store } = makeStore();
    const msg = store.injectScenario('funnel_shared_dirty');
    expect(msg).toContain('漏斗');
    expect(store.state.funnel.cleanedSinceLastUse).toBe(false);
    expect(store.review().map((i) => i.code)).toContain('FUNNEL_NOT_CLEANED');
  });

  it('场景注入：subsample_short 构造不足量子样并在装粉时拦截', () => {
    const { store } = makeStore();
    store.injectScenario('subsample_short');
    expect(store.state.wizard.provenance).toBeTruthy();
    // 点击装粉 -> 60g < 100g flow
    expect(store.startFill('funnel')).toMatch(/SUBSAMPLE_MASS_SHORT|不足/);
  });
});
