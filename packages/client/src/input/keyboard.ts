import { Input } from '@stickyclaude/shared';
import type { Action, Bindings } from '../app/options.ts';
import { ACTIONS, DEFAULT_BINDINGS, mouseButtonOf, mouseCode } from '../app/options.ts';

const BIT: Record<Action, number> = {
  left: Input.LEFT,
  right: Input.RIGHT,
  up: Input.UP,
  down: Input.DOWN,
  jump: Input.JUMP,
  attack: Input.ATTACK,
  block: Input.BLOCK,
  pickup: Input.PICKUP,
  dash: Input.DASH,
  special: Input.SPECIAL,
};

/** Table `event.code` → bit d'entrée, construite à partir des touches choisies. */
export function buildKeymap(b: Readonly<Bindings>): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of ACTIONS) {
    for (const c of b[a]) if (c !== '') m.set(c, (m.get(c) ?? 0) | BIT[a]);
  }
  return m;
}

/**
 * Clavier par position physique (`event.code`) : WASD sur QWERTY et ZQSD sur AZERTY donnent les
 * mêmes codes. Les touches sont reconfigurables (`setBindings`), boutons de la souris compris
 * (codes `Mouse0` à `Mouse4`, sur le canvas seulement) : rien n'est sous-entendu.
 */
export class KeyboardInput {
  private held = 0;
  private edges = 0;
  private keymap = buildKeymap(DEFAULT_BINDINGS);
  private captureCb: ((code: string) => void) | null = null;
  private on = true;
  private mouse = 0;
  /** Dernière position de la souris (px de la fenêtre), connue seulement après un mouvement. */
  private mouseX = 0;
  private mouseY = 0;
  private mouseSeen = false;
  /** Le menu contextuel reste masqué jusqu'à cet instant (clic droit choisi pendant la saisie). */
  private ctxBlockUntil = 0;
  private captureMouse: ((code: string) => void) | null = null;

  constructor(target: Window) {
    target.addEventListener('keydown', (e) => this.onKey(e, true));
    target.addEventListener('keyup', (e) => this.onKey(e, false));
    target.addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.reset();
    });
    target.addEventListener('pointerdown', (e) => this.onPointer(e, true));
    target.addEventListener('pointerup', (e) => this.onPointer(e, false));
    // Un bouton lié à une action ne doit rien faire d'autre dans la page (défilement automatique
    // de la molette, précédent/suivant des boutons latéraux, sélection de texte).
    target.addEventListener('mousedown', (e) => {
      if (this.keymap.has(mouseCode(e.button)) && e.target instanceof HTMLCanvasElement) {
        e.preventDefault();
      }
    });
    target.addEventListener('auxclick', (e) => {
      if (this.keymap.has(mouseCode(e.button)) && e.target instanceof HTMLCanvasElement) {
        e.preventDefault();
      }
    });
    target.addEventListener('pointercancel', () => (this.mouse = 0));
    target.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.mouseSeen = true;
    });
    document.documentElement.addEventListener('pointerleave', () => (this.mouseSeen = false));
    // Quand le clic droit est lié à une action : pas de menu du navigateur en jeu, même au-dessus
    // du HUD (pas seulement sur le canvas). S'il ne sert à rien, le menu reste disponible.
    target.addEventListener('contextmenu', (e) => {
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      if (performance.now() < this.ctxBlockUntil) {
        e.preventDefault();
        return;
      }
      if (!this.keymap.has(mouseCode(2))) return;
      if (t instanceof HTMLCanvasElement || this.on) e.preventDefault();
    });
  }

  /** Les touches de jeu sont ignorées (menus, saisie de texte). */
  get enabled(): boolean {
    return this.on;
  }

  /** Les touches relâchées pendant la pause ne sont pas vues : on repart de zéro à la reprise. */
  set enabled(v: boolean) {
    if (v && !this.on) this.reset();
    this.on = v;
  }

  setBindings(b: Readonly<Bindings>): void {
    this.keymap = buildKeymap(b);
    this.reset();
  }

  /** La prochaine touche pressée est transmise à `cb` au lieu d'agir (reconfiguration). */
  capture(cb: ((code: string) => void) | null): void {
    this.captureCb = cb;
    this.captureMouse = cb;
  }

  /**
   * Angle (radians, 0 = droite, y vers le bas) de la souris vu depuis `ox, oy` (px de la fenêtre),
   * ou null tant que la souris n'a pas bougé.
   */
  mouseAngle(ox: number, oy: number): number | null {
    if (!this.mouseSeen) return null;
    const dx = this.mouseX - ox;
    const dy = this.mouseY - oy;
    if (dx * dx + dy * dy < 16) return null;
    return Math.atan2(dy, dx);
  }

  private reset(): void {
    this.held = 0;
    this.edges = 0;
    this.mouse = 0;
  }

  private onPointer(e: PointerEvent, down: boolean): void {
    if (e.pointerType === 'touch') return;
    // Saisie d'une nouvelle touche : le prochain bouton de la souris (hors la touche de saisie
    // elle-même, qui sert à annuler) est transmis au lieu d'agir.
    if (down && this.captureMouse) {
      const t = e.target;
      if (t instanceof Element && t.closest('.keycap')) return;
      const cb = this.captureMouse;
      this.captureMouse = null;
      this.captureCb = null;
      e.preventDefault();
      if (e.button === 2) this.ctxBlockUntil = performance.now() + 500;
      cb(mouseCode(e.button));
      return;
    }
    const bit = this.keymap.get(mouseCode(e.button)) ?? 0;
    if (bit === 0 || mouseButtonOf(mouseCode(e.button)) < 0) return;
    // Un relâchement compte partout : si l'écran de fin ou un menu recouvre le canvas pendant que
    // le bouton est tenu, il ne doit pas rester collé.
    if (!down) {
      this.mouse &= ~bit;
      return;
    }
    if (!(e.target instanceof HTMLCanvasElement)) return;
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
    this.mouseSeen = true;
    if (this.on) {
      this.mouse |= bit;
      this.edges |= bit;
    }
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    // Un relâchement compte toujours, avant les gardes ci-dessous : pause, options, champ de texte.
    // Sans cela, une touche lâchée pendant ce temps resterait enfoncée à la reprise.
    if (!down) {
      const up = this.keymap.get(e.code);
      if (up !== undefined) this.held &= ~up;
    }
    const t = e.target;
    if (
      t instanceof HTMLInputElement ||
      t instanceof HTMLTextAreaElement ||
      t instanceof HTMLSelectElement
    ) {
      return;
    }
    if (down && this.captureCb) {
      e.preventDefault();
      const cb = this.captureCb;
      this.captureCb = null;
      this.captureMouse = null;
      cb(e.code);
      return;
    }
    if (!this.on) return;
    const bit = this.keymap.get(e.code);
    if (bit === undefined) return;
    e.preventDefault();
    if (!down) return;
    this.held |= bit;
    this.edges |= bit;
  }

  /** État des touches, y compris un appui plus court qu'un tick. */
  sample(): number {
    const m = this.held | this.edges | this.mouse;
    this.edges = 0;
    return m;
  }
}
