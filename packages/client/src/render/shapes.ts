import { ObjType, ProjType, WeaponId } from '@stickyclaude/shared';

/**
 * Formes tracées au stylo : armes, objets, projectiles, accessoires, motifs. Ce sont des
 * polylignes (listes de points x, y) dans un repère local ; le rendu les place, les tourne et les
 * fait « bouillir ». Voir `docs/DIRECTION_ARTISTIQUE.md` §6.
 *
 * Armes : l'origine est la poignée, +x est le sens du canon ou de la lame. Accessoires : l'origine
 * est le centre de la tête (rayon 4,4), +y vers le bas.
 */

export interface Shape {
  /** Une suite de points (x0, y0, x1, y1…) par trait. */
  strokes: Float32Array[];
  /** Le trait est-il fermé ? */
  closed: boolean[];
  /** Rayon englobant (pour les effets). */
  radius: number;
  /** Centre de la boîte englobante. */
  cx: number;
  cy: number;
  /** Nombre total de points (animation de tracé). */
  points: number;
}

function shape(strokes: number[][], closed: boolean | boolean[] = false): Shape {
  const cl = Array.isArray(closed) ? closed : strokes.map(() => closed);
  let radius = 0;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let points = 0;
  for (const s of strokes) {
    points += s.length / 2;
    for (let i = 0; i < s.length; i += 2) {
      radius = Math.max(radius, Math.hypot(s[i], s[i + 1]));
      x0 = Math.min(x0, s[i]);
      x1 = Math.max(x1, s[i]);
      y0 = Math.min(y0, s[i + 1]);
      y1 = Math.max(y1, s[i + 1]);
    }
  }
  return {
    strokes: strokes.map((s) => Float32Array.from(s)),
    closed: cl,
    radius,
    cx: (x0 + x1) / 2,
    cy: (y0 + y1) / 2,
    points,
  };
}

/** Polygone approchant un cercle ou une ellipse, fermé implicitement. */
export function circle(cx: number, cy: number, rx: number, ry = rx, n = 12, a0 = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    out.push(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
  }
  return out;
}

/** Arc de cercle (ouvert) de a0 à a1. */
export function arc(cx: number, cy: number, r: number, a0: number, a1: number, n = 8): number[] {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return out;
}

const rect = (x0: number, y0: number, x1: number, y1: number): number[] => [
  x0,
  y0,
  x1,
  y0,
  x1,
  y1,
  x0,
  y1,
];

function star(cx: number, cy: number, r: number, points = 5): number[] {
  const out: number[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const rr = i % 2 === 0 ? r : r * 0.42;
    out.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  return out;
}

function heart(cx: number, cy: number, s: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 16; i++) {
    const t = (i / 16) * Math.PI * 2;
    out.push(
      cx + s * 0.06 * 16 * Math.sin(t) ** 3,
      cy -
        s * 0.06 * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)),
    );
  }
  return out;
}

function spiral(cx: number, cy: number, r: number, turns = 2.5, n = 28): number[] {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = t * turns * Math.PI * 2;
    out.push(cx + Math.cos(a) * r * t, cy + Math.sin(a) * r * t);
  }
  return out;
}

function wave(x0: number, y: number, len: number, amp: number, periods: number, n = 16): number[] {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push(x0 + t * len, y + Math.sin(t * periods * Math.PI * 2) * amp);
  }
  return out;
}

// --- Armes tenues (poignée en 0,0, sens du coup vers +x) ---------------------------------------

const ruler = shape(
  [
    rect(-2, -2, 31, 2),
    [4, -2, 4, -0.2],
    [8, -2, 8, 0.4],
    [12, -2, 12, -0.2],
    [16, -2, 16, 0.4],
    [20, -2, 20, -0.2],
    [24, -2, 24, 0.4],
    [28, -2, 28, -0.2],
  ],
  [true, false, false, false, false, false, false, false],
);

