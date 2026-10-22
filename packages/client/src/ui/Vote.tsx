import { getArena, VOTE_OPTIONS } from '@stickyclaude/shared';
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { actions, selfSlot, vote } from '../app/store.ts';
import { pick, t } from '../i18n/index.ts';
import { ArenaThumb } from './ArenaThumb.tsx';

/**
 * Vote de la carte avant chaque manche : cartes proposées, nombre de votes, compte à rebours.
 * Les touches 1 à 4 votent aussi (elles servent d'emotes le reste du temps).
 */
export function Vote(): JSX.Element | null {
  const v = vote.value;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!v) return undefined;
    const id = window.setInterval(() => tick((n) => n + 1), 200);
    return () => window.clearInterval(id);
  }, [v === null]);
  if (!v) return null;
  const canVote = selfSlot.value >= 0 && v.picked < 0;
  const left = Math.max(0, Math.ceil((v.endsAt - performance.now()) / 1000));
  const cast = (i: number): void => {
    if (!canVote) return;
    vote.value = { ...v, mine: i };
    actions.vote(i);
  };
  return (
    <section class="vote" aria-label={t('vote.title')}>
      <div class="card">
        <h2>
          {t('vote.title')} <span class="hint">{t('vote.round', { n: v.round })}</span>
          <span class="timer" aria-live="off">
            {v.picked >= 0 ? t('vote.chosen') : `${left} s`}
          </span>
        </h2>
        <ul class="vote-options">
          {v.options.map((o, i) => {
            const arena = getArena(o.id);
            const cls = `vote-option${v.mine === i ? ' mine' : ''}${v.picked === i ? ' won' : ''}`;
            return (
              <li key={o.id}>
                <button
                  type="button"
                  class={cls}
                  disabled={!canVote}
                  aria-pressed={v.mine === i}
                  onClick={(e) => {
                    cast(i);
                    e.currentTarget.blur();
                  }}
                >
                  {arena && <ArenaThumb arena={arena} width={160} />}
                  <span class="vname">
                    <kbd>{i + 1}</kbd> {pick(o.name)}
                  </span>
                  <span class="vcount">{t('vote.votes', { n: v.counts[i] ?? 0 })}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <p class="hint">
          {selfSlot.value < 0
            ? t('vote.spectator')
            : t('vote.hint', { n: Math.min(VOTE_OPTIONS, v.options.length) })}
        </p>
      </div>
    </section>
  );
}
