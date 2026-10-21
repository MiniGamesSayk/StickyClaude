import { ARENAS, INK_COLORS } from '@stickyclaude/shared';
import { describe, expect, it } from 'vitest';
import { contrast, legibleInk, THEMES, themeOf, UI } from '../src/render/palette.ts';

describe('palette (docs/DIRECTION_ARTISTIQUE.md §2)', () => {
  it('le texte de l’interface respecte WCAG AA (≥ 4,5 : 1)', () => {
    const pairs: [string, number, number][] = [
      ['encre sur papier', UI.ink, UI.paper],
      ['encre sur champ', UI.ink, UI.paper2],
      ['encre douce sur papier', UI.inkSoft, UI.paper],
      ['encre douce sur champ', UI.inkSoft, UI.paper2],
      ['blanc sur bouton', UI.onAccent, UI.accent],
      ['danger sur papier', UI.danger, UI.paper],
      ['succès sur papier', UI.ok, UI.paper],
      ['or sur papier', UI.gold, UI.paper],
    ];
    for (const [name, fg, bg] of pairs) {
      expect(contrast(fg, bg), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('les 12 encres de joueur, assombries au besoin, se lisent sur chaque papier (≥ 3 : 1)', () => {
    for (const [id, th] of Object.entries(THEMES)) {
      for (const ink of INK_COLORS) {
        const shown = legibleInk(ink, th.paper, 3);
        expect(contrast(shown, th.paper), `${id} #${ink.toString(16)}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('l’assombrissement garde les encres déjà lisibles et la teinte des autres', () => {
    expect(legibleInk(0x1b2a5e, 0xf8f4e6)).toBe(0x1b2a5e);
    const gold = legibleInk(0xc9a227, 0xf8f4e6);
    expect(gold).not.toBe(0xc9a227);
    expect((gold >> 16) & 255).toBeGreaterThan(gold & 255);
  });

  it('le texte de score dans une encre reste lisible sur les cartes (≥ 4,5 : 1)', () => {
    for (const ink of INK_COLORS) {
      expect(contrast(legibleInk(ink, UI.paper, 4.5), UI.paper)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('chaque arène a un papier', () => {
    for (const a of Object.values(ARENAS)) {
      expect(THEMES[a.theme], `${a.id} : ${a.theme}`).toBeDefined();
      expect(themeOf(a.theme)).toBe(THEMES[a.theme]);
    }
  });

  it('un thème inconnu retombe sur le papier de base', () => {
    expect(themeOf('inconnu').ruling).toBe('grid');
  });
});