const compass = shape(
  [
    circle(0, 0, 2, 2, 8),
    [2, 0, 25, -2.6],
    [2, 0.4, 22, 3.6],
    [25, -2.6, 28.5, -3],
    [22, 3.6, 21, 6.5, 24, 4.6],
    [10, -1, 12, 3],
  ],
  [true, false, false, false, true, false],
);

const stampHammer = shape(
  [
    [0, -1.2, 15, -1.2, 15, 1.2, 0, 1.2],
    rect(15, -7, 24, 7),
    rect(24, -5, 28, 5),
    [17, -3, 22, -3, 20, 3],
  ],
  [true, true, true, false],
);

const pistol = shape(
  [
    [0, -3, 12, -3, 12, 0.6, 5, 0.6, 5.4, 6.4, 1.2, 6.4, 0.6, 0.6, 0, 0.6],
    [12, -2.4, 18, -2.4, 18, -0.6, 12, -0.6],
    [3, -1.6, 9, -1.6, 4, -0.2, 10, -0.4],
  ],
  [true, true, false],
);

const shotgun = shape(
  [
    [-9, -1.6, -2, -3.2, 3, -2.4, 3, 0.8, -2, 1, -6, 4.6, -9.4, 3.6],
    [3, -2.6, 27, -2.6, 27, -0.6, 3, -0.6],
    [3, 0.4, 27, 0.4],
    [11, 0.4, 11, 3.4, 18, 3.4, 18, 0.4],
  ],
  [true, true, false, false],
);

const blowgun = shape(
  [
    rect(0, -1.8, 27, 1.8),
    circle(0, 0, 2.2, 2.2, 8),
    [27, -2.4, 27, 2.4],
    circle(31, -4, 1.7, 1.7, 7),
    circle(33.5, -1.2, 1.4, 1.4, 7),
  ],
  [true, true, false, true, true],
);

const planeLauncher = shape(
  [
    [0, -3, 18, -4.6, 18, 4.6, 0, 3],
    [18, -4.6, 22, -6.2, 22, 6.2, 18, 4.6],
    [20, -1.4, 29, 0, 20, 1.8],
    [4, 3, 6, 7, 10, 7, 9, 3.6],
  ],
  [true, true, false, false],
);

const bazooka = shape(
  [
    [-7, -3.6, 22, -3.6, 22, 3.6, -7, 3.6],
    [22, -3.6, 27, -5.6, 27, 5.6, 22, 3.6],
    [-7, 0, 22, 0],
    [6, 3.6, 6, 8, 10, 8, 10, 3.6],
    [2, -3.6, 2, -6.6, 7, -6.6],
    [14, 1.2, 14.4, 2.8, 15.5, 1.6],
  ],
  [true, true, false, false, false, false],
);

const eraser = shape(
  [
    [-5, -3.4, 5, -3.4, 6, -2.4, 6, 2.4, 5, 3.4, -5, 3.4, -6, 2.4, -6, -2.4],
    [-1, -3.4, -1, 3.4],
    [-5, -1, -2.5, 1.2],
  ],
  [true, false, false],
);

const grapple = shape(
  [
    [0, 0, 11, 0, 12.4, -1.8, 11, -3.6, 4, -3.6, 2.8, -2, 4, -0.4, 9, -0.4],
    [6, 3.4, 15, 3.4, 16.4, 1.6, 15, -0.2, 8, -0.2],
    [15, 3.4, 20, 5.4, 18, 8.4],
  ],
  [false, false, false],
);

const inkMine = shape(
  [
    circle(0, 0, 5.2, 4.4, 14),
    [-3, -5.5, -4, -8, -2, -7],
    [3.4, -5, 6, -7.6, 5.4, -4.4],
    [0, 0, 2, 1, 0.4, 2.6],
  ],
  [true, false, false, false],
);

