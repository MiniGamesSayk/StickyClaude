import { DEFAULT_MOVEMENT, MOVEMENT_KEYS, MOVEMENT_TUNING } from '@stickyclaude/shared';
import type { MovementKey } from '@stickyclaude/shared';
import type { GameClient } from '../net/client.ts';

/**
 * Panneau de réglage en direct des constantes de mouvement (développement seulement).
 * Les changements sont envoyés au serveur (DEV_TOOLS=1) qui les applique à la salle et les
 * diffuse : tout le monde simule avec les mêmes valeurs.
 */
export function mountTuning(panel: HTMLElement, client: GameClient): void {
  panel.hidden = false;
  panel.replaceChildren();
  const title = document.createElement('div');
  title.textContent = 'Constantes de mouvement (dev)';
  title.style.marginBottom = '6px';
  const reset = document.createElement('button');
  reset.textContent = 'Réinitialiser';
  const copy = document.createElement('button');
  copy.textContent = 'Copier le JSON';
  panel.append(title, reset, copy);

  const inputs = new Map<MovementKey, { range: HTMLInputElement; value: HTMLInputElement }>();
  const current = (): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const k of MOVEMENT_KEYS)
      out[k] = client.predictor?.world.params[k] ?? DEFAULT_MOVEMENT[k];
    return out;
  };

  const set = (k: MovementKey, v: number): void => {
    client.tune(k, v);
    if (client.predictor) client.predictor.world.params[k] = v;
  };

  for (const k of MOVEMENT_KEYS) {
    const meta = MOVEMENT_TUNING[k];
    const label = document.createElement('label');
    const name = document.createElement('span');
    name.textContent = meta.label;
    const value = document.createElement('input');
    value.type = 'number';
    value.min = String(meta.min);
    value.max = String(meta.max);
    value.step = String(meta.step);
    value.value = String(DEFAULT_MOVEMENT[k]);
    value.style.width = '52px';
    const range = document.createElement('input');
    range.type = 'range';
    range.min = String(meta.min);
    range.max = String(meta.max);
    range.step = String(meta.step);
    range.value = String(DEFAULT_MOVEMENT[k]);
    const apply = (v: number): void => {
      if (!Number.isFinite(v)) return;
      range.value = String(v);
      value.value = String(v);
      set(k, v);
    };
    range.addEventListener('input', () => apply(Number(range.value)));
    value.addEventListener('change', () => apply(Number(value.value)));
    label.append(name, value, range);
    panel.append(label);
    inputs.set(k, { range, value });
  }

  reset.addEventListener('click', () => {
    for (const k of MOVEMENT_KEYS) {
      const i = inputs.get(k)!;
      i.range.value = String(DEFAULT_MOVEMENT[k]);
      i.value.value = String(DEFAULT_MOVEMENT[k]);
      set(k, DEFAULT_MOVEMENT[k]);
    }
  });
  copy.addEventListener('click', () => {
    void navigator.clipboard.writeText(JSON.stringify(current(), null, 2));
  });
}
