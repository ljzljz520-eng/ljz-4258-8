import type { Cylinder, MethodVersion } from './types';

/**
 * 受控种子：首次启动写入本机。
 * 方法为“已批准”版本；系统只能使用其中列出的公式。
 */
export const SEED_METHOD_ID = 'Q-PHY-01-v1.0';

export const seedMethods: MethodVersion[] = [
  {
    id: SEED_METHOD_ID,
    code: 'Q/MPS-PHY-01',
    version: 'v1.0',
    title: '乳粉 松装密度、振实密度与漏斗流动时间测定方法',
    approvedAt: '2026-08-20',
    approvedBy: '技术负责人（已批准）',
    formulas: [
      {
        id: 'bulk-density-q-phy-01',
        title: '松装密度',
        expression: 'ρb = (m1 − m0) / V0',
        unit: 'g/mL',
      },
      {
        id: 'tapped-density-q-phy-01',
        title: '振实密度',
        expression: 'ρt = (m1 − m0) / Vt',
        unit: 'g/mL',
      },
      {
        id: 'flow-time-100ml-q-phy-01',
        title: '流动时间（100 g 标准装粉）',
        expression: 't = t2 − t1',
        unit: 's',
      },
    ],
    bulkCylinderId: 'cyl-100',
    tapTarget: 500,
    tapInterruptionInvalidates: true,
    flowChargeG: 100,
    maxExposureMin: 10,
    minValidReplicates: 2,
  },
];

export const seedCylinders: Cylinder[] = [
  {
    id: 'cyl-100',
    name: '100 mL 粉体具塞量筒',
    nominalMl: 100,
    graduationMl: 1,
    maxTiltDeltaMl: 2,
    listedTareG: 46.2,
    verifiedAt: '2026-08-25',
    active: true,
  },
  {
    id: 'cyl-250',
    name: '250 mL 粉体具塞量筒（备用）',
    nominalMl: 250,
    graduationMl: 2,
    maxTiltDeltaMl: 4,
    listedTareG: 98.6,
    verifiedAt: '2026-08-25',
    active: true,
  },
];