const sharpener = shape(
  [
    [0, -9, 8, -7, 10, 7, 0, 9],
    [3, -3.6, 8, -3.4],
    circle(6, 3.8, 1.9, 1.9, 8),
    [10, -2, 14, -1, 12, 1.6],
    [10, 3.4, 13.4, 4.6],
  ],
  [true, false, true, false, false],
);

const crate = shape(
  [rect(-7, -7, 7, 7), [-7, -7, 7, 7], [7, -7, -7, 7], [-2, -7, -2, -9, 2, -9, 2, -7]],
  [true, false, false, false],
);

/** Forme tenue de chaque arme (0 = poings : aucune). */
export const WEAPON_SHAPES: Readonly<Record<number, Shape>> = {
  [WeaponId.RULER]: ruler,
  [WeaponId.COMPASS]: compass,
  [WeaponId.STAMP_HAMMER]: stampHammer,
  [WeaponId.PISTOL]: pistol,
  [WeaponId.SHOTGUN]: shotgun,
  [WeaponId.BLOWGUN]: blowgun,
  [WeaponId.PLANE_LAUNCHER]: planeLauncher,
  [WeaponId.BAZOOKA]: bazooka,
  [WeaponId.ERASER]: eraser,
  [WeaponId.GRAPPLE]: grapple,
  [WeaponId.INK_MINE]: inkMine,
  [WeaponId.SHARPENER_SHIELD]: sharpener,
  [WeaponId.CRATE]: crate,
};

/** Couleur d'encre propre à chaque arme (id 0 à 13). */
export const WEAPON_INK: readonly number[] = [
  0x22262e, 0x1f4fd1, 0x6b7280, 0x7a4a2b, 0x22262e, 0x22262e, 0x12a6a6, 0x1f4fd1, 0x7b3fb5,
  0xe5579a, 0x1f9d55, 0x1b2a5e, 0xc9a227, 0x7a4a2b,
];

// --- Objets du décor dynamique (origine : centre du bas ; le haut est y négatif) ----------------

const objCrate = shape(
  [
    rect(-8, -16, 8, 0),
    [-8, -16, 8, 0],
    [8, -16, -8, 0],
    [-2.5, -16, -2.5, -14, 2.5, -14, 2.5, -16],
  ],
  [true, false, false, false],
);

const objBalloon = shape(
  [circle(0, -15, 6.4, 7.6, 14), [0, -7.2, 1, -4, -0.8, -2, 0.6, 1], [-3, -19, -1.4, -20.6]],
  [true, false, false],
);

const objTack = shape(
  [[-7, 0, 0, -3, 7, 0], [0, -3, 0, -9.5], circle(0, -10.5, 2.2, 2.2, 7)],
  [true, false, true],
);

const objMine = shape(
  [circle(0, -4.4, 5.4, 4.6, 14), [-3.4, -9, -4.4, -12, -2.4, -10.6], [3, -9, 5.4, -11.4, 5, -8.6]],
  [true, false, false],
);

const objBall = shape(
  [
    circle(0, -7, 7.4, 7, 14),
    [-4, -9, -1, -6, -3, -3],
    [2, -11, 3, -7, 6, -6],
    [-5, -5, -2.5, -6.2],
  ],
  [true, false, false, false],
);

/** Forme au sol d'un objet : caisse, ballon, punaise, mine, boule. */
export const OBJECT_SHAPES: Readonly<Record<number, Shape>> = {
  [ObjType.CRATE]: objCrate,
  [ObjType.BALLOON]: objBalloon,
  [ObjType.TACK]: objTack,
  [ObjType.MINE]: objMine,
  [ObjType.BALL]: objBall,
};

// --- Projectiles (centre en 0,0, dirigés vers +x) -----------------------------------------------

