import { signal } from '@preact/signals';
import { Input } from '@stickyclaude/shared';

/**
 * Mode défense : la parade est un état qu'on bascule (clic molette, touche, bouton de la manette
 * ou de l'écran), pas un bouton qu'on tient. Tant qu'il est actif, `Input.BLOCK` est envoyé à
 * chaque image ; la simulation lève la garde dans la direction de la visée, et ignore le mode
 * quand le personnage tient une arme. Un seul état partagé par toutes les sources d'entrées.
 */
export const defense = signal(false);

export function toggleDefense(): void {
  defense.value = !defense.value;
}

export function setDefense(on: boolean): void {
  if (defense.value !== on) defense.value = on;
}

/** Bit d'entrée du mode défense. */
export function defenseMask(): number {
  return defense.value ? Input.BLOCK : 0;
}
