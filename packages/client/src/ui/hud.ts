import {
  Cause,
  GamePhase,
  INK_COLORS,
  MAX_PLAYERS,
  MODE_PARAMS,
  ModeId,
  modeInfo,
  TICK_HZ,
  weaponDef,
} from '@stickyclaude/shared';
import type { LobbyView, PlayerInfo, RoundInfo } from '@stickyclaude/shared';
import { COUNTDOWN_TICKS } from '@stickyclaude/sim';
import { clock, el, hex } from './dom.ts';
import { teamName, TEAM_COLORS } from './lobby.ts';
import { CAUSE_TEXT, SILLY_TEXT } from './texts.ts';
import type { ResultsMessage, ScoresMessage } from '../net/client.ts';

/** Ce que le HUD lit à chaque rafraîchissement (quelques fois par seconde). */
export interface HudState {
  phase: number;
  phaseTick: number;
  mode: number;
  modeData: ArrayLike<number>;
  round: RoundInfo | null;
  lobby: LobbyView | null;
  selfSlot: number;
  hp: number;
  weapon: number;
  ammo: number;
  ghost: boolean;
  ghostCd: number;
  dead: boolean;
  rttMs: number;
  fps: number;
  inMatch: boolean;
  teamsMode: boolean;
}

interface Banner {
  text: string;
  sub: string;
  until: number;
}

/** Interface en jeu : manche, minuteur, scores, état du joueur, bannières, fil des éliminations. */
export class Hud {
  private readonly top = el('div', { class: 'hud-top' });
  private readonly modeLine = el('div', { class: 'hud-mode' });
  private readonly scores = el('div', { class: 'hud-scores' });
  private readonly self = el('div', { class: 'hud-self' });
  private readonly bannerEl = el('div', { class: 'hud-banner' });
  private readonly feedEl = el('div', { class: 'hud-feed' });
  private readonly stat = el('div', { class: 'hud-stat' });
  private readonly podiumEl = el('div', { class: 'podium', hidden: true });
  private banner: Banner | null = null;
  private readonly feedItems: { text: HTMLElement; until: number }[] = [];
  private names: { name: string; color: number }[] = [];
  private key = '';

  constructor(private readonly root: HTMLElement) {
    this.root.replaceChildren(
      this.top,
      this.modeLine,
      this.scores,
      this.self,
      this.bannerEl,
      this.feedEl,
      this.stat,
      this.podiumEl,
    );
  }

  show(): void {
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
    this.hidePodium();
  }

  /** Noms et couleurs des joueurs (gardés après leur départ, pour les messages et le podium). */
  setRoster(players: PlayerInfo[]): void {
    for (const p of players) {
      this.names[p.slot] = { name: p.name, color: INK_COLORS[p.look.color % INK_COLORS.length] };
    }
  }

  nameOf(slot: number): string {
    return this.names[slot]?.name ?? `Joueur ${slot + 1}`;
  }

  private colorOf(slot: number): string {
    return hex(this.names[slot]?.color ?? 0x22262e);
  }

  /** Nom d'une équipe ou d'un joueur selon le mode (les scores sont indexés par l'un ou l'autre). */
  labelOf(index: number, teamsMode: boolean): string {
    return teamsMode ? teamName(index) : this.nameOf(index);
  }

  say(text: string, sub = '', ms = 1800): void {
    this.banner = { text, sub, until: performance.now() + ms };
    this.paintBanner(performance.now());
  }

  clearBanner(): void {
    this.banner = null;
    this.paintBanner(0);
  }

  feed(text: string, color?: number): void {
    const line = el('div', { class: 'feed-line' }, text);
    if (color !== undefined) line.style.borderLeftColor = hex(color);
    this.feedEl.prepend(line);
    this.feedItems.push({ text: line, until: performance.now() + 6000 });
    while (this.feedItems.length > 6) this.feedItems.shift()?.text.remove();
  }

  /** « A a éliminé B (cause) » à partir de l'événement KO. */
  koText(victim: number, killer: number, cause: number): string {
    const v = this.nameOf(victim);
    if (killer === 255 || killer === victim) {
      if (cause === Cause.FALL) return `${v} est tombé dans le vide`;
      return killer === victim
        ? `${v} s’est éliminé (${CAUSE_TEXT[cause] ?? '?'})`
        : `${v} est éliminé (${CAUSE_TEXT[cause] ?? '?'})`;
    }
    return `${this.nameOf(killer)} a éliminé ${v} (${CAUSE_TEXT[cause] ?? '?'})`;
  }

  roundEnd(m: ScoresMessage, teamsMode: boolean): void {
    if (m.winner < 0) this.say('Manche nulle', 'Personne ne marque', 3200);
    else
      this.say(
        `${this.labelOf(m.winner, teamsMode)} gagne la manche`,
        m.final ? 'Et la partie !' : `Manche ${m.round}`,
        3200,
      );
  }

