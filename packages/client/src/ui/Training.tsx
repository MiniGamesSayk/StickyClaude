import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { TRAINING_OBJECTIVES } from '../app/solo.ts';
import { actions, training } from '../app/store.ts';
import { t } from '../i18n/index.ts';
import type { MessageKey } from '../i18n/index.ts';
import { Button, CheckMark } from './components.tsx';

const KEY: Record<string, MessageKey> = {
  run: 'train.run',
  jump: 'train.jump',
  double: 'train.double',
  wall: 'train.wall',
  drop: 'train.drop',
  crouch: 'train.crouch',
  punch: 'train.punch',
  combo: 'train.combo',
  charged: 'train.charged',
  kick: 'train.kick',
  block: 'train.block',
  parry: 'train.parry',
  pickup: 'train.pickup',
  shoot: 'train.shoot',
  throw: 'train.throw',
  emote: 'train.emote',
};

/**
 * Le carnet d'entraînement : la liste d'objectifs, cochés à mesure. Sur téléphone il est replié
 * en une ligne (le prochain objectif) pour ne pas cacher les commandes tactiles ni le terrain.
 */
export function Training(p: { touch?: boolean }): JSX.Element {
  const list = training.value ?? [];
  const done = list.filter((o) => o.done).length;
  const [open, setOpen] = useState(!p.touch);
  const next = list.find((o) => !o.done);
  const label = (o: { id: string }): string => t(KEY[o.id] ?? 'train.jump');
  return (
    <>
      <aside class={`notebook${p.touch ? ' compact' : ''}`} aria-label={t('train.title')}>
        {p.touch && (
          <button
            type="button"
            class="notebook-toggle"
            aria-expanded={open}
            aria-label={open ? t('train.close') : t('train.open')}
            onClick={() => setOpen(!open)}
          >
            <b>
              {done}/{TRAINING_OBJECTIVES.length}
            </b>
            <span>{next ? label(next) : t('train.all_done')}</span>
          </button>
        )}
        <div class="card" hidden={!open}>
          <h2>
            {t('train.title')} · {done}/{TRAINING_OBJECTIVES.length}
          </h2>
          <p class="hint">{t('train.hint')}</p>
          <ul class="goals">
            {list.map((o) => (
              <li key={o.id} class={o.done ? 'done' : ''}>
                <span class="box">{o.done && <CheckMark />}</span>
                <span class="txt">
                  {label(o)}
                  {o.goal > 1 && !o.done
                    ? ` (${t('train.progress', { n: o.progress, goal: o.goal })})`
                    : ''}
                </span>
              </li>
            ))}
          </ul>
          {done === TRAINING_OBJECTIVES.length && <p role="status">{t('train.all_done')}</p>}
          <div class="row">
            <Button small secondary onClick={() => actions.resetTraining()}>
              {t('train.reset')}
            </Button>
          </div>
        </div>
      </aside>
      {!p.touch && (
        <div class="bottomleft">
          <Button secondary onClick={() => actions.quitSolo()}>
            {t('train.quit')}
          </Button>
        </div>
      )}
    </>
  );
}
