import type {
  BulkDraft,
  Cylinder,
  FlowDraft,
  Issue,
  MethodVersion,
} from './types';

/**
 * 读数复核：在实验员“确认”结团/架桥/洒失/有效测次之后，
 * 依据已批准方法计算或判废。error 存在时不得保存为有效测次（记录仍可留档标记无效）。
 */

export function validateBulk(
  method: MethodVersion,
  cylinder: Cylinder,
  d: BulkDraft,
  exposureMin?: number | null,
): Issue[] {
  const issues: Issue[] = [];
  const err = (code: string, message: string) =>
    issues.push({ level: 'error', code, message });
  const warn = (code: string, message: string) =>
    issues.push({ level: 'warning', code, message });

  if (d.tareMassG == null) err('TARE_MISSING', '缺少量筒皮重读数，需先称空筒皮重。');
  if (d.grossMassG == null) err('GROSS_MISSING', '缺少量筒+粉毛重读数。');
  if (d.looseVolumeMl == null) err('LOOSE_VOL_MISSING', '缺少松装体积读数。');

  // 测试点：量筒皮重错用——本次实测皮重与台账皮重不符
  if (d.tareMassG != null) {
    const delta = Math.abs(d.tareMassG - cylinder.listedTareG);
    if (delta > 0.5) {
      err(
        'TARE_MISMATCH',
        `皮重错用嫌疑：本次空筒 ${d.tareMassG.toFixed(2)} g 与台账皮重 ${cylinder.listedTareG.toFixed(
          2,
        )} g 相差 ${delta.toFixed(2)} g（>0.5 g），请核对量筒编号或重新去皮。`,
      );
    }
  }
  if (d.tareMassG != null && d.grossMassG != null && d.grossMassG <= d.tareMassG) {
    err('NET_NONPOSITIVE', '毛重不大于皮重，净重非正，读数不可用。');
  }

  // 测试点：粉面倾斜——周向最大/最小读数差超阈值
  if (d.looseVolumeMaxMl != null && d.looseVolumeMinMl != null) {
    const tilt = d.looseVolumeMaxMl - d.looseVolumeMinMl;
    if (tilt < 0) err('TILT_REVERSED', '粉面最大读数小于最小读数，记录有误。');
    if (tilt > cylinder.maxTiltDeltaMl) {
      err(
        'SURFACE_TILT',
        `粉面倾斜：周向读数差 ${tilt} mL 超过方法允许 ${cylinder.maxTiltDeltaMl} mL，需重新刮平读数。`,
      );
    }
    if (d.looseVolumeMl != null) {
      if (
        d.looseVolumeMl < d.looseVolumeMinMl ||
        d.looseVolumeMl > d.looseVolumeMaxMl
      ) {
        warn('VOLUME_OUTSIDE_RANGE', '松装体积读数不在周向最小/最大读数之间，请复核。');
      }
    }
  }

  if (d.looseVolumeMl != null && d.looseVolumeMl > cylinder.nominalMl + 0.0001) {
    err('VOLUME_OVERFLOW', `松装体积 ${d.looseVolumeMl} mL 超出量筒标称 ${cylinder.nominalMl} mL。`);
  }

  // 测试点：振实计数中断
  if (d.tapCount < d.tapTarget) {
    err(
      'TAP_SHORT',
      `振实计数不足：${d.tapCount}/${d.tapTarget}，未达方法规定次数。`,
    );
  }
  if (d.tapInterrupted && method.tapInterruptionInvalidates) {
    err(
      'TAP_INTERRUPTED',
      '振实计数发生中断（脉冲丢失或暂停），按已批准方法该测次判废；同一 aliquot 不得回退当松装样，需另取新样重测。',
    );
  }
  if (d.tappedVolumeMl == null) {
    err('TAPPED_VOL_MISSING', '缺少振实后体积读数。');
  } else if (
    d.looseVolumeMl != null &&
    d.tappedVolumeMl > d.looseVolumeMl + 0.0001
  ) {
    err('TAPPED_EXCEEDS_LOOSE', '振实体积大于松装体积，物理上不合理，请复核读数。');
  }

  // 实验员确认的现场现象
  if (d.flags.caking) err('CAKING', '确认存在结团：本测次不满足方法状态要求，判废并重取试样。');
  if (d.flags.bridging) err('BRIDGING_BULK', '量筒内架桥/成拱：松装体积不具代表性，判废。');
  if (d.flags.spillage) err('SPILLAGE', '确认发生洒失：质量与体积不对应，判废。');

  // 测试点：等待期间吸湿
  if (exposureMin != null && exposureMin > method.maxExposureMin) {
    err(
      'MOISTURE_EXPOSURE',
      `开封暴露 ${exposureMin.toFixed(1)} min 超过方法限值 ${method.maxExposureMin} min，存在吸湿影响，判废并密封换样。`,
    );
  } else if (d.flags.moistureAbsorbed) {
    warn('MOISTURE_CONFIRMED', '实验员标记等待期间吸湿：即使未超时限也建议换样。');
  }

  if (d.flags.acceptedReplicate && issues.some((i) => i.level === 'error')) {
    warn(
      'ACCEPTED_WITH_ERROR',
      '存在判废项仍勾选“有效测次”：系统不会把该测次计入有效测次，请改勾或排除。',
    );
  }

  return issues;
}

