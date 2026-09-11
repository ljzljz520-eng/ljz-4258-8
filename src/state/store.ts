import { createContextId } from '@builder.io/qwik';
import type {
  Aliquot,
  BulkDraft,
  BulkRun,
  Conditioning,
  Cylinder,
  Draft,
  EnvPoint,
  ExposureSession,
  ExposureWithdrawal,
  FillMode,
  FlowDraft,
  FlowRun,
  Issue,
  LabState,
  Run,
  RunFlags,
  Sample,
  SampleSnapshot,
  SubSample,
  WizardStep,
} from '../domain/types';
import { SEED_METHOD_ID } from '../domain/seed';
import {
  calcBulkDensity,
  calcFlowTime,
  calcTappedDensity,
} from '../domain/formulas';
import { hasFatal, validateBulk, validateFlow } from '../domain/validate';
import {
  checkFunnelCleanliness,
  isExposureUsable,
  validateExposure,
  validateSubSampleMass,
  type ExposureIssue,
} from '../domain/exposure';
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
    aliquotMassG: null,
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
    aliquotMassG: null,
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
  setFunnelCleaned(cleaned: boolean): void;

  /* ---- 短时高湿暴露分支 ---- */
  createExposure(input: {
    sampleId: string;
    trayId: string;
    layerThicknessMm: number | null;
    initialPowderMassG: number | null;
    trayTareG: number | null;
    loggerStartedAt: string | null;
    openedAt?: string;
    note?: string;
  }): string | null;
  setExposureField<K extends keyof ExposureSession>(
    id: string,
    key: K,
    value: ExposureSession[K],
  ): void;
  addEnvPoint(id: string, p: { rh: number; tempC: number; at?: string }): string | null;
  addWithdrawal(
    id: string,
    w: { at: string; massG: number; purpose: string },
  ): string | null;
  closeExposure(id: string, closedAt: string): string | null;
  invalidateExposure(id: string, reason: string): void;
  reviewExposure(id: string): ExposureIssue[];
  createSubSample(
    sessionId: string,
    input: { subCode: string; massG: number | null; note?: string },
  ): string | null;
  /** 以暴露后独立子样开始一轮物性试验向导（不修改原样记录） */
  startSubSampleWizard(
    kind: 'bulk' | 'flow',
    subSampleId: string,
  ): string | null;
  /** 异常场景一键注入（演练/自检；在本机库中产生演示样与草案） */
  injectScenario(
    scenario:
      | 'wrong_tare'
      | 'tilt'
      | 'tap_interrupt'
      | 'funnel_stick'
      | 'moisture'
      | ExposeScenarioId,
  ): string;
}

export type ScenarioId =
  | 'wrong_tare'
  | 'tilt'
  | 'tap_interrupt'
  | 'funnel_stick'
  | 'moisture';

