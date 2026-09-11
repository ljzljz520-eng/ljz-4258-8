import { component$, useContext } from '@builder.io/qwik';
import type { WizardStep } from '../domain/types';
import { LabStoreContext } from '../state/store';

const ALL: { id: WizardStep; label: string; kind: 'bulk' | 'both' }[] = [
  { id: 'sample', label: '样品/方法', kind: 'both' },
  { id: 'fill', label: '装粉核对', kind: 'both' },
  { id: 'loose', label: '松装 V0', kind: 'bulk' },
  { id: 'tap', label: '振实 Vt', kind: 'bulk' },
  { id: 'flow', label: '漏斗流动', kind: 'both' },
  { id: 'review', label: '读数复核', kind: 'both' },
];

export const Stepper = component$(() => {
  const store = useContext(LabStoreContext);
  const kind = store.state.wizard.kind;
  const steps = ALL.filter((s) => s.kind === 'both' || kind === 'bulk');
  const current = steps.findIndex((s) => s.id === store.state.wizard.step);
  return (
    <nav class="stepper" aria-label="试验步骤">
      {steps.map((s, i) => (
        <button
          key={s.id}
          class={
            i === current ? 'step on' : i < current ? 'step done' : 'step'
          }
          onClick$={() => store.gotoStep(s.id)}
        >
          <span class="step-no">{i + 1}</span>
          {s.label}
        </button>
      ))}
    </nav>
  );
});