export function validateFlow(
  method: MethodVersion,
  d: FlowDraft,
  exposureMin?: number | null,
): Issue[] {
  const issues: Issue[] = [];
  const err = (code: string, message: string) =>
    issues.push({ level: 'error', code, message });
  const warn = (code: string, message: string) =>
    issues.push({ level: 'warning', code, message });

  if (d.chargeMassG == null) err('CHARGE_MISSING', '缺少漏斗装粉量读数。');
  else if (d.chargeMassG <= 0) err('CHARGE_INVALID', '装粉量必须为正。');
  else {
    const delta = Math.abs(d.chargeMassG - method.flowChargeG);
    if (delta > 1) {
      warn(
        'CHARGE_OFF_NOMINAL',
        `装粉量 ${d.chargeMassG.toFixed(2)} g 与标准 ${method.flowChargeG} g 相差 ${delta.toFixed(
          2,
        )} g，流动时间按实测记录，比较时注明装量差异。`,
      );
    }
  }

  if (d.flowTimeS == null) err('FLOWTIME_MISSING', '缺少流出时间读数。');
  else if (d.flowTimeS < 0) err('FLOWTIME_INVALID', '流出时间不能为负。');

  // 测试点：漏斗口粘粉
  if (d.outletSticking) {
    err(
      'OUTLET_STICKING',
      '确认漏斗口粘粉：流出过程受阻，流动时间不具代表性，判废；称量残留质量留档并清洁后另取新样。',
    );
  }
  if (d.residueMassG == null) {
    warn('RESIDUE_MISSING', '未读取漏斗残留质量：建议每次均称量以判定粘粉/残留。');
  } else if (d.residueMassG < 0) {
    err('RESIDUE_NEGATIVE', '残留质量不能为负。');
  } else if (d.residueMassG > 1 && !d.outletSticking) {
    warn(
      'RESIDUE_HIGH',
      `残留质量 ${d.residueMassG.toFixed(2)} g 较大（>1 g），即使未见明显粘粉也应确认流道口状态。`,
    );
  }

  if (d.flags.caking) err('CAKING_FLOW', '确认存在结团：流动时间不具代表性，判废。');
  if (d.flags.bridging) err('BRIDGING_FLOW', '漏斗内架桥/成拱：流动被阻断，判废。');
  if (d.flags.spillage) err('SPILLAGE_FLOW', '确认洒失：装粉量不真实，判废。');

  if (exposureMin != null && exposureMin > method.maxExposureMin) {
    err(
      'MOISTURE_EXPOSURE_FLOW',
      `等待暴露 ${exposureMin.toFixed(1)} min 超过方法限值 ${method.maxExposureMin} min，吸湿可能改变流动性，判废。`,
    );
  } else if (d.flags.moistureAbsorbed) {
    warn('MOISTURE_CONFIRMED_FLOW', '实验员标记等待期间吸湿，建议密封换样。');
  }

  if (d.flags.acceptedReplicate && issues.some((i) => i.level === 'error')) {
    warn(
      'ACCEPTED_WITH_ERROR_FLOW',
      '存在判废项仍勾选“有效测次”：系统不会计入有效测次。',
    );
  }

  return issues;
}

export function hasFatal(issues: Issue[]): boolean {
  return issues.some((i) => i.level === 'error');
}
