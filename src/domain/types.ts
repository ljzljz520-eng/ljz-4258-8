/**
 * 奶粉粉体物性试验领域模型
 * 全部数据仅保存在本机 IndexedDB，不含任何后端/上传逻辑。
 */

/** 调湿状态（按已批准方法对试样环境处理的记录） */
export type Conditioning = 'as_received' | 'conditioned' | 'sealed_hold';

export const CONDITIONING_LABEL: Record<Conditioning, string> = {
  as_received: '生产取样原样（未调湿）',
  conditioned: '已按方法调湿平衡',
  sealed_hold: '密封暂存待检',
};

/** 装粉方式 */
export type FillMode = 'free_pour' | 'spoon' | 'funnel' | 'other';
export const FILL_MODE_LABEL: Record<FillMode, string> = {
  free_pour: '自由倾入',
  spoon: '药勺分层加入',
  funnel: '经标准漏斗加入',
  other: '其他（须在备注说明）',
};

export type RunKind = 'bulk' | 'flow';

/** 量筒（量器）定义 */
export interface Cylinder {
  id: string;
  name: string;
  /** 标称容量 mL（刻度范围） */
  nominalMl: number;
  /** 每最小格读数 mL */
  graduationMl: number;
  /** 方法允许的最大倾斜读数差 mL（粉面倾斜判废阈值） */
  maxTiltDeltaMl: number;
  /** 量筒皮重（空筒）g，来自天平与设备台账 */
  listedTareG: number;
  /** 量筒校准/核对状态 */
  verifiedAt: string;
  active: boolean;
}

/** 已批准公式标识：只允许计算下列方法中批准的指标，不计算冲调体验等方法外指标 */
export type FormulaId =
  | 'bulk-density-q-phy-01'
  | 'tapped-density-q-phy-01'
  | 'flow-time-100ml-q-phy-01';

export interface ApprovedFormula {
  id: FormulaId;
  title: string;
  expression: string;
  unit: string;
}

/** 方法版本（审批受控；未批准公式一律不可用） */
export interface MethodVersion {
  id: string;
  code: string;
  version: string;
  title: string;
  approvedAt: string;
  approvedBy: string;
  formulas: ApprovedFormula[];
  /** 松装/振实量筒定义 */
  bulkCylinderId: string;
  /** 振实计数目标档 */
  tapTarget: number;
  /** 振实中断（脉冲丢失/手动暂停）是否判该次无效 */
  tapInterruptionInvalidates: boolean;
  /** 漏斗标准装粉量 g */
  flowChargeG: number;
  /** 允许等待暴露（吸湿）时长 min，超过判废 */
  maxExposureMin: number;
  /** 有效测次要求 */
  minValidReplicates: number;
}

export interface Sample {
  id: string;
  /** 生产样编号 */
  sampleCode: string;
  productName: string;
  batchNo: string;
  /** 生产/取样时间 */
  producedAt: string;
  /** 开封时间 ISO */
  openedAt: string;
  conditioning: Conditioning;
  note?: string;
  createdAt: string;
}

/** 同一份试样（分装 aliquot）的阶段状态——防止振实后再冒充初始松装样 */
export type AliquotPhase =
  | 'fresh' // 刚分装，未做任何装填
  | 'bulk_loose' // 已完成松装填粉读数
  | 'tapped' // 已完成振实：此 aliquot 禁止再用于松装
  | 'spent' // 废弃（洒失/吸湿/其他失效）
  | 'flow_loaded' // 已装入漏斗，尚未放开
  | 'flow_discharged'; // 已放开流出

export interface Aliquot {
  id: string;
  sampleId: string;
  kind: RunKind;
  phase: AliquotPhase;
  /** 分装/等待开始时间（用于暴露吸湿计时） */
  preparedAt: string;
  /** 高湿暴露分支：本 aliquot 取自哪次暴露会话的哪个独立子样（缺省=原样常规试验） */
  exposureSessionId?: string;
  subSampleId?: string;
  note?: string;
}

/* ===================== 短时高湿暴露分支 ===================== */

/** 暴露会话状态 */
export type ExposureStatus =
  | 'open' // 敞口暴露进行中
  | 'closed' // 已封口，可从盘中取独立子样
  | 'invalid'; // 会话判废（结露/曲线无效等）：不得据此产生子样测次

