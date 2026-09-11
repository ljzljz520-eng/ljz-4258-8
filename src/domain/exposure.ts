import type {
  EnvPoint,
  ExposureSession,
  FunnelStatus,
  Sample,
  SubSample,
} from './types';

/**
 * 短时高湿暴露分支（受控参数）。
 * 本分支为已批准方法 Q/MPS-PHY-01 v1.0 的附加试验流，阈值在受控代码中固定。
 */
export const EXPOSURE_RULES = {
  /** 目标高湿暴露相对湿度下限 %RH */
  targetRh: 85,
  /** 敞口暴露目标时长 min（短时） */
  targetDurationMin: 30,
  /** 记录器允许比敞口开始晚启动的最大时长 min；超过则曲线前段缺失，判废 */
  maxLoggerLateMin: 2,
  /** 环境曲线采样间隔上限 min（间隔过大视为曲线不完整） */
  maxCurveGapMin: 5,
  /** 暴露子样用于松装/振实的最小称样量 g */
  minBulkAliquotMassG: 50,
  /** 暴露子样用于漏斗流动的最小称样量 g（标准装粉 100 g） */
  minFlowAliquotMassG: 100,
} as const;

export interface ExposureIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
}

const err = (code: string, message: string): ExposureIssue => ({
  level: 'error',
  code,
  message,
});
const warn = (code: string, message: string): ExposureIssue => ({
  level: 'warning',
  code,
  message,
});

export function exposureDurationMin(s: ExposureSession, at = new Date()): number | null {
  const start = Date.parse(s.openedAt);
  if (!Number.isFinite(start)) return null;
  const endIso = s.closedAt ?? at.toISOString();
  const end = Date.parse(endIso);
  if (!Number.isFinite(end) || end < start) return null;
  return Math.round(((end - start) / 60000) * 10) / 10;
}

/**
 * 复核一次高湿暴露会话。
 * 覆盖：湿度记录器晚启动、样盘局部结露、暴露中取走一部分（含厚度复测/衡算）、曲线覆盖。
 */
