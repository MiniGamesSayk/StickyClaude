import { ARENAS, LOBBY_ARENA_ID, ROTATION_ARENA_IDS } from '@stickyclaude/shared';
import { parseArena } from '@stickyclaude/shared/schemas';
import { describe, expect, it } from 'vitest';
import { analyzeArena } from '../src/index.ts';

describe('les 10 arènes de l analyse', () => {
  it('il y en a dix, aux noms et thèmes distincts, plus l arène d entraînement', () => {
    expect(ROTATION_ARENA_IDS).toHaveLength(10);
    expect(new Set(ROTATION_ARENA_IDS).size).toBe(10);
    const themes = new Set(ROTATION_ARENA_IDS.map((id) => ARENAS[id].theme));
    expect(themes.size).toBe(10);
    for (const id of ROTATION_ARENA_IDS) {
      const a = ARENAS[id];
      expect(a.id).toBe(id);
      expect(a.name.fr.length).toBeGreaterThan(2);
      expect(a.name.en.length).toBeGreaterThan(2);
    }
    expect(ARENAS[LOBBY_ARENA_ID]).toBeDefined();
    expect(ROTATION_ARENA_IDS).not.toContain(LOBBY_ARENA_ID);
  });

  it('les deux types de mort subite sont utilisés', () => {
    const kinds = new Set(ROTATION_ARENA_IDS.map((id) => ARENAS[id].suddenDeath));
    expect(kinds).toEqual(new Set(['ink-rise', 'tear-edges']));
  });

  it('chaque arène déclare une colline et des cages : tous les modes bonus y sont jouables', () => {
    for (const id of [...ROTATION_ARENA_IDS, LOBBY_ARENA_ID]) {
      const a = ARENAS[id];
      expect(a.modes?.koth, id).toBeDefined();
      expect(a.modes?.ball, id).toBeDefined();
    }
  });

  for (const id of [LOBBY_ARENA_ID, ...ROTATION_ARENA_IDS]) {
    describe(id, () => {
      it('respecte le schéma', () => {
        expect(() => parseArena(ARENAS[id])).not.toThrow();
      });

      it('passe le test d accessibilité par simulation (§2.6)', () => {
        const r = analyzeArena(ARENAS[id]);
        expect(r.errors).toEqual([]);
        expect(r.standing).toBeGreaterThan(80);
        expect(r.reachable).toBeGreaterThan(80);
      });
    });
  }

  it('l analyse détecte les arènes cassées', () => {
    const broken = structuredClone(ARENAS['maths-quadrille']);
    // un point d'apparition emmuré, une arme dans le vide, une zone de colline inatteignable
    const rows = broken.grid.map((r) => r.split(''));
    for (let y = 26; y <= 32; y++) for (let x = 12; x <= 16; x++) rows[y][x] = '#';
    broken.grid = rows.map((r) => r.join(''));
    const r1 = analyzeArena(broken);
    expect(r1.errors.length).toBeGreaterThan(0);

    const voidWeapon = structuredClone(ARENAS['double-page']);
    voidWeapon.spawns.weapons = [[31, 20]];
    expect(analyzeArena(voidWeapon).errors.join(' ')).toContain('vide');

    const tooFew = structuredClone(ARENAS['partition']);
    tooFew.spawns.players = tooFew.spawns.players.slice(0, 5);
    expect(analyzeArena(tooFew).errors.join(' ')).toContain('au moins');

    const noZone = structuredClone(ARENAS['partition']);
    noZone.modes = { koth: { zone: [4, 2, 6, 3] } };
    expect(analyzeArena(noZone).errors.join(' ')).toContain('colline');
  });
});
