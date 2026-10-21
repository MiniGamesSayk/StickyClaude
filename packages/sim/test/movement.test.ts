import {
  CELL,
  DEFAULT_MOVEMENT,
  GRID_W,
  Input,
  MAX_PLAYERS,
  PlayerState,
  SimEvent,
  WORLD_H,
} from '@stickyclaude/shared';
import { describe, expect, it } from 'vitest';
import { addPlayer, createWorld, step, wallContact } from '../src/index.ts';
import {
  arena,
  boxArena,
  customArena,
  DOWN,
  eventTypes,
  FLOOR_Y,
  fill,
  inputs,
  JUMP,
  LEFT,
  overlapsSolid,
  put,
  RIGHT,
  run,
  runCollect,
  settle,
  worldWithPlayer,
} from './helpers.ts';

const P = DEFAULT_MOVEMENT;

describe('sol et course', () => {
  it('le joueur tombe, atterrit sur le sol et reste posé', () => {
    const w = worldWithPlayer();
    const p = w.players[0];
    expect(p.grounded).toBe(true);
    expect(p.y).toBeCloseTo(FLOOR_Y, 3);
    expect(p.vy).toBe(0);
    expect(p.state).toBe(PlayerState.IDLE);
  });

  it('accélère jusqu à la vitesse de course puis décélère à l arrêt', () => {
    const w = worldWithPlayer();
    const p = w.players[0];
    run(w, 30, RIGHT);
    expect(p.vx).toBeCloseTo(P.runSpeed, 3);
    expect(p.state).toBe(PlayerState.RUN);
    run(w, 30, 0);
    expect(p.vx).toBe(0);
    expect(p.state).toBe(PlayerState.IDLE);
  });

  it('le demi-tour au sol est plus rapide que la simple accélération', () => {
    const w = worldWithPlayer();
    const p = w.players[0];
    run(w, 30, RIGHT);
    run(w, 4, LEFT);
    expect(p.vx).toBeLessThan(0);
    expect(p.facing).toBe(-1);
  });

  it('le contrôle est réduit en l air', () => {
    const w = worldWithPlayer();
    const p = w.players[0];
    run(w, 1, JUMP | RIGHT);
    run(w, 6, JUMP | RIGHT);
    expect(p.grounded).toBe(false);
    // 7 ticks d'accélération aérienne : bien moins que la vitesse max
    expect(p.vx).toBeLessThan(P.airAccel * (7 / 60) + 1);
    expect(p.vx).toBeGreaterThan(0);
  });

  it('ne sort jamais de la page horizontalement', () => {
    const w = worldWithPlayer();
    const p = w.players[0];
    run(w, 600, RIGHT);
    expect(p.x + P.width / 2).toBeLessThanOrEqual((GRID_W - 2) * CELL + 1e-6);
    run(w, 1200, LEFT);
    expect(p.x - P.width / 2).toBeGreaterThanOrEqual(2 * CELL - 1e-6);
  });
});

