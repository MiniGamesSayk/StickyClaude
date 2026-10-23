import { AtkPhase, AttackKind, Input, PlayerState, SimEvent, TICK_MS } from '@stickyclaude/shared';
import { hashWorld } from '@stickyclaude/sim';
import { describe, expect, it } from 'vitest';
import {
  MANNEQUINS,
  mannequinInput,
  SoloSource,
  TRAINING_OBJECTIVES,
  TrainingTracker,
} from '../src/app/solo.ts';
import type { GameEvent } from '../src/net/client.ts';

function solo(seed = 7): { s: SoloSource; events: GameEvent[]; done: string[] } {
  const events: GameEvent[] = [];
  const done: string[] = [];
  const s = new SoloSource({
    name: 'Zoé',
    look: { color: 3, stroke: 1, hat: 2, victory: 0 },
    seed,
    onEvent: (e) => events.push(e),
    onObjectives: (_l, d) => done.push(...d),
  });
  return { s, events, done };
}

/** Avance de `seconds` secondes à 60 images/s avec `input` (ou une fonction du temps). */
function run(s: SoloSource, seconds: number, input: number | ((t: number) => number)): void {
  const frames = Math.round(seconds * 60);
  for (let i = 0; i < frames; i++) {
    const t = i / 60;
    s.update(typeof input === 'function' ? input(t) : input, 0, TICK_MS);
  }
}

describe('mannequins', () => {
  it('leur entrée est une fonction pure du tick, jamais du joueur', () => {
    for (const k of MANNEQUINS) {
      for (let t = 0; t < 600; t += 7) {
        expect(mannequinInput(k, t, 1)).toBe(mannequinInput(k, t, 1));
      }
    }
    expect(mannequinInput('static', 123, 1)).toBe(0);
  });

  it('celui qui oscille change de sens toutes les 1,5 s', () => {
    expect(mannequinInput('patrol', 0, 0)).toBe(Input.RIGHT);
    expect(mannequinInput('patrol', 89, 0)).toBe(Input.RIGHT);
    expect(mannequinInput('patrol', 90, 0)).toBe(Input.LEFT);
    expect(mannequinInput('patrol', 180, 0)).toBe(Input.RIGHT);
  });

  it('le boxeur frappe à intervalle fixe, deux ticks à la fois', () => {
    let attacks = 0;
    for (let t = 0; t < 1500; t++)
      if ((mannequinInput('boxer', t, 3) & Input.ATTACK) !== 0) attacks++;
    expect(attacks).toBe(20);
  });
});

describe('objectifs du carnet', () => {
  it('chaque objectif a un texte et un but', () => {
    expect(TRAINING_OBJECTIVES.length).toBeGreaterThanOrEqual(12);
    const ids = new Set(TRAINING_OBJECTIVES.map((o) => o.id));
    expect(ids.size).toBe(TRAINING_OBJECTIVES.length);
  });

  it('les événements cochent les objectifs, une seule fois', () => {
    const t = new TrainingTracker();
    expect(t.event(SimEvent.JUMP, 0, [])).toEqual(['jump']);
    expect(t.event(SimEvent.JUMP, 0, [])).toEqual([]);
    expect(t.event(SimEvent.JUMP, 3, [])).toEqual([]); // un mannequin ne compte pas
    expect(t.event(SimEvent.DOUBLE_JUMP, 0, [])).toEqual(['double']);
    expect(t.event(SimEvent.WALL_JUMP, 0, [])).toEqual(['wall']);
    expect(t.event(SimEvent.DROP_THROUGH, 0, [])).toEqual(['drop']);
    expect(t.event(SimEvent.BLOCKED, 0, [0, 0, 255, 0])).toEqual(['block']);
    expect(t.event(SimEvent.BLOCKED, 0, [0, 0, 255, 1])).toEqual(['parry']);
    expect(t.event(SimEvent.PICKUP, 3, [0, 4, 9])).toEqual(['pickup']);
    expect(t.event(SimEvent.EMOTE, 0, [2])).toEqual(['emote']);
  });

  it('frapper un mannequin compte, 3 fois pour l’objectif ; encaisser ne compte pas', () => {
    const t = new TrainingTracker();
    expect(t.event(SimEvent.HIT, 0, [10, 10, 2, 5, 0])).toEqual([]); // le joueur est la victime
    expect(t.event(SimEvent.HIT, 1, [10, 10, 0, 5, 0])).toEqual([]);
    expect(t.progress('punch')).toBe(1);
    expect(t.event(SimEvent.HIT, 2, [10, 10, 0, 5, 0])).toEqual([]);
    expect(t.event(SimEvent.HIT, 3, [10, 10, 0, 5, 0])).toEqual(['punch']);
  });

  it('attaque spéciale et coup vers le bas en l’air se reconnaissent au geste en cours', () => {
    const t = new TrainingTracker();
    t.tick(PlayerState.ATTACK, true, 100, AttackKind.CHARGED, 1);
    expect(t.event(SimEvent.HIT, 1, [10, 10, 0, 20, 1])).toContain('charged');
    t.tick(PlayerState.ATTACK, false, 100, AttackKind.AIR_DOWN, 1);
    expect(t.event(SimEvent.HIT, 1, [10, 10, 0, 10, 0])).toContain('kick');
    const d = new TrainingTracker();
    d.tick(PlayerState.ATTACK, true, 100, AttackKind.SPECIAL_DOWN, 1);
    expect(d.event(SimEvent.HIT, 1, [10, 10, 0, 12, 1])).toContain('charged');
  });

  it('la ruée invulnérable en l’air se reconnaît à son événement, pas le dash simple', () => {
    const t = new TrainingTracker();
    expect(t.event(SimEvent.DASH, 0, [100, 100, 1, 0])).toEqual(['dash']);
    expect(t.event(SimEvent.DASH, 0, [100, 100, 1, 1])).toEqual(['airspecial']);
  });

  it('courir 700 unités, rester accroupi 0,5 s, enchaîner 3 coups', () => {
    const t = new TrainingTracker();
    let doneRun = false;
    for (let x = 0; x < 800; x += 3) {
      if (t.tick(PlayerState.RUN, true, x, 0, 0).includes('run')) doneRun = true;
    }
    expect(doneRun).toBe(true);
    let crouch = false;
    for (let i = 0; i < 40; i++)
      if (t.tick(PlayerState.CROUCH, true, 0, 0, 0).includes('crouch')) crouch = true;
    expect(crouch).toBe(true);
    expect(t.tick(PlayerState.ATTACK, true, 0, AttackKind.FIST3, 3)).toContain('combo');
  });

  it('la liste reflète l’avancement', () => {
    const t = new TrainingTracker(['jump']);
    const list = t.list();
    expect(list.find((o) => o.id === 'jump')?.done).toBe(true);
    expect(list.find((o) => o.id === 'double')?.done).toBe(false);
    expect(list.length).toBe(TRAINING_OBJECTIVES.length);
  });
});