const projPellet = shape(
  [circle(0, 0, 3.2, 3.2, 9), [-1.4, -1.6, 0.4, 0.2, 1.6, -1.4]],
  [true, false],
);
const projPlane = shape(
  [
    [9, 0, -7, -5, -4, 0, -7, 5],
    [-4, 0, 9, 0],
    [-1, 0, -5, 2.4],
  ],
  [true, false, false],
);
const projRocket = shape(
  [
    [-7, -2.6, 5, -2.6, 9, 0, 5, 2.6, -7, 2.6],
    [-7, -2.6, -11, -6, -9, -2.6],
    [-7, 2.6, -11, 6, -9, 2.6],
    [-1, -2.6, -1, 2.6],
  ],
  [true, false, false, false],
);
const projEraser = shape(
  [
    [-5, -3.6, 5, -3.6, 6, -2.4, 6, 2.4, 5, 3.6, -5, 3.6, -6, 2.4, -6, -2.4],
    [-1, -3.6, -1, 3.6],
  ],
  [true, false],
);

export const PROJECTILE_SHAPES: Readonly<Record<number, Shape>> = {
  [ProjType.PELLET]: projPellet,
  [ProjType.PLANE]: projPlane,
  [ProjType.ROCKET]: projRocket,
  [ProjType.ERASER]: projEraser,
};

// --- Accessoires (origine : centre de la tête, rayon 4,4) --------------------------------------

const R = 4.4;

const hats: (Shape | null)[] = [
  null,
  // 1 casquette
  shape(
    [
      [-R, -1.2, -3.6, -4.2, 0, -5.8, 3.6, -4.2, R, -1.2],
      [R - 0.4, -1.8, 7.6, -1.6, 9.6, -0.2, 6.4, -0.4, R - 0.2, -0.6],
      [0, -5.8, 0, -4.8],
    ],
    [false, false, false],
  ),
  // 2 haut-de-forme
  shape(
    [
      rect(-3.4, -11.6, 3.4, -3.6),
      [-6.4, -3.6, 6.4, -3.6, 6.8, -2.6, -6.8, -2.6],
      [-3.4, -5.6, 3.4, -5.6],
    ],
    [true, true, false],
  ),
  // 3 bandeau de ninja
  shape(
    [
      [-R - 0.4, -1.6, R + 0.4, -1.6, R + 0.4, -0.2, -R - 0.4, -0.2],
      [-R - 0.4, -1, -8.6, -3, -9.6, -0.6],
      [-R - 0.4, -0.8, -8.4, 1.6, -10, 2],
    ],
    [true, false, false],
  ),
  // 4 couronne en papier
  shape([[-4, -3.4, -4.4, -8.6, -2.2, -6, 0, -9.6, 2.2, -6, 4.4, -8.6, 4, -3.4]], true),
  // 5 chapeau de sorcier
  shape(
    [
      [-5, -3.4, -2.4, -9, 0.6, -16, 2.4, -9.6, 5, -3.4],
      [-7.6, -3.2, 7.6, -3.2],
      star(0.2, -8.2, 1.5),
    ],
    [false, false, true],
  ),
  // 6 antennes
  shape(
    [
      [-1.4, -4.2, -3.2, -8.6, -4.6, -11],
      [1.4, -4.2, 3.2, -8.6, 4.6, -11],
      circle(-4.8, -11.8, 1.5, 1.5, 7),
      circle(4.8, -11.8, 1.5, 1.5, 7),
    ],
    [false, false, true, true],
  ),
  // 7 lunettes
  shape(
    [
      circle(-2.2, -0.2, 1.9, 1.9, 8),
      circle(2.4, -0.2, 1.9, 1.9, 8),
      [-0.3, -0.2, 0.5, -0.2],
      [-4.2, -0.3, -R - 1.2, -1.2],
    ],
    [true, true, false, false],
  ),
  // 8 nœud papillon
  shape(
    [[0, -4.6, -5.8, -8, -5.8, -2.2], [0, -4.6, 5.8, -8, 5.8, -2.2], circle(0, -4.8, 1.1, 1.1, 6)],
    [true, true, true],
  ),
  // 9 casque de chantier
  shape(
    [
      [-R - 0.4, -1.2, -3.6, -5, 0, -6.6, 3.6, -5, R + 0.4, -1.2],
      [-R - 1.8, -1.2, R + 1.8, -1.2],
      [0, -6.6, 0, -2.2],
    ],
    [false, false, false],
  ),
  // 10 cornet de glace
  shape(
    [
      [-3.2, -9.4, 3.2, -9.4, 0, -4.2],
      [-1.8, -8.4, 0.6, -5.6],
      circle(0, -11.8, 3.6, 3.2, 10),
      circle(0.8, -15.6, 1, 1, 6),
    ],
    [true, false, true, true],
  ),
  // 11 auréole
  shape([circle(0, -9, 5.4, 1.7, 12), circle(0, -9.8, 4.4, 1.2, 12)], [true, true]),
];