export function validateExposure(
  s: ExposureSession,
  at = new Date(),
): ExposureIssue[] {
  const issues: ExposureIssue[] = [];
  const start = Date.parse(s.openedAt);

  if (!Number.isFinite(start)) {
    issues.push(err('EXPOSURE_START_MISSING', '缺少敞口开始时间。'));
    return issues;
  }

  // 1) 湿度记录器晚启动：记录器缺失或晚于敞口开始超过容差
  if (!s.loggerStartedAt) {
    issues.push(
      err(
        'LOGGER_NOT_STARTED',
        '湿度记录器未启动：环境曲线完全缺失，无法证明高湿暴露条件，本次暴露判废。',
      ),
    );
  } else {
    const loggerStart = Date.parse(s.loggerStartedAt);
    if (Number.isFinite(loggerStart)) {
      const lateMin = (loggerStart - start) / 60000;
      if (lateMin > EXPOSURE_RULES.maxLoggerLateMin) {
        issues.push(
          err(
            'LOGGER_LATE_START',
            `湿度记录器晚于敞口开始 ${lateMin.toFixed(1)} min 启动（容差 ${EXPOSURE_RULES.maxLoggerLateMin} min）：暴露前段 ${lateMin.toFixed(
              1,
            )} min 无环境曲线，曲线不可追溯，本次暴露会话判废，不得据此产生子样测次。`,
          ),
        );
      } else if (lateMin > 0) {
        issues.push(
          warn(
            'LOGGER_SLIGHT_LATE',
            `记录器晚 ${lateMin.toFixed(1)} min 启动（在 ${EXPOSURE_RULES.maxLoggerLateMin} min 容差内），已记录偏差。`,
          ),
        );
      } else if (-lateMin > EXPOSURE_RULES.maxLoggerLateMin) {
        issues.push(
          err(
            'LOGGER_CLOCK_ANOMALY',
            '记录器启动时间明显早于敞口开始（时钟不一致），请核对记录器时钟后重测。',
          ),
        );
      }
    }
  }

  // 环境曲线覆盖：至少 2 个点；覆盖敞口开始（容差内）到封口；采样间隔
  if (s.curve.length === 0) {
    issues.push(err('ENV_CURVE_EMPTY', '环境曲线无采样点，暴露条件不可追溯。'));
  } else {
    const pts = [...s.curve].sort(
      (a, b) => Date.parse(a.at) - Date.parse(b.at),
    );
    const t0 = Date.parse(pts[0].at);
    if (t0 - start > EXPOSURE_RULES.maxLoggerLateMin * 60000) {
      issues.push(
        err(
          'ENV_CURVE_HEAD_GAP',
          '环境曲线首个采样点明显晚于敞口开始，暴露起始段无记录。',
        ),
      );
    }
    for (let i = 1; i < pts.length; i++) {
      const gapMin =
        (Date.parse(pts[i].at) - Date.parse(pts[i - 1].at)) / 60000;
      if (gapMin > EXPOSURE_RULES.maxCurveGapMin) {
        issues.push(
          err(
            'ENV_CURVE_GAP',
            `环境曲线在 ${new Date(Date.parse(pts[i - 1].at)).toLocaleTimeString('zh-CN')}–${new Date(
              Date.parse(pts[i].at),
            ).toLocaleTimeString('zh-CN')} 间中断 ${gapMin.toFixed(1)} min（>${EXPOSURE_RULES.maxCurveGapMin} min），曲线不完整。`,
          ),
        );
        break;
      }
    }
    const endMs = s.closedAt ? Date.parse(s.closedAt) : at.getTime();
    if (s.closedAt && Number.isFinite(endMs)) {
      const tailMin = (endMs - Date.parse(pts[pts.length - 1].at)) / 60000;
      if (tailMin > EXPOSURE_RULES.maxCurveGapMin) {
        issues.push(
          warn(
            'ENV_CURVE_TAIL_GAP',
            `封口前最后 ${tailMin.toFixed(1)} min 无采样点，请确认记录器持续到封口。`,
          ),
        );
      }
    }
    const maxRh = Math.max(...pts.map((p) => p.rh));
    if (maxRh < EXPOSURE_RULES.targetRh) {
      issues.push(
        warn(
          'RH_BELOW_TARGET',
          `曲线最高相对湿度 ${maxRh.toFixed(0)}%RH 未达目标 ${EXPOSURE_RULES.targetRh}%RH：本次为较低湿度暴露，比较时须注明。`,
        ),
      );
    }
  }

  // 2) 样盘局部结露：一旦确认，整个暴露会话判废（结露导致局部吸水/板结，不具代表性）
  if (s.localCondensation) {
    issues.push(
      err(
        'DISH_CONDENSATION',
        '确认样盘局部结露（盘壁/粉面水珠）：粉体已发生局部吸水，整盘试样不具代表性，本次暴露判废；不得从该盘取子样做物性试验，须密封废弃并重新暴露。',
      ),
    );
  }

  if (s.layerThicknessMm == null || s.layerThicknessMm <= 0) {
    issues.push(err('LAYER_THICKNESS_MISSING', '缺少敞口初始样层厚度（mm）。'));
  }

  // 3) 暴露中取走一部分：逐笔登记，质量为正且在暴露窗口内；取走后须复测厚度
  let withdrawnG = 0;
  for (const w of s.withdrawals) {
    const wt = Date.parse(w.at);
    if (!(w.massG > 0)) {
      issues.push(
        err(
          'WITHDRAWAL_MASS_INVALID',
          '一笔暴露中取走记录的质量非正，请核对天平读数。',
        ),
      );
    }
    withdrawnG += w.massG > 0 ? w.massG : 0;
    if (Number.isFinite(wt) && (wt < start || (s.closedAt && wt > Date.parse(s.closedAt)))) {
      issues.push(
        err(
          'WITHDRAWAL_OUTSIDE_WINDOW',
          `取走时间 ${new Date(wt).toLocaleString('zh-CN')} 不在敞口暴露窗口内，记录无效。`,
        ),
      );
    }
  }
  if (s.withdrawals.length > 0) {
    if (s.layerThicknessAfterMm == null || s.layerThicknessAfterMm <= 0) {
      issues.push(
        err(
          'LAYER_THICKNESS_UNVERIFIED',
          `暴露中已取走 ${s.withdrawals.length} 笔（合计 ${withdrawnG.toFixed(
            2,
          )} g），但缺少取走后复测样层厚度：剩余粉层状态无法确认，请补测或判废。`,
        ),
      );
    } else if (
      s.layerThicknessMm != null &&
      s.layerThicknessAfterMm > s.layerThicknessMm + 0.5
    ) {
      issues.push(
        err(
          'LAYER_THICKNESS_INCONSISTENT',
          `取走后厚度 ${s.layerThicknessAfterMm} mm 反而大于初始 ${s.layerThicknessMm} mm，记录矛盾，请复核。`,
        ),
      );
    }
    // 质量衡算：初始粉量 − 取走合计 不得为负
    if (s.initialPowderMassG != null) {
      const remain = s.initialPowderMassG - withdrawnG;
      if (remain < 0) {
        issues.push(
          err(
            'WITHDRAWAL_MASS_BALANCE',
            `取走合计 ${withdrawnG.toFixed(2)} g 超过敞口初始粉量 ${s.initialPowderMassG.toFixed(
              2,
            )} g，质量衡算为负，记录有误。`,
          ),
        );
      }
    }
  }

  // 封口与时长
  if (!s.closedAt) {
    issues.push(
      warn('EXPOSURE_STILL_OPEN', '暴露仍在进行（未封口）：封口后才能取独立子样。'),
    );
  } else {
    const dur = exposureDurationMin(s, at);
    if (dur != null && dur <= 0) {
      issues.push(err('EXPOSURE_TIME_REVERSED', '敞口结束时间早于开始时间。'));
    }
  }

  return issues;
}