describe('entraînement solo : la vraie simulation, en local', () => {
  it('démarre avec le joueur et les trois mannequins, sur l’arène d’entraînement', () => {
    const { s } = solo();
    run(s, 0.1, 0);
    expect(s.scene.playerCount).toBe(1 + MANNEQUINS.length);
    expect(s.scene.players.filter((p) => p.mannequin).length).toBe(3);
    expect(s.scene.players[0].self).toBe(true);
    expect(s.scene.players[0].name).toBe('Zoé');
    expect(s.world.arena.id).toBe('entrainement');
  });

  it('sauter coche « Saute » et la scène reste finie sur 20 s de gestes variés', () => {
    const { s, done } = solo();
    run(s, 20, (t) => {
      let m = Math.floor(t / 1.5) % 2 === 0 ? Input.RIGHT : Input.LEFT;
      if (Math.floor(t * 2) % 3 === 0) m |= Input.JUMP;
      if (Math.floor(t * 3) % 4 === 0) m |= Input.ATTACK;
      if (Math.floor(t) % 5 === 4) m |= Input.BLOCK;
      return m;
    });
    expect(done).toContain('jump');
    for (const p of s.scene.players.slice(0, s.scene.playerCount)) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      expect(p.hp).toBeLessThanOrEqual(100);
    }
    // aucun dégât ne compte : les PV des mannequins sont intacts
    for (const p of s.scene.players.filter((q) => q.mannequin)) expect(p.hp).toBe(100);
  });

  it('même graine et mêmes entrées : même monde (déterministe)', () => {
    const a = solo(11).s;
    const b = solo(11).s;
    const script = (t: number): number =>
      Math.floor(t * 2) % 2 === 0 ? Input.RIGHT | Input.JUMP : Input.LEFT;
    run(a, 8, script);
    run(b, 8, script);
    expect(hashWorld(a.world)).toBe(hashWorld(b.world));
  });

  it('la pause fige la simulation', () => {
    const { s } = solo();
    run(s, 0.5, 0);
    const t0 = s.world.tick;
    s.paused = true;
    run(s, 2, Input.RIGHT);
    expect(s.world.tick).toBe(t0);
    s.paused = false;
    run(s, 0.5, 0);
    expect(s.world.tick).toBeGreaterThan(t0);
  });

  it('une image très longue (onglet masqué) ne simule pas des secondes d’un coup', () => {
    const { s } = solo();
    run(s, 0.2, 0);
    const t0 = s.world.tick;
    s.update(0, 0, 5000);
    expect(s.world.tick - t0).toBeLessThanOrEqual(7);
  });

  it('une emote déclenche l’événement et l’objectif', () => {
    const { s, events, done } = solo();
    s.emote(3);
    expect(events.some((e) => e.type === SimEvent.EMOTE && e.a[0] === 3)).toBe(true);
    expect(done).toContain('emote');
  });

  it('le coup de poing donne bien l’attaque dans la phase active à un moment', () => {
    const { s } = solo();
    let sawActive = false;
    for (let i = 0; i < 120; i++) {
      s.update(i % 20 < 2 ? Input.ATTACK : 0, 0, TICK_MS);
      const p = s.world.players[0];
      if (p.atkPhase === AtkPhase.ACTIVE) sawActive = true;
    }
    expect(sawActive).toBe(true);
  });
});
