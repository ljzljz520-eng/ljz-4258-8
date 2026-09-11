import { createContextId } from '@builder.io/qwik';
import type {
  Aliquot,
  BulkDraft,
  BulkRun,
  Conditioning,
  Cylinder,
  Draft,
  FillMode,
  FlowDraft,
  FlowRun,
  Issue,
  LabState,
  Run,
  RunFlags,
  Sample,
  SampleSnapshot,
  WizardStep,
} from '../domain/types';
import { SEED_METHOD_ID } from '../domain/seed';
import {
  calcBulkDensity,
  calcFlowTime,
  calcTappedDensity,
} from '../domain/formulas';
import { hasFatal, validateBulk, validateFlow } from '../domain/validate';
import { saveState } from '../db/idb';

export const defaultFlags = (): RunFlags => ({
  caking: false,
  bridging: false,
  spillage: false,
  acceptedReplicate: false,
  moistureAbsorbed: false,
});

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function snapshotOf(s: Sample): SampleSnapshot {
  return {
    sampleCode: s.sampleCode,
    batchNo: s.batchNo,
    openedAt: s.openedAt,
    conditioning: s.conditioning,
  };
}

export function newBulkDraft(tapTarget: number): BulkDraft {
  return {
    kind: 'bulk',
    aliquotId: '',
    fillMode: 'free_pour',
    tareMassG: null,
    grossMassG: null,
    looseVolumeMl: null,
    looseVolumeMaxMl: null,
    looseVolumeMinMl: null,
    tapTarget,
    tapCount: 0,
    tapInterrupted: false,
    tappedVolumeMl: null,
    flags: defaultFlags(),
    exposureStartedAt: null,
    note: '',
  };
}

export function newFlowDraft(): FlowDraft {
  return {
    kind: 'flow',
    aliquotId: '',
    chargeMassG: null,
    flowTimeS: null,
    residueMassG: null,
    outletSticking: false,
    flags: defaultFlags(),
    exposureStartedAt: null,
    note: '',
  };
}

export interface LabStore {
  state: LabState;
  addSample(input: {
    sampleCode: string;
    productName: string;
    batchNo: string;
    producedAt: string;
    openedAt: string;
    conditioning: Conditioning;
    note?: string;
  }): string | null;
  startWizard(kind: 'bulk' | 'flow', sampleId: string): void;
  gotoStep(step: WizardStep): void;
  back(): void;
  setKind(kind: 'bulk' | 'flow'): void;
  setCylinder(cylinderId: string): void;
  setMethod(methodId: string): void;
  startFill(fillMode: FillMode): string | null;
  setBulkField<K extends keyof BulkDraft>(key: K, value: BulkDraft[K]): void;
  setFlag(kind: 'bulk' | 'flow', key: keyof RunFlags, value: boolean): void;
  setTap(count: number, interrupted: boolean): void;
  startFlowLoad(chargeG: number): string | null;
  markFlowDischarged(flowTimeS: number): string | null;
  setFlowField<K extends keyof FlowDraft>(key: K, value: FlowDraft[K]): void;
  setNote(kind: 'bulk' | 'flow', note: string): void;
  review(): Issue[];
  saveRun(): { ok: boolean; issues: Issue[]; runId?: string; fatal: boolean };
  abortWizard(reason: string): void;
  discardAliquot(reason: string): void;
  /** 五个测试场景一键注入（演练/自检；在本机库中产生演示样与草案） */
  injectScenario(
    scenario:
      | 'wrong_tare'
      | 'tilt'
      | 'tap_interrupt'
      | 'funnel_stick'
      | 'moisture',
  ): string;
}

export type ScenarioId =
  | 'wrong_tare'
  | 'tilt'
  | 'tap_interrupt'
  | 'funnel_stick'
  | 'moisture';

const STEP_ORDER: WizardStep[] = ['sample', 'fill', 'loose', 'tap', 'flow', 'review'];

export const LabStoreContext= createContextId<LabStore>('lab-store');

export interface StoreDeps {
  persist?: (s: LabState) => Promise<void>;
  now?: () => Date;
}

