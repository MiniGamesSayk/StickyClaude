import { WORLD_H, WORLD_W } from '@stickyclaude/shared';

/**
 * Caméra dynamique (analyse §2.7) : elle englobe les joueurs vivants avec une marge, le zoom est
 * lissé entre un minimum et un maximum, le cadre reste dans la page, un peu plus serré sur
 * mobile. Pure (aucune dépendance au rendu) : testable sans navigateur.
 */

export interface CameraLimits {
  minZoom: number;
  maxZoom: number;
  /** Marge autour des joueurs (unités de monde). */
  marginX: number;
  marginY: number;
}

export const DESKTOP_LIMITS: CameraLimits = {
  minZoom: 1,
  maxZoom: 1.45,
  marginX: 150,
  marginY: 110,
};
export const MOBILE_LIMITS: CameraLimits = {
  minZoom: 1.18,
  maxZoom: 1.8,
  marginX: 120,
  marginY: 90,
};

/** Constantes de temps du lissage (secondes). */
const TAU_POS = 0.32;
const TAU_ZOOM_IN = 0.55;
const TAU_ZOOM_OUT = 0.22;

export class Camera {
  /** Centre du cadre (monde) et zoom (1 = toute la page visible). */
  x = WORLD_W / 2;
  y = WORLD_H / 2;
  zoom = 1;
  limits: CameraLimits = DESKTOP_LIMITS;
  /** Tremblement : amplitude courante (unités de monde) et déphasage. */
  private shakeAmp = 0;
  private shakeT = 0;
  /** Décalage de tremblement du dernier `update`. */
  shakeX = 0;
  shakeY = 0;
  private targetX = WORLD_W / 2;
  private targetY = WORLD_H / 2;
  private targetZoom = 1;
  private fresh = true;

  /** Cadre cible autour de `n` points (x, y consécutifs dans `pts`). `n = 0` : toute la page. */
  frame(pts: ArrayLike<number>, n: number): void {
    const lim = this.limits;
    if (n <= 0) {
      this.targetX = WORLD_W / 2;
      this.targetY = WORLD_H / 2;
      this.targetZoom = lim.minZoom;
      return;
    }
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = pts[i * 2];
      const y = pts[i * 2 + 1];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    const w = x1 - x0 + 2 * lim.marginX;
    const h = y1 - y0 + 2 * lim.marginY;
    const z = Math.min(WORLD_W / w, WORLD_H / h);
    this.targetZoom = Math.max(lim.minZoom, Math.min(lim.maxZoom, z));
    this.targetX = (x0 + x1) / 2;
    this.targetY = (y0 + y1) / 2;
  }

  /** Cadre imposé (aperçu du stickman de l'accueil), sans tenir compte des limites de zoom. */
  setTarget(x: number, y: number, zoom: number): void {
    this.targetX = x;
    this.targetY = y;
    this.targetZoom = zoom;
  }

  /** Cadre toute la page (salon d'attente, menus). */
  frameAll(): void {
    this.targetX = WORLD_W / 2;
    this.targetY = WORLD_H / 2;
    this.targetZoom = 1;
  }

  /** Secousse d'écran : l'amplitude s'additionne (au plus 8 unités) et s'amortit. */
  shake(amp: number): void {
    this.shakeAmp = Math.min(8, this.shakeAmp + amp);
  }

  /** Remet tout de suite la caméra sur sa cible (changement de manche). */
  snap(): void {
    this.fresh = true;
  }

  /**
   * Avance de `dtS` secondes. `viewW`, `viewH` : taille de l'écran en pixels (pour borner le cadre
   * à la page). `baseScale` : pixels par unité à zoom 1.
   */
  update(
    dtS: number,
    viewW: number,
    viewH: number,
    baseScale: number,
    reducedMotion: boolean,
  ): void {
    if (this.fresh) {
      this.x = this.targetX;
      this.y = this.targetY;
      this.zoom = this.targetZoom;
      this.fresh = false;
    } else {
      const kp = 1 - Math.exp(-dtS / TAU_POS);
      const tz = this.targetZoom < this.zoom ? TAU_ZOOM_OUT : TAU_ZOOM_IN;
      const kz = 1 - Math.exp(-dtS / tz);
      this.x += (this.targetX - this.x) * kp;
      this.y += (this.targetY - this.y) * kp;
      this.zoom += (this.targetZoom - this.zoom) * kz;
    }
    // borne le cadre à la page
    const scale = baseScale * this.zoom;
    const vw = viewW / scale;
    const vh = viewH / scale;
    this.x = vw >= WORLD_W ? WORLD_W / 2 : Math.min(WORLD_W - vw / 2, Math.max(vw / 2, this.x));
    this.y = vh >= WORLD_H ? WORLD_H / 2 : Math.min(WORLD_H - vh / 2, Math.max(vh / 2, this.y));
    // tremblement
    if (reducedMotion) {
      this.shakeAmp = 0;
    } else {
      this.shakeAmp *= Math.exp(-dtS / 0.09);
      if (this.shakeAmp < 0.05) this.shakeAmp = 0;
    }
    this.shakeT += dtS;
    this.shakeX = this.shakeAmp === 0 ? 0 : Math.sin(this.shakeT * 83.1) * this.shakeAmp;
    this.shakeY = this.shakeAmp === 0 ? 0 : Math.cos(this.shakeT * 71.7) * this.shakeAmp;
  }

  /** Rectangle visible (monde) pour un écran donné : x0, y0, x1, y1. */
  visible(viewW: number, viewH: number, baseScale: number, out: Float32Array): void {
    const scale = baseScale * this.zoom;
    const vw = viewW / scale;
    const vh = viewH / scale;
    out[0] = this.x - vw / 2;
    out[1] = this.y - vh / 2;
    out[2] = this.x + vw / 2;
    out[3] = this.y + vh / 2;
  }
}
