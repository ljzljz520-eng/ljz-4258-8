import { component$ } from '@builder.io/qwik';

interface Props {
  /** empty 空漏斗 / loaded 已装粉 / discharging 流出中 / done 已流完 / stuck 口粘粉 */
  state: 'empty' | 'loaded' | 'discharging' | 'done' | 'stuck';
  residueG?: number | null;
}

/** SVG 漏斗状态：粉床、流出粒子动画、出口粘粉（红色） */
export const FunnelDiagram = component$<Props>(({ state, residueG }) => {
  const W = 168;
  const H = 248;
  const cx = 84;
  const topY = 24;
  const outletTop = 196;
  const outletW = 12;
  const stuck = state === 'stuck';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} class="funnel" role="img" aria-label="漏斗状态">
      <title>{`漏斗状态：${state}`}</title>
      {/* 漏斗壁 */}
      <path
        d={`M30 ${topY} H138 L${cx + outletW / 2} ${outletTop} V220 H${cx - outletW / 2} V${outletTop} Z`}
        class="funnel-wall"
      />
      {/* 粉床（loaded / discharging 时锥体内有粉） */}
      {(state === 'loaded' || state === 'discharging') && (
        <path
          d={`M48 78 H120 L${cx + outletW / 2 - 1} ${state === 'discharging' ? 188 : outletTop - 1}
             H${cx - outletW / 2 + 1} L60 78 Z`}
          class={state === 'discharging' ? 'powder-flow' : 'powder-loose'}
        />
      )}
      {state === 'loaded' && (
        <line x1={48} y1={78} x2={120} y2={78} class="surface" />
      )}

      {/* 流出粒子 */}
      {state === 'discharging' &&
        [0, 1, 2, 3, 4].map((i) => (
          <circle key={i} cx={cx + (i % 2 === 0 ? -2 : 2)} cy={0} r="2" class="particle">
            <animate
              attributeName="cy"
              from={`${outletTop + 6}`}
              to={`${H - 8}`}
              dur="0.7s"
              begin={`${i * 0.13}s`}
              repeatCount="indefinite"
            />
            <animate attributeName="opacity" values="1;0.2" dur="0.7s" begin={`${i * 0.13}s`} repeatCount="indefinite" />
          </circle>
        ))}

      {/* 接料杯 */}
      <path d="M52 232 H116 L110 244 H58 Z" class="beaker" />

      {/* 出口粘粉 */}
      {stuck && (
        <g>
          <ellipse cx={cx} cy={outletTop + 2} rx={9} ry="5" class="stuck" />
          <circle cx={cx - 4} cy={outletTop + 8} r="2.6" class="stuck-dot" />
          <circle cx={cx + 5} cy={outletTop + 6} r="2.2" class="stuck-dot" />
          <text x={cx} y={12} text-anchor="middle" class="warn-text">
            漏斗口粘粉
          </text>
        </g>
      )}

      {/* 状态字 */}
      <text x={cx} y={H - 1} text-anchor="middle" class="phase-label">
        {state === 'empty' && '空漏斗（待装粉）'}
        {state === 'loaded' && '已装粉（待放开计时）'}
        {state === 'discharging' && '流出中…'}
        {state === 'done' && `流出结束${residueG != null ? `，残留 ${residueG} g` : ''}`}
        {state === 'stuck' && `出口粘粉${residueG != null ? `，残留 ${residueG} g` : ''}，判废`}
      </text>
    </svg>
  );
});
