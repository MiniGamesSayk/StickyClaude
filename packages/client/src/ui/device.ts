import { options } from '../app/options.ts';
import { isTouchDevice } from '../input/touch.ts';

/** Les contrôles tactiles sont-ils actifs ? (option « toujours », « jamais » ou « sur écran tactile ») */
export function touchActive(): boolean {
  const o = options.value.touch;
  return o === 'on' || (o === 'auto' && isTouchDevice());
}