/** 环境曲线采样点（温湿度记录器） */
export interface EnvPoint {
  /** 记录器时刻 ISO */
  at: string;
  /** 相对湿度 %RH */
  rh: number;
  /** 温度 ℃ */
  tempC: number;
}

/** 暴露过程中从敞口样盘取走一部分的登记 */
export interface ExposureWithdrawal {
  id: string;
  at: string;
  /** 取走质量 g（天平称量） */
  massG: number;
  /** 用途/去向 */
  purpose: string;
}

/**
 * 短时高湿敞口暴露会话（分支）。
 * 仅记录本分支自己的敞口起止/样层厚度/环境曲线；与原样常规试验数据完全分离。
 */
export interface ExposureSession {
  id: string;
  /** 暴露所用原样（仅引用，禁止回写该样的任何记录） */
  sampleId: string;
  /** 敞口开始/结束 ISO（实验员观察到的真实敞口时刻） */
  openedAt: string;
  closedAt: string | null;
  status: ExposureStatus;
  /** 样盘标识 */
  trayId: string;
  /** 敞口初始样层厚度 mm */
  layerThicknessMm: number | null;
  /** 暴露中取走一部分后复测的样层厚度 mm */
  layerThicknessAfterMm: number | null;
  /** 敞口粉层总质量 g（盘+粉毛重 − 盘皮重），用于取走后的质量衡算 */
  initialPowderMassG: number | null;
  /** 样盘皮重 g */
  trayTareG: number | null;
  /** 湿度记录器启动时刻（可能晚于敞口开始） */
  loggerStartedAt: string | null;
  /** 实验员确认样盘局部结露（盘壁/粉面水珠） */
  localCondensation: boolean;
  /** 暴露过程中取走记录 */
  withdrawals: ExposureWithdrawal[];
  /** 环境曲线（记录器采样） */
  curve: EnvPoint[];
  note: string;
  createdAt: string;
}

/** 暴露后独立子样：从已封口暴露盘中另取的一份试样 */
export interface SubSample {
  id: string;
  exposureSessionId: string;
  /** 冗余引用原样，便于审计；子样不属于原样可回写的数据 */
  sourceSampleId: string;
  /** 子样编号（独立编号，不复用原样编号） */
  subCode: string;
  /** 子样称取质量 g（不足方法最小装样量则判废） */
  massG: number | null;
  createdAt: string;
  note?: string;
}

/** 实验员确认的现场现象 */
export interface RunFlags {
  /** 结团 */
  caking: boolean;
  /** 架桥（漏斗/量筒内成拱） */
  bridging: boolean;
  /** 洒失（样品洒落、损失） */
  spillage: boolean;
  /** 实验员确认本测次读数有效（有效测次） */
  acceptedReplicate: boolean;
  /** 等待期间吸湿（按暴露时长由系统提示，实验员确认） */
  moistureAbsorbed: boolean;
}

export interface SampleSnapshot {
  sampleCode: string;
  batchNo: string;
  openedAt: string;
  conditioning: Conditioning;
}

/** 测次来源：原样常规试验，或高湿暴露后的独立子样（两者数据隔离，禁止互相回写） */
export interface RunProvenance {
  /** 非空=高湿暴露后子样测次；空=原样常规测次 */
  exposureSessionId?: string;
  subSampleId?: string;
  subCode?: string;
}

export interface BulkRun {
  id: string;
  kind: 'bulk';
  sampleId: string;
  aliquotId: string;
  /** 暴露后子样测次的溯源（原样常规测次不含此字段） */
  provenance?: RunProvenance;
  snapshot: SampleSnapshot;
  methodId: string;
  cylinderId: string;
  cylinderListedTareG: number;
  fillMode: FillMode;
  /** 本次投入量筒的 aliquot 称取质量 g（暴露子样最小装样量审计用） */
  aliquotMassG: number | null;
  /** 松装体积 mL（复核后） */
  looseVolumeMl: number | null;
  /** 粉面四周读数最大值/最小值（倾斜判定） */
  looseVolumeMaxMl: number | null;
  looseVolumeMinMl: number | null;
  /** 量筒+粉 称量 g */
  grossMassG: number | null;
  /** 本次实测空筒皮重 g */
  tareMassG: number | null;
  /** 振实目标/实际次数 */
  tapTarget: number;
  tapCount: number;
  tapInterrupted: boolean;
  tappedVolumeMl: number | null;
  flags: RunFlags;
  exposureMin: number | null;
  note: string;
  createdAt: string;
}

