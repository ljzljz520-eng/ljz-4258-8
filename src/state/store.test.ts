import { describe, expect, it, vi } from 'vitest';
import { createLabStore } from './store';
import { createInitialState } from '../db/idb';
import type { LabState } from '../domain/types';

function makeStore(now = new Date('2026-09-11T10:00:00Z')) {
  const persist = vi.fn(async (_s: LabState) => {});
  const store = createLabStore(createInitialState(), {
    persist,
    now: () => new Date(now.getTime()),
  });
  const err = store.addSample({
    sampleCode: 'S1',
    productName: '全脂乳粉',
    batchNo: 'B1',
    producedAt: now.toISOString(),
    openedAt: now.toISOString(),
    conditioning: 'as_received',
  });
  expect(err).toBeNull();
  return { store, persist, now };
}

function fillBulk(store: ReturnType<typeof createLabStore>, tare = 46.3) {
  store.startWizard('bulk', store.state.samples[0].id);
  store.startFill('free_pour');
  store.setBulkField('tareMassG', tare);
  store.setBulkField('grossMassG', 102.3);
  store.setBulkField('looseVolumeMl', 78);
  store.setBulkField('looseVolumeMaxMl', 79);
  store.setBulkField('looseVolumeMinMl', 77);
}

describe('aliquot 阶段锁定：振实后不能冒充初始松装样', () => {
  it('每次装粉都产生新 aliquot', () => {
    const { store } = makeStore();
    fillBulk(store);
    const id1 = store.state.wizard.draft!.aliquotId;
    store.gotoStep('tap');
    store.setTap(500, false);
    store.setBulkField('tappedVolumeMl', 68);
    const r = store.saveRun();
    expect(r.ok).toBe(true);
    const saved = store.state.aliquots.find((a) => a.id === id1)!;
    expect(saved.phase).toBe('tapped');
    // 新一轮试验必须分装新 aliquot
    store.startWizard('bulk', store.state.samples[0].id);
    store.startFill('spoon');
    const id2 = store.state.wizard.draft!.aliquotId;
    expect(id2).not.toBe(id1);
  });

  it('漏斗 aliquot 已装粉/已流完不可重复使用', () => {
    const { store } = makeStore();
    store.startWizard('flow', store.state.samples[0].id);
    store.startFill('funnel');
    expect(store.startFlowLoad(100)).toBeNull();
    // 重复装粉被拒
    expect(store.startFlowLoad(100)).toMatch(/不能重复装填/);
    expect(store.markFlowDischarged(18.6)).toBeNull();
    // 流完后不能再放开
    expect(store.markFlowDischarged(2)).toMatch(/须先/);
    // 新一轮必须新 aliquot
    store.startWizard('flow', store.state.samples[0].id);
    const oldId = store.state.aliquots.filter((a) => a.kind === 'flow')[0].id;
    store.startFill('funnel');
    expect(store.state.wizard.draft!.aliquotId).not.toBe(oldId);
  });

  it('中断锁定后不可“续数”撤销', () => {
    const { store } = makeStore();
    fillBulk(store);
    store.gotoStep('tap');
    store.setTap(463, true);
    store.setTap(500, false); // 恢复后续数
    const d = store.state.wizard.draft!;
    expect(d.kind === 'bulk' && d.tapInterrupted).toBe(true);
    const issues = store.review().map((i) => i.code);
    expect(issues).toContain('TAP_INTERRUPTED');
  });

  it('皮重错用导致不能保存为有效测次，但可留档', () => {
    const { store } = makeStore();
    fillBulk(store, 58.4);
    store.gotoStep('tap');
    store.setTap(500, false);
    store.setBulkField('tappedVolumeMl', 68);
    store.setFlag('bulk', 'acceptedReplicate', true);
    store.gotoStep('review');
    const codes = store.review().map((i) => i.code);
    expect(codes).toContain('TARE_MISMATCH');
    // 勾了有效测次 + 有判废项：拒绝保存
    const rejected = store.saveRun();
    expect(rejected.ok).toBe(false);
    expect(store.state.runs.length).toBe(0);
    // 取消有效勾选：允许留档（无效），且 acceptedReplicate 被强制 false
    store.setFlag('bulk', 'acceptedReplicate', false);
    const saved = store.saveRun();
    expect(saved.ok).toBe(true);
    expect(store.state.runs[0].flags.acceptedReplicate).toBe(false);
  });

  it('等待吸湿超限（注入 now）判废', () => {
    const start = new Date('2026-09-11T10:00:00Z');
    const persist = vi.fn(async () => {});
    const current = { t: start.getTime() };
    const store = createLabStore(createInitialState(), {
      persist,
      now: () => new Date(current.t),
    });
    store.addSample({
      sampleCode: 'S2', productName: 'x', batchNo: 'B2',
      producedAt: start.toISOString(), openedAt: start.toISOString(),
      conditioning: 'as_received',
    });
    store.startWizard('flow', store.state.samples[0].id);
    store.startFill('funnel');
    // 等待 13 分钟
    current.t += 13 * 60000;
    store.startFlowLoad(100);
    store.markFlowDischarged(19.0);
    store.setFlowField('residueMassG', 0.1);
    const codes = store.review().map((i) => i.code);
    expect(codes).toContain('MOISTURE_EXPOSURE_FLOW');
  });

  it('正常 bulk 流程可保存为有效测次并按公式计算', () => {
    const { store } = makeStore();
    fillBulk(store);
    store.gotoStep('tap');
    store.setTap(500, false);
    store.setBulkField('tappedVolumeMl', 68);
    store.setFlag('bulk', 'acceptedReplicate', true);
    store.gotoStep('review');
    expect(store.review().filter((i) => i.level === 'error').length).toBe(0);
    const r = store.saveRun();
    expect(r.ok).toBe(true);
    expect(r.fatal).toBe(false);
    expect(store.state.runs.length).toBe(1);
    expect(store.state.runs[0].flags.acceptedReplicate).toBe(true);
  });
});
