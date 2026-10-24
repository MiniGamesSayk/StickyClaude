import { aimSectorOfAngle, withAim } from '@stickyclaude/shared';
import type { Options } from '../app/options.ts';
import { GamepadInput } from './gamepad.ts';
import { KeyboardInput } from './keyboard.ts';
import { touchAimAngle, touchMask } from './touch.ts';

/** Réunit clavier (et souris), manette et tactile en un seul masque d'entrées par image. */
export class InputManager {
  readonly keyboard = new KeyboardInput(window);
  readonly gamepad = new GamepadInput();
  /** Position à l'écran (px de la fenêtre) du joueur local : origine de la visée à la souris. */
  origin: (() => { x: number; y: number } | null) | null = null;

  /**
   * Masque d'entrées de l'image. La visée suit le joystick tactile, puis le stick de la manette,
   * puis la souris ; sans aucun des trois, la simulation vise dans la direction tenue.
   */
  sample(): number {
    const m = this.keyboard.sample() | this.gamepad.sample() | touchMask();
    const a = this.aimAngle();
    return a === null ? m : withAim(m, aimSectorOfAngle(a));
  }

  private aimAngle(): number | null {
    const t = touchAimAngle();
    if (t !== null) return t;
    if (this.gamepad.aimAngle !== null) return this.gamepad.aimAngle;
    const o = this.origin?.();
    return o ? this.keyboard.mouseAngle(o.x, o.y) : null;
  }

  apply(o: Options): void {
    this.keyboard.setBindings(o.bindings);
    this.gamepad.rumbleEnabled = o.padRumble;
    this.gamepad.bindings = o.padBindings;
  }
}
