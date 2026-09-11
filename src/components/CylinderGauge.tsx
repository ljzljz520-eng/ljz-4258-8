import { component$ } from '@builder.io/qwik';

interface Props {
  nominalMl: number;
  graduationMl: number;
  looseVolumeMl: number | null;
  tappedVolumeMl?: number | null;
  maxMl?: number | null;
  minMl?: number | null;
  tiltBad?: boolean;
  phase?: 'fresh' | 'loose' | 'tapped';
}

/**
 * SVG 量筒“液面式”刻度：
 * 粉柱高度随读数变化；振实层用深色叠在松装层内，直观体现 Vt < V0。
 */
export const CylinderGauge = component$<Props>(
  ({ nominalMl, graduationMl, looseVolumeMl, tappedVolumeMl, maxMl, minMl, tiltBad, phase }) => {
    const W = 168;
    const H = 344;
    const top = 30;
    const bottom = 292;
    const left = 64;
    const right = 116;
    const innerW = right - left;
    const usableH = bottom - top;

    const yFor = (ml: number) =>
      bottom - Math.max(0, Math.min(ml, nominalMl)) / nominalMl * usableH;

    const ticks: { y: number; major: boolean; label?: string }[] = [];
    for (let v = 0; v <= nominalMl; v += graduationMl) {
      const major = v % 10 === 0 || v === nominalMl;
      ticks.push({
        y: yFor(v),
        major,
        label: major && v % 20 === 0 ? String(v) : undefined,
      });
    }

    const looseY = looseVolumeMl != null ? yFor(looseVolumeMl) : null;
    const tappedY = tappedVolumeMl != null ? yFor(tappedVolumeMl) : null;
    const maxY = maxMl != null ? yFor(maxMl) : null;
    const minY = minMl != null ? yFor(minMl) : null;

    return (
      <svg viewBox={`0 0 ${W} ${H}`} class="gauge" role="img" aria-label="量筒刻度">
        <title>量筒粉面刻度示意</title>
        {/* 刻度 */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={right + 2}
              y1={t.y}
              x2={right + (t.major ? 12 : 7)}
              y2={t.y}
              class={t.major ? 'tick major' : 'tick'}
            />
            {t.label != null && (
              <text x={right + 15} y={t.y + 3.5} class="tick-label">
                {t.label}
              </text>
            )}
          </g>
        ))}
        {/* 筒壁 */}
        <rect x={left} y={top} width={innerW} height={usableH} rx="3" class="cyl-wall">
          <title>{`${nominalMl} mL 量筒，分度 ${graduationMl} mL`}</title>
        </rect>

        {/* 松装粉柱 */}
        {looseY != null && (
          <rect
            x={left + 2}
            y={looseY}
            width={innerW - 4}
            height={bottom - looseY}
            class="powder-loose"
          />
        )}
        {/* 振实粉柱（叠层，较矮、较深） */}
        {tappedY != null && (
          <rect
            x={left + 2}
            y={tappedY}
            width={innerW - 4}
            height={bottom - tappedY}
            class="powder-tapped"
            opacity="0.85"
          />
        )}

        {/* 粉面：倾斜时画斜线并标周向最高/最低 */}
        {looseY != null && maxY != null && minY != null && maxY !== minY && (
          <g>
            <line
              x1={left + 3}
              y1={maxY}
              x2={right - 3}
              y2={minY}
              class={tiltBad ? 'surface surface-bad' : 'surface'}
              stroke-dasharray="4 3"
            />
            <circle cx={left + 4} cy={maxY} r="2.6" class={tiltBad ? 'dot-bad' : 'dot-ok'} />
            <circle cx={right - 4} cy={minY} r="2.6" class={tiltBad ? 'dot-bad' : 'dot-ok'} />
            {tiltBad && (
              <text x={8} y={Math.max(14, maxY - 6)} class="warn-text">
                粉面倾斜超差
              </text>
            )}
          </g>
        )}
        {looseY != null && (maxY == null || maxY === minY) && (
          <line x1={left + 2} y1={looseY} x2={right - 2} y2={looseY} class="surface" />
        )}

        {/* 读数引线 */}
        {looseY != null && (
          <g>
            <line x1={left - 4} y1={looseY} x2={left - 12} y2={looseY} class="lead" />
            <text x={4} y={looseY + 3.5} class="read-label">
              V0 {looseVolumeMl}
            </text>
          </g>
        )}
        {tappedY != null && (
          <g>
            <line x1={right + 12} y1={tappedY} x2={right + 20} y2={tappedY} class="lead tapped-lead" />
            <text x={right + 22} y={tappedY + 3.5} class="read-label tapped-text">
              Vt {tappedVolumeMl}
            </text>
          </g>
        )}

        {/* 阶段徽标 */}
        <text x={left + innerW / 2} y={H - 14} text-anchor="middle" class="phase-label">
          {phase === 'tapped'
            ? '振实后（该 aliquot 已锁定）'
            : phase === 'loose'
              ? '初始松装读数 V0'
              : '待装粉'}
        </text>
      </svg>
    );
  },
);
