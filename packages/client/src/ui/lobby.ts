import {
  BONUS_EVERY_MAX,
  BONUS_MODE_IDS,
  EMOTES,
  GamePhase,
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
  getArena,
} from '@stickyclaude/shared';
import type { LobbyView, Look, RoomSettings } from '@stickyclaude/shared';
import { button, el, hex } from './dom.ts';
import { LookEditor } from './menu.ts';
import { KEYS_HINT } from './texts.ts';

export interface LobbyHandlers {
  onLeave(): void;
  onCopyLink(): void;
  onReady(ready: boolean): void;
  onStart(): void;
  onSettings(patch: Partial<RoomSettings>): void;
  onTeams(opts: { assign?: number[]; shuffle?: boolean }): void;
  onKick(slot: number): void;
  onLook(look: Look): void;
  onEmote(id: number): void;
}

const TEAM_NAMES = ['Bleus', 'Rouges', 'Verts', 'Jaunes'];
export const TEAM_COLORS = [0x1f4fd1, 0xd6322e, 0x1f9d55, 0xc9a227];

export function teamName(team: number): string {
  return TEAM_NAMES[team] ?? `Équipe ${team + 1}`;
}

interface Field<T> {
  row: HTMLElement;
  input: T;
}

function checkField(label: string, onChange: (v: boolean) => void): Field<HTMLInputElement> {
  const input = el('input', { type: 'checkbox' });
  input.addEventListener('change', () => {
    onChange(input.checked);
    input.blur();
  });
  return { row: el('label', { class: 'check' }, input, label), input };
}

function selectField(
  label: string,
  options: [string, string][],
  onChange: (v: string) => void,
): Field<HTMLSelectElement> {
  const input = el('select');
  for (const [value, text] of options) input.append(el('option', { value, textContent: text }));
  input.addEventListener('change', () => {
    onChange(input.value);
    input.blur();
  });
  return { row: el('label', {}, label, input), input };
}

