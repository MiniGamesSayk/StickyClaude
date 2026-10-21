import {
  COLOR_COUNT,
  DEFAULT_LOOK,
  HAT_NAMES,
  INK_COLORS,
  NAME_MAX,
  sanitizeLook,
  STROKE_NAMES,
  VICTORY_NAMES,
} from '@stickyclaude/shared';
import type { Look, PublicRoom } from '@stickyclaude/shared';
import { button, el, hex, storeGet, storeSet } from './dom.ts';

const NAME_KEY = 'stickyclaude.name';
const LOOK_KEY = 'stickyclaude.look';

export function loadName(): string {
  return storeGet(NAME_KEY) ?? `Joueur${Math.floor(Math.random() * 900 + 100)}`;
}

export function saveName(name: string): void {
  storeSet(NAME_KEY, name);
}

export function loadLook(): Look {
  const raw = storeGet(LOOK_KEY);
  if (raw) {
    try {
      return sanitizeLook(JSON.parse(raw), DEFAULT_LOOK);
    } catch {
      /* préférence illisible : valeurs par défaut */
    }
  }
  return { ...DEFAULT_LOOK, color: Math.floor(Math.random() * COLOR_COUNT) };
}

export function saveLook(look: Look): void {
  storeSet(LOOK_KEY, JSON.stringify(look));
}

function select(
  options: readonly string[],
  value: number,
  onChange: (v: number) => void,
): HTMLSelectElement {
  const s = el('select');
  options.forEach((label, i) => s.append(el('option', { value: String(i), textContent: label })));
  s.value = String(value);
  s.addEventListener('change', () => {
    onChange(Number(s.value));
    s.blur();
  });
  return s;
}

/** Éditeur d'apparence : couleur, trait, couvre-chef, emote de victoire (liste blanche côté serveur). */
export class LookEditor {
  readonly root: HTMLElement;
  private look: Look;
  private readonly swatches: HTMLButtonElement[] = [];
  private readonly selects: HTMLSelectElement[] = [];

  constructor(
    initial: Look,
    private readonly onChange: (look: Look) => void,
  ) {
    this.look = { ...initial };
    const colors = el('div', { class: 'swatches' });
    for (let i = 0; i < COLOR_COUNT; i++) {
      const b = el('button', { type: 'button', class: 'swatch', title: `Encre ${i + 1}` });
      b.style.background = hex(INK_COLORS[i]);
      b.addEventListener('click', () => {
        this.set({ ...this.look, color: i }, true);
        b.blur();
      });
      this.swatches.push(b);
      colors.append(b);
    }
    const stroke = select(
      STROKE_NAMES.map((n) => n.fr),
      this.look.stroke,
      (v) => this.set({ ...this.look, stroke: v }, true),
    );
    const hat = select(
      HAT_NAMES.map((n) => n.fr),
      this.look.hat,
      (v) => this.set({ ...this.look, hat: v }, true),
    );
    const victory = select(
      VICTORY_NAMES.map((n) => n.fr),
      this.look.victory,
      (v) => this.set({ ...this.look, victory: v }, true),
    );
    this.selects.push(stroke, hat, victory);
    this.root = el(
      'div',
      { class: 'look' },
      colors,
      el(
        'div',
        { class: 'look-grid' },
        el('label', {}, 'Trait', stroke),
        el('label', {}, 'Chapeau', hat),
        el('label', {}, 'Victoire', victory),
      ),
    );
    this.paint();
  }

  get value(): Look {
    return { ...this.look };
  }

  /** Remplace l'apparence affichée (le serveur peut avoir changé la couleur). */
  set(look: Look, notify = false): void {
    this.look = { ...look };
    this.paint();
    if (notify) this.onChange(this.value);
  }

  private paint(): void {
    this.swatches.forEach((b, i) => b.classList.toggle('on', i === this.look.color));
    this.selects[0].value = String(this.look.stroke);
    this.selects[1].value = String(this.look.hat);
    this.selects[2].value = String(this.look.victory);
  }
}

export interface MenuHandlers {
  onQuick(name: string, look: Look): void;
  onCreate(name: string, look: Look, isPublic: boolean): void;
  onJoin(name: string, code: string, look: Look): void;
}

/** Écran d'accueil : pseudo, apparence, partie rapide, créer, rejoindre, salons publics. */
export class Menu {
  private readonly name: HTMLInputElement;
  private readonly code: HTMLInputElement;
  private readonly isPublic: HTMLInputElement;
  private readonly error: HTMLElement;
  private readonly rooms: HTMLElement;
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly look: LookEditor;
  private publicRooms: PublicRoom[] = [];