export function createLabStore(initial: LabState, deps: StoreDeps = {}): LabStore {
  const persist = deps.persist ?? saveState;
  const now = deps.now ?? (() => new Date());
  const state = initial;

  const save = (): void => {
    void persist(state);
  };

  const fail = (wizardMsg: string): string => {
    state.wizard.uiError = wizardMsg;
    save();
    return wizardMsg;
  };

  const clearError = (): void => {
    if (state.wizard.uiError) state.wizard.uiError = null;
  };

  const getSample = (): Sample | null =>
    state.samples.find((s) => s.id === state.wizard.sampleId) ?? null;
  const getMethod = () =>
    state.methods.find((m) => m.id === state.wizard.methodId) ?? null;
  const getCylinder = (): Cylinder | null =>
    state.cylinders.find((c) => c.id === state.wizard.cylinderId) ?? null;
  const getAliquot = (): Aliquot | null =>
    state.wizard.draft
      ? state.aliquots.find((a) => a.id === state.wizard.draft!.aliquotId) ?? null
      : null;

  const bulkDraft = (): BulkDraft | null =>
    state.wizard.draft?.kind === 'bulk' ? state.wizard.draft : null;
  const flowDraft = (): FlowDraft | null =>
    state.wizard.draft?.kind === 'flow' ? state.wizard.draft : null;

  /** 暴露时长（min）：从分装/等待开始到现在 */
  const exposureMin = (d: Draft): number | null => {
    if (!d.exposureStartedAt) return null;
    const start = Date.parse(d.exposureStartedAt);
    if (!Number.isFinite(start)) return null;
    return Math.round(((now().getTime() - start) / 60000) * 10) / 10;
  };

  const advanceTo = (step: WizardStep): void => {
    state.wizard.step = step;
    clearError();
    save();
  };

  const store: LabStore = {
    state,

    addSample(input) {
      if (!input.sampleCode.trim()) return '生产样编号不能为空';
      if (!input.batchNo.trim()) return '批号不能为空';
      if (!input.openedAt) return '开封时间必填';
      const dup = state.samples.some(
        (s) =>
          s.sampleCode.trim() === input.sampleCode.trim() &&
          s.batchNo.trim() === input.batchNo.trim(),
      );
      if (dup) return '同一生产样编号 + 批号已存在';
      const sample: Sample = {
        id: uid('smp'),
        sampleCode: input.sampleCode.trim(),
        productName: input.productName.trim(),
        batchNo: input.batchNo.trim(),
        producedAt: input.producedAt,
        openedAt: new Date(input.openedAt).toISOString(),
        conditioning: input.conditioning,
        note: input.note?.trim() || undefined,
        createdAt: now().toISOString(),
      };
      state.samples = [...state.samples, sample];
      state.wizard.sampleId = sample.id;
      save();
      return null;
    },

    startWizard(kind, sampleId) {
      const sample = state.samples.find((s) => s.id === sampleId);
      if (!sample) {
        fail('请先选择或登记生产样');
        return;
      }
      const method = getMethod() ?? state.methods[0];
      state.wizard.kind = kind;
      state.wizard.sampleId = sampleId;
      state.wizard.methodId = method.id;
      state.wizard.cylinderId = method.bulkCylinderId;
      state.wizard.draft =
        kind === 'bulk' ? newBulkDraft(method.tapTarget) : newFlowDraft();
      advanceTo('fill');
    },

    gotoStep(step) {
      if (
        STEP_ORDER.indexOf(step) > STEP_ORDER.indexOf('fill') &&
        !state.wizard.draft?.aliquotId
      ) {
        fail('请先在“装粉”步取一份新 aliquot');
        return;
      }
      if (step === 'review' && !state.wizard.draft) {
        fail('暂无待复核数据');
        return;
      }
      advanceTo(step);
    },

    back() {
      const i = STEP_ORDER.indexOf(state.wizard.step);
      if (i > 0) advanceTo(STEP_ORDER[i - 1]);
    },

    setKind(kind) {
      state.wizard.kind = kind;
      save();
    },
    setCylinder(cylinderId) {
      state.wizard.cylinderId = cylinderId;
      save();
    },
    setMethod(methodId) {
      const m = state.methods.find((x) => x.id === methodId);
      if (!m) return;
      state.wizard.methodId = methodId;
      state.wizard.cylinderId = m.bulkCylinderId;
      const d = bulkDraft();
      if (d && d.tapTarget !== m.tapTarget) d.tapTarget = m.tapTarget;
      save();
    },

    startFill(fillMode) {
      const sample = getSample();
      if (!sample) return fail('请先选择生产样');
      const kind = state.wizard.kind;
      const aliquot: Aliquot = {
        id: uid('alq'),
        sampleId: sample.id,
        kind,
        phase: 'fresh',
        preparedAt: now().toISOString(),
      };
      state.aliquots = [...state.aliquots, aliquot];
      if (kind === 'bulk') {
        const d = newBulkDraft(getMethod()?.tapTarget ?? 500);
        d.aliquotId = aliquot.id;
        d.fillMode = fillMode;
        d.exposureStartedAt = aliquot.preparedAt;
        state.wizard.draft = d;
        advanceTo('loose');
      } else {
        const d = newFlowDraft();
        d.aliquotId = aliquot.id;
        d.exposureStartedAt = aliquot.preparedAt;
        state.wizard.draft = d;
        state.wizard.step = 'flow';
        clearError();
        save();
      }
      return null;
    },

    setBulkField(key, value) {
      const d = bulkDraft();
      if (!d) return;
      (d as unknown as Record<string, unknown>)[key] = value;
      save();
    },

    setFlag(kind, key, value) {
      const d = kind === 'bulk' ? bulkDraft() : flowDraft();
      if (!d) return;
      d.flags[key] = value;
      save();
    },

    setTap(count, interrupted) {
      const d = bulkDraft();
      if (!d) return;
      const a = getAliquot();
      if (a && a.phase === 'tapped') {
        fail('该 aliquot 已振实，不得回退冒充初始松装样');
        return;
      }
      d.tapCount = Math.max(0, Math.floor(count));
      // 中断一旦发生即锁定（恢复设备也不能撤销本测次中断事实）
      d.tapInterrupted = d.tapInterrupted || interrupted;
      save();
    },

    startFlowLoad(chargeG) {
      const d = flowDraft();
      if (!d) return fail('当前不是漏斗流动试验');
      const a = getAliquot();
      if (!a) return fail('缺少分装 aliquot');
      if (a.phase !== 'fresh') {
        return fail(
          a.phase === 'flow_discharged'
            ? '该 aliquot 已放开流出，不得重复使用，请另取新样'
            : '该 aliquot 已装入漏斗，不能重复装填',
        );
      }
      if (!(chargeG > 0)) return fail('装粉量必须为正数');
      d.chargeMassG = chargeG;
      a.phase = 'flow_loaded';
      save();
      return null;
    },

    markFlowDischarged(flowTimeS) {
      const d = flowDraft();
      if (!d) return fail('当前不是漏斗流动试验');
      const a = getAliquot();
      if (!a || a.phase !== 'flow_loaded') {
        return fail('须先“装入漏斗”再放开流出');
      }
      if (!(flowTimeS >= 0)) return fail('流出时间无效');
      d.flowTimeS = Math.round(flowTimeS * 100) / 100;
      a.phase = 'flow_discharged';
      save();
      return null;
    },

    setFlowField(key, value) {
      const d = flowDraft();
      if (!d) return;
      (d as unknown as Record<string, unknown>)[key] = value;
      save();
    },

    setNote(kind, note) {
      const d = kind === 'bulk' ? bulkDraft() : flowDraft();
      if (!d) return;
      d.note = note;
      save();
    },

    review() {
      const method = getMethod();
      if (!method || !state.wizard.draft) return [];
      const exposure = exposureMin(state.wizard.draft);
      if (state.wizard.draft.kind === 'bulk') {
        const cyl = getCylinder();
        if (!cyl)
          return [{ level: 'error', code: 'CYL_MISSING', message: '未选择量筒' }];
        return validateBulk(method, cyl, state.wizard.draft as BulkDraft, exposure);
      }
      return validateFlow(method, state.wizard.draft as FlowDraft, exposure);
    },

    saveRun() {
      const method = getMethod();
      const sample = getSample();
      const issues = store.review();
      const fatal = hasFatal(issues);
      if (!method || !sample || !state.wizard.draft) {
        return { ok: false, issues, fatal: true };
      }
      const d = state.wizard.draft;
      const exposure = exposureMin(d);

      if (d.kind === 'bulk') {
        const cyl = getCylinder();
        if (!cyl) return { ok: false, issues, fatal: true };
        const net =
          d.grossMassG != null && d.tareMassG != null
            ? d.grossMassG - d.tareMassG
            : null;
        const computable = !fatal && net != null && net > 0 && d.looseVolumeMl != null;
        if (d.flags.acceptedReplicate && !computable) {
          return { ok: false, issues, fatal };
        }
        const run: BulkRun = {
          id: uid('run'),
          kind: 'bulk',
          sampleId: sample.id,
          aliquotId: d.aliquotId,
          snapshot: snapshotOf(sample),
          methodId: method.id,
          cylinderId: cyl.id,
          cylinderListedTareG: cyl.listedTareG,
          fillMode: d.fillMode,
          looseVolumeMl: d.looseVolumeMl,
          looseVolumeMaxMl: d.looseVolumeMaxMl,
          looseVolumeMinMl: d.looseVolumeMinMl,
          grossMassG: d.grossMassG,
          tareMassG: d.tareMassG,
          tapTarget: d.tapTarget,
          tapCount: d.tapCount,
          tapInterrupted: d.tapInterrupted,
          tappedVolumeMl: d.tappedVolumeMl,
          flags: {
            ...d.flags,
            acceptedReplicate: d.flags.acceptedReplicate && !fatal,
          },
          exposureMin: exposure,
          note: d.note,
          createdAt: now().toISOString(),
        };
        const a = getAliquot();
        if (a) a.phase = 'tapped'; // 锁定：振实后禁止再用于初始松装
        state.runs = [...state.runs, run as Run];
        state.wizard.draft = null;
        state.wizard.step = 'sample';
        save();
        return { ok: true, issues, runId: run.id, fatal };
      }

      const fd = d as FlowDraft;
      const computableFlow =
        !fatal && fd.flowTimeS != null && fd.chargeMassG != null && fd.chargeMassG > 0;
      if (fd.flags.acceptedReplicate && !computableFlow) {
        return { ok: false, issues, fatal };
      }
      const run: FlowRun = {
        id: uid('run'),
        kind: 'flow',
        sampleId: sample.id,
        aliquotId: fd.aliquotId,
        snapshot: snapshotOf(sample),
        methodId: method.id,
        chargeMassG: fd.chargeMassG,
        flowTimeS: fd.flowTimeS,
        residueMassG: fd.residueMassG,
        outletSticking: fd.outletSticking,
        flags: {
          ...fd.flags,
          acceptedReplicate: fd.flags.acceptedReplicate && !fatal,
        },
        exposureMin: exposure,
        note: fd.note,
        createdAt: now().toISOString(),
      };
      const a = getAliquot();
      if (a) a.phase = 'flow_discharged';
      state.runs = [...state.runs, run as Run];
      state.wizard.draft = null;
      state.wizard.step = 'sample';
      save();
      return { ok: true, issues, runId: run.id, fatal };
    },

    abortWizard(reason) {
      const a = getAliquot();
      if (a) {
        a.phase = 'spent';
        a.note = `中止：${reason}`;
      }
      state.wizard.draft = null;
      state.wizard.step = 'sample';
      clearError();
      save();
    },

    discardAliquot(reason) {
      const a = getAliquot();
      if (a) {
        a.phase = 'spent';
        a.note = reason;
      }
      // 丢弃后必须重新取 aliquot
      if (state.wizard.draft) state.wizard.draft.aliquotId = '';
      state.wizard.step = 'fill';
      clearError();
      save();
    },

    injectScenario(scenario) {
      const method = state.methods[0];
      if (!method) throw new Error('缺少已批准方法');
      const tag =
        scenario === 'wrong_tare'
          ? '皮重错用'
          : scenario === 'tilt'
            ? '粉面倾斜'
            : scenario === 'tap_interrupt'
              ? '振实中断'
              : scenario === 'funnel_stick'
                ? '漏斗口粘粉'
                : '等待吸湿';
      const sample: Sample = {
        id: uid('smp'),
        sampleCode: `DEMO-${scenario}`,
        productName: '（场景演练）全脂乳粉',
        batchNo: `T${Date.now().toString(36)}`,
        producedAt: now().toISOString(),
        openedAt: new Date(now().getTime() - 30 * 60000).toISOString(),
        conditioning: 'as_received',
        note: `场景演练：${tag}`,
        createdAt: now().toISOString(),
      };
      state.samples = [...state.samples, sample];

      const makeAliquot = (kind: 'bulk' | 'flow', preparedAt: string): Aliquot => {
        const a: Aliquot = {
          id: uid('alq'),
          sampleId: sample.id,
          kind,
          phase: kind === 'bulk' ? 'bulk_loose' : 'flow_discharged',
          preparedAt,
        };
        state.aliquots = [...state.aliquots, a];
        return a;
      };

      if (scenario === 'wrong_tare' || scenario === 'tilt' || scenario === 'tap_interrupt') {
        const a = makeAliquot('bulk', new Date(now().getTime() - 2 * 60000).toISOString());
        const d = newBulkDraft(method.tapTarget);
        d.aliquotId = a.id;
        d.fillMode = 'free_pour';
        d.exposureStartedAt = a.preparedAt;
        d.tareMassG = 58.4; // 与台账 46.2 g 明显不符
        d.grossMassG = 102.3;
        d.looseVolumeMl = 78;
        d.looseVolumeMaxMl = 79;
        d.looseVolumeMinMl = 77;
        d.tapCount = 500;
        d.tappedVolumeMl = 68;
        if (scenario === 'tilt') {
          d.tareMassG = 46.3; // 皮重正常，仅倾斜超差
          d.looseVolumeMl = 78;
          d.looseVolumeMaxMl = 82;
          d.looseVolumeMinMl = 76;
        }
        if (scenario === 'tap_interrupt') {
          d.tareMassG = 46.3;
          d.looseVolumeMaxMl = 79;
          d.looseVolumeMinMl = 77;
          d.tapCount = 463;
          d.tapInterrupted = true; // 脉冲丢失，按方法判废
          d.tappedVolumeMl = null;
        }
        state.wizard.kind = 'bulk';
        state.wizard.sampleId = sample.id;
        state.wizard.methodId = method.id;
        state.wizard.cylinderId = method.bulkCylinderId;
        state.wizard.draft = d;
        state.wizard.step = 'review';
        state.wizard.uiError = null;
        save();
        return `已注入「${tag}」场景，请在复核页查看判废项`;
      }

      // flow scenarios
      const minutesAgo = scenario === 'moisture' ? method.maxExposureMin + 3 : 2;
      const a = makeAliquot(
        'flow',
        new Date(now().getTime() - minutesAgo * 60000).toISOString(),
      );
      const d = newFlowDraft();
      d.aliquotId = a.id;
      d.exposureStartedAt = a.preparedAt;
      d.chargeMassG = method.flowChargeG;
      d.flowTimeS = 18.6;
      d.residueMassG = 0.2;
      if (scenario === 'funnel_stick') {
        d.outletSticking = true;
        d.residueMassG = 3.4;
      }
      if (scenario === 'moisture') {
        d.flags.moistureAbsorbed = true;
        d.note = '等待检测台占用，开封暴露超限';
      }
      state.wizard.kind = 'flow';
      state.wizard.sampleId = sample.id;
      state.wizard.methodId = method.id;
      state.wizard.draft = d;
      state.wizard.step = 'review';
      state.wizard.uiError = null;
      save();
      return `已注入「${tag}」场景，请在复核页查看判废项`;
    },
  };

  return store;
}

