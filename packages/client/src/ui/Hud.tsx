import {
  GamePhase,
  MAX_PLAYERS,
  MODE_PARAMS,
  ModeId,
  modeInfo,
  SillyDeath,
  TICK_HZ,
  weaponDef,
} from '@stickyclaude/shared';
import type { JSX } from 'preact';
import { COUNTDOWN_TICKS, GHOST_COOLDOWN_TICKS } from '@stickyclaude/sim';
import { options } from '../app/options.ts';
import {
  actions,
  banner,
  emoteReadyAt,
  hud,
  killFeed,
  lobby,
  mode,
  net,
  podium,
  round,
  selfSlot,
  toast,
} from '../app/store.ts';
import { keyLabel } from '../input/bindings.ts';
import { pick, t } from '../i18n/index.ts';
import type { MessageKey } from '../i18n/index.ts';
import { Button, HpBar, Tally } from './components.tsx';
import { touchActive } from './device.ts';
import { colorOfCss, nameOf, teamColorCss, teamLabel } from './format.ts';

function clock(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Haut de l'écran : manche, mode, minuteur de mort subite. */
function Top(): JSX.Element | null {
  const h = hud.value;
  const r = round.value;
  if (!h.inMatch || !r) return null;
  let timer: string | null = null;
  let sudden = false;
  if (h.phase === GamePhase.PLAYING) {
    let left = -1;
    if (h.mode === ModeId.KOTH) left = MODE_PARAMS.kothMaxTicks - h.phaseTick;
    else if (h.mode === ModeId.BALL) left = MODE_PARAMS.ballMaxTicks - h.phaseTick;
    else if (h.mode !== ModeId.INK_RISE && r.suddenAfterTicks > 0)
      left = r.suddenAfterTicks - h.phaseTick;
    if (left > 0) timer = clock(left / TICK_HZ);
    else if (
      h.mode !== ModeId.KOTH &&
      h.mode !== ModeId.BALL &&
      left <= 0 &&
      r.suddenAfterTicks > 0
    ) {
      timer = t('hud.sudden');
      sudden = true;
    }
  }
  return (
    <div class="hud-top">
      <span class="big">{t('hud.round', { n: r.round })}</span> · {pick(modeInfo(h.mode).name)}
      {timer !== null && (
        <>
          {' '}
          · <span class={`timer${sudden ? ' sudden' : ''}`}>{timer}</span>
        </>
      )}
    </div>
  );
}

/** Ligne de règle propre au mode bonus. */
function ModeLine(): JSX.Element {
  const h = hud.value;
  const d = h.modeData;
  let text: string;
  switch (h.mode) {
    case ModeId.KOTH: {
      const parts: string[] = [];
      const teams = lobby.value?.settings.mode === 'teams';
      for (let i = 0; i < MAX_PLAYERS; i++) {
        const v = d[i] ?? 0;
        if (v > 0) {
          parts.push(
            `${teams ? teamLabel(i) : nameOf(i)} ${Math.floor(v / TICK_HZ)}/${MODE_PARAMS.kothHoldTicks / TICK_HZ} s`,
          );
        }
      }
      text = parts.length > 0 ? t('mode.koth', { list: parts.join(' · ') }) : t('mode.koth_idle');
      break;
    }
    case ModeId.BALL:
      text = t('mode.ball', { a: d[0] ?? 0, b: d[1] ?? 0 });
      break;
    case ModeId.POTATO: {
      const holder = (d[0] ?? 0) - 1;
      text =
        holder >= 0
          ? t('mode.potato_holder', {
              name: nameOf(holder),
              s: Math.max(0, Math.ceil((d[1] ?? 0) / TICK_HZ)),
            })
          : t('mode.potato_wait');
      break;
    }
    case ModeId.INK_RISE:
      text = t('mode.ink');
      break;
    case ModeId.MOON:
      text = t('mode.moon');
      break;
    case ModeId.SAME_WEAPON:
      text = t('mode.same_weapon', {
        weapon: pick(weaponDef(round.value?.commonWeapon ?? 0).name),
      });
      break;
    default:
      text = '';
  }
  return <div class="hud-mode">{h.inMatch ? text : ''}</div>;
}

/** Scores dans la marge de gauche, en bâtons de comptage. */
function Margin(): JSX.Element | null {
  const lob = lobby.value;
  const r = round.value;
  const h = hud.value;
  if (!lob || !r || !h.inMatch || !options.value.showScores) return null;
  const teams = lob.settings.mode === 'teams';
  const goal = lob.settings.roundsToWin;
  const rows: { key: string; label: string; color: string; score: number }[] = [];
  if (teams) {
    const seen = new Set<number>();
    for (let slot = 0; slot < MAX_PLAYERS; slot++) {
      const tm = r.teams[slot];
      if (tm >= 0 && !seen.has(tm)) {
        seen.add(tm);
        rows.push({
          key: `t${tm}`,
          label: teamLabel(tm),
          color: teamColorCss(tm),
          score: lob.scores[tm] ?? 0,
        });
      }
    }
  } else {
    for (let slot = 0; slot < MAX_PLAYERS; slot++) {
      if (r.teams[slot] < 0) continue;
      rows.push({
        key: `p${slot}`,
        label: nameOf(slot),
        color: colorOfCss(slot),
        score: lob.scores[slot] ?? 0,
      });
    }
  }
  return (
    <div class="margin" aria-label={t('hud.score_to', { n: goal })}>
      {rows.map((row) => (
        <div class="srow" key={row.key}>
          <span class="sname" style={{ color: row.color }}>
            {row.label}
          </span>
          <Tally
            n={row.score}
            goal={goal}
            color={row.color}
            label={t('a11y.score', { name: row.label, n: row.score })}
          />
        </div>
      ))}
    </div>
  );
}

/** Gros texte central : décompte « écrit à la main » ou résultat de la manche. */
function Banner(): JSX.Element | null {
  const h = hud.value;
  const b = banner.value;
  let text = '';
  let sub = '';
  let key = '';
  if (h.phase === GamePhase.COUNTDOWN) {
    const left = Math.ceil((COUNTDOWN_TICKS - h.phaseTick) / TICK_HZ);
    text = left > 0 ? String(left) : t('count.go');
    sub = t('hud.round', { n: h.round });
    key = `c${text}`;
  } else if (h.phase === GamePhase.PLAYING && h.phaseTick > 0 && h.phaseTick < 40) {
    text = t('count.go');
    key = 'go';
  } else if (b) {
    text = b.text;
    sub = b.sub;
    key = `b${b.key}`;
  }
  if (text === '') return null;
  return (
    <div class="hud-banner" aria-hidden="true" key={key}>
      <div class="bt">{text}</div>
      {sub !== '' && <div class="bs">{sub}</div>}
    </div>
  );
}

/** Éliminé, fantôme ou spectateur : recharge du dessin, emotes et actions possibles. */
function DeadPanel(): JSX.Element {
  const h = hud.value;
  const spectator = selfSlot.value < 0;
  const o = options.value;
  const touch = touchActive();
  const key = (a: 'attack' | 'block'): string =>
    touch
      ? t(a === 'attack' ? 'touch.attack' : 'touch.block')
      : keyLabel(o.bindings[a][0], o.layout, t('act.jump'));
  const title = spectator ? t('hud.spectator') : h.ghost ? t('hud.ghost') : t('hud.dead');
  const cd = h.ghost && !spectator ? h.ghostCd : 0;
  const sec = Math.ceil(cd / TICK_HZ);
  const emoteSec = Math.ceil(Math.max(0, emoteReadyAt.value - performance.now()) / 1000);
  return (
    <div class="hud-self hud-dead">
      <div class="dead-title">{title}</div>
      {spectator && <div class="dead-line">{t('hud.spectator_help')}</div>}
      {!spectator && h.ghost && (
        <>
          <div class="dead-cd" role="progressbar" aria-valuemin={0} aria-valuemax={100}>
            <span
              style={{ width: `${Math.round((1 - cd / GHOST_COOLDOWN_TICKS) * 100)}%` }}
              class={cd > 0 ? '' : 'ready'}
            />
          </div>
          <div class="dead-line">
            {sec > 0 ? t('hud.ghost_next', { s: sec }) : t('hud.ghost_ready_short')}
          </div>
          <div class="dead-line">
            <kbd>{key('attack')}</kbd> {t('hud.ghost_line')} · <kbd>{key('block')}</kbd>{' '}
            {t('hud.ghost_drop')}
          </div>
        </>
      )}
      {!spectator && !h.ghost && <div class="dead-line">{t('hud.dead_help')}</div>}
      {!spectator && (
        <div class="dead-line">
          {touch ? t('touch.emote') : <kbd>1–9</kbd>} {t('hud.emotes')}
          {emoteSec > 0 ? ` · ${t('hud.emote_wait', { s: emoteSec })}` : ''}
        </div>
      )}
    </div>
  );
}

function SelfStats(): JSX.Element {
  const h = hud.value;
  if (selfSlot.value < 0 || h.ghost || h.dead) return <DeadPanel />;
  const w = weaponDef(h.weapon);
  return (
    <div class="hud-self">
      <HpBar hp={h.hp} />
      <span>{t('hud.hp', { hp: Math.max(0, Math.round(h.hp)) })}</span>
      <span>
        · {h.weapon === 0 ? t('hud.fists') : `${pick(w.name)}${w.ammo > 0 ? ` · ${h.ammo}` : ''}`}
      </span>
    </div>
  );
}

/** Interface en jeu (en ligne comme en entraînement). */
export function Hud(p: { solo?: boolean }): JSX.Element {
  const h = hud.value;
  const tst = toast.value;
  return (
    <div class="hud" role="presentation">
      {!p.solo && <Top />}
      {!p.solo && <ModeLine />}
      {!p.solo && <Margin />}
      <Banner />
      <div class="feed" aria-live="off">
        {killFeed.value.map((f) => (
          <div key={f.id} style={{ borderLeftColor: `#${f.color.toString(16).padStart(6, '0')}` }}>
            {f.text}
          </div>
        ))}
      </div>
      {!p.solo && <SelfStats />}
      {options.value.showStats && (
        <div class="stats">
          {Math.round(h.rttMs)} ms · {Math.round(h.fps)} FPS
        </div>
      )}
      {tst && (
        <div class="toast" key={tst.id} role="status">
          {tst.text}
        </div>
      )}
      {mode.value === 'online' && net.value.status !== 'joined' && null}
    </div>
  );
}

const SILLY: Record<number, MessageKey> = {
  [SillyDeath.NONE]: 'silly.none',
  [SillyDeath.FALL]: 'silly.fall',
  [SillyDeath.FRIENDLY]: 'silly.friendly',
  [SillyDeath.SELF]: 'silly.self',
};

/** Podium et statistiques de fin de partie. */
export function Podium(): JSX.Element | null {
  const r = podium.value;
  if (!r) return null;
  const teams = r.teams.some((tm, i) => tm >= 0 && tm !== i);
  const label = (idx: number): string => (teams ? teamLabel(idx) : nameOf(idx));
  const color = (idx: number): string => (teams ? teamColorCss(idx) : colorOfCss(idx));
  const order = ['second', 'first', 'third'] as const;
  const byRank = [r.podium[1], r.podium[0], r.podium[2]];
  return (
    <div class="scrim">
      <div class="card wide" role="dialog" aria-label={t('podium.title')}>
        <h1>{t('podium.title')}</h1>
        <div class="steps" aria-hidden="true">
          {byRank.map((idx, k) =>
            idx === undefined ? null : (
              <div key={idx} class={`step ${order[k]}`}>
                <span class="who" style={{ color: color(idx) }}>
                  {label(idx)}
                </span>
                <span class="n">{r.scores[idx] ?? 0}</span>
              </div>
            ),
          )}
        </div>
        <ol style={{ margin: 0, paddingLeft: '1.4rem' }}>
          {r.podium.map((idx, rank) => (
            <li key={idx} style={{ color: color(idx) }}>
              {label(idx)} — {t('podium.rounds', { n: r.scores[idx] ?? 0 })}
              {rank === 0 ? ' ★' : ''}
            </li>
          ))}
        </ol>
        <h2>{t('podium.stats')}</h2>
        <table class="table">
          <thead>
            <tr>
              <th>{t('podium.player')}</th>
              <th>{t('podium.kos')}</th>
              <th>{t('podium.deaths')}</th>
              <th>{t('podium.damage')}</th>
              <th>{t('podium.combo')}</th>
              <th>{t('podium.silly')}</th>
            </tr>
          </thead>
          <tbody>
            {r.stats.map((st) => (
              <tr key={st.slot}>
                <td style={{ color: colorOfCss(st.slot) }}>{nameOf(st.slot)}</td>
                <td>{st.kos}</td>
                <td>{st.deaths}</td>
                <td>{Math.round(st.damage)}</td>
                <td>{st.bestCombo}</td>
                <td>{t(SILLY[st.silly] ?? 'silly.none')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p class="hint">{t('podium.back')}</p>
        <Button secondary onClick={() => actions.leave()}>
          {t('podium.leave')}
        </Button>
      </div>
    </div>
  );
}
