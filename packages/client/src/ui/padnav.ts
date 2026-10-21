import type { PadNav } from '../input/gamepad.ts';

/**
 * Navigation des menus à la manette (analyse §1.11) : la croix ou le stick déplacent le focus vers
 * l'élément le plus proche dans la direction voulue, A active, B ou Start ferment.
 */

const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]:not(.skip), [role="radio"]:not(:disabled)';

function visible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none';
}

/** Éléments sélectionnables : ceux de la fenêtre ouverte si elle existe, sinon tout `#ui`. */
export function focusables(root: HTMLElement): HTMLElement[] {
  const modal = root.querySelector<HTMLElement>('[aria-modal="true"], [role="alertdialog"]');
  const scope = modal ?? root;
  return [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
}

/** Choisit, parmi `items`, l'élément voisin de `from` dans la direction (dx, dy). */
export function pickNeighbor(
  items: readonly { x: number; y: number }[],
  from: { x: number; y: number },
  dx: number,
  dy: number,
): number {
  let best = -1;
  let bestScore = Infinity;
  items.forEach((c, i) => {
    const vx = c.x - from.x;
    const vy = c.y - from.y;
    const along = vx * dx + vy * dy;
    if (along <= 1) return;
    const across = Math.abs(vx * dy - vy * dx);
    // proche dans la direction, peu écarté sur le côté
    const score = along + across * 2.2;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

export function padNavigate(nav: PadNav): void {
  const root = document.getElementById('ui');
  if (!root) return;
  const active = document.activeElement as HTMLElement | null;
  if (nav.confirm && active && root.contains(active)) {
    active.click();
    return;
  }
  if (nav.back || nav.menu) {
    (active ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }),
    );
    return;
  }
  if (nav.dx === 0 && nav.dy === 0) return;
  const items = focusables(root);
  if (items.length === 0) return;
  if (!active || !items.includes(active)) {
    items[0].focus();
    return;
  }
  const centers = items.map((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const r = active.getBoundingClientRect();
  const i = pickNeighbor(
    centers,
    { x: r.left + r.width / 2, y: r.top + r.height / 2 },
    nav.dx,
    nav.dy,
  );
  if (i >= 0) items[i].focus();
}
