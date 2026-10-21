import { INK_COLORS, NAME_MAX } from '@stickyclaude/shared';
import type { RosterEntry } from '@stickyclaude/shared';

export interface UiHandlers {
  onCreate(name: string): void;
  onJoin(name: string, code: string): void;
  onLeave(): void;
  onCopyLink(): void;
}

export interface HudInfo {
  code: string;
  roster: RosterEntry[];
  selfSlot: number;
  host: number;
  rttMs: number;
  fps: number;
}

const NAME_KEY = 'stickyclaude.name';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  const { class: cls, ...rest } = props;
  if (cls) e.className = cls;
  Object.assign(e, rest);
  for (const c of children) e.append(c);
  return e;
}

/** Interface minimale en DOM : pseudo, créer/rejoindre par code, panneau du salon. */
export class Ui {
  private readonly name: HTMLInputElement;
  private readonly code: HTMLInputElement;
  private readonly create: HTMLButtonElement;
  private readonly join: HTMLButtonElement;
  private readonly error: HTMLElement;
  private hudKey = '';

  constructor(
    private readonly menu: HTMLElement,
    private readonly hud: HTMLElement,
    private readonly h: UiHandlers,
  ) {
    this.name = el('input', {
      type: 'text',
      maxLength: NAME_MAX,
      autocomplete: 'off',
      spellcheck: false,
    });
    this.name.value = this.storedName();
    this.code = el('input', {
      type: 'text',
      maxLength: 8,
      placeholder: 'CODE',
      autocomplete: 'off',
      spellcheck: false,
    });
    this.create = el('button', { type: 'button' }, 'Créer un salon');
    this.join = el('button', { type: 'button', class: 'secondary' }, 'Rejoindre');
    this.error = el('div', { class: 'error', role: 'alert' });
    this.create.addEventListener('click', () => this.submit(false));
    this.join.addEventListener('click', () => this.submit(true));
    const onEnter = (e: KeyboardEvent): void => {
      if (e.key === 'Enter') this.submit(this.code.value.trim() !== '');
    };
    this.name.addEventListener('keydown', onEnter);
    this.code.addEventListener('keydown', onEnter);

    const card = el(
      'div',
      { class: 'card' },
      el('h1', {}, 'StickyClaude'),
      el('p', { class: 'sub' }, 'Combat de stickmen en ligne'),
      el('label', {}, 'Ton pseudo', this.name),
      this.create,
      el('label', {}, 'Ou rejoins un salon', el('div', { class: 'row' }, this.code, this.join)),
      this.error,
    );
    this.menu.replaceChildren(card);
  }

  private storedName(): string {
    try {
      return localStorage.getItem(NAME_KEY) ?? `Joueur${Math.floor(Math.random() * 900 + 100)}`;
    } catch {
      return 'Joueur';
    }
  }

  prefillCode(code: string): void {
    this.code.value = code.toUpperCase();
  }

  prefillName(name: string): void {
    this.name.value = name;
  }

  private submit(join: boolean): void {
    const name = this.name.value.trim();
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      /* stockage indisponible : sans importance */
    }
    this.error.textContent = '';
    if (join && this.code.value.trim() === '') {
      this.error.textContent = 'Entre le code du salon.';
      return;
    }
    this.setBusy(true);
    if (join) this.h.onJoin(name, this.code.value.trim());
    else this.h.onCreate(name);
  }

  setBusy(busy: boolean): void {
    this.create.disabled = busy;
    this.join.disabled = busy;
  }

  showError(msg: string): void {
    this.error.textContent = msg;
    this.setBusy(false);
    this.showMenu();
  }

  showMenu(): void {
    this.menu.hidden = false;
    this.hud.hidden = true;
    this.setBusy(false);
  }

  /** Message plein écran quand la connexion est perdue. */
  showDisconnected(): void {
    const btn = el('button', { type: 'button' }, 'Recharger');
    btn.addEventListener('click', () => location.reload());
    this.menu.hidden = false;
    this.hud.hidden = true;
    this.menu.replaceChildren(
      el(
        'div',
        { class: 'card' },
        el('h1', {}, 'Connexion perdue'),
        el('p', { class: 'sub' }, 'Le serveur ne répond plus.'),
        btn,
      ),
    );
  }

  hideMenu(): void {
    this.menu.hidden = true;
    this.hud.hidden = false;
  }

  updateHud(info: HudInfo): void {
    const key = `${info.code}|${info.selfSlot}|${info.host}|${info.roster.map((r) => `${r.slot}:${r.name}:${r.color}`).join(',')}`;
    if (key !== this.hudKey) {
      this.hudKey = key;
      const copy = el('button', { type: 'button' }, 'Copier le lien');
      copy.addEventListener('click', () => this.h.onCopyLink());
      const leave = el('button', { type: 'button' }, 'Quitter');
      leave.addEventListener('click', () => this.h.onLeave());
      const list = el('ul');
      for (const r of info.roster) {
        const dot = el('span', { class: 'dot' });
        dot.style.background = `#${(INK_COLORS[r.color % INK_COLORS.length] ?? 0).toString(16).padStart(6, '0')}`;
        const me = r.slot === info.selfSlot ? ' (toi)' : '';
        const host = r.slot === info.host ? ' ★' : '';
        list.append(el('li', {}, dot, `${r.name}${me}${host}`));
      }
      this.hud.replaceChildren(
        el('div', {}, 'Salon ', el('span', { class: 'code' }, info.code), copy, leave),
        list,
        el(
          'div',
          { class: 'hint' },
          'Flèches ou WASD/ZQSD : bouger · Espace : sauter (deux fois = double saut) · contre un mur : saut mural · ↓ + Espace : traverser · F3 : réseau',
        ),
        el('div', { class: 'hint stat' }),
      );
    }
    const stat = this.hud.querySelector('.stat');
    if (stat) stat.textContent = `${Math.round(info.rttMs)} ms · ${Math.round(info.fps)} FPS`;
  }
}