  update(s: HudState): void {
    const now = performance.now();
    this.paintBanner(now);
    for (let i = this.feedItems.length - 1; i >= 0; i--) {
      if (this.feedItems[i].until < now) this.feedItems.splice(i, 1)[0].text.remove();
    }
    this.stat.textContent = `${Math.round(s.rttMs)} ms · ${Math.round(s.fps)} FPS`;
    const playing = s.inMatch;
    this.top.hidden = !playing;
    this.modeLine.hidden = !playing;
    this.scores.hidden = !playing;
    if (!playing) {
      this.top.replaceChildren();
      this.modeLine.textContent = '';
      this.scores.replaceChildren();
    } else {
      this.paintTop(s);
      this.paintModeLine(s);
      this.paintScores(s);
      this.paintCountdown(s);
    }
    this.paintSelf(s);
  }

  private paintTop(s: HudState): void {
    const r = s.round;
    if (!r) return;
    const mode = modeInfo(s.mode);
    let timer = '';
    if (s.phase === GamePhase.PLAYING) {
      let left = -1;
      if (s.mode === ModeId.KOTH) left = MODE_PARAMS.kothMaxTicks - s.phaseTick;
      else if (s.mode === ModeId.BALL) left = MODE_PARAMS.ballMaxTicks - s.phaseTick;
      else if (s.mode !== ModeId.INK_RISE && r.suddenAfterTicks > 0) {
        left = r.suddenAfterTicks - s.phaseTick;
      }
      if (left > 0) timer = ` · ${clock(left / TICK_HZ)}`;
      else if (
        s.mode !== ModeId.KOTH &&
        s.mode !== ModeId.BALL &&
        left <= 0 &&
        r.suddenAfterTicks > 0
      ) {
        timer = ' · MORT SUBITE';
      }
    }
    this.top.replaceChildren(
      el('span', { class: 'big' }, `Manche ${r.round}`),
      ` · ${mode.name.fr}${timer}`,
    );
  }

  private paintModeLine(s: HudState): void {
    const d = s.modeData;
    let text: string;
    switch (s.mode) {
      case ModeId.KOTH: {
        const parts: string[] = [];
        for (let t = 0; t < MAX_PLAYERS; t++) {
          const v = d[t] ?? 0;
          if (v > 0) {
            const label = this.labelOf(t, s.teamsMode);
            parts.push(
              `${label} ${Math.floor(v / TICK_HZ)}/${MODE_PARAMS.kothHoldTicks / TICK_HZ} s`,
            );
          }
        }
        text =
          parts.length > 0 ? `Colline : ${parts.join(' · ')}` : 'Tiens la colline 15 s cumulées';
        break;
      }
      case ModeId.BALL:
        text = `Boulette-ball : ${d[0] ?? 0} – ${d[1] ?? 0} (3 buts pour gagner)`;
        break;
      case ModeId.POTATO: {
        const holder = (d[0] ?? 0) - 1;
        text =
          holder >= 0
            ? `La patate est chez ${this.nameOf(holder)} : ${Math.max(0, Math.ceil((d[1] ?? 0) / TICK_HZ))} s`
            : 'Une patate d’encre arrive…';
        break;
      }
      case ModeId.INK_RISE:
        text = 'L’encre monte : reste en hauteur !';
        break;
      case ModeId.MOON:
        text = 'Gravité lunaire';
        break;
      case ModeId.SAME_WEAPON:
        text = `Même arme pour tous : ${weaponDef(s.round?.commonWeapon ?? 0).name.fr}`;
        break;
      default:
        text = '';
    }
    if (this.modeLine.textContent !== text) this.modeLine.textContent = text;
  }

  private paintScores(s: HudState): void {
    const lobby = s.lobby;
    const r = s.round;
    if (!lobby || !r) return;
    const teams = lobby.settings.mode === 'teams';
    const goal = lobby.settings.roundsToWin;
    const rows: { label: string; color: string; score: number }[] = [];
    if (teams) {
      const seen = new Set<number>();
      for (let slot = 0; slot < MAX_PLAYERS; slot++) {
        const t = r.teams[slot];
        if (t >= 0 && !seen.has(t)) {
          seen.add(t);
          rows.push({
            label: teamName(t),
            color: hex(TEAM_COLORS[t] ?? 0),
            score: lobby.scores[t] ?? 0,
          });
        }
      }
    } else {
      for (let slot = 0; slot < MAX_PLAYERS; slot++) {
        if (r.teams[slot] < 0) continue;
        rows.push({
          label: this.nameOf(slot),
          color: this.colorOf(slot),
          score: lobby.scores[slot] ?? 0,
        });
      }
    }
    const key = JSON.stringify([rows, goal, s.selfSlot]);
    if (key === this.key) return;
    this.key = key;
    this.scores.replaceChildren(
      ...rows.map((row) => {
        const pips = el('span', { class: 'pips' });
        for (let i = 0; i < goal; i++) pips.append(el('i', { class: i < row.score ? 'on' : '' }));
        const name = el('span', { class: 'sname' }, row.label);
        name.style.color = row.color;
        return el('div', { class: 'srow' }, name, pips);
      }),
    );
  }

