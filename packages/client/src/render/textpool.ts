import type { Container } from 'pixi.js';
import { Text } from 'pixi.js';

const FONT = "'Patrick Hand', 'Comic Sans MS', 'Segoe Print', sans-serif";

/**
 * Réserve de textes réutilisés d'une image à l'autre : `begin()`, puis `get()` autant de fois que
 * nécessaire, puis `end()` masque ceux qui n'ont pas servi (aucune allocation en régime établi).
 */
export class TextPool {
  private readonly items: Text[] = [];
  private used = 0;

  constructor(private readonly parent: Container) {}

  begin(): void {
    this.used = 0;
  }

  /** Texte centré horizontalement ; `bottom` : l'ancre est le bas du texte (sinon le centre). */
  get(text: string, size: number, color: number, bottom = false): Text {
    let t = this.items[this.used];
    if (!t) {
      t = new Text({
        text,
        style: { fontFamily: FONT, fontSize: size, fill: color, align: 'center' },
      });
      this.parent.addChild(t);
      this.items.push(t);
    }
    this.used++;
    t.visible = true;
    t.alpha = 1;
    if (t.text !== text) t.text = text;
    if (t.style.fontSize !== size) t.style.fontSize = size;
    if (t.style.fill !== color) t.style.fill = color;
    t.anchor.set(0.5, bottom ? 1 : 0.5);
    return t;
  }

  end(): void {
    for (let i = this.used; i < this.items.length; i++) this.items[i].visible = false;
  }

  destroy(): void {
    for (const t of this.items) t.destroy();
    this.items.length = 0;
  }
}
