import { Input } from '@stickyclaude/shared';
import { signal } from '@preact/signals';

/**
 * État des contrôles tactiles (analyse §1.6) : un joystick virtuel à 8 directions et quatre
 * boutons. Le composant d'interface (`ui/TouchControls.tsx`) alimente ces fonctions avec les
 * événements `pointer` ; le gestionnaire d'entrées lit `touchMask()` à chaque image.
 */

/** Rayon du joystick en pixels CSS (à taille 1). */
export const STICK_RADIUS = 56;
const DEAD = 0.28;

let stickBits = 0;
let buttonBits = 0;
let edge = 0;
/** Angle du pouce (radians, 0 = droite, y vers le bas) tant que le joystick est sorti de sa zone morte. */
let stickAng: number | null = null;

/** Position du pouce par rapport au centre du joystick (pour dessiner la boule), −1 à 1. */
export const stick = signal({ x: 0, y: 0, active: false });

/** Convertit un déplacement (px) en bits de direction ; 8 directions, zone morte. */
export function stickToBits(dx: number, dy: number, radius = STICK_RADIUS): number {
  const len = Math.hypot(dx, dy);
  if (len < radius * DEAD) return 0;
  const ang = Math.atan2(dy, dx);
  // secteurs de 45° : droite, bas-droite, bas, bas-gauche, gauche, haut-gauche, haut, haut-droite
  const sector = Math.round(ang / (Math.PI / 4));
  const s = ((sector % 8) + 8) % 8;
  let m = 0;
  if (s === 0 || s === 1 || s === 7) m |= Input.RIGHT;
  if (s === 3 || s === 4 || s === 5) m |= Input.LEFT;
  if (s === 1 || s === 2 || s === 3) m |= Input.DOWN;
  if (s === 5 || s === 6 || s === 7) m |= Input.UP;
  return m;
}

export function setStick(dx: number, dy: number, active: boolean, radius = STICK_RADIUS): void {
  stickBits = active ? stickToBits(dx, dy, radius) : 0;
  stickAng = active && Math.hypot(dx, dy) >= radius * DEAD ? Math.atan2(dy, dx) : null;
  const len = Math.hypot(dx, dy) || 1;
  const k = Math.min(1, len / radius);
  stick.value = { x: active ? (dx / len) * k : 0, y: active ? (dy / len) * k : 0, active };
}

/** Un bouton est enfoncé (`down`) ou relâché ; un appui court compte au moins un échantillon. */
export function setButton(bit: number, down: boolean): void {
  if (down) {
    buttonBits |= bit;
    edge |= bit;
  } else buttonBits &= ~bit;
}

/** Masque d'entrées tactiles de l'image courante. */
export function touchMask(): number {
  const m = stickBits | buttonBits | edge;
  edge = 0;
  return m;
}

/** Direction de visée du joystick (radians), ou null s'il est au repos. */
export function touchAimAngle(): number | null {
  return stickAng;
}

export function resetTouch(): void {
  stickAng = null;
  stickBits = 0;
  buttonBits = 0;
  edge = 0;
  stick.value = { x: 0, y: 0, active: false };
}

/** Vrai sur un appareil dont le pointeur principal est tactile. */
export function isTouchDevice(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(pointer: coarse)').matches === true ||
      (typeof navigator !== 'undefined' &&
        navigator.maxTouchPoints > 1 &&
        !window.matchMedia?.('(pointer: fine)').matches))
  );
}

/** Vibration du téléphone (désactivable). */
export function vibrate(ms: number | number[]): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(ms);
  } catch {
    /* non pris en charge */
  }
}
