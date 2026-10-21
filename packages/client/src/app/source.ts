import type { SfxName } from '../audio/engine.ts';
import type { GameEvent } from '../net/client.ts';
import type { Scene } from '../render/types.ts';

/**
 * Une source de scène : le jeu en ligne (réseau, prédiction, interpolation), l'entraînement solo
 * (simulation locale) ou l'aperçu de l'accueil. La boucle de rendu ne connaît que ceci.
 */
export interface RenderSource {
  /** Avance d'une image avec les entrées du moment (masque de touches). */
  update(input: number, nowMs: number, dtMs: number): void;
  /** La scène à dessiner (objet réutilisé d'une image à l'autre). */
  readonly scene: Scene;
  /** Emplacement du joueur local, −1 s'il n'y en a pas. */
  readonly self: number;
  /** Libère les ressources (connexion…). */
  dispose(): void;
}

/** Ce que les sources envoient au son : événements de la simulation et mouvements locaux. */
export interface AudioSink {
  /** Événement de simulation ; `own` : emplacement du joueur local (pour la stéréo et le volume). */
  event(e: GameEvent, own: number): void;
  /** Mouvement du joueur local : saut, atterrissage, début de coup… (`SimEvent`). */
  local(type: number, x: number, y: number, arg: number): void;
  /** Pas de course : à appeler à chaque image où le joueur local court. */
  footstep(x: number, speed: number): void;
  /** Effet d'interface, de décompte ou de transition (nom d'un effet du manifeste). */
  cue(name: SfxName, vol?: number): void;
  /** Nouvelle manche : la tension de la précédente retombe. */
  newRound(): void;
  /** Atténue la musique quelques secondes. */
  duck(seconds: number): void;
}

export const nullAudio: AudioSink = {
  event: () => undefined,
  local: () => undefined,
  footstep: () => undefined,
  cue: () => undefined,
  newRound: () => undefined,
  duck: () => undefined,
};

/** Retour tactile : gros impacts (manette, téléphone). */
export interface Haptics {
  hit(strength: number): void;
}

export const nullHaptics: Haptics = { hit: () => undefined };
