import { Input } from '@stickyclaude/shared';

/**
 * Touches par position physique (`event.code`) : WASD sur QWERTY et ZQSD sur AZERTY donnent les
 * mêmes codes, donc le même jeu de touches sur toutes les dispositions.
 */
const KEYMAP: Record<string, number> = {
  KeyA: Input.LEFT,
  ArrowLeft: Input.LEFT,
  KeyD: Input.RIGHT,
  ArrowRight: Input.RIGHT,
  KeyW: Input.UP,
  ArrowUp: Input.UP,
  KeyS: Input.DOWN,
  ArrowDown: Input.DOWN,
  Space: Input.JUMP,
  KeyJ: Input.ATTACK,
  KeyK: Input.BLOCK,
  KeyL: Input.PICKUP,
};

export class KeyboardInput {
  private held = 0;
  private edges = 0;

  constructor(target: Window) {
    target.addEventListener('keydown', (e) => this.onKey(e, true));
    target.addEventListener('keyup', (e) => this.onKey(e, false));
    target.addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.reset();
    });
  }

  private reset(): void {
    this.held = 0;
    this.edges = 0;
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
    const bit = KEYMAP[e.code];
    if (bit === undefined) return;
    e.preventDefault();
    if (down) {
      this.held |= bit;
      this.edges |= bit;
    } else {
      this.held &= ~bit;
    }
  }

  /** État des touches, y compris un appui plus court qu'un tick. */
  sample(): number {
    const m = this.held | this.edges;
    this.edges = 0;
    return m;
  }
}
