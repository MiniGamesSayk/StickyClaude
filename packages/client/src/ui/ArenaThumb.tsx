import { Cell, GRID_H, GRID_W, parseGrid } from '@stickyclaude/shared';
import type { ArenaData } from '@stickyclaude/shared';
import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { css, themeOf } from '../render/palette.ts';

/** Vignette d'une arène : la grille en miniature, sur le papier du thème. */
export function drawThumb(canvas: HTMLCanvasElement, arena: ArenaData): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const k = canvas.width / GRID_W;
  const cells = parseGrid(arena.grid);
  ctx.fillStyle = css(themeOf(arena.theme).paper);
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const c = cells[y * GRID_W + x];
      if (c === Cell.EMPTY) continue;
      ctx.fillStyle =
        c === Cell.SOLID
          ? '#1b2a5e'
          : c === Cell.PAPER
            ? '#c9a96a'
            : c === Cell.ONEWAY
              ? '#1f4fd1'
              : '#d6322e';
      if (c === Cell.ONEWAY) ctx.fillRect(x * k, y * k, k, Math.max(1, k * 0.35));
      else ctx.fillRect(x * k, y * k, k, k);
    }
  }
  for (const m of arena.movers) {
    ctx.fillStyle = 'rgba(31,79,209,0.6)';
    ctx.fillRect(m.rect[0] * k, m.rect[1] * k, m.rect[2] * k, m.rect[3] * k);
  }
}

export function ArenaThumb(p: { arena: ArenaData; width?: number }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  const w = p.width ?? 128;
  useEffect(() => {
    if (ref.current) drawThumb(ref.current, p.arena);
  }, [p.arena]);
  return (
    <canvas
      ref={ref}
      class="thumb"
      width={w}
      height={Math.round((w * GRID_H) / GRID_W)}
      aria-hidden="true"
    />
  );
}