describe('sauts', () => {
  it('le saut atteint la hauteur attendue (≈ 3,2 cellules)', () => {
    const w = worldWithPlayer();
    const p = w.players[0];
    let minY = p.y;
    for (let i = 0; i < 80; i++) {
      run(w, 1, JUMP);
      minY = Math.min(minY, p.y);
    }
    const height = FLOOR_Y - minY;
    const expected = (P.jumpSpeed * P.jumpSpeed) / (2 * P.gravity);
    expect(height).toBeGreaterThan(expected - 6);
    expect(height).toBeLessThan(expected + 2);
  });

  it('relâcher le saut coupe la montée', () => {
    const w1 = worldWithPlayer();
    const w2 = worldWithPlayer();
    let min1 = w1.players[0].y;
    let min2 = w2.players[0].y;
    for (let i = 0; i < 80; i++) {
      run(w1, 1, JUMP);
      run(w2, 1, i < 3 ? JUMP : 0);
      min1 = Math.min(min1, w1.players[0].y);
      min2 = Math.min(min2, w2.players[0].y);
    }
    expect(FLOOR_Y - min2).toBeLessThan((FLOOR_Y - min1) * 0.7);
  });

  it('coyote time : on peut sauter juste après avoir quitté un bord', () => {
    // Plateforme étroite : on la quitte en marchant, puis on saute 4 ticks plus tard.
    const a = customArena((r) => {
      fill(r, 30, 33, 40, 35, '.');
    });
    const w = worldWithPlayer(a);
    put(w, 29 * CELL + 8, FLOOR_Y);
    w.players[0].grounded = true;
    let leftAt = -1;
    let types = new Set<number>();
    for (let i = 0; i < 80; i++) {
      const p = w.players[0];
      if (leftAt < 0 && !p.grounded && i > 0) leftAt = i;
      const wantJump = leftAt >= 0 && i === leftAt + 3;
      const set = runCollect(w, 1, () => RIGHT | (wantJump ? JUMP : 0));
      if (wantJump) types = set;
      if (i > leftAt + 6 && leftAt >= 0) break;
    }
    expect(leftAt).toBeGreaterThan(0);
    // Un saut normal (pas un double saut) car le coyote time est encore actif.
    expect(types.has(SimEvent.JUMP)).toBe(true);
    expect(types.has(SimEvent.DOUBLE_JUMP)).toBe(false);
  });

  it('après le coyote time, l appui déclenche le double saut', () => {
    const a = customArena((r) => {
      fill(r, 30, 33, 40, 35, '.');
    });
    const w = worldWithPlayer(a);
    put(w, 29 * CELL + 8, FLOOR_Y);
    w.players[0].grounded = true;
    let leftAt = -1;
    let types = new Set<number>();
    for (let i = 0; i < 80; i++) {
      const p = w.players[0];
      if (leftAt < 0 && !p.grounded && i > 0) leftAt = i;
      const wantJump = leftAt >= 0 && i === leftAt + 12;
      const set = runCollect(w, 1, () => RIGHT | (wantJump ? JUMP : 0));
      if (wantJump) types = set;
      if (leftAt >= 0 && i > leftAt + 13) break;
    }
    expect(types.has(SimEvent.JUMP)).toBe(false);
    expect(types.has(SimEvent.DOUBLE_JUMP)).toBe(true);
  });

  it('mémoire du saut : un appui juste avant l atterrissage déclenche le saut', () => {
    const w = worldWithPlayer();
    const p = w.players[0];
    // Saute, redescend, et rappuie 3 ticks avant de toucher le sol.
    run(w, 1, JUMP);
    let pressed = false;
    let jumpedAtLanding = false;
    for (let i = 0; i < 100; i++) {
      const nearGround = p.vy > 0 && FLOOR_Y - p.y < 12 && FLOOR_Y - p.y > 3;
      if (nearGround && !pressed) {
        pressed = true;
        const types = runCollect(w, 1, () => JUMP);
        void types;
        continue;
      }
      if (pressed) {
        const types = runCollect(w, 1, () => 0);
        if (types.has(SimEvent.JUMP) || p.vy < 0) {
          jumpedAtLanding = true;
          break;
        }
      } else {
        run(w, 1, 0);
      }
    }
    expect(pressed).toBe(true);
    expect(jumpedAtLanding).toBe(true);
  });

  it('un seul double saut par contact avec le sol', () => {
    const w = worldWithPlayer();
    const seen: number[] = [];
    for (let i = 0; i < 45; i++) {
      // 1er appui tenu (saut), relâché, 2e appui (double saut), relâché, 3e appui (sans effet).
      const mask = i < 10 || (i >= 13 && i < 22) || (i >= 26 && i < 32) ? JUMP : 0;
      inputs.fill(0);
      inputs[0] = mask;
      step(w, inputs);
      seen.push(...eventTypes(w));
    }
    expect(seen.filter((t) => t === SimEvent.JUMP).length).toBe(1);
    expect(seen.filter((t) => t === SimEvent.DOUBLE_JUMP).length).toBe(1);
  });

  it('chute rapide : la vitesse de chute est plus grande en maintenant bas', () => {
    const w1 = createWorld(boxArena(), 1);
    const w2 = createWorld(boxArena(), 1);
    for (const w of [w1, w2]) {
      addPlayer(w, 0);
      put(w, 512, 100);
    }
    run(w1, 30, 0);
    run(w2, 30, DOWN);
    expect(w2.players[0].vy).toBeGreaterThan(w1.players[0].vy);
    expect(w1.players[0].vy).toBeLessThanOrEqual(P.maxFallSpeed);
    expect(w2.players[0].vy).toBeLessThanOrEqual(P.fastFallSpeed);
  });
});