  private paintCountdown(s: HudState): void {
    if (s.phase === GamePhase.COUNTDOWN) {
      const left = Math.ceil((COUNTDOWN_TICKS - s.phaseTick) / TICK_HZ);
      const text = left > 0 ? String(left) : 'Go !';
      if (this.bannerText !== text) {
        this.banner = { text, sub: s.round ? `Manche ${s.round.round}` : '', until: Infinity };
        this.paintBanner(performance.now());
      }
    } else if (s.phase === GamePhase.PLAYING && s.phaseTick < 40 && s.phaseTick > 0) {
      if (this.bannerText !== 'Go !') this.banner = { text: 'Go !', sub: '', until: Infinity };
      this.paintBanner(performance.now());
    } else if (this.banner?.until === Infinity) {
      this.banner = null;
      this.paintBanner(0);
    }
  }

  private get bannerText(): string {
    return this.banner?.text ?? '';
  }

  private paintBanner(now: number): void {
    if (this.banner && this.banner.until < now) this.banner = null;
    const b = this.banner;
    this.bannerEl.hidden = !b;
    if (!b) return;
    if (this.bannerEl.dataset.text !== b.text + b.sub) {
      this.bannerEl.dataset.text = b.text + b.sub;
      this.bannerEl.replaceChildren(
        el('div', { class: 'bt' }, b.text),
        el('div', { class: 'bs' }, b.sub),
      );
    }
  }

  private paintSelf(s: HudState): void {
    if (s.selfSlot < 0) {
      this.self.textContent = 'Spectateur';
      return;
    }
    if (s.ghost) {
      const sec = Math.ceil(s.ghostCd / TICK_HZ);
      this.self.textContent =
        sec > 0
          ? `Fantôme-crayon · prochain dessin dans ${sec} s`
          : 'Fantôme-crayon · J : trait · K : goutte d’encre';
      return;
    }
    if (s.dead) {
      this.self.textContent = 'Éliminé';
      return;
    }
    const w = weaponDef(s.weapon);
    const hp = Math.max(0, Math.min(100, s.hp));
    const bar = el('span', { class: 'hpbar' }, el('i'));
    (bar.firstChild as HTMLElement).style.width = `${hp}%`;
    (bar.firstChild as HTMLElement).style.background =
      hp > 50 ? '#1f9d55' : hp > 25 ? '#e8801a' : '#d6322e';
    const weapon = s.weapon === 0 ? 'Poings' : `${w.name.fr}${w.ammo > 0 ? ` · ${s.ammo}` : ''}`;
    this.self.replaceChildren(bar, ` ${hp} PV · ${weapon}`);
  }

  // --- Podium ---------------------------------------------------------------------------------

  showPodium(r: ResultsMessage): void {
    const teams = r.teams.some((t, i) => t >= 0 && t !== i);
    const rows = r.podium.map((idx, rank) => {
      const members: number[] = [];
      for (let slot = 0; slot < MAX_PLAYERS; slot++) if (r.teams[slot] === idx) members.push(slot);
      const label = teams ? teamName(idx) : this.nameOf(idx);
      const color = teams ? hex(TEAM_COLORS[idx] ?? 0) : this.colorOf(idx);
      const n = el('span', { class: 'sname' }, `${rank + 1}. ${label}`);
      n.style.color = color;
      return el(
        'div',
        { class: `prow${rank === 0 ? ' first' : ''}` },
        n,
        el('span', {}, `${r.scores[idx] ?? 0} manche${(r.scores[idx] ?? 0) > 1 ? 's' : ''}`),
        teams ? el('span', { class: 'hint' }, members.map((m) => this.nameOf(m)).join(', ')) : null,
      );
    });
    const stats = el(
      'table',
      { class: 'stats' },
      el(
        'tr',
        {},
        ...['Joueur', 'KO', 'Morts', 'Dégâts', 'Combo', 'Mort la plus bête'].map((h) =>
          el('th', {}, h),
        ),
      ),
      ...r.stats.map((st) => {
        const n = el('td', {}, this.nameOf(st.slot));
        n.style.color = this.colorOf(st.slot);
        return el(
          'tr',
          {},
          n,
          el('td', {}, String(st.kos)),
          el('td', {}, String(st.deaths)),
          el('td', {}, String(Math.round(st.damage))),
          el('td', {}, String(st.bestCombo)),
          el('td', {}, SILLY_TEXT[st.silly] ?? '–'),
        );
      }),
    );
    this.podiumEl.hidden = false;
    this.podiumEl.replaceChildren(
      el(
        'div',
        { class: 'card wide' },
        el('h1', {}, 'Podium'),
        ...rows,
        stats,
        el('p', { class: 'hint' }, 'Retour au salon dans quelques secondes…'),
      ),
    );
  }

  hidePodium(): void {
    this.podiumEl.hidden = true;
    this.podiumEl.replaceChildren();
  }
}
