/**
 * Qualité adaptative (analyse §2.7). On mesure les FPS pendant les premières secondes ; si la
 * moyenne tombe sous 50, on baisse d'un cran : résolution interne (DPR plafonné entre 1 et 1,5),
 * line boiling du terrain, particules. Le joueur peut forcer la qualité dans les options.
 * Pur et sans horloge : on lui donne la durée de chaque image.
 */

export type QualitySetting = 'auto' | 'low' | 'medium' | 'high';
/** 0 = basse, 1 = moyenne, 2 = haute. */
export type QualityLevel = 0 | 1 | 2;

export interface QualityProfile {
  level: QualityLevel;
  /** Plafond du devicePixelRatio du canvas. */
  dprCap: number;
  /** Tremblé du terrain (variantes de morceaux) et des traits. */
  boilTerrain: boolean;
  boilStrokes: boolean;
  /** Densité des particules (1 = tout). */
  density: number;
  /** Résolution maximale des morceaux de terrain (pixels par unité). */
  terrainRes: number;
  /** Nombre de variantes de terrain pour le tremblé. */
  terrainVariants: number;
}

export const PROFILES: readonly QualityProfile[] = [
  {
    level: 0,
    dprCap: 1,
    boilTerrain: false,
    boilStrokes: false,
    density: 0.5,
    terrainRes: 1,
    terrainVariants: 1,
  },
  {
    level: 1,
    dprCap: 1.5,
    boilTerrain: false,
    boilStrokes: true,
    density: 0.75,
    terrainRes: 1.5,
    terrainVariants: 1,
  },
  {
    level: 2,
    dprCap: 2,
    boilTerrain: true,
    boilStrokes: true,
    density: 1,
    terrainRes: 2,
    terrainVariants: 3,
  },
];

/** Durée de la première mesure et des suivantes (ms), et seuil de FPS. */
export const FIRST_WINDOW_MS = 5000;
export const NEXT_WINDOW_MS = 6000;
export const FPS_THRESHOLD = 50;

export class QualityController {
  private setting: QualitySetting = 'auto';
  private auto: QualityLevel;
  private windowMs = 0;
  private frames = 0;
  private first = true;
  /** FPS moyen de la dernière fenêtre mesurée (affichage, tests). */
  lastFps = 60;

  constructor(
    /** Niveau de départ en auto : haut sur un PC, moyen sur un téléphone. */
    startLevel: QualityLevel = 2,
  ) {
    this.auto = startLevel;
  }

  setSetting(s: QualitySetting): void {
    this.setting = s;
    this.windowMs = 0;
    this.frames = 0;
  }

  get level(): QualityLevel {
    switch (this.setting) {
      case 'low':
        return 0;
      case 'medium':
        return 1;
      case 'high':
        return 2;
      default:
        return this.auto;
    }
  }

  get profile(): QualityProfile {
    return PROFILES[this.level];
  }

  /**
   * À appeler à chaque image avec sa durée. Retourne vrai si le niveau a changé. Les images
   * anormalement longues (onglet masqué, chargement : > 250 ms) ne comptent pas. `cap` est le
   * plafond de FPS choisi par le joueur (0 = aucun) : tenir 30 FPS sous un plafond de 30 n'est
   * pas une charge excessive.
   */
  frame(dtMs: number, cap = 0): boolean {
    if (this.setting !== 'auto' || dtMs > 250) return false;
    this.windowMs += dtMs;
    this.frames++;
    const target = this.first ? FIRST_WINDOW_MS : NEXT_WINDOW_MS;
    if (this.windowMs < target) return false;
    const fps = (this.frames * 1000) / this.windowMs;
    this.lastFps = fps;
    this.windowMs = 0;
    this.frames = 0;
    this.first = false;
    const threshold = cap > 0 ? Math.min(FPS_THRESHOLD, cap * 0.9) : FPS_THRESHOLD;
    if (fps < threshold && this.auto > 0) {
      this.auto = (this.auto - 1) as QualityLevel;
      return true;
    }
    return false;
  }
}