describe('murs', () => {
  // Puits de wall-jump de test-flat : piliers aux colonnes 44-45 et 50-51, vide entre 46 et 49.
  const shaftLeftWallX = 46 * CELL;

  it('glissade contre un mur : la chute est plafonnée', () => {
    const w = worldWithPlayer();
    const p = put(w, shaftLeftWallX + P.width / 2, 20 * CELL);
    p.grounded = false;
    run(w, 60, LEFT);
    expect(p.state).toBe(PlayerState.WALL_SLIDE);
    expect(p.vy).toBeLessThanOrEqual(P.wallSlideSpeed + 1e-9);
    expect(p.vy).toBeGreaterThan(0);
  });

  it('saut mural : projette à l opposé du mur', () => {
    const w = worldWithPlayer();
    const p = put(w, shaftLeftWallX + P.width / 2, 20 * CELL);
    p.grounded = false;
    run(w, 20, LEFT);
    const types = runCollect(w, 1, () => LEFT | JUMP);
    expect(types.has(SimEvent.WALL_JUMP)).toBe(true);
    expect(p.vx).toBeGreaterThan(0);
    expect(p.vy).toBeLessThan(0);
    expect(p.facing).toBe(1);
  });

  it('on peut monter le puits en alternant les murs', () => {
    const w = worldWithPlayer();
    const p = put(w, shaftLeftWallX + P.width / 2, 30 * CELL);
    p.grounded = false;
    const startY = p.y;
    let side = -1;
    let minY = p.y;
    let prevJump = false;
    let wallJumps = 0;
    for (let i = 0; i < 160; i++) {
      const touching = wallContact(w, p, side) !== 0;
      const jump: boolean = (touching && !prevJump) || (prevJump && p.wallLock > 0);
      prevJump = jump;
      inputs.fill(0);
      inputs[0] = (side < 0 ? LEFT : RIGHT) | (jump ? JUMP : 0);
      step(w, inputs);
      if (eventTypes(w).includes(SimEvent.WALL_JUMP)) wallJumps++;
      if (p.wallLock === 0 && p.vx > 20) side = 1;
      if (p.wallLock === 0 && p.vx < -20) side = -1;
      minY = Math.min(minY, p.y);
    }
    expect(wallJumps).toBeGreaterThanOrEqual(4);
    expect(startY - minY).toBeGreaterThan(10 * CELL);
  });
});

describe('accroupi', () => {
  it('réduit la boîte et la vitesse', () => {
    const w = worldWithPlayer();
    const p = w.players[0];
    run(w, 5, DOWN);
    expect(p.crouching).toBe(true);
    expect(p.state).toBe(PlayerState.CROUCH);
    run(w, 30, DOWN | RIGHT);
    expect(p.vx).toBeCloseTo(P.crouchSpeed, 3);
    run(w, 5, 0);
    expect(p.crouching).toBe(false);
  });

  it('reste accroupi sous un plafond trop bas pour se relever', () => {
    const a = customArena((r) => fill(r, 20, 30, 30, 30, '#'));
    const w = worldWithPlayer(a);
    // Corps plus grand que le passage (2 cellules = 32) : debout 40, accroupi 20.
    w.params.height = 40;
    w.params.crouchHeight = 20;
    const p = put(w, 25 * CELL, FLOOR_Y);
    p.grounded = true;
    p.crouching = true;
    run(w, 10, 0);
    expect(p.crouching).toBe(true);
    expect(overlapsSolid(w, p)).toBe(false);
    // En sortant du passage, il se relève.
    put(w, 15 * CELL, FLOOR_Y);
    run(w, 3, 0);
    expect(p.crouching).toBe(false);
  });
});

describe('plateformes à sens unique et mobiles', () => {
  it('traverse par le bas puis atterrit dessus', () => {
    // Plateforme à sens unique de test-flat : rangée 28, colonnes 16-23.
    const w = worldWithPlayer();
    const p = put(w, 20 * CELL, FLOOR_Y);
    p.grounded = true;
    let landedOnTop = false;
    for (let i = 0; i < 200; i++) {
      // saut tenu, relâché, double saut tenu
      inputs.fill(0);
      inputs[0] = i < 12 || (i >= 16 && i < 40) ? JUMP : 0;
      step(w, inputs);
      if (p.grounded && Math.abs(p.y - 28 * CELL) < 0.01) {
        landedOnTop = true;
        break;
      }
    }
    expect(landedOnTop).toBe(true);
  });

  it('bas + saut traverse la plateforme vers le bas', () => {
    const w = worldWithPlayer();
    const p = put(w, 20 * CELL, 28 * CELL);
    p.grounded = true;
    run(w, 2, 0);
    expect(p.y).toBeCloseTo(28 * CELL, 3);
    const types = runCollect(w, 1, () => DOWN | JUMP);
    expect(types.has(SimEvent.DROP_THROUGH)).toBe(true);
    run(w, 60, 0);
    expect(p.y).toBeCloseTo(FLOOR_Y, 3);
  });

  it('une plateforme mobile entraîne le joueur', () => {
    const w = worldWithPlayer();
    const m = w.movers[1]; // ascenseur : colonne 56, rangée 32 → 10
    expect(m.w).toBe(4 * CELL);
    // Place le joueur sur l'ascenseur au tick courant.
    const p = put(w, m.x + m.w / 2, m.y);
    p.grounded = true;
    p.groundMover = 1;
    let maxRise = 0;
    const startY = p.y;
    for (let i = 0; i < 150; i++) {
      run(w, 1, 0);
      expect(p.groundMover).toBe(1);
      expect(p.y).toBeCloseTo(w.movers[1].y, 2);
      maxRise = Math.max(maxRise, startY - p.y);
    }
    expect(maxRise).toBeGreaterThan(CELL);
  });
});