export interface FlowRun {
  id: string;
  kind: 'flow';
  sampleId: string;
  aliquotId: string;
  /** 暴露后子样测次溯源 */
  provenance?: RunProvenance;
  snapshot: SampleSnapshot;
  methodId: string;
  /** 漏斗装粉量 g */
  chargeMassG: number | null;
  /** 流出时间 s（放开→最后一粒） */
  flowTimeS: number | null;
  /** 漏斗口/流道残留质量 g（粘粉） */
  residueMassG: number | null;
  /** 漏斗口粘粉确认 */
  outletSticking: boolean;
  flags: RunFlags;
  exposureMin: number | null;
  note: string;
  createdAt: string;
}

export type Run = BulkRun | FlowRun;

/** 复核结论中的问题项 */
export interface Issue {
  level: 'error' | 'warning';
  code: string;
  message: string;
}

export interface BulkResults {
  netMassG: number;
  bulkDensityGPerMl: number;
  tappedDensityGPerMl: number | null;
}

export interface FlowResults {
  flowTimeS: number;
}

/** 当前分步向导的步骤（松装 → 振实 → 流动 → 复核保存） */
export type WizardStep =
  | 'sample'
  | 'fill'
  | 'loose'
  | 'tap'
  | 'flow'
  | 'review';

export interface BulkDraft {
  kind: 'bulk';
  aliquotId: string;
  /** 本测次称取投入量筒的 aliquot 质量 g（暴露子样最小装样量判废用） */
  aliquotMassG: number | null;
  fillMode: FillMode;
  tareMassG: number | null;
  grossMassG: number | null;
  looseVolumeMl: number | null;
  looseVolumeMaxMl: number | null;
  looseVolumeMinMl: number | null;
  tapTarget: number;
  tapCount: number;
  tapInterrupted: boolean;
  tappedVolumeMl: number | null;
  flags: RunFlags;
  exposureStartedAt: string | null;
  note: string;
}

export interface FlowDraft {
  kind: 'flow';
  aliquotId: string;
  /** 本测次称取的 aliquot 质量 g（暴露子样最小装样量判废用；与标准装粉量 chargeMassG 一致） */
  aliquotMassG: number | null;
  chargeMassG: number | null;
  flowTimeS: number | null;
  residueMassG: number | null;
  outletSticking: boolean;
  flags: RunFlags;
  exposureStartedAt: string | null;
  note: string;
}

export type Draft = BulkDraft | FlowDraft;

export interface Wizard {
  step: WizardStep;
  kind: RunKind;
  sampleId: string | null;
  methodId: string | null;
  cylinderId: string | null;
  draft: Draft | null;
  /** 高湿暴露分支：当前向导是否在做暴露后独立子样试验（null=原样常规试验） */
  provenance: RunProvenance | null;
  /** 读数复核界面的提示（系统计算，不通过不允许保存） */
  uiError: string | null;
}

/** 漏斗清洁/共用状态：防止两种奶粉共用未清洁漏斗造成交叉污染 */
export interface FunnelStatus {
  /** 最近一次流动试验使用的原样/子样所属产品名称 */
  lastProductName: string | null;
  /** 最近一次使用的样品编号（原样或子样编号） */
  lastSampleRef: string | null;
  /** 最近一次使用时间 ISO */
  lastUsedAt: string | null;
  /** 实验员确认已清洁（每次流动试验前必须为 true，否则判废） */
  cleanedSinceLastUse: boolean;
}

export interface LabState {
  samples: Sample[];
  aliquots: Aliquot[];
  runs: Run[];
  methods: MethodVersion[];
  cylinders: Cylinder[];
  /** 短时高湿暴露会话（分支） */
  exposureSessions: ExposureSession[];
  /** 暴露后独立子样 */
  subSamples: SubSample[];
  /** 标准漏斗共用/清洁状态 */
  funnel: FunnelStatus;
  wizard: Wizard;
}
