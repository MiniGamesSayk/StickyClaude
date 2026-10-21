import { WORLD_H, WORLD_W } from '@stickyclaude/shared';
import { describe, expect, it } from 'vitest';
import { Camera, DESKTOP_LIMITS, MOBILE_LIMITS } from '../src/render/camera.ts';

const VIEW_W = 1280;
const VIEW_H = 720;
const BASE = Math.min(VIEW_W / WORLD_W, VIEW_H / WORLD_H);

function settle(c: Camera, seconds = 4): void {
  for (let i = 0; i < seconds * 60; i++) c.update(1 / 60, VIEW_W, VIEW_H, BASE, false);
}

describe('Camera', () => {
  it('sans joueur, cadre toute la page', () => {
    const c = new Camera();
    c.frame([], 0);
    c.snap();
    settle(c);
    expect(c.zoom).toBeCloseTo(1, 2);
    expect(c.x).toBeCloseTo(WORLD_W / 2, 1);
    expect(c.y).toBeCloseTo(WORLD_H / 2, 1);
  });

  it('deux joueurs proches : zoom plafonné, centré entre eux, dans la page', () => {
    const c = new Camera();
    c.frame([500, 300, 540, 300], 2);
    c.snap();
    settle(c);
    expect(c.zoom).toBeCloseTo(DESKTOP_LIMITS.maxZoom, 2);
    expect(c.x).toBeGreaterThan(450);
    expect(c.x).toBeLessThan(560);
  });

  it('joueurs aux deux bouts : on dézoome au minimum', () => {
    const c = new Camera();
    c.frame([40, 500, 980, 100], 2);
    c.snap();
    settle(c);
    expect(c.zoom).toBeCloseTo(DESKTOP_LIMITS.minZoom, 2);
  });

  it('ne sort jamais de la page, même avec un joueur au coin', () => {
    const c = new Camera();
    c.frame([10, 10, 30, 30], 2);
    c.snap();
    settle(c);
    const v = new Float32Array(4);
    c.visible(VIEW_W, VIEW_H, BASE, v);
    expect(v[0]).toBeGreaterThanOrEqual(-0.01);
    expect(v[1]).toBeGreaterThanOrEqual(-0.01);
    expect(v[2]).toBeLessThanOrEqual(WORLD_W + 0.01);
    expect(v[3]).toBeLessThanOrEqual(WORLD_H + 0.01);
  });

  it('le zoom est lissé : une grande cible ne fait pas sauter le cadre', () => {
    const c = new Camera();
    c.frame([500, 300, 540, 300], 2);
    c.snap();
    settle(c);
    const z0 = c.zoom;
    c.frame([40, 500, 980, 100], 2);
    c.update(1 / 60, VIEW_W, VIEW_H, BASE, false);
    expect(Math.abs(c.zoom - z0)).toBeLessThan(0.06);
  });

  it('un écran large montre la page centrée sans zoom', () => {
    const c = new Camera();
    c.frame([], 0);
    c.snap();
    c.update(1 / 60, 2560, 720, Math.min(2560 / WORLD_W, 720 / WORLD_H), false);
    expect(c.x).toBeCloseTo(WORLD_W / 2, 1);
  });

  it('mobile : plus serré qu’au bureau', () => {
    expect(MOBILE_LIMITS.minZoom).toBeGreaterThan(DESKTOP_LIMITS.minZoom);
    expect(MOBILE_LIMITS.maxZoom).toBeGreaterThan(DESKTOP_LIMITS.maxZoom);
    const c = new Camera();
    c.limits = MOBILE_LIMITS;
    c.frame([40, 500, 980, 100], 2);
    c.snap();
    settle(c);
    expect(c.zoom).toBeCloseTo(MOBILE_LIMITS.minZoom, 2);
  });

  it('la secousse s’amortit et disparaît ; elle est coupée en mouvement réduit', () => {
    const c = new Camera();
    c.shake(6);
    c.update(1 / 60, VIEW_W, VIEW_H, BASE, false);
    expect(Math.abs(c.shakeX) + Math.abs(c.shakeY)).toBeGreaterThan(0);
    settle(c, 1);
    expect(c.shakeX).toBe(0);
    c.shake(6);
    c.update(1 / 60, VIEW_W, VIEW_H, BASE, true);
    expect(c.shakeX).toBe(0);
    expect(c.shakeY).toBe(0);
  });

  it('plafonne la secousse cumulée', () => {
    const c = new Camera();
    for (let i = 0; i < 10; i++) c.shake(5);
    c.update(0, VIEW_W, VIEW_H, BASE, false);
    expect(Math.hypot(c.shakeX, c.shakeY)).toBeLessThanOrEqual(8 * Math.SQRT2 + 1e-6);
  });
});