describe('chute et réapparition', () => {
  it('tomber sous la page réapparaît à un point d apparition', () => {
    const w = worldWithPlayer();
    const p = put(w, 31 * CELL, 33 * CELL); // dans le fosse
    p.grounded = false;
    let fell = false;
    let respawned = false;
    for (let i = 0; i < 300; i++) {
      inputs.fill(0);
      step(w, inputs);
      const t = eventTypes(w);
      if (t.includes(SimEvent.FELL)) fell = true;
      if (t.includes(SimEvent.SPAWN)) respawned = true;
      if (fell && respawned) break;
    }
    expect(fell).toBe(true);
    expect(respawned).toBe(true);
    expect(p.y).toBeLessThan(WORLD_H);
    expect(p.respawns).toBe(2);
  });
});

describe('pas d effet tunnel', () => {
  it('une vitesse verticale énorme ne traverse pas le sol', () => {
    const w = worldWithPlayer(boxArena());
    const p = put(w, 10 * CELL, 5 * CELL);
    p.vy = 40000;
    w.params.maxFallSpeed = 1e9;
    w.params.fastFallSpeed = 1e9;
    run(w, 1, 0);
    expect(p.y).toBeCloseTo(FLOOR_Y, 3);
    expect(overlapsSolid(w, p)).toBe(false);
  });

  it('une vitesse horizontale énorme s arrête contre le mur', () => {
    const w = worldWithPlayer(boxArena());
    const p = put(w, 10 * CELL, FLOOR_Y);
    p.vx = 50000;
    p.grounded = true;
    inputs.fill(0);
    inputs[0] = RIGHT;
    w.params.runSpeed = 1e9;
    step(w, inputs);
    expect(p.x + P.width / 2).toBeCloseTo((GRID_W - 2) * CELL, 3);
    expect(overlapsSolid(w, p)).toBe(false);
  });

  it('une vitesse vers le haut énorme s arrête sous le plafond', () => {
    const w = worldWithPlayer(boxArena());
    const p = put(w, 10 * CELL, FLOOR_Y);
    p.vy = -40000;
    p.grounded = false;
    run(w, 1, 0);
    expect(p.y - P.height).toBeCloseTo(2 * CELL, 3);
    expect(overlapsSolid(w, p)).toBe(false);
  });

  it('une vitesse énorme dans toutes les directions ne traverse aucun bloc', () => {
    // Dans test-flat : tirs à haute vitesse contre piliers, sol et ledges.
    for (const [vx, vy] of [
      [30000, 0],
      [-30000, 0],
      [0, 30000],
      [0, -30000],
      [20000, 20000],
      [-20000, -20000],
    ] as const) {
      const w = worldWithPlayer();
      w.params.maxFallSpeed = 1e9;
      w.params.fastFallSpeed = 1e9;
      const p = put(w, 22 * CELL, 26 * CELL);
      p.vx = vx;
      p.vy = vy;
      p.wallLock = 1000;
      for (let i = 0; i < 5; i++) {
        run(w, 1, 0);
        expect(overlapsSolid(w, p)).toBe(false);
      }
    }
  });
});

describe('plusieurs joueurs', () => {
  it('8 joueurs apparaissent sur des points différents et ne se gênent pas', () => {
    const w = createWorld(arena(), 7);
    for (let s = 0; s < MAX_PLAYERS; s++) addPlayer(w, s);
    const xs = new Set(w.players.map((p) => p.x));
    expect(xs.size).toBe(MAX_PLAYERS);
    settle(w);
    for (const p of w.players) expect(p.grounded).toBe(true);
  });

  it('les entrées d un joueur n affectent pas les autres', () => {
    const w = createWorld(arena(), 7);
    addPlayer(w, 0);
    addPlayer(w, 1);
    run(w, 90, 0);
    const x1 = w.players[1].x;
    run(w, 30, RIGHT, 0);
    expect(w.players[1].x).toBe(x1);
    expect(w.players[0].x).toBeGreaterThan(w.players[1].x);
    expect(Input.RIGHT).toBe(RIGHT);
  });
});
