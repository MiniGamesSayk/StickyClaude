import {
  BONUS_EVERY_MAX,
  BONUS_MODE_IDS,
  EMOTES,
  GamePhase,
  getArena,
  INK_COLORS,
  MAX_PLAYERS,
  MAX_SPECTATORS,
  modeInfo,
  ROTATION_ARENA_IDS,
  ROUNDS_TO_WIN_CHOICES,
  SUDDEN_MAX_SEC,
  SUDDEN_MIN_SEC,
  TEAMS_MAX,
  TEAMS_MIN,
} from '@stickyclaude/shared';
import type { RoomSettings } from '@stickyclaude/shared';
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { profile } from '../app/options.ts';
import { actions, hud, levels, lobby, overlay, selfSlot } from '../app/store.ts';
import { pick, t } from '../i18n/index.ts';
import { touchActive } from './device.ts';
import { LookEditor } from './Home.tsx';
import { Button, Check, hex, Select } from './components.tsx';
import { teamLabel } from './format.ts';

/** Panneau du salon : joueurs, prêt, équipes, réglages de l'hôte, apparence, emotes. */
export function LobbyPanel(): JSX.Element | null {
  const lob = lobby.value;
  const self = selfSlot.value;
  // Sur téléphone le panneau démarre replié : il ne cache plus le terrain ni le joystick.
  const [collapsed, setCollapsed] = useState(touchActive());
  if (!lob) return null;
  const isHost = self >= 0 && lob.host === self;
  const inLobby = lob.phase === GamePhase.LOBBY;
  const me = lob.players.find((p) => p.slot === self);
  const ready = me?.ready ?? false;
  const s = lob.settings;
  const teamsMode = s.mode === 'teams';
  const editable = isHost && inLobby;
  const patch = (p: Partial<RoomSettings>): void => actions.settings(p);

  // statut
  let status: string;
  if (self < 0) {
    status = inLobby ? t('lobby.status_watching') : t('lobby.status_watching_game');
  } else if (!inLobby) {
    status = t('lobby.status_playing');
  } else {
    const others = lob.players.filter((p) => p.slot !== self);
    const allReady = others.every((p) => p.ready || p.slot === lob.host);
    if (lob.players.length < 2) status = t('lobby.status_alone');
    else if (isHost)
      status = allReady ? t('lobby.status_all_ready') : t('lobby.status_some_not_ready');
    else status = ready ? t('lobby.status_you_ready') : t('lobby.status_click_ready');
    if (lob.autostartMs >= 0)
      status += ` ${t('lobby.autostart', { s: Math.ceil(lob.autostartMs / 1000) })}`;
  }

  return (
    <aside class={`panel${collapsed ? ' collapsed' : ''}`} aria-label={t('lobby.code')}>
      <div class="card">
        <div class="lobby-title">
          <span class="code" aria-label={t('lobby.code')}>
            {lob.code}
          </span>
          <Button small secondary onClick={() => actions.copyLink()}>
            {t('lobby.copy')}
          </Button>
          <Button small secondary onClick={() => actions.leave()}>
            {t('lobby.leave')}
          </Button>
          <Button
            small
            secondary
            onClick={() => setCollapsed(!collapsed)}
            pressed={collapsed}
            label="−"
          >
            {collapsed ? '▸' : '▾'}
          </Button>
        </div>
        <ul class="players">
          {lob.players.map((p) => (
            <li key={p.slot} class={p.slot === self ? 'me' : ''}>
              <span
                class="dot"
                style={{ background: hex(INK_COLORS[p.look.color % INK_COLORS.length]) }}
              />
              <span class="pname">
                {p.name}
                {p.slot === self ? ` (${t('lobby.me')})` : ''}
              </span>
              {p.slot === lob.host && <span title={t('lobby.host')}>★</span>}
              {!p.connected && (
                <span class="warn" title={t('lobby.reconnecting')}>
                  ⌛
                </span>
              )}
              {p.ready && (
                <span class="ok" title={t('lobby.ready')}>
                  ✔
                </span>
              )}
              {teamsMode &&
                p.team >= 0 &&
                (editable ? (
                  <select
                    aria-label={teamLabel(p.team)}
                    value={String(p.team)}
                    onChange={(e) => {
                      const assign = new Array<number>(MAX_PLAYERS).fill(-1);
                      assign[p.slot] = Number(e.currentTarget.value);
                      actions.teams({ assign });
                      e.currentTarget.blur();
                    }}
                  >
                    {Array.from({ length: s.teams }, (_, k) => (
                      <option key={k} value={String(k)}>
                        {teamLabel(k)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span>{teamLabel(p.team)}</span>
                ))}
              <span class="ping">{p.ping > 0 ? `${p.ping} ms` : ''}</span>
              {editable && p.slot !== self && (
                <Button
                  small
                  secondary
                  title={t('lobby.kick')}
                  label={t('lobby.kick')}
                  onClick={() => actions.kick(p.slot)}
                >
                  ✖
                </Button>
              )}
            </li>
          ))}
        </ul>
        {teamsMode && editable && (
          <Button small secondary onClick={() => actions.teams({ shuffle: true })}>
            {t('lobby.shuffle')}
          </Button>
        )}
        {lob.spectators.length > 0 && (
          <p class="hint">
            {t('lobby.spectators', {
              n: lob.spectators.length,
              max: MAX_SPECTATORS,
              names: lob.spectators.map((x) => x.name).join(', '),
            })}
          </p>
        )}
        <p class="status" role="status">
          {status}
        </p>
        {inLobby && self >= 0 && (
          <div class="row">
            {isHost ? (
              <Button class="grow" onClick={() => actions.start()}>
                {t('lobby.start')}
              </Button>
            ) : (
              <Button class="grow" secondary={ready} onClick={() => actions.ready(!ready)}>
                {ready ? t('lobby.not_ready') : t('lobby.ready')}
              </Button>
            )}
            {isHost && (
              <Button secondary onClick={() => actions.ready(!ready)}>
                {ready ? t('lobby.not_ready') : t('lobby.ready')}
              </Button>
            )}
          </div>
        )}
        {!collapsed && inLobby && <p class="hint">{t('lobby.practice')}</p>}
        {!collapsed && self >= 0 && (
          <details>
            <summary>{t('lobby.my_stickman')}</summary>
            <LookEditor look={me?.look ?? profile.value.look} onChange={(l) => actions.look(l)} />
          </details>
        )}
        {!collapsed && (
          <details open={editable} class="settings">
            <summary>{t('lobby.settings')}</summary>
            {!editable && <p class="hint">{t('lobby.settings_readonly')}</p>}
            <Select
              label={t('set.mode')}
              value={s.mode}
              disabled={!editable}
              options={[
                { value: 'ffa', label: t('set.mode_ffa') },
                { value: 'teams', label: t('set.mode_teams') },
              ]}
              onChange={(v) => patch({ mode: v })}
            />
            {teamsMode && (
              <>
                <Select
                  label={t('set.teams')}
                  value={s.teams}
                  disabled={!editable}
                  options={Array.from({ length: TEAMS_MAX - TEAMS_MIN + 1 }, (_, i) => ({
                    value: TEAMS_MIN + i,
                    label: t('set.teams_n', { n: TEAMS_MIN + i }),
                  }))}
                  onChange={(v) => patch({ teams: v })}
                />
                <Check
                  label={t('set.friendly')}
                  checked={s.friendlyFire}
                  disabled={!editable}
                  onChange={(v) => patch({ friendlyFire: v })}
                />
              </>
            )}
            <Select
              label={t('set.rounds')}
              value={s.roundsToWin}
              disabled={!editable}
              options={ROUNDS_TO_WIN_CHOICES.map((n) => ({ value: n, label: String(n) }))}
              onChange={(v) => patch({ roundsToWin: v })}
            />
            <Check
              label={t('set.weapons')}
              checked={s.weapons}
              disabled={!editable}
              onChange={(v) => patch({ weapons: v })}
            />
            <div class="row">
              <Check
                label={t('set.sudden')}
                checked={s.suddenDeath}
                disabled={!editable}
                onChange={(v) => patch({ suddenDeath: v })}
              />
              <input
                type="number"
                aria-label={t('set.sudden_sec')}
                min={SUDDEN_MIN_SEC}
                max={SUDDEN_MAX_SEC}
                step={5}
                style={{ width: '5rem' }}
                value={s.suddenDeathSec}
                disabled={!editable || !s.suddenDeath}
                onChange={(e) => patch({ suddenDeathSec: Number(e.currentTarget.value) })}
              />
            </div>
            <Check
              label={t('set.ghosts')}
              checked={s.ghosts}
              disabled={!editable}
              onChange={(v) => patch({ ghosts: v })}
            />
            <Select
              label={t('set.bonus')}
              value={s.bonusEvery}
              disabled={!editable}
              options={Array.from({ length: BONUS_EVERY_MAX + 1 }, (_, i) => ({
                value: i,
                label:
                  i === 0
                    ? t('set.bonus_never')
                    : i === 1
                      ? t('set.bonus_every')
                      : t('set.bonus_n', { n: i }),
              }))}
              onChange={(v) => patch({ bonusEvery: v })}
            />
            <span class="hint">{t('set.bonus_modes')}</span>
            <div class="checks">
              {BONUS_MODE_IDS.map((id) => (
                <Check
                  key={id}
                  label={pick(modeInfo(id).name)}
                  checked={s.bonusModes.includes(id)}
                  disabled={!editable}
                  onChange={(on) =>
                    patch({
                      bonusModes: on ? [...s.bonusModes, id] : s.bonusModes.filter((m) => m !== id),
                    })
                  }
                />
              ))}
            </div>
            <span class="hint">{t('set.arenas')}</span>
            <div class="checks">
              {[...ROTATION_ARENA_IDS, ...lob.custom.map((c) => c.id)].map((id) => (
                <Check
                  key={id}
                  label={pick(getArena(id)?.name ?? { fr: id, en: id })}
                  checked={s.arenas.includes(id)}
                  disabled={!editable}
                  onChange={(on) =>
                    patch({ arenas: on ? [...s.arenas, id] : s.arenas.filter((a) => a !== id) })
                  }
                />
              ))}
            </div>
            <Check
              label={t('set.vote')}
              checked={s.voteMaps}
              disabled={!editable}
              onChange={(v) => patch({ voteMaps: v })}
            />
            <Check
              label={t('set.public')}
              checked={s.isPublic}
              disabled={!editable}
              onChange={(v) => patch({ isPublic: v })}
            />
          </details>
        )}
        {!collapsed && (
          <details class="levels">
            <summary>{t('lobby.levels')}</summary>
            {lob.custom.length === 0 && <p class="hint">{t('lobby.levels_none')}</p>}
            <ul class="level-list">
              {lob.custom.map((c) => (
                <li key={c.id}>
                  <span class="pname">
                    {c.name} <span class="hint">{t('lobby.levels_by', { name: c.by })}</span>
                  </span>
                  {inLobby && self >= 0 && (isHost || c.by === me?.name) && (
                    <Button
                      small
                      secondary
                      label={t('lobby.level_remove')}
                      title={t('lobby.level_remove')}
                      onClick={() => actions.deleteLevel(c.id)}
                    >
                      ✖
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            <span class="hint">{t('lobby.levels_mine')}</span>
            {levels.value.length === 0 && <p class="hint">{t('lobby.levels_mine_none')}</p>}
            <ul class="level-list">
              {levels.value.map((l) => (
                <li key={l.id}>
                  <span class="pname">{pick(l.name)}</span>
                  {inLobby && self >= 0 && (
                    <Button small secondary onClick={() => actions.sendLevel(l)}>
                      {t('lobby.level_send')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            <Button small secondary onClick={() => (overlay.value = 'creator')}>
              {t('lobby.create_level')}
            </Button>
          </details>
        )}
        {!collapsed && self >= 0 && (
          <>
            <span class="hint">{t('lobby.emotes')}</span>
            <div class="emotes">
              {EMOTES.map((e, i) => (
                <Button
                  key={i}
                  small
                  secondary
                  title={pick(e)}
                  label={pick(e)}
                  onClick={() => actions.emote(i)}
                >
                  {i + 1}
                </Button>
              ))}
            </div>
          </>
        )}
        <span class="hint" aria-hidden="true">
          {hud.value.rttMs > 0 ? `${Math.round(hud.value.rttMs)} ms` : ''}
        </span>
      </div>
    </aside>
  );
}
