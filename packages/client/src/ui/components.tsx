import { INK_COLORS } from '@stickyclaude/shared';
import type { ComponentChildren, JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { legibleInk } from '../render/palette.ts';

/** Petits composants d'interface : bouton, case, curseur, choix, pastille d'encre, bâtons de comptage. */

export function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

interface ButtonProps {
  children: ComponentChildren;
  onClick: () => void;
  secondary?: boolean;
  small?: boolean;
  block?: boolean;
  disabled?: boolean;
  title?: string;
  label?: string;
  class?: string;
  pressed?: boolean;
}

/** Bouton qui rend le focus après le clic : Espace (saut) ne doit pas le redéclencher. */
export function Button(p: ButtonProps): JSX.Element {
  const cls = `btn${p.secondary ? ' secondary' : ''}${p.small ? ' small' : ''}${p.block ? ' block' : ''}${p.class ? ` ${p.class}` : ''}`;
  return (
    <button
      type="button"
      class={cls}
      disabled={p.disabled}
      title={p.title}
      aria-label={p.label}
      aria-pressed={p.pressed}
      onClick={(e) => {
        p.onClick();
        e.currentTarget.blur();
      }}
    >
      {p.children}
    </button>
  );
}

export function Check(p: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <label class="check">
      <input
        type="checkbox"
        checked={p.checked}
        disabled={p.disabled}
        onChange={(e) => {
          p.onChange(e.currentTarget.checked);
          e.currentTarget.blur();
        }}
      />
      <span>{p.label}</span>
    </label>
  );
}

export function Slider(p: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}): JSX.Element {
  return (
    <label>
      <span class="row" style={{ justifyContent: 'space-between' }}>
        <span>{p.label}</span>
        <span class="hint">{p.format ? p.format(p.value) : String(p.value)}</span>
      </span>
      <input
        type="range"
        min={p.min}
        max={p.max}
        step={p.step}
        value={p.value}
        onInput={(e) => p.onChange(Number(e.currentTarget.value))}
      />
    </label>
  );
}

export function Select<T extends string | number>(p: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <label>
      <span>{p.label}</span>
      <select
        value={String(p.value)}
        disabled={p.disabled}
        onChange={(e) => {
          const raw = e.currentTarget.value;
          const found = p.options.find((o) => String(o.value) === raw);
          if (found) p.onChange(found.value);
          e.currentTarget.blur();
        }}
      >
        {p.options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Groupe de choix exclusifs (boutons radio en forme de pastilles). */
export function Choice<T extends string | number>(p: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}): JSX.Element {
  return (
    <div role="radiogroup" aria-label={p.label} class="field">
      <span>{p.label}</span>
      <div class="chips">
        {p.options.map((o) => (
          <button
            type="button"
            key={String(o.value)}
            role="radio"
            aria-checked={o.value === p.value}
            class={`chip${o.value === p.value ? ' on' : ''}`}
            onClick={(e) => {
              p.onChange(o.value);
              e.currentTarget.blur();
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Pastilles des 12 encres : uniquement la couleur. */
export function Swatches(p: {
  value: number;
  onChange: (i: number) => void;
  label: (i: number) => string;
  /** Encres déjà prises (grisées) dans le salon. */
  taken?: ReadonlySet<number>;
}): JSX.Element {
  return (
    <div class="swatches" role="radiogroup">
      {INK_COLORS.map((c, i) => (
        <button
          type="button"
          key={i}
          role="radio"
          aria-checked={i === p.value}
          aria-label={p.label(i)}
          title={p.label(i)}
          class={`swatch${i === p.value ? ' on' : ''}`}
          style={{ background: hex(c) }}
          onClick={(e) => {
            p.onChange(i);
            e.currentTarget.blur();
          }}
        />
      ))}
    </div>
  );
}

/** Points de vie en petits traits (10 bâtons). */
export function HpBar(p: { hp: number }): JSX.Element {
  const hp = Math.max(0, Math.min(100, p.hp));
  const filled = Math.ceil(hp / 10);
  const cls = hp > 50 ? '' : hp > 25 ? ' mid' : ' low';
  return (
    <span class={`hpbar${cls}`} role="img" aria-label={`${hp}`}>
      {Array.from({ length: 10 }, (_, i) => (
        <i key={i} class={i < filled ? 'on' : ''} />
      ))}
    </span>
  );
}

/**
 * Score en bâtons de comptage (groupes de quatre traits barrés d'un cinquième). `goal` dessine en
 * pointillé les manches restantes.
 */
export function Tally(p: { n: number; goal: number; color: string; label: string }): JSX.Element {
  const w = 8;
  const items: JSX.Element[] = [];
  let x = 4;
  for (let i = 0; i < p.n; i++) {
    const inGroup = i % 5;
    if (inGroup === 4) {
      // le cinquième barre le groupe
      items.push(
        <path
          key={i}
          d={`M${x - 4 * w - 3} 18 L${x - 1} 3`}
          stroke={p.color}
          stroke-width="2.4"
          stroke-linecap="round"
          fill="none"
        />,
      );
      x += 4;
    } else {
      const j = ((i * 37) % 5) - 2;
      items.push(
        <path
          key={i}
          d={`M${x + j * 0.4} 2 L${x - j * 0.3} 18`}
          stroke={p.color}
          stroke-width="2.4"
          stroke-linecap="round"
          fill="none"
        />,
      );
      x += w;
    }
  }
  const remaining = Math.max(0, p.goal - p.n);
  const ghosts: JSX.Element[] = [];
  let gx = x;
  for (let i = 0; i < Math.min(remaining, 7); i++) {
    ghosts.push(<circle key={`g${i}`} cx={gx + 2} cy={11} r="1.4" fill={p.color} opacity="0.35" />);
    gx += w;
  }
  const width = Math.max(40, gx + 6);
  return (
    <svg class="tally" viewBox={`0 0 ${width} 20`} width={width} role="img" aria-label={p.label}>
      {items}
      {ghosts}
    </svg>
  );
}

/** Coche tracée à la main. */
export function CheckMark(): JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      fill="none"
      stroke-width="3"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M3 11 L8 16 L18 3" />
    </svg>
  );
}

/** Couleur d'encre lisible sur le papier des cartes pour du texte. */
export function inkText(color: number): string {
  return hex(legibleInk(color, 0xfbf7ea, 4.5));
}

/** Verrouille le focus dans une boîte modale (Tab boucle, Échap appelle `onClose`). */
export function Modal(p: {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  wide?: boolean;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      p.onClose();
      return;
    }
    if (e.key !== 'Tab' || !ref.current) return;
    const focusables = ref.current.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  return (
    <div
      class="scrim"
      onKeyDown={onKey}
      onClick={(e) => {
        if (e.target === e.currentTarget) p.onClose();
      }}
    >
      <div
        class={`card ${p.wide ? 'wide' : 'narrow'}`}
        role="dialog"
        aria-modal="true"
        aria-label={p.title}
        ref={(el) => {
          (ref as { current: HTMLDivElement | null }).current = el;
          if (el && !el.contains(document.activeElement)) {
            const f = el.querySelector<HTMLElement>('button, input, select');
            f?.focus();
          }
        }}
      >
        {p.children}
      </div>
    </div>
  );
}