/** 会话是否可用于产生独立子样（有任何 error 均不允许） */
export function isExposureUsable(s: ExposureSession, at = new Date()): boolean {
  return (
    s.status !== 'invalid' &&
    s.closedAt != null &&
    !validateExposure(s, at).some((i) => i.level === 'error')
  );
}

export interface SubSampleIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
}

/**
 * 5) 子样质量不足：暴露后独立子样的称取质量必须满足试验最小装样量。
 */
export function validateSubSampleMass(
  sub: SubSample,
  kind: 'bulk' | 'flow',
): SubSampleIssue[] {
  const min =
    kind === 'bulk'
      ? EXPOSURE_RULES.minBulkAliquotMassG
      : EXPOSURE_RULES.minFlowAliquotMassG;
  if (sub.massG == null) {
    return [
      err(
        'SUBSAMPLE_MASS_MISSING',
        `暴露子样未称取质量（${kind === 'bulk' ? '松装/振实' : '漏斗流动'}最小 ${min} g）。`,
      ),
    ];
  }
  if (!(sub.massG > 0)) {
    return [err('SUBSAMPLE_MASS_INVALID', '暴露子样质量必须为正。')];
  }
  if (sub.massG < min) {
    return [
      err(
        'SUBSAMPLE_MASS_SHORT',
        `暴露后独立子样质量 ${sub.massG.toFixed(2)} g 不足 ${kind === 'bulk' ? '松装/振实' : '漏斗流动'}最小装样量 ${min} g：不得开始物性试验，请重新从暴露盘称取足量子样（禁止回掺原样凑量）。`,
      ),
    ];
  }
  return [];
}

/**
 * 5) 两种奶粉共用未清洁漏斗：流动试验开始前核对漏斗清洁状态与上一产品。
 */
export function checkFunnelCleanliness(
  funnel: FunnelStatus,
  current: Sample,
): SubSampleIssue[] {
  const issues: SubSampleIssue[] = [];
  if (funnel.lastProductName != null && !funnel.cleanedSinceLastUse) {
    const other =
      funnel.lastProductName !== current.productName ||
      funnel.lastSampleRef !== current.sampleCode;
    issues.push({
      level: 'error',
      code: 'FUNNEL_NOT_CLEANED',
      message:
        (other
          ? `标准漏斗上次用于「${funnel.lastProductName}（${funnel.lastSampleRef ?? '—'}）」，与本样「${current.productName}（${current.sampleCode}）」不是同一样/产品，`
          : `标准漏斗上次使用后尚未清洁，`) +
        '两种奶粉残留会交叉污染流动时间，本次流动试验判废：请按SOP清洁干燥漏斗并勾选清洁确认后，另取新 aliquot 重测。',
    });
  }
  return issues;
}

/** 曲线便捷追加（去重时刻不处理，由 UI 顺序录入） */
export function appendEnvPoint(s: ExposureSession, p: EnvPoint): void {
  s.curve = [...s.curve, p];
}