export const HAT_SHAPES: readonly (Shape | null)[] = hats;

// --- Motifs pour les daltoniens (badge de poitrine, rayon 3) ------------------------------------

const patterns: Shape[] = [
  // 0 points
  shape(
    [circle(-1.4, -1.2, 0.6, 0.6, 5), circle(1.4, -1.2, 0.6, 0.6, 5), circle(0, 1.4, 0.6, 0.6, 5)],
    true,
  ),
  // 1 rayures
  shape([
    [-1.8, -2, -1.8, 2],
    [0, -2.4, 0, 2.4],
    [1.8, -2, 1.8, 2],
  ]),
  // 2 damier
  shape(
    [rect(-2.2, -2.2, 0, 0), rect(0, 0, 2.2, 2.2), rect(-2.2, -2.2, 2.2, 2.2)],
    [true, true, true],
  ),
  // 3 zigzag
  shape([[-2.6, 1.2, -1.3, -1.2, 0, 1.2, 1.3, -1.2, 2.6, 1.2]]),
  // 4 croix
  shape([
    [0, -2.4, 0, 2.4],
    [-2.4, 0, 2.4, 0],
  ]),
  // 5 anneau
  shape([circle(0, 0, 2.2, 2.2, 10)], true),
  // 6 triangle
  shape([[0, -2.6, 2.6, 2, -2.6, 2]], true),
  // 7 losange
  shape([[0, -2.8, 2.2, 0, 0, 2.8, -2.2, 0]], true),
  // 8 étoile
  shape([star(0, 0.2, 2.8)], true),
  // 9 vagues
  shape([wave(-2.6, -1, 5.2, 0.7, 1.5, 8), wave(-2.6, 1.2, 5.2, 0.7, 1.5, 8)]),
  // 10 spirale
  shape([spiral(0, 0, 2.6, 1.8, 14)]),
  // 11 cœur
  shape([heart(0, 0.2, 0.7)], true),
];

export const PATTERN_SHAPES: readonly Shape[] = patterns;

// --- Éléments de décor et d'effets -------------------------------------------------------------

