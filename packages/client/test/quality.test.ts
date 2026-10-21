import { describe, expect, it } from 'vitest';
import { FPS_THRESHOLD, PROFILES, QualityController } from '../src/render/quality.ts';

function run(q: QualityController, fps: number, seconds: number): number {
  let changes = 0;
  const dt = 1000 / fps;
  for (let t = 0; t < seconds * 1000; t += dt) if (q.frame(dt)) changes++;
  return changes;
}

describe('QualityController', () => {
  it('reste haut quand les 5 premières secondes tiennent 60 FPS', () => {
    const q = new QualityController(2);
    expect(run(q, 60, 12)).toBe(0);
    expect(q.level).toBe(2);
    expect(q.lastFps).toBeGreaterThan(FPS_THRESHOLD);
  });

  it('baisse d’un cran après 5 s sous 50 FPS, puis encore après chaque fenêtre', () => {
    const q = new QualityController(2);
    expect(run(q, 35, 4.9)).toBe(0);
    expect(run(q, 35, 0.4)).toBe(1);
    expect(q.level).toBe(1);
    expect(run(q, 35, 6.5)).toBe(1);
    expect(q.level).toBe(0);
    expect(run(q, 20, 20)).toBe(0);
    expect(q.level).toBe(0);
  });

  it('ne remonte jamais seul', () => {
    const q = new QualityController(2);
    run(q, 30, 6);
    expect(q.level).toBe(1);
    run(q, 144, 30);
    expect(q.level).toBe(1);
  });

  it('un niveau forcé ignore les mesures', () => {
    const q = new QualityController(2);
    q.setSetting('low');
    expect(run(q, 20, 20)).toBe(0);
    expect(q.level).toBe(0);
    q.setSetting('high');
    expect(q.level).toBe(2);
    q.setSetting('auto');
    expect(q.level).toBe(2);
  });

  it('ignore les images anormalement longues (onglet masqué)', () => {
    const q = new QualityController(2);
    for (let i = 0; i < 100; i++) q.frame(2000);
    expect(q.level).toBe(2);
  });

  it('les profils baissent la résolution, le tremblé et les particules', () => {
    expect(PROFILES[0].dprCap).toBe(1);
    expect(PROFILES[1].dprCap).toBe(1.5);
    expect(PROFILES[0].density).toBeLessThan(PROFILES[2].density);
    expect(PROFILES[0].boilStrokes).toBe(false);
    expect(PROFILES[2].boilTerrain).toBe(true);
    expect(PROFILES[0].terrainVariants).toBe(1);
  });

  it('le départ sur téléphone est le niveau moyen', () => {
    expect(new QualityController(1).level).toBe(1);
  });
});
