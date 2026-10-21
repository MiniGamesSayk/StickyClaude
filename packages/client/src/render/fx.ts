import { CELL, EMOTES, INK_COLORS, ObjType, SimEvent, TICK_MS } from '@stickyclaude/shared';
import type { Graphics, Text } from 'pixi.js';
import type { GameEvent } from '../net/client.ts';
import type { TextPool } from './textpool.ts';

/** Effets de développement : anneaux, traits, textes flottants. Tout est dessiné dans un Graphics. */

interface Ring {
  kind: 'ring';
  x: number;
  y: number;
  r0: number;
  r1: number;
  color: number;
  life: number;
  max: number;
  fill: boolean;
}

interface Line {
  kind: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: number;
  width: number;
  life: number;
  max: number;
}

interface Pop {
  kind: 'pop';
  x: number;
  y: number;
  text: string;
  color: number;
  size: number;
  vy: number;
  life: number;
  max: number;
}

/** Bulle d'emote qui suit son joueur. */
interface Bubble {
  kind: 'bubble';
  slot: number;
  text: string;
  life: number;
  max: number;
}

interface Cross {
  kind: 'cross';
  x: number;
  y: number;
  color: number;
  life: number;
  max: number;
}

type Fx = Ring | Line | Pop | Bubble | Cross;

const MAX_FX = 160;
export const EXPLOSION_KINDS = ['roquette', 'mine', 'ballon', 'patate', 'caisse'] as const;

export interface FxContext {
  /** Position (pieds) d'un joueur à l'écran, ou null. */
  playerPos(slot: number): { x: number; y: number } | null;
  colorOf(slot: number): number;
}

export class FxLayer {
  private fx: Fx[] = [];

  clear(): void {
    this.fx.length = 0;
  }

  private push(f: Fx): void {
    if (this.fx.length >= MAX_FX) this.fx.shift();
    this.fx.push(f);
  }

  /** Transforme un événement de la simulation en effets visibles. */
  add(e: GameEvent, ctx: FxContext): void {
    const a = e.a;
    switch (e.type) {
      case SimEvent.HIT: {
        // victime = e.slot · x y · attaquant · dégâts · drapeaux (1 fort, 2 paré, 4 mortel)
        const dmg = Math.round(a[3] ?? 0);
        const heavy = ((a[4] ?? 0) & 1) !== 0;
        this.push({
          kind: 'ring',
          x: a[0],
          y: a[1],
          r0: 4,
          r1: heavy ? 26 : 16,
          color: 0xd6322e,
          life: 14,
          max: 14,
          fill: false,
        });
        if (dmg > 0) {
          this.push({
            kind: 'pop',
            x: a[0],
            y: a[1] - 18,
            text: String(dmg),
            color: heavy ? 0xd6322e : 0x22262e,
            size: heavy ? 18 : 13,
            vy: -0.7,
            life: 40,
            max: 40,
          });
        }
        break;
      }
      case SimEvent.KO: {
        this.push({
          kind: 'cross',
          x: a[0],
          y: a[1] - 16,
          color: ctx.colorOf(e.slot),
          life: 90,
          max: 90,
        });
        this.push({
          kind: 'pop',
          x: a[0],
          y: a[1] - 40,
          text: 'KO !',
          color: 0xd6322e,
          size: 22,
          vy: -0.5,
          life: 60,
          max: 60,
        });
        break;
      }
      case SimEvent.BLOCKED: {
        const perfect = (a[3] ?? 0) === 1;
        this.push({
          kind: 'ring',
          x: a[0],
          y: a[1] - 14,
          r0: 6,
          r1: perfect ? 30 : 18,
          color: perfect ? 0xc9a227 : 0x1f4fd1,
          life: perfect ? 20 : 12,
          max: perfect ? 20 : 12,
          fill: perfect,
        });
        this.push({
          kind: 'pop',
          x: a[0],
          y: a[1] - 36,
          text: perfect ? 'PARADE PARFAITE' : 'PARADE',
          color: perfect ? 0xc9a227 : 0x1f4fd1,
          size: perfect ? 15 : 12,
          vy: -0.4,
          life: 40,
          max: 40,
        });
        break;
      }
      case SimEvent.SHOT:
        // tireur · bouche x y · fin x y · arme
        this.push({
          kind: 'line',
          x1: a[0],
          y1: a[1],
          x2: a[2],
          y2: a[3],
          color: 0x22262e,
          width: 1.5,
          life: 6,
          max: 6,
        });
        break;
      case SimEvent.EXPLOSION:
        this.push({
          kind: 'ring',
          x: a[0],
          y: a[1],
          r0: 6,
          r1: Math.max(12, a[2] ?? 30),
          color: a[3] === 3 ? 0x7b3fb5 : 0xe8801a,
          life: 22,
          max: 22,
          fill: true,
        });
        break;
      case SimEvent.TERRAIN:
        this.push({
          kind: 'ring',
          x: (a[0] + 0.5) * CELL,
          y: (a[1] + 0.5) * CELL,
          r0: 4,
          r1: Math.max(10, ((a[2] ?? 0) / 10) * CELL),
          color: 0x9c8a5a,
          life: 16,
          max: 16,
          fill: false,
        });
        break;
      case SimEvent.WEAPON_SPAWN:
        this.push({
          kind: 'ring',
          x: a[0],
          y: a[1] - 6,
          r0: 14,
          r1: 4,
          color: 0x1f4fd1,
          life: 30,
          max: 30,
          fill: false,
        });
        break;
      case SimEvent.SPAWN: {
        this.push({
          kind: 'ring',
          x: a[0],
          y: a[1] - 16,
          r0: 4,
          r1: 24,
          color: ctx.colorOf(e.slot),
          life: 18,
          max: 18,
          fill: false,
        });
        break;
      }
      case SimEvent.EMOTE:
        this.push({
          kind: 'bubble',
          slot: e.slot,
          text: EMOTES[a[0]]?.fr ?? '?',
          life: 120,
          max: 120,
        });
        break;
      case SimEvent.GRAPPLE:
        this.push({
          kind: 'line',
          x1: a[0],
          y1: a[1],
          x2: a[0],
          y2: a[1],
          color: 0x6b7280,
          width: 2,
          life: 4,
          max: 4,
        });
        break;
      case SimEvent.CRATE_BREAK:
        this.push({
          kind: 'ring',
          x: a[0],
          y: a[1] - 8,
          r0: 4,
          r1: 18,
          color: 0x7a4a2b,
          life: 14,
          max: 14,
          fill: false,
        });
        break;
      case SimEvent.GOAL:
        this.push({
          kind: 'pop',
          x: a[1],
          y: a[2] - 20,
          text: 'BUT !',
          color: 0x1f9d55,
          size: 28,
          vy: -0.3,
          life: 90,
          max: 90,
        });
        break;
      case SimEvent.SUDDEN_DEATH:
        this.push({
          kind: 'pop',
          x: 512,
          y: 200,
          text: 'MORT SUBITE',
          color: 0xd6322e,
          size: 30,
          vy: 0,
          life: 120,
          max: 120,
        });
        break;
      case SimEvent.STAMP:
        this.push({
          kind: 'ring',
          x: a[0],
          y: a[1],
          r0: 4,
          r1: 20,
          color: 0x1b2a5e,
          life: 16,
          max: 16,
          fill: true,
        });
        break;
      default:
        break;
    }
  }