export const STAR = shape([star(0, 0, 1, 5)], true);
export const HEART = shape([heart(0, 0, 0.12)], true);
export const SMILEY = shape(
  [
    circle(0, 0, 1, 1, 14),
    [-0.4, -0.3, -0.4, -0.1],
    [0.4, -0.3, 0.4, -0.1],
    arc(0, 0.1, 0.55, 0.3, Math.PI - 0.3, 6),
  ],
  [true, false, false, false],
);
export const NOTE_QUAVER = shape(
  [circle(0, 0, 0.5, 0.38, 8), [0.46, 0, 0.46, -2.2, 1.3, -1.6]],
  [true, false],
);
export const NOTE_BEAMED = shape(
  [
    circle(0, 0, 0.5, 0.38, 8),
    circle(1.6, -0.3, 0.5, 0.38, 8),
    [0.46, 0, 0.46, -2.2, 2.06, -2.5, 2.06, -0.3],
    [0.46, -2.2, 2.06, -2.5],
  ],
  [true, true, false, false],
);
export const CLEF = shape(
  [
    [
      0, 3.4, 0.9, 2.3, 0.7, 0.4, -0.6, -1.2, -1.2, -2.6, -0.4, -3.8, 0.7, -3.4, 0.9, -2, 0.1, -0.2,
      -0.4, 1.6, -0.6, 3.2, 0.2, 4, 0.9, 3.6, 0.6, 2.6, -0.2, 2.5, -0.5, 3.2,
    ],
    [0, -3.2, 0, 3.6],
  ],
  false,
);
export const COMPASS_ROSE = shape(
  [
    [0, -1, 0.26, -0.26, 1, 0, 0.26, 0.26, 0, 1, -0.26, 0.26, -1, 0, -0.26, -0.26],
    [0, -1.35, 0, 1.35],
    [-1.35, 0, 1.35, 0],
    circle(0, 0, 1.15, 1.15, 16),
  ],
  [true, false, false, true],
);
export const ARROW = shape(
  [
    [0, 0, 5, 0],
    [3.8, -1.2, 5, 0, 3.8, 1.2],
  ],
  false,
);
export const SPIRAL = shape([spiral(0, 0, 1, 2.6, 30)], false);
export const SCRIBBLE = shape(
  [[-1, 0.2, 0.9, -0.6, -0.9, -0.2, 1, 0.5, -1, 0.7, 0.8, 0.1, -0.8, 1, 1, 1.1]],
  false,
);
export const CROSS = shape(
  [
    [-1, -1, 1, 1],
    [1, -1, -1, 1],
  ],
  false,
);
export const AXES = shape(
  [
    [-1, 1, -1, -1.1],
    [-1.3, 1, 1.2, 1],
    [-1.12, -0.86, -1, -1.1, -0.88, -0.86],
    [0.96, 0.88, 1.2, 1, 0.96, 1.12],
    [-0.5, 1.06, -0.5, 0.94],
    [0, 1.06, 0, 0.94],
    [0.5, 1.06, 0.5, 0.94],
  ],
  false,
);
export const BINDING_COIL = shape([circle(0, 0, 1, 0.6, 10)], true);
export const RULER_DECOR = shape(
  [
    rect(-1, -0.14, 1, 0.14),
    [-0.8, -0.14, -0.8, 0.02],
    [-0.4, -0.14, -0.4, 0.06],
    [0, -0.14, 0, 0.02],
    [0.4, -0.14, 0.4, 0.06],
    [0.8, -0.14, 0.8, 0.02],
  ],
  [true, false, false, false, false, false],
);
export const WAVE = shape([wave(-1, 0, 2, 0.12, 3, 18)], false);

/** Bulle de BD dentelée pour les onomatopées (rayon 1). */
export function burst(points = 14, inner = 0.72, seed = 1): number[] {
  const out: number[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2;
    const jitter = 1 + 0.09 * Math.sin(i * 12.9898 + seed * 78.233);
    const r = (i % 2 === 0 ? 1 : inner) * jitter;
    out.push(Math.cos(a) * r, Math.sin(a) * r);
  }
  return out;
}

export const BURST = shape([burst(14, 0.72, 1)], true);

/** Crayon du fantôme (pointe en 0,0, corps vers le haut à droite). */
export const PENCIL = shape(
  [
    [0, 0, 3.4, -1.6, 14.4, -12.6, 11.6, -15.4, 1.6, -3.4],
    [3.4, -1.6, 1.6, -3.4],
    [13.0, -11.2, 10.2, -14.0],
    [0, 0, 1.2, -0.5],
  ],
  [true, false, false, false],
);

/** Cible du mannequin d'entraînement (rayon 1). */
export const TARGET = shape(
  [circle(0, 0, 1, 1, 12), circle(0, 0, 0.5, 0.5, 8), [-1.3, 0, 1.3, 0], [0, -1.3, 0, 1.3]],
  [true, true, false, false],
);
