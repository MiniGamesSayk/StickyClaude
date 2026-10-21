import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en.ts';
import { fr } from '../src/i18n/fr.ts';
import { detectLang, format, keysOf, setLang, t, tIn } from '../src/i18n/index.ts';
import { FlashLimiter, MIN_FLASH_GAP_MS } from '../src/render/limiter.ts';
import { pickNeighbor } from '../src/ui/padnav.ts';

const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n FR + EN (analyse §1.12)', () => {
  it('les deux langues ont exactement les mêmes clés', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort());
    expect(keysOf('en').length).toBe(keysOf('fr').length);
  });

  it('aucun message vide, et les mêmes {paramètres} dans les deux langues', () => {
    for (const k of Object.keys(fr) as (keyof typeof fr)[]) {
      expect(fr[k].trim(), `fr.${k}`).not.toBe('');
      expect(en[k].trim(), `en.${k}`).not.toBe('');
      expect(placeholders(en[k]), k).toEqual(placeholders(fr[k]));
    }
  });

  it('les deux langues sont bien différentes (pas de texte copié) pour l’essentiel', () => {
    const keys = Object.keys(fr) as (keyof typeof fr)[];
    const same = keys.filter((k) => fr[k] === en[k] && fr[k].length > 8);
    expect(same.length).toBeLessThan(keys.length * 0.05);
  });

  it('FR par défaut, EN si le navigateur n’est pas en français', () => {
    expect(detectLang('fr-FR')).toBe('fr');
    expect(detectLang('fr')).toBe('fr');
    expect(detectLang('en-GB')).toBe('en');
    expect(detectLang('ja')).toBe('en');
    expect(detectLang(undefined)).toBe('fr');
    expect(detectLang('')).toBe('fr');
  });

  it('remplace les paramètres, garde ceux qu’on ne donne pas', () => {
    expect(format('{a} et {b}', { a: 1 })).toBe('1 et {b}');
    expect(tIn('fr', 'round.won', { who: 'Zoé' })).toBe('Zoé gagne la manche');
    expect(tIn('en', 'round.won', { who: 'Zoé' })).toBe('Zoé wins the round');
  });

  it('t() suit la langue courante', () => {
    setLang('en');
    expect(t('home.quick')).toBe('Quick match');
    setLang('fr');
    expect(t('home.quick')).toBe('Partie rapide');
  });
});

describe('flashs (analyse §1.11 : jamais plus de 3 par seconde)', () => {
  it('même avec une demande à chaque image, 3 flashs au plus par seconde glissante', () => {
    const l = new FlashLimiter();
    const times: number[] = [];
    for (let t0 = 0; t0 < 10_000; t0 += 16) if (l.allow(t0)) times.push(t0);
    expect(times.length).toBeGreaterThan(20);
    for (let i = 0; i + 3 < times.length; i++) {
      expect(times[i + 3] - times[i], `fenêtre ${i}`).toBeGreaterThanOrEqual(1000);
    }
    expect(MIN_FLASH_GAP_MS * 3).toBeGreaterThanOrEqual(1000);
  });

  it('rien n’est refusé quand les demandes sont espacées', () => {
    const l = new FlashLimiter();
    expect(l.allow(0)).toBe(true);
    expect(l.allow(400)).toBe(true);
    expect(l.allow(500)).toBe(false);
  });
});

describe('navigation à la manette dans les menus', () => {
  const items = [
    { x: 100, y: 100 },
    { x: 300, y: 100 },
    { x: 100, y: 200 },
    { x: 300, y: 220 },
  ];
  it('choisit le voisin dans la direction demandée', () => {
    expect(pickNeighbor(items, items[0], 1, 0)).toBe(1);
    expect(pickNeighbor(items, items[0], 0, 1)).toBe(2);
    expect(pickNeighbor(items, items[3], -1, 0)).toBe(2);
    expect(pickNeighbor(items, items[3], 0, -1)).toBe(1);
  });
  it('ne bouge pas s’il n’y a personne dans cette direction', () => {
    expect(pickNeighbor(items, items[0], -1, 0)).toBe(-1);
    expect(pickNeighbor(items, items[0], 0, -1)).toBe(-1);
  });
  it('préfère l’élément aligné à celui qui est plus proche mais de côté', () => {
    const grid = [
      { x: 0, y: 0 },
      { x: 60, y: 90 },
      { x: 200, y: 0 },
    ];
    expect(pickNeighbor(grid, grid[0], 1, 0)).toBe(2);
  });
});