  /** Avance d'une image de `dtMs` et dessine. */
  draw(g: Graphics, texts: TextPool, dtMs: number, ctx: FxContext): void {
    g.clear();
    const dt = dtMs / TICK_MS;
    const live: Fx[] = [];
    for (const f of this.fx) {
      f.life -= dt;
      if (f.life <= 0) continue;
      live.push(f);
      const k = 1 - f.life / f.max;
      switch (f.kind) {
        case 'ring': {
          const r = f.r0 + (f.r1 - f.r0) * k;
          if (f.fill) g.circle(f.x, f.y, r).fill({ color: f.color, alpha: 0.35 * (1 - k) });
          g.circle(f.x, f.y, r).stroke({ width: 2, color: f.color, alpha: 1 - k });
          break;
        }
        case 'line':
          g.moveTo(f.x1, f.y1)
            .lineTo(f.x2, f.y2)
            .stroke({ width: f.width, color: f.color, alpha: 1 - k });
          break;
        case 'cross': {
          const s = 10;
          g.moveTo(f.x - s, f.y - s)
            .lineTo(f.x + s, f.y + s)
            .moveTo(f.x + s, f.y - s)
            .lineTo(f.x - s, f.y + s)
            .stroke({ width: 3, color: f.color, alpha: Math.min(1, (1 - k) * 2) });
          break;
        }
        case 'pop': {
          f.y += f.vy * dt;
          const t = texts.get(f.text, f.size, f.color, true);
          t.position.set(f.x, f.y);
          t.alpha = Math.min(1, (1 - k) * 2);
          break;
        }
        case 'bubble': {
          const pos = ctx.playerPos(f.slot);
          if (!pos) break;
          const t = texts.get(f.text, 12, 0x22262e, true);
          t.position.set(pos.x, pos.y - 62);
          t.alpha = Math.min(1, (1 - k) * 4);
          const w = t.width + 10;
          g.roundRect(pos.x - w / 2, pos.y - 62 - 16, w, 18, 6).fill({
            color: 0xffffff,
            alpha: 0.9,
          });
          g.roundRect(pos.x - w / 2, pos.y - 62 - 16, w, 18, 6).stroke({
            width: 1.5,
            color: 0x22262e,
          });
          break;
        }
      }
    }
    this.fx = live;
  }
}

export { INK_COLORS, ObjType };
export type { Text };
