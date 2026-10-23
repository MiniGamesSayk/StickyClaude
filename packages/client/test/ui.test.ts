import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TRAIL_STEP_S, TrailGate } from '../src/render/trailGate.ts';
import { roomFull, submitAllowed } from '../src/ui/guards.ts';

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

describe('validations de l’accueil', () => {
  it('pas de second envoi pendant une connexion, ni sur une touche répétée', () => {
    expect(submitAllowed('idle')).toBe(true);
    expect(submitAllowed('connecting')).toBe(false);
    expect(submitAllowed('idle', true)).toBe(false);
    expect(submitAllowed('reconnecting')).toBe(true);
  });

  it('un salon d’attente plein ne se rejoint pas, une partie pleine se regarde', () => {
    expect(roomFull({ players: 8, maxPlayers: 8, phase: 'lobby' })).toBe(true);
    expect(roomFull({ players: 7, maxPlayers: 8, phase: 'lobby' })).toBe(false);
    expect(roomFull({ players: 8, maxPlayers: 8, phase: 'playing' })).toBe(false);
  });
});

describe('traînées de projectiles', () => {
  const emitted = (fps: number, seconds: number): number => {
    const gate = new TrailGate();
    let n = 0;
    for (let t = 0; t < seconds * fps; t++) {
      if (gate.open) n++; // les traînées de cette image partent avant `advance`
      gate.advance(1 / fps);
    }
    return n / seconds;
  };

  it('au plus 60 par seconde quel que soit le nombre d’images', () => {
    expect(emitted(144, 5)).toBeLessThanOrEqual(60 + 1);
    expect(emitted(240, 5)).toBeLessThanOrEqual(60 + 1);
    expect(emitted(60, 5)).toBeGreaterThan(50);
  });

  it('à 30 images par seconde, une image sur deux au moins est émise', () => {
    const rate = emitted(30, 5);
    expect(rate).toBeGreaterThan(25);
    expect(rate).toBeLessThanOrEqual(31);
    expect(TRAIL_STEP_S).toBeCloseTo(1 / 60, 6);
  });
});

describe('feuille de style tactile', () => {
  it('le survol des boutons n’anime que les appareils qui survolent', () => {
    const at = css.indexOf('.btn:hover:not(:disabled)');
    expect(at).toBeGreaterThan(0);
    const before = css.slice(css.lastIndexOf('@media', at), at);
    expect(before).toContain('hover: hover');
  });

  it('les boutons tactiles font au moins 44 px (2,75 rem)', () => {
    const block = (sel: string): string => {
      const i = css.indexOf(`${sel} {`);
      expect(i, sel).toBeGreaterThan(0);
      return css.slice(i, css.indexOf('}', i));
    };
    expect(block('.tsmall .btn')).toContain('min-height: 2.75rem');
    for (const b of ['.tbtn.pickup', '.tbtn.dash', '.tbtn.crouch']) {
      expect(block(b)).toContain('max(2.75rem');
    }
  });
});
