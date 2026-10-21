import { Input } from '@stickyclaude/shared';
import type { Action, Bindings } from '../app/options.ts';
import { ACTIONS, DEFAULT_BINDINGS } from '../app/options.ts';

const BIT: Record<Action, number> = {
  left: Input.LEFT,
  right: Input.RIGHT,
  up: Input.UP,
  down: Input.DOWN,
  jump: Input.JUMP,
  attack: Input.ATTACK,
  block: Input.BLOCK,
  pickup: Input.PICKUP,
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
 * mêmes codes. Les touches sont reconfigurables (`setBindings`) ; la souris sert aussi :
 * clic gauche = attaquer, clic droit = parer (sur le canvas seulement).
 */
export class KeyboardInput {
  private held = 0;
  private edges = 0;
  private keymap = buildKeymap(DEFAULT_BINDINGS);
  private captureCb: ((code: string) => void) | null = null;
  /** Les touches de jeu sont ignorées (menus, saisie de texte). */
  enabled = true;
  private mouse = 0;

  constructor(target: Window) {
    target.addEventListener('keydown', (e) => this.onKey(e, true));
    target.addEventListener('keyup', (e) => this.onKey(e, false));
    target.addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.reset();
    });
    target.addEventListener('pointerdown', (e) => this.onPointer(e, true));
    target.addEventListener('pointerup', (e) => this.onPointer(e, false));
    target.addEventListener('contextmenu', (e) => {
      if (e.target instanceof HTMLCanvasElement) e.preventDefault();
    });
  }

  setBindings(b: Readonly<Bindings>): void {
    this.keymap = buildKeymap(b);
    this.reset();
  }

  /** La prochaine touche pressée est transmise à `cb` au lieu d'agir (reconfiguration). */
  capture(cb: ((code: string) => void) | null): void {
    this.captureCb = cb;
  }

  private reset(): void {
    this.held = 0;
    this.edges = 0;
    this.mouse = 0;
  }

  private onPointer(e: PointerEvent, down: boolean): void {
    if (e.pointerType === 'touch' || !(e.target instanceof HTMLCanvasElement)) return;
    const bit = e.button === 0 ? Input.ATTACK : e.button === 2 ? Input.BLOCK : 0;
    if (bit === 0) return;
    if (down && this.enabled) {
      this.mouse |= bit;
      this.edges |= bit;
    } else this.mouse &= ~bit;
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
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
      cb(e.code);
      return;
    }
    if (!this.enabled) return;
    const bit = this.keymap.get(e.code);
    if (bit === undefined) return;
    e.preventDefault();
    if (down) {
      this.held |= bit;
      this.edges |= bit;
    } else {
      // une touche partagée par deux actions (rare) : on ne relâche que son bit propre
      this.held &= ~bit;
    }
  }

  /** État des touches, y compris un appui plus court qu'un tick. */
  sample(): number {
    const m = this.held | this.edges | this.mouse;
    this.edges = 0;
    return m;
  }
}
