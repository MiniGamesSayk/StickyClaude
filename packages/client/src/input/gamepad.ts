import { Input } from '@stickyclaude/shared';

const DEADZONE = 0.35;

/** Manette (mapping standard) : stick ou croix, A saut, X attaque, B parade, Y ramasser. */
export class GamepadInput {
  sample(): number {
    if (typeof navigator.getGamepads !== 'function') return 0;
    let m = 0;
    for (const pad of navigator.getGamepads()) {
      if (!pad?.connected) continue;
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      const b = (i: number): boolean => pad.buttons[i]?.pressed === true;
      if (ax < -DEADZONE || b(14)) m |= Input.LEFT;
      if (ax > DEADZONE || b(15)) m |= Input.RIGHT;
      if (ay < -DEADZONE || b(12)) m |= Input.UP;
      if (ay > DEADZONE || b(13)) m |= Input.DOWN;
      if (b(0)) m |= Input.JUMP;
      if (b(2) || b(7)) m |= Input.ATTACK;
      if (b(1) || b(6)) m |= Input.BLOCK;
      if (b(3)) m |= Input.PICKUP;
    }
    return m;
  }
}