/** 界面结果预览（复核通过才在正式记录里出现密度值） */
export function previewBulk(
  d: BulkDraft,
  allowedFormulaIds: string[],
): { net: number | null; bulk: number | null; tapped: number | null } {
  const net =
    d.grossMassG != null && d.tareMassG != null ? d.grossMassG - d.tareMassG : null;
  let bulk: number | null = null;
  let tapped: number | null = null;
  try {
    if (
      net != null &&
      d.looseVolumeMl != null &&
      allowedFormulaIds.includes('bulk-density-q-phy-01')
    ) {
      bulk = calcBulkDensity(net, d.looseVolumeMl);
    }
    if (
      net != null &&
      d.tappedVolumeMl != null &&
      allowedFormulaIds.includes('tapped-density-q-phy-01')
    ) {
      tapped = calcTappedDensity(net, d.tappedVolumeMl);
    }
  } catch {
    /* 显示为空，判废由复核层负责 */
  }
  return { net, bulk, tapped };
}

export function previewFlowTime(startIso: string | null, end: Date): number | null {
  if (!startIso) return null;
  const s = Date.parse(startIso);
  if (!Number.isFinite(s)) return null;
  try {
    return calcFlowTime(s, end.getTime());
  } catch {
    return null;
  }
}

export function initialWizardState(): LabState['wizard'] {
  return {
    step: 'sample',
    kind: 'bulk',
    sampleId: null,
    methodId: SEED_METHOD_ID,
    cylinderId: 'cyl-100',
    draft: null,
    uiError: null,
  };
}
