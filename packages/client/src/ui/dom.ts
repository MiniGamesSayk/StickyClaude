/** Petits utilitaires DOM (interface de développement : DOM brut, Preact arrive en phase 3). */

type Props<K extends keyof HTMLElementTagNameMap> = Partial<HTMLElementTagNameMap[K]> & {
  class?: string;
  title?: string;
  dataset?: Record<string, string>;
};

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props<K> = {},
  ...children: (Node | string | null | false | undefined)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  const { class: cls, dataset, ...rest } = props;
  if (cls) e.className = cls;
  Object.assign(e, rest);
  if (dataset) for (const [k, v] of Object.entries(dataset)) e.dataset[k] = v;
  for (const c of children) if (c !== null && c !== false && c !== undefined) e.append(c);
  return e;
}

/** Bouton qui rend le focus après le clic : Espace (saut) ne doit pas le redéclencher. */
export function button(
  label: string,
  onClick: () => void,
  opts: { secondary?: boolean; title?: string; disabled?: boolean } = {},
): HTMLButtonElement {
  const b = el('button', {
    type: 'button',
    class: opts.secondary ? 'secondary' : '',
    title: opts.title ?? '',
    disabled: opts.disabled ?? false,
  });
  b.textContent = label;
  b.addEventListener('click', () => {
    onClick();
    b.blur();
  });
  return b;
}

export function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

export function byId<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} manquant`);
  return e as T;
}

/** Lecture / écriture du stockage local, sans jamais lever (mode privé, stockage plein…). */
export function storeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* stockage indisponible : sans importance */
  }
}

export function storeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* idem */
  }
}

/** Formate des secondes en m:ss. */
export function clock(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