/** 五个新增异常场景（高湿暴露分支 + 漏斗交叉污染） */
export type ExposeScenarioId =
  | 'logger_late'
  | 'dish_condensation'
  | 'mid_withdrawal'
  | 'subsample_short'
  | 'funnel_shared_dirty';

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
      state.wizard.sampleId = sample.id;
      state.wizard.methodId = method.id;
      state.wizard.cylinderId = method.bulkCylinderId;
      state.wizard.provenance = null;
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
      const provenance = state.wizard.provenance;
      // 暴露后子样试验：称取质量必须已达标才允许开装（子样质量不足场景）
      let sub: SubSample | null = null;
      if (provenance?.subSampleId) {
        sub = state.subSamples.find((x) => x.id === provenance.subSampleId) ?? null;
        if (!sub) return fail('暴露子样不存在，请从暴露分支重新进入');
        const massIssues = validateSubSampleMass(
          sub,
          kind,
        );
        if (massIssues.some((i) => i.level === 'error')) {
          return fail(
            massIssues[0].message + '（不能开始装粉，且禁止用暴露后结果回写原样）',
          );
        }
      }
      const aliquot: Aliquot = {
        id: uid('alq'),
        sampleId: sample.id,
        kind,
        phase: 'fresh',
        preparedAt: now().toISOString(),
        exposureSessionId: provenance?.exposureSessionId,
        subSampleId: provenance?.subSampleId,
      };
      state.aliquots = [...state.aliquots, aliquot];
      if (kind === 'bulk') {
        const d = newBulkDraft(getMethod()?.tapTarget ?? 500);
        d.aliquotId = aliquot.id;
        d.fillMode = fillMode;
        d.aliquotMassG = sub?.massG ?? null;
        // 暴露后子样不套用“开封暴露 10 min”计时（暴露时长在会话记录中受控）
        d.exposureStartedAt = provenance ? null : aliquot.preparedAt;
        state.wizard.draft = d;
        advanceTo('loose');
      } else {
        const d = newFlowDraft();
        d.aliquotId = aliquot.id;
        d.aliquotMassG = sub?.massG ?? null;
        d.exposureStartedAt = provenance ? null : aliquot.preparedAt;
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

      // 两种奶粉共用未清洁漏斗：装粉前按当前产品核对漏斗清洁状态
      const provenance = state.wizard.provenance;
      const sub = provenance?.subSampleId
        ? state.subSamples.find((x) => x.id === provenance.subSampleId)
        : null;
      const productName = sub
        ? `${getSample()?.productName ?? ''}（暴露子样 ${sub.subCode}）`
        : getSample()?.productName ?? '';
      const current: Sample = {
        id: getSample()?.id ?? '',
        sampleCode: sub?.subCode ?? getSample()?.sampleCode ?? '',
        productName,
        batchNo: '',
        producedAt: '',
        openedAt: '',
        conditioning: 'as_received',
        createdAt: '',
      };
      const funnelIssues = checkFunnelCleanliness(state.funnel, current);
      if (funnelIssues.some((i) => i.level === 'error')) {
        return fail(
          funnelIssues[0].message + '（清洁并确认前，本 aliquot 不得装入漏斗）',
        );
      }

      d.chargeMassG = chargeG;
      if (d.aliquotMassG == null) d.aliquotMassG = chargeG;
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
      // 装粉量经“称取并锁定”后随 aliquot 阶段锁定，禁止再改写称量值
      if (key === 'chargeMassG') {
        const a = getAliquot();
        if (a && a.phase !== 'fresh') {
          fail(
            '装粉量已锁定（该 aliquot 已装粉/已流出），不得改写称量值；如需更改请丢弃当前 aliquot 另取新样',
          );
          return;
        }
      }
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
      const provenance = state.wizard.provenance;
      if (state.wizard.draft.kind === 'bulk') {
        const cyl = getCylinder();
        if (!cyl)
          return [{ level: 'error', code: 'CYL_MISSING', message: '未选择量筒' }];
        return validateBulk(
          method,
          cyl,
          state.wizard.draft as BulkDraft,
          exposure,
          { provenance: provenance ?? undefined },
        );
      }
      // 流动：复核时也再次核对漏斗清洁状态（防止两种奶粉共用未清洁漏斗）
      const sample = getSample();
      let funnelIssues: Issue[] = [];
      if (sample) {
        const sub = provenance?.subSampleId
          ? state.subSamples.find((x) => x.id === provenance.subSampleId)
          : null;
        funnelIssues = checkFunnelCleanliness(state.funnel, {
          ...sample,
          sampleCode: sub?.subCode ?? sample.sampleCode,
          productName: sub
            ? `${sample.productName}（暴露子样 ${sub.subCode}）`
            : sample.productName,
        });
      }
      return validateFlow(method, state.wizard.draft as FlowDraft, exposure, {
        provenance: provenance ?? undefined,
        funnelIssues,
      });
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
      const provenance = state.wizard.provenance ?? undefined;
      const sub = provenance?.subSampleId
        ? state.subSamples.find((x) => x.id === provenance.subSampleId)
        : null;

      if (d.kind === 'bulk') {
        const cyl = getCylinder();
        if (!cyl) return { ok: false, issues, fatal: true };
        const net =
          d.grossMassG != null && d.tareMassG != null
            ? d.grossMassG - d.tareMassG
            : null;
        const computable =
          !fatal &&
          net != null &&
          net > 0 &&
          d.looseVolumeMl != null &&
          d.looseVolumeMl > 0 &&
          d.tappedVolumeMl != null &&
          d.tappedVolumeMl > 0;
        if (d.flags.acceptedReplicate && !computable) {
          return { ok: false, issues, fatal };
        }
        const run: BulkRun = {
          id: uid('run'),
          kind: 'bulk',
          sampleId: sample.id,
          aliquotId: d.aliquotId,
          provenance,
          snapshot: snapshotOf(sample),
          methodId: method.id,
          cylinderId: cyl.id,
          cylinderListedTareG: cyl.listedTareG,
          fillMode: d.fillMode,
          aliquotMassG: d.aliquotMassG,
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
        state.wizard.provenance = null;
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
        provenance,
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
      // 流动完成即占用漏斗：下次任何奶粉使用前必须重新清洁确认
      state.funnel = {
        lastProductName: sample.productName,
        lastSampleRef: sub?.subCode ?? sample.sampleCode,
        lastUsedAt: now().toISOString(),
        cleanedSinceLastUse: false,
      };
      state.wizard.draft = null;
      state.wizard.provenance = null;
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
      state.wizard.provenance = null;
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

    setFunnelCleaned(cleaned) {
      state.funnel.cleanedSinceLastUse = cleaned;
      save();
    },

    /* ---------------- 短时高湿暴露分支 ---------------- */

    createExposure(input) {
      const sample = state.samples.find((s) => s.id === input.sampleId);
      if (!sample) return '请先选择要敞口暴露的原样';
      // 暴露分支只能基于原样，不能对暴露后子样再次暴露
      if (state.subSamples.some((x) => x.sourceSampleId === sample.id && x.subCode === sample.sampleCode)) {
        return '不能对暴露后子样再次暴露';
      }
      if (!input.openedAt) return '缺少敞口开始时间';
      if (input.layerThicknessMm != null && input.layerThicknessMm <= 0) {
        return '样层厚度必须为正';
      }
      const session: ExposureSession = {
        id: uid('exp'),
        sampleId: sample.id,
        openedAt: new Date(input.openedAt).toISOString(),
        closedAt: null,
        status: 'open',
        trayId: input.trayId.trim() || '未编号样盘',
        layerThicknessMm: input.layerThicknessMm,
        layerThicknessAfterMm: null,
        initialPowderMassG: input.initialPowderMassG,
        trayTareG: input.trayTareG,
        loggerStartedAt: input.loggerStartedAt
          ? new Date(input.loggerStartedAt).toISOString()
          : null,
        localCondensation: false,
        withdrawals: [],
        curve: [],
        note: input.note?.trim() || '',
        createdAt: now().toISOString(),
      };
      state.exposureSessions = [...state.exposureSessions, session];
      save();
      return null;
    },

    setExposureField(id, key, value) {
      const s = state.exposureSessions.find((x) => x.id === id);
      if (!s) return;
      (s as unknown as Record<string, unknown>)[key] = value;
      save();
    },

    addEnvPoint(id, p) {
      const s = state.exposureSessions.find((x) => x.id === id);
      if (!s) return '暴露会话不存在';
      if (!(p.rh > 0) || !(p.rh <= 100)) return '相对湿度需在 0–100 %RH';
      if (!Number.isFinite(p.tempC)) return '温度无效';
      const point: EnvPoint = {
        at: p.at ? new Date(p.at).toISOString() : now().toISOString(),
        rh: p.rh,
        tempC: p.tempC,
      };
      s.curve = [...s.curve, point];
      save();
      return null;
    },

    addWithdrawal(id, w) {
      const s = state.exposureSessions.find((x) => x.id === id);
      if (!s) return '暴露会话不存在';
      if (!(w.massG > 0)) return '取走质量必须为正';
      const atIso = new Date(w.at).toISOString();
      const at = Date.parse(atIso);
      const start = Date.parse(s.openedAt);
      if (at < start) return '取走时间早于敞口开始';
      if (s.closedAt && at > Date.parse(s.closedAt)) {
        return '取走时间晚于封口时间（暴露中取走须在敞口窗口内）';
      }
      const rec: ExposureWithdrawal = {
        id: uid('wd'),
        at: atIso,
        massG: w.massG,
        purpose: w.purpose.trim() || '未注明',
      };
      s.withdrawals = [...s.withdrawals, rec];
      save();
      return null;
    },

    closeExposure(id, closedAt) {
      const s = state.exposureSessions.find((x) => x.id === id);
      if (!s) return '暴露会话不存在';
      if (s.status === 'invalid') return '该暴露会话已判废，不能封口';
      const end = new Date(closedAt).toISOString();
      if (Date.parse(end) < Date.parse(s.openedAt)) return '封口时间早于敞口开始';
      s.closedAt = end;
      // 封口即复核：出现任何 error 直接标记会话判废，子样不得使用
      const fatal = validateExposure(s, now()).some((i) => i.level === 'error');
      s.status = fatal ? 'invalid' : 'closed';
      save();
      return fatal
        ? '封口复核发现判废项，该暴露会话标记为无效：不得从中取子样做物性试验'
        : null;
    },

    invalidateExposure(id, reason) {
      const s = state.exposureSessions.find((x) => x.id === id);
      if (!s) return;
      s.status = 'invalid';
      s.note = `${s.note ? s.note + '；' : ''}判废：${reason}`;
      save();
    },

    reviewExposure(id) {
      const s = state.exposureSessions.find((x) => x.id === id);
      return s ? validateExposure(s, now()) : [];
    },

    createSubSample(sessionId, input) {
      const s = state.exposureSessions.find((x) => x.id === sessionId);
      if (!s) return '暴露会话不存在';
      if (!isExposureUsable(s, now())) {
        return '该暴露会话未封口或存在判废项，不得取暴露后独立子样';
      }
      if (!input.subCode.trim()) return '子样编号必填';
      const dup = state.subSamples.some((x) => x.subCode.trim() === input.subCode.trim());
      if (dup) return '子样编号已存在（暴露子样独立编号，不得复用原样编号）';
      if (input.massG != null && !(input.massG > 0)) return '子样质量必须为正';
      const sub: SubSample = {
        id: uid('sub'),
        exposureSessionId: s.id,
        sourceSampleId: s.sampleId,
        subCode: input.subCode.trim(),
        massG: input.massG,
        createdAt: now().toISOString(),
        note: input.note?.trim() || undefined,
      };
      state.subSamples = [...state.subSamples, sub];
      save();
      return null;
    },

    startSubSampleWizard(kind, subSampleId) {
      const sub = state.subSamples.find((x) => x.id === subSampleId);
      if (!sub) return fail('暴露子样不存在');
      const s = state.exposureSessions.find((x) => x.id === sub.exposureSessionId);
      if (!s || !isExposureUsable(s, now())) {
        return fail('来源暴露会话不可用（未封口或已判废），不能开始子样试验');
      }
      const sample = state.samples.find((x) => x.id === sub.sourceSampleId);
      if (!sample) return fail('来源原样不存在');
      const method = getMethod() ?? state.methods[0];
      // 子样质量不足：在进入装粉前即拦截（bulk/flow 各自最小装样量）
      const massIssues = validateSubSampleMass(sub, kind);
      if (massIssues.some((i) => i.level === 'error')) {
        return fail(massIssues[0].message);
      }
      state.wizard.kind = kind;
      state.wizard.sampleId = sample.id;
      state.wizard.methodId = method.id;
      state.wizard.cylinderId = method.bulkCylinderId;
      state.wizard.provenance = {
        exposureSessionId: s.id,
        subSampleId: sub.id,
        subCode: sub.subCode,
      };
      state.wizard.draft =
        kind === 'bulk' ? newBulkDraft(method.tapTarget) : newFlowDraft();
      advanceTo('fill');
      return null;
    },

    injectScenario(scenario) {
      const method = state.methods[0];
      if (!method) throw new Error('缺少已批准方法');

      // ---- 高湿暴露分支的五个新异常场景 ----
      if (
        scenario === 'logger_late' ||
        scenario === 'dish_condensation' ||
        scenario === 'mid_withdrawal' ||
        scenario === 'subsample_short' ||
        scenario === 'funnel_shared_dirty'
      ) {
        return injectExposureScenario(this, scenario);
      }

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

/**
 * 高湿暴露分支五个异常场景的演示注入（本机演练）。
 * 场景之间相互独立，各自生成演示原样/暴露会话/子样，互不回写。
 */
function injectExposureScenario(
  store: LabStore,
  scenario: ExposeScenarioId,
): string {
  const state = store.state as LabState;
  const method = state.methods[0];
  const t = Date.now();

  const makeSample = (productName: string, code: string): Sample => {
    const s: Sample = {
      id: uid('smp'),
      sampleCode: code,
      productName,
      batchNo: `T${t.toString(36)}${Math.floor(Math.random() * 1e4)}`,
      producedAt: new Date(t - 60 * 60000).toISOString(),
      openedAt: new Date(t - 40 * 60000).toISOString(),
      conditioning: 'as_received',
      note: `高湿暴露场景演练：${code}`,
      createdAt: new Date(t).toISOString(),
    };
    state.samples = [...state.samples, s];
    return s;
  };

  const curveFrom = (openMs: number, gapMin = 3, points = 11): EnvPoint[] => {
    const out: EnvPoint[] = [];
    for (let i = 0; i < points; i++) {
      out.push({
        at: new Date(openMs + i * gapMin * 60000).toISOString(),
        rh: 88 + (i % 3),
        tempC: 25,
      });
    }
    return out;
  };

  const openMs = t - 30 * 60000;

  // 场景 1：湿度记录器晚启动（晚 8 min，超过 2 min 容差）
  if (scenario === 'logger_late') {
    const sample = makeSample('（演练）全脂乳粉', 'DEMO-EXP-LOGGER');
    const s: ExposureSession = {
      id: uid('exp'),
      sampleId: sample.id,
      openedAt: new Date(openMs).toISOString(),
      closedAt: new Date(t).toISOString(),
      status: 'invalid',
      trayId: '盘A',
      layerThicknessMm: 10,
      layerThicknessAfterMm: null,
      initialPowderMassG: 120,
      trayTareG: 30,
      loggerStartedAt: new Date(openMs + 8 * 60000).toISOString(),
      localCondensation: false,
      withdrawals: [],
      curve: curveFrom(openMs + 8 * 60000),
      note: '记录器接通电源晚，敞口前 8 min 无曲线',
      createdAt: new Date(t).toISOString(),
    };
    state.exposureSessions = [...state.exposureSessions, s];
    state.wizard.step = 'sample';
    state.wizard.draft = null;
    state.wizard.provenance = null;
    return '已注入「记录器晚启动」会话（已封口判废）：请到“高湿暴露”页查看 LOGGER_LATE_START，且该会话无法创建可用子样';
  }

  // 场景 2：样盘局部结露
  if (scenario === 'dish_condensation') {
    const sample = makeSample('（演练）脱脂乳粉', 'DEMO-EXP-COND');
    const s: ExposureSession = {
      id: uid('exp'),
      sampleId: sample.id,
      openedAt: new Date(openMs).toISOString(),
      closedAt: new Date(t).toISOString(),
      status: 'invalid',
      trayId: '盘B',
      layerThicknessMm: 12,
      layerThicknessAfterMm: null,
      initialPowderMassG: 130,
      trayTareG: 30,
      loggerStartedAt: new Date(openMs).toISOString(),
      localCondensation: true,
      withdrawals: [],
      curve: curveFrom(openMs),
      note: '高湿下盘壁下缘出现水珠（局部结露）',
      createdAt: new Date(t).toISOString(),
    };
    state.exposureSessions = [...state.exposureSessions, s];
    state.wizard.step = 'sample';
    state.wizard.draft = null;
    state.wizard.provenance = null;
    return '已注入「样盘局部结露」会话（判废）：整盘不得取子样，须密封废弃重新暴露';
  }

  // 场景 3：暴露中取走一部分（已登记取走并复测厚度，会话可用）
  if (scenario === 'mid_withdrawal') {
    const sample = makeSample('（演练）全脂乳粉', 'DEMO-EXP-WD');
    const s: ExposureSession = {
      id: uid('exp'),
      sampleId: sample.id,
      openedAt: new Date(openMs).toISOString(),
      closedAt: new Date(t).toISOString(),
      status: 'closed',
      trayId: '盘C',
      layerThicknessMm: 12,
      layerThicknessAfterMm: 9,
      initialPowderMassG: 200,
      trayTareG: 30,
      loggerStartedAt: new Date(openMs).toISOString(),
      localCondensation: false,
      withdrawals: [
        {
          id: uid('wd'),
          at: new Date(openMs + 12 * 60000).toISOString(),
          massG: 40,
          purpose: '临时水分快测取样（已登记）',
        },
      ],
      curve: curveFrom(openMs),
      note: '暴露 12 min 时取走 40 g，复测厚度 9 mm',
      createdAt: new Date(t).toISOString(),
    };
    state.exposureSessions = [...state.exposureSessions, s];
    const sub: SubSample = {
      id: uid('sub'),
      exposureSessionId: s.id,
      sourceSampleId: sample.id,
      subCode: 'DEMO-EXP-WD-S1',
      massG: 110,
      createdAt: new Date(t).toISOString(),
    };
    state.subSamples = [...state.subSamples, sub];
    state.wizard.step = 'sample';
    state.wizard.draft = null;
    state.wizard.provenance = null;
    return '已注入「暴露中取走一部分」会话：取走 40 g 已登记、厚度已复测，会话仍可用，已生成足量子样（可在暴露页发起子样试验）';
  }

  // 场景 4：子样质量不足（会话可用，但子样仅 60 g < 流动 100 g）
  if (scenario === 'subsample_short') {
    const sample = makeSample('（演练）全脂乳粉', 'DEMO-EXP-SHORT');
    const s: ExposureSession = {
      id: uid('exp'),
      sampleId: sample.id,
      openedAt: new Date(openMs).toISOString(),
      closedAt: new Date(t).toISOString(),
      status: 'closed',
      trayId: '盘D',
      layerThicknessMm: 10,
      layerThicknessAfterMm: null,
      initialPowderMassG: 150,
      trayTareG: 30,
      loggerStartedAt: new Date(openMs).toISOString(),
      localCondensation: false,
      withdrawals: [],
      curve: curveFrom(openMs),
      note: '暴露正常，取独立子样时粉量不够',
      createdAt: new Date(t).toISOString(),
    };
    state.exposureSessions = [...state.exposureSessions, s];
    const sub: SubSample = {
      id: uid('sub'),
      exposureSessionId: s.id,
      sourceSampleId: sample.id,
      subCode: 'DEMO-EXP-SHORT-S1',
      massG: 60, // < flow 100 g（也 < 若用于 bulk 的 50 g? 60>50，故用 flow 场景）
      createdAt: new Date(t).toISOString(),
    };
    state.subSamples = [...state.subSamples, sub];
    // 直接以该不足量子样开启流动向导并跳到装粉步，便于观察拦截
    state.wizard.kind = 'flow';
    state.wizard.sampleId = sample.id;
    state.wizard.methodId = method.id;
    state.wizard.provenance = {
      exposureSessionId: s.id,
      subSampleId: sub.id,
      subCode: sub.subCode,
    };
    state.wizard.draft = newFlowDraft();
    state.wizard.step = 'fill';
    state.wizard.uiError = null;
    return '已注入「子样质量不足」子样（60 g < 流动 100 g）：在装粉步点击装粉即被 SUBSAMPLE_MASS_SHORT 拦截';
  }

  // 场景 5：两种奶粉共用未清洁漏斗
  const productA = makeSample('（演练）全脂乳粉', 'DEMO-FUNNEL-A');
  const productB = makeSample('（演练）脱脂乳粉', 'DEMO-FUNNEL-B');
  // 模拟上一次用 A 做过流动、漏斗未清洁
  state.funnel = {
    lastProductName: productA.productName,
    lastSampleRef: productA.sampleCode,
    lastUsedAt: new Date(t - 15 * 60000).toISOString(),
    cleanedSinceLastUse: false,
  };
  // 当前要对 B 做流动
  const a: Aliquot = {
    id: uid('alq'),
    sampleId: productB.id,
    kind: 'flow',
    phase: 'fresh',
    preparedAt: new Date(t - 1 * 60000).toISOString(),
  };
  state.aliquots = [...state.aliquots, a];
  const d = newFlowDraft();
  d.aliquotId = a.id;
  d.exposureStartedAt = a.preparedAt;
  d.aliquotMassG = 100;
  d.chargeMassG = 100;
  state.wizard.kind = 'flow';
  state.wizard.sampleId = productB.id;
  state.wizard.methodId = method.id;
  state.wizard.provenance = null;
  state.wizard.draft = d;
  state.wizard.step = 'flow';
  state.wizard.uiError = null;
  return '已注入「共用未清洁漏斗」：漏斗上次用于全脂乳粉 A 且未清洁，现对脱脂乳粉 B 装粉将被 FUNNEL_NOT_CLEANED 拦截（请到漏斗流动步点击“称取并锁定”）';
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
    provenance: null,
    uiError: null,
  };
}
