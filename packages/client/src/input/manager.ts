import type { Options } from '../app/options.ts';
import { GamepadInput } from './gamepad.ts';
import { KeyboardInput } from './keyboard.ts';
import { touchMask } from './touch.ts';

/** Réunit clavier (et souris), manette et tactile en un seul masque d'entrées par image. */
export class InputManager {
  readonly keyboard = new KeyboardInput(window);
  readonly gamepad = new GamepadInput();

  sample(): number {
    return this.keyboard.sample() | this.gamepad.sample() | touchMask();
  }

  apply(o: Options): void {
    this.keyboard.setBindings(o.bindings);
    this.gamepad.rumbleEnabled = o.padRumble;
  }
}
