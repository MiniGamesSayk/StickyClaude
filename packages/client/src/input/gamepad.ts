import { Input } from '@stickyclaude/shared';

const DEADZONE = 0.35;
const ACTIONS = Input.JUMP | Input.ATTACK | Input.BLOCK | Input.PICKUP | Input.DASH;
/** Inclinaison minimale du stick pour viser dans sa direction. */
const AIM_DEADZONE = 0.4;

/** Un déplacement dans les menus ou un bouton de menu. */
export interface PadNav {
  dx: number;
  dy: number;
  confirm: boolean;
  back: boolean;
  menu: boolean;
}

interface Rumble {
  playEffect?: (
    type: string,
    params: { duration: number; strongMagnitude: number; weakMagnitude: number },
  ) => Promise<unknown>;
}

/**
 * Manette (mapping standard) : stick ou croix, A saut, X ou gâchette droite attaque, B ou gâchette
 * gauche parade, Y ramasser, Start menu. Détection à chaud, vibration sur les gros impacts
 * (`vibrationActuator`), navigation des menus (croix, A, B).
 */
export class GamepadInput {
  /** Une manette est branchée. */
  connected = false;
  /** Vibration autorisée (option). */
  rumbleEnabled = true;
  /** Direction du stick (radians, 0 = droite, y vers le bas) tant qu'il est incliné, sinon null. */
  aimAngle: number | null = null;
  private lastNav = 0;
  private navHeld = false;
  private prevButtons = 0;
  /**
   * Boutons d'action « armés » : vus relâchés depuis la dernière remise à zéro. Un bouton resté
   * enfoncé depuis les menus (A, B) ou qui ment (gâchette qui lit « pressée » au repos) est ignoré
   * tant qu'il n'a pas été relâché, au lieu de laisser le personnage en parade.
   */
  private armed = 0;
  private readonly nav: PadNav = { dx: 0, dy: 0, confirm: false, back: false, menu: false };

  private pads(): Gamepad[] {
    if (typeof navigator.getGamepads !== 'function') return [];
    const out: Gamepad[] = [];
    for (const p of navigator.getGamepads()) if (p?.connected) out.push(p);
    return out;
  }

  /** Les boutons d'action actuellement tenus ne comptent plus tant qu'ils ne sont pas relâchés. */
  disarm(): void {
    this.armed = 0;
  }

  sample(): number {
    let m = 0;
    const pads = this.pads();
    this.connected = pads.length > 0;
    this.aimAngle = null;
    for (const pad of pads) {
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      if (Math.hypot(ax, ay) > AIM_DEADZONE) this.aimAngle = Math.atan2(ay, ax);
      const b = (i: number): boolean => pad.buttons[i]?.pressed === true;
      // Gâchettes (analogiques) : un appui net, pas un simple frémissement.
      const trig = (i: number): boolean => {
        const btn = pad.buttons[i];
        return btn !== undefined && btn.pressed && btn.value > 0.5;
      };
      if (ax < -DEADZONE || b(14)) m |= Input.LEFT;
      if (ax > DEADZONE || b(15)) m |= Input.RIGHT;
      if (ay < -DEADZONE || b(12)) m |= Input.UP;
      if (ay > DEADZONE || b(13)) m |= Input.DOWN;
      if (b(0)) m |= Input.JUMP;
      if (b(2) || trig(7)) m |= Input.ATTACK;
      if (b(1) || trig(6)) m |= Input.BLOCK;
      if (b(3) || b(5)) m |= Input.PICKUP;
      if (b(4)) m |= Input.DASH;
    }
    if (pads.length === 0) this.armed = 0;
    this.armed |= ~m & ACTIONS;
    return (m & ~ACTIONS) | (m & this.armed);
  }

  /**
   * Navigation des menus : retourne un déplacement (avec répétition : 350 ms puis 140 ms) ou un
   * bouton pressé, sinon null. À appeler à chaque image quand un menu est affiché.
   */
  navigate(nowMs: number): PadNav | null {
    const pads = this.pads();
    if (pads.length === 0) return null;
    let dx = 0;
    let dy = 0;
    let buttons = 0;
    for (const pad of pads) {
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      const b = (i: number): boolean => pad.buttons[i]?.pressed === true;
      if (ax < -0.5 || b(14)) dx = -1;
      if (ax > 0.5 || b(15)) dx = 1;
      if (ay < -0.5 || b(12)) dy = -1;
      if (ay > 0.5 || b(13)) dy = 1;
      if (b(0)) buttons |= 1;
      if (b(1)) buttons |= 2;
      if (b(9)) buttons |= 4;
    }
    const n = this.nav;
    n.dx = 0;
    n.dy = 0;
    n.confirm = (buttons & 1) !== 0 && (this.prevButtons & 1) === 0;
    n.back = (buttons & 2) !== 0 && (this.prevButtons & 2) === 0;
    n.menu = (buttons & 4) !== 0 && (this.prevButtons & 4) === 0;
    this.prevButtons = buttons;
    if (dx !== 0 || dy !== 0) {
      const wait = this.navHeld ? 140 : 350;
      if (nowMs - this.lastNav >= wait) {
        n.dx = dx;
        n.dy = dy;
        this.lastNav = nowMs;
        this.navHeld = true;
      }
    } else this.navHeld = false;
    return n.dx !== 0 || n.dy !== 0 || n.confirm || n.back || n.menu ? n : null;
  }

  /** Fait vibrer la manette (intensité 0 à 1, durée en ms). */
  rumble(strength: number, ms: number): void {
    if (!this.rumbleEnabled) return;
    for (const pad of this.pads()) {
      try {
        const act = (pad as unknown as { vibrationActuator?: Rumble }).vibrationActuator;
        void act?.playEffect?.('dual-rumble', {
          duration: ms,
          strongMagnitude: Math.min(1, strength),
          weakMagnitude: Math.min(1, strength * 0.6),
        });
      } catch {
        /* pas de vibration sur cette manette */
      }
    }
  }
}