  constructor(
    private readonly root: HTMLElement,
    private readonly h: MenuHandlers,
  ) {
    this.name = el('input', {
      type: 'text',
      maxLength: NAME_MAX,
      autocomplete: 'off',
      spellcheck: false,
    });
    this.name.value = loadName();
    this.code = el('input', {
      type: 'text',
      maxLength: 8,
      placeholder: 'CODE',
      autocomplete: 'off',
      spellcheck: false,
    });
    this.isPublic = el('input', { type: 'checkbox' });
    this.error = el('div', { class: 'error', role: 'alert' });
    this.rooms = el('div', { class: 'rooms' });
    this.look = new LookEditor(loadLook(), (l) => saveLook(l));

    const quick = button('Partie rapide', () => this.submit('quick'));
    const create = button('Créer un salon', () => this.submit('create'), { secondary: true });
    const join = button('Rejoindre', () => this.submit('join'), { secondary: true });
    this.buttons.push(quick, create, join);
    const onEnter = (e: KeyboardEvent): void => {
      if (e.key === 'Enter') this.submit(this.code.value.trim() !== '' ? 'join' : 'quick');
    };
    this.name.addEventListener('keydown', onEnter);
    this.code.addEventListener('keydown', onEnter);

    this.root.replaceChildren(
      el(
        'div',
        { class: 'card wide' },
        el('h1', {}, 'StickyClaude'),
        el('p', { class: 'sub' }, 'Combat de stickmen en ligne · 2 à 8 joueurs'),
        el('label', {}, 'Ton pseudo', this.name),
        this.look.root,
        quick,
        el(
          'div',
          { class: 'row' },
          create,
          el('label', { class: 'check' }, this.isPublic, 'public'),
        ),
        el('label', {}, 'Ou rejoins un salon', el('div', { class: 'row' }, this.code, join)),
        this.error,
        el('h2', {}, 'Salons publics'),
        this.rooms,
      ),
    );
    this.renderRooms();
  }

  get lookValue(): Look {
    return this.look.value;
  }

  get nameValue(): string {
    return this.name.value.trim();
  }

  private submit(kind: 'quick' | 'create' | 'join'): void {
    const name = this.nameValue;
    saveName(name);
    this.error.textContent = '';
    if (kind === 'join' && this.code.value.trim() === '') {
      this.error.textContent = 'Entre le code du salon.';
      return;
    }
    this.setBusy(true);
    const look = this.look.value;
    if (kind === 'quick') this.h.onQuick(name, look);
    else if (kind === 'create') this.h.onCreate(name, look, this.isPublic.checked);
    else this.h.onJoin(name, this.code.value.trim(), look);
  }

  prefillCode(code: string): void {
    this.code.value = code.toUpperCase();
  }

  prefillName(name: string): void {
    this.name.value = name;
  }

  setBusy(busy: boolean): void {
    for (const b of this.buttons) b.disabled = busy;
  }

  showError(msg: string): void {
    this.error.textContent = msg;
    this.setBusy(false);
    this.show();
  }

  show(): void {
    this.root.hidden = false;
    this.setBusy(false);
  }

  hide(): void {
    this.root.hidden = true;
  }

  setRooms(list: PublicRoom[]): void {
    this.publicRooms = list;
    this.renderRooms();
  }

  private renderRooms(): void {
    if (this.publicRooms.length === 0) {
      this.rooms.replaceChildren(el('p', { class: 'hint' }, 'Aucun salon public pour le moment.'));
      return;
    }
    this.rooms.replaceChildren(
      ...this.publicRooms.map((r) =>
        el(
          'div',
          { class: 'room' },
          el('span', { class: 'host' }, r.host || '—'),
          el(
            'span',
            { class: 'meta' },
            `${r.players}/${r.maxPlayers} · ${r.mode === 'teams' ? 'équipes' : 'chacun pour soi'} · ${r.phase === 'lobby' ? 'en attente' : 'en jeu'}`,
          ),
          button(
            'Rejoindre',
            () => {
              const name = this.nameValue;
              saveName(name);
              this.setBusy(true);
              this.h.onJoin(name, r.code, this.look.value);
            },
            { secondary: true },
          ),
        ),
      ),
    );
  }
}