/** Panneau du salon : joueurs, prêt, équipes, réglages de l'hôte, apparence, emotes. */
export class LobbyPanel {
  private readonly title: HTMLElement;
  private readonly players: HTMLElement;
  private readonly spectators: HTMLElement;
  private readonly status: HTMLElement;
  private readonly actions: HTMLElement;
  private readonly settingsBox: HTMLElement;
  private readonly look: LookEditor;
  private readonly lookBox: HTMLElement;
  private readonly mode: Field<HTMLSelectElement>;
  private readonly teams: Field<HTMLSelectElement>;
  private readonly friendly: Field<HTMLInputElement>;
  private readonly rounds: Field<HTMLSelectElement>;
  private readonly weapons: Field<HTMLInputElement>;
  private readonly sudden: Field<HTMLInputElement>;
  private readonly suddenSec: HTMLInputElement;
  private readonly ghosts: Field<HTMLInputElement>;
  private readonly bonusEvery: Field<HTMLSelectElement>;
  private readonly isPublic: Field<HTMLInputElement>;
  private readonly bonusModes = new Map<number, HTMLInputElement>();
  private readonly arenas = new Map<string, HTMLInputElement>();
  private readonly teamSection: HTMLElement;
  private playersKey = '';
  private lobby: LobbyView | null = null;
  private self = -1;
  private ready = false;
  private applying = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly h: LobbyHandlers,
    initialLook: Look,
  ) {
    this.title = el('div', { class: 'lobby-title' });
    this.players = el('ul', { class: 'players' });
    this.spectators = el('div', { class: 'hint' });
    this.status = el('div', { class: 'status' });
    this.actions = el('div', { class: 'row' });
    this.look = new LookEditor(initialLook, (l) => h.onLook(l));
    this.lookBox = el('details', {}, el('summary', {}, 'Mon stickman'), this.look.root);

    const patch = (p: Partial<RoomSettings>): void => {
      if (!this.applying) h.onSettings(p);
    };
    this.mode = selectField(
      'Mode',
      [
        ['ffa', 'Chacun pour soi'],
        ['teams', 'Équipes'],
      ],
      (v) => patch({ mode: v as RoomSettings['mode'] }),
    );
    this.teams = selectField(
      'Équipes',
      Array.from({ length: TEAMS_MAX - TEAMS_MIN + 1 }, (_, i): [string, string] => [
        String(TEAMS_MIN + i),
        `${TEAMS_MIN + i} équipes`,
      ]),
      (v) => patch({ teams: Number(v) }),
    );
    this.friendly = checkField('Tir ami', (v) => patch({ friendlyFire: v }));
    this.rounds = selectField(
      'Manches à gagner',
      ROUNDS_TO_WIN_CHOICES.map((n): [string, string] => [String(n), String(n)]),
      (v) => patch({ roundsToWin: Number(v) }),
    );
    this.weapons = checkField('Armes', (v) => patch({ weapons: v }));
    this.sudden = checkField('Mort subite', (v) => patch({ suddenDeath: v }));
    this.suddenSec = el('input', {
      type: 'number',
      min: String(SUDDEN_MIN_SEC),
      max: String(SUDDEN_MAX_SEC),
      step: '5',
    });
    this.suddenSec.addEventListener('change', () =>
      patch({ suddenDeathSec: Number(this.suddenSec.value) }),
    );
    this.ghosts = checkField('Les morts dessinent (fantômes)', (v) => patch({ ghosts: v }));
    this.bonusEvery = selectField(
      'Mode bonus',
      Array.from({ length: BONUS_EVERY_MAX + 1 }, (_, i): [string, string] => [
        String(i),
        i === 0 ? 'jamais' : i === 1 ? 'à chaque manche' : `une manche sur ${i}`,
      ]),
      (v) => patch({ bonusEvery: Number(v) }),
    );
    this.isPublic = checkField('Salon public', (v) => patch({ isPublic: v }));

    const bonusBox = el('div', { class: 'checks' });
    for (const id of BONUS_MODE_IDS) {
      const box = el('input', { type: 'checkbox' });
      box.addEventListener('change', () => {
        const ids = [...this.bonusModes].filter(([, b]) => b.checked).map(([m]) => m);
        patch({ bonusModes: ids });
        box.blur();
      });
      this.bonusModes.set(id, box);
      bonusBox.append(el('label', { class: 'check' }, box, modeInfo(id).name.fr));
    }
    const arenaBox = el('div', { class: 'checks' });
    for (const id of ROTATION_ARENA_IDS) {
      const box = el('input', { type: 'checkbox' });
      box.addEventListener('change', () => {
        patch({ arenas: [...this.arenas].filter(([, b]) => b.checked).map(([a]) => a) });
        box.blur();
      });
      this.arenas.set(id, box);
      arenaBox.append(el('label', { class: 'check' }, box, getArena(id)?.name.fr ?? id));
    }

    this.teamSection = el('div', {});
    this.settingsBox = el(
      'details',
      { open: true },
      el('summary', {}, 'Réglages de la partie'),
      this.mode.row,
      this.teams.row,
      this.friendly.row,
      this.rounds.row,
      this.weapons.row,
      el('div', { class: 'row' }, this.sudden.row, this.suddenSec),
      this.ghosts.row,
      this.bonusEvery.row,
      el('div', { class: 'hint' }, 'Modes bonus autorisés'),
      bonusBox,
      el('div', { class: 'hint' }, 'Arènes (aucune cochée = toutes)'),
      arenaBox,
      this.isPublic.row,
    );

    const emotes = el('div', { class: 'emotes' });
    EMOTES.forEach((e, i) => {
      emotes.append(button(`${i + 1}`, () => h.onEmote(i), { secondary: true, title: e.fr }));
    });

    this.root.replaceChildren(
      el(
        'div',
        { class: 'panel' },
        this.title,
        this.players,
        this.teamSection,
        this.spectators,
        this.status,
        this.actions,
        this.lookBox,
        this.settingsBox,
        el('div', { class: 'hint' }, 'Emotes (touches 1 à 9)'),
        emotes,
        el('div', { class: 'hint' }, KEYS_HINT),
        el('div', { class: 'hint stat' }),
      ),
    );
  }

  show(): void {
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  setStat(text: string): void {
    const s = this.root.querySelector('.stat');
    if (s && s.textContent !== text) s.textContent = text;
  }

  /** L'apparence validée par le serveur (couleur attribuée) remplace celle de l'éditeur. */
  syncLook(look: Look): void {
    this.look.set(look, false);
  }

  update(lobby: LobbyView, selfSlot: number): void {
    this.lobby = lobby;
    this.self = selfSlot;
    const isHost = selfSlot >= 0 && lobby.host === selfSlot;
    const inLobby = lobby.phase === GamePhase.LOBBY;
    const me = lobby.players.find((p) => p.slot === selfSlot);
    this.ready = me?.ready ?? false;

    this.title.replaceChildren(
      el('span', { class: 'code' }, lobby.code),
      button('Copier le lien', () => this.h.onCopyLink(), { secondary: true }),
      button('Quitter', () => this.h.onLeave(), { secondary: true }),
    );

    // Joueurs
    const s = lobby.settings;
    const teamsMode = s.mode === 'teams';
    const key = JSON.stringify([lobby.players, lobby.host, selfSlot, inLobby, teamsMode, s.teams]);
    if (key !== this.playersKey) {
      this.playersKey = key;
      this.players.replaceChildren(
        ...lobby.players.map((p) => {
          const dot = el('span', { class: 'dot' });
          dot.style.background = hex(INK_COLORS[p.look.color % INK_COLORS.length]);
          const li = el(
            'li',
            { class: p.slot === selfSlot ? 'me' : '' },
            dot,
            el('span', { class: 'pname' }, p.name + (p.slot === selfSlot ? ' (toi)' : '')),
            p.slot === lobby.host ? el('span', { class: 'tag', title: 'Hôte' }, '★') : null,
            !p.connected ? el('span', { class: 'tag warn', title: 'Reconnexion…' }, '⌛') : null,
            p.ready ? el('span', { class: 'tag ok', title: 'Prêt' }, '✔') : null,
            el('span', { class: 'ping' }, p.ping > 0 ? `${p.ping} ms` : ''),
          );
          if (teamsMode && p.team >= 0) {
            if (isHost && inLobby) {
              const sel = el('select');
              for (let t = 0; t < s.teams; t++) {
                sel.append(el('option', { value: String(t), textContent: teamName(t) }));
              }
              sel.value = String(p.team);
              sel.addEventListener('change', () => {
                const assign = new Array<number>(MAX_PLAYERS).fill(-1);
                assign[p.slot] = Number(sel.value);
                this.h.onTeams({ assign });
                sel.blur();
              });
              li.append(sel);
            } else {
              const tag = el('span', { class: 'tag team' }, teamName(p.team));
              tag.style.color = hex(TEAM_COLORS[p.team] ?? 0);
              li.append(tag);
            }
          }
          if (isHost && inLobby && p.slot !== selfSlot) {
            li.append(
              button('✖', () => this.h.onKick(p.slot), { secondary: true, title: 'Expulser' }),
            );
          }
          return li;
        }),
      );
    }
    this.teamSection.replaceChildren(
      ...(teamsMode && isHost && inLobby
        ? [
            button('Mélanger les équipes', () => this.h.onTeams({ shuffle: true }), {
              secondary: true,
            }),
          ]
        : []),
    );
    this.spectators.textContent =
      lobby.spectators.length > 0
        ? `Spectateurs (${lobby.spectators.length}/${MAX_SPECTATORS}) : ${lobby.spectators.map((x) => x.name).join(', ')}`
        : '';

    // Statut et actions
    const actions: HTMLElement[] = [];
    let status: string;
    if (selfSlot < 0) {
      status = inLobby
        ? 'Tu regardes le salon (plus de place de joueur).'
        : 'Une partie est en cours : tu regardes, puis tu entres à la manche suivante.';
    } else if (!inLobby) {
      status = 'Partie en cours.';
    } else {
      const others = lobby.players.filter((p) => p.slot !== selfSlot);
      const allReady = others.every((p) => p.ready || p.slot === lobby.host);
      if (lobby.players.length < 2) status = 'En attente d’autres joueurs… (partagez le code)';
      else if (isHost)
        status = allReady ? 'Tout le monde est prêt.' : 'Certains joueurs ne sont pas prêts.';
      else status = this.ready ? 'Tu es prêt, en attente de l’hôte.' : 'Clique sur « Prêt ».';
      if (lobby.autostartMs >= 0) {
        status += ` Lancement automatique dans ${Math.ceil(lobby.autostartMs / 1000)} s.`;
      }
      if (!isHost) {
        actions.push(
          button(this.ready ? 'Pas prêt' : 'Prêt', () => this.h.onReady(!this.ready), {
            secondary: this.ready,
          }),
        );
      } else {
        actions.push(button('Lancer la partie', () => this.h.onStart()));
        actions.push(
          button(this.ready ? 'Pas prêt' : 'Prêt', () => this.h.onReady(!this.ready), {
            secondary: true,
          }),
        );
      }
    }
    this.status.textContent = status;
    this.actions.replaceChildren(...actions);

    // Réglages
    this.applying = true;
    this.mode.input.value = s.mode;
    this.teams.input.value = String(s.teams);
    this.teams.row.hidden = !teamsMode;
    this.friendly.input.checked = s.friendlyFire;
    this.friendly.row.hidden = !teamsMode;
    this.rounds.input.value = String(s.roundsToWin);
    this.weapons.input.checked = s.weapons;
    this.sudden.input.checked = s.suddenDeath;
    if (document.activeElement !== this.suddenSec) this.suddenSec.value = String(s.suddenDeathSec);
    this.suddenSec.disabled = !s.suddenDeath;
    this.ghosts.input.checked = s.ghosts;
    this.bonusEvery.input.value = String(s.bonusEvery);
    this.isPublic.input.checked = s.isPublic;
    for (const [id, box] of this.bonusModes) box.checked = s.bonusModes.includes(id);
    for (const [id, box] of this.arenas) box.checked = s.arenas.includes(id);
    const editable = isHost && inLobby;
    const controls = this.settingsBox.querySelectorAll('input, select');
    controls.forEach((c) => ((c as HTMLInputElement).disabled = !editable));
    if (editable) this.suddenSec.disabled = !s.suddenDeath;
    this.applying = false;
    this.lookBox.hidden = selfSlot < 0;
    // la couleur finalement attribuée par le serveur
    if (me) this.look.set(me.look, false);
  }

  get currentLobby(): LobbyView | null {
    return this.lobby;
  }

  get selfSlot(): number {
    return this.self;
  }
}
