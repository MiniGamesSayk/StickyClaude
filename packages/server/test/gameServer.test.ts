import {
  BinType,
  Input,
  MAX_PLAYERS,
  PROTOCOL_VERSION,
  ReliableType,
  readSlotPosPayload,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  SimEvent,
} from '@stickyclaude/shared';
import { describe, expect, it } from 'vitest';
import { harness } from './helpers.ts';

describe('salons', () => {
  it('crée un salon avec un code de 5 caractères sans caractères ambigus', () => {
    const h = harness();
    const a = h.connect();
    const code = h.create(a);
    expect(code).toHaveLength(ROOM_CODE_LENGTH);
    for (const ch of code) expect(ROOM_CODE_ALPHABET).toContain(ch);
    expect(code).not.toMatch(/[01OIL]/);
    const j = a.lastOf('joined')!;
    expect(j.slot).toBe(0);
    expect(j.host).toBe(0);
    expect(j.arena).toBe('test-flat');
    expect(j.players).toEqual([{ slot: 0, name: 'Alice', color: 0 }]);
    expect(h.server.stats()).toEqual({ rooms: 1, players: 1, connections: 1 });
  });

  it('permet de rejoindre par code (insensible à la casse) et diffuse la liste des joueurs', () => {
    const h = harness();
    const a = h.connect();
    const b = h.connect('10.0.0.2');
    const code = h.create(a);
    h.join(b, code.toLowerCase());
    const jb = b.lastOf('joined')!;
    expect(jb.slot).toBe(1);
    expect(jb.players.map((p) => p.name)).toEqual(['Alice', 'Bob']);
    expect(jb.players.map((p) => p.color)).toEqual([0, 1]);
    const roster = a.lastOf('roster')!;
    expect(roster.players).toHaveLength(2);
    expect(roster.host).toBe(0);
  });

  it('refuse un code inconnu, un mauvais pseudo, une mauvaise version', () => {
    const h = harness();
    const a = h.connect();
    h.join(a, 'ZZZZZ');
    expect(a.lastOf('error')!.code).toBe('not_found');
    h.send(a, { t: 'create', v: PROTOCOL_VERSION, name: 'a' });
    expect(a.lastOf('error')!.code).toBe('bad_name');
    h.send(a, { t: 'create', v: PROTOCOL_VERSION, name: '​​  ' });
    expect(a.lastOf('error')!.code).toBe('bad_name');
    h.send(a, { t: 'create', v: 99, name: 'Alice' });
    expect(a.lastOf('error')!.code).toBe('version');
  });

  it('normalise les pseudos (NFKC, caractères invisibles retirés)', () => {
    const h = harness();
    const a = h.connect();
    h.send(a, { t: 'create', v: PROTOCOL_VERSION, name: '  Ａlice​‮  ' });
    expect(a.lastOf('joined')!.players[0].name).toBe('Alice');
  });

  it('refuse un second create/join pendant qu on est dans un salon', () => {
    const h = harness();
    const a = h.connect();
    const code = h.create(a);
    h.send(a, { t: 'create', v: PROTOCOL_VERSION, name: 'Alice' });
    expect(a.lastOf('error')!.code).toBe('already_joined');
    h.join(a, code);
    expect(a.lastOf('error')!.code).toBe('already_joined');
  });

  it('un salon plein refuse le 9e joueur', () => {
    const h = harness();
    const first = h.connect('1.1.1.1');
    const code = h.create(first);
    for (let i = 1; i < MAX_PLAYERS; i++) {
      const c = h.connect(`1.1.1.${i + 1}`);
      h.join(c, code, `Joueur${i}`);
      expect(c.lastOf('joined')!.slot).toBe(i);
    }
    const extra = h.connect('1.1.2.1');
    h.join(extra, code, 'Trop');
    expect(extra.lastOf('error')!.code).toBe('full');
  });

  it('donne à chaque joueur une couleur d encre différente', () => {
    const h = harness();
    const conns = Array.from({ length: 8 }, (_, i) => h.connect(`2.2.2.${i}`));
    const code = h.create(conns[0]);
    for (let i = 1; i < 8; i++) h.join(conns[i], code, `J${i}x`);
    const roster = conns[7].lastOf('joined')!.players;
    expect(new Set(roster.map((p) => p.color)).size).toBe(8);
  });

  it('transmet l hôte au joueur le plus ancien quand il part', () => {
    const h = harness();
    const a = h.connect('3.0.0.1');
    const b = h.connect('3.0.0.2');
    const c = h.connect('3.0.0.3');
    const code = h.create(a);
    h.join(b, code, 'Bobb');
    h.join(c, code, 'Carl');
    h.server.onClose(a);
    expect(b.lastOf('roster')!.host).toBe(1);
    h.server.onClose(b);
    expect(c.lastOf('roster')!.host).toBe(2);
  });

  it('libère l emplacement et supprime le salon vide après le délai d inactivité', () => {
    const h = harness({ ROOM_IDLE_TTL_SEC: '2' });
    const a = h.connect();
    const code = h.create(a);
    h.server.onClose(a);
    expect(h.server.rooms.has(code)).toBe(true);
    h.advance(60);
    expect(h.server.rooms.has(code)).toBe(true);
    h.advance(120);
    expect(h.server.rooms.has(code)).toBe(false);
  });

  it('applique MAX_ROOMS, MAX_CONNECTIONS et MAX_CONN_PER_IP', () => {
    const h = harness({ MAX_ROOMS: '2', MAX_CONNECTIONS: '5', MAX_CONN_PER_IP: '2' });
    const a = h.connect('9.0.0.1');
    const b = h.connect('9.0.0.2');
    h.create(a);
    h.create(b);
    const c = h.connect('9.0.0.3');
    h.send(c, { t: 'create', v: PROTOCOL_VERSION, name: 'Carl' });
    expect(c.lastOf('error')!.code).toBe('server_full');
    const d1 = h.connect('9.0.0.4');
    const d2 = h.connect('9.0.0.4');
    const d3 = h.connect('9.0.0.4');
    expect(d1.closed).toBeNull();
    expect(d2.closed).toBeNull();
    expect(d3.closed).not.toBeNull();
    const e = h.connect('9.0.0.5');
    expect(e.closed).not.toBeNull(); // 6e connexion > MAX_CONNECTIONS
  });

  it('limite la création de salons à 3 par minute et par IP', () => {
    const h = harness();
    const codes: string[] = [];
    for (let i = 0; i < 3; i++) {
      const c = h.connect('7.7.7.7');
      codes.push(h.create(c));
    }
    const c4 = h.connect('7.7.7.7');
    h.send(c4, { t: 'create', v: PROTOCOL_VERSION, name: 'Alice' });
    expect(c4.lastOf('error')!.code).toBe('rate_limited');
    h.time += 61_000;
    const c5 = h.connect('7.7.7.7');
    expect(h.create(c5)).toHaveLength(ROOM_CODE_LENGTH);
  });

  it('limite les essais de codes à 10 par minute et par IP', () => {
    const h = harness();
    const a = h.connect('8.8.8.8');
    for (let i = 0; i < 10; i++) {
      h.join(a, 'ZZZZZ');
      expect(a.lastOf('error')!.code).toBe('not_found');
    }
    h.join(a, 'ZZZZY');
    expect(a.lastOf('error')!.code).toBe('rate_limited');
    // Même un bon code est refusé pendant le blocage
    const owner = h.connect('8.8.4.4');
    const code = h.create(owner);
    h.join(a, code);
    expect(a.lastOf('error')!.code).toBe('rate_limited');
  });
});

describe('messages invalides', () => {
  it('déconnecte après 20 messages invalides', () => {
    const h = harness();
    const a = h.connect();
    for (let i = 0; i < 19; i++) h.server.onMessage(a, 'pas du json', false);
    expect(a.closed).toBeNull();
    h.server.onMessage(a, '{"t":"nope"}', false);
    expect(a.closed?.code).toBe(1008);
  });

  it('compte les binaires invalides (avant d avoir rejoint, mauvais type, tronqués)', () => {
    const h = harness();
    const a = h.connect();
    h.server.onMessage(a, new Uint8Array([BinType.INPUT, 0, 0]), true);
    h.server.onMessage(a, new Uint8Array([200, 1, 2]), true);
    h.server.onMessage(a, new Uint8Array(0), true);
    h.server.onMessage(a, 'texte reçu comme binaire', true);
    expect(h.server.metrics.invalidMessages).toBe(4);
    h.create(a);
    h.server.onMessage(a, new Uint8Array([BinType.INPUT, 1]), true);
    expect(h.server.metrics.invalidMessages).toBe(5);
  });

  it('ne plante pas sur des messages JSON hostiles', () => {
    const h = harness();
    const a = h.connect();
    for (const m of [
      'null',
      '[]',
      '{"t":"create"}',
      '{"t":"create","v":1,"name":{"a":1}}',
      '{"t":"join","v":1,"name":"abcd","code":["x"]}',
      '{"t":"__proto__"}',
      '{"t":"tune","k":"constructor","val":1}',
    ]) {
      h.server.onMessage(a, m, false);
    }
    expect(a.closed).toBeNull();
  });
});

describe('réglage en direct', () => {
  it('est refusé sans DEV_TOOLS', () => {
    const h = harness();
    const a = h.connect();
    h.create(a);
    h.send(a, { t: 'tune', k: 'runSpeed', val: 300 });
    expect(a.lastOf('error')!.code).toBe('forbidden');
  });

  it('modifie le monde et prévient tous les joueurs avec DEV_TOOLS', () => {
    const h = harness({ DEV_TOOLS: '1' });
    const a = h.connect();
    const b = h.connect('10.0.0.2');
    const code = h.create(a);
    h.join(b, code);
    h.send(a, { t: 'tune', k: 'runSpeed', val: 99999 });
    const room = h.server.rooms.get(code)!;
    expect(room.world.params.runSpeed).toBe(400); // plafonné par les bornes de réglage
    expect(b.lastOf('tune')).toEqual({ t: 'tune', k: 'runSpeed', val: 400 });
  });
});

describe('ticks, entrées et snapshots', () => {
  it('envoie des snapshots à 30 Hz avec le bloc own', () => {
    const h = harness();
    const a = h.connect();
    h.create(a);
    h.advance(60);
    const snaps = a.snapshots();
    expect(snaps).toHaveLength(30);
    expect(snaps[0].hasOwn).toBe(true);
    expect(snaps[snaps.length - 1].tick).toBe(60);
    // Le joueur tombe au sol puis reste immobile
    const last = snaps[snaps.length - 1];
    expect(last.own.y).toBeCloseTo(528, 1);
    expect(last.playerCount).toBe(1);
  });

  it('applique les entrées étiquetées par tick, de façon déterministe', () => {
    const h = harness();
    const a = h.connect();
    h.create(a);
    h.advance(60); // se pose
    const x0 = a.snapshots().at(-1)!.own.x;
    // Envoie 30 ticks d'entrée « droite » à l'avance (labels 61..90)
    for (let t = 61; t <= 90; t += 4) {
      h.sendInput(a, t + 3 > 90 ? 90 : t + 3, [Input.RIGHT, Input.RIGHT, Input.RIGHT, Input.RIGHT]);
    }
    h.advance(30);
    const x1 = a.snapshots().at(-1)!.own.x;
    expect(x1).toBeGreaterThan(x0 + 40);
    // vitesse max atteinte
    expect(a.snapshots().at(-1)!.own.vx).toBeCloseTo(190, 1);
  });

  it('répète la dernière entrée quand une entrée manque, puis revient au neutre', () => {
    const h = harness();
    const a = h.connect();
    h.create(a);
    h.advance(60);
    h.sendInput(a, 62, [Input.RIGHT, Input.RIGHT]); // labels 61 et 62
    h.advance(10);
    // 8 ticks sans entrée : la dernière est répétée => le joueur court encore
    expect(a.snapshots().at(-1)!.own.vx).toBeGreaterThan(100);
    h.advance(60);
    // Au-delà de 20 ticks manquants, entrée neutre : il s'arrête
    expect(a.snapshots().at(-1)!.own.vx).toBe(0);
  });

  it('rejette les entrées en retard et trop en avance, et signale la marge', () => {
    const h = harness();
    const a = h.connect();
    h.create(a);
    h.advance(10);
    // prochain label = 11. Marge = 5 - 0 pour label 16.
    h.sendInput(a, 16, [Input.LEFT]);
    h.advance(2); // snapshot au tick 12
    expect(a.snapshots().at(-1)!.margin).toBe(5);
    // Retard : label 5 alors que le prochain est 13
    const late0 = h.server.metrics.inputsLate;
    h.sendInput(a, 5, [Input.LEFT]);
    expect(h.server.metrics.inputsLate).toBe(late0 + 1);
    h.advance(2);
    expect(a.snapshots().at(-1)!.margin).toBe(-8);
    // Trop en avance : ignoré, mais pas de plantage
    h.sendInput(a, 13 + 500, [Input.LEFT]);
    h.advance(4);
    expect(a.closed).toBeNull();
  });

  it('reconstitue les étiquettes de 16 bits autour du tick courant', () => {
    const h = harness();
    const a = h.connect();
    h.create(a);
    h.advance(100);
    const room = [...h.server.rooms.values()][0];
    // Simule un tick proche du retour à zéro de la fenêtre 16 bits
    room.world.tick = 65_530;
    h.sendInput(a, (65_536 + 3) & 0xffff, [Input.RIGHT]); // label 65_539, prochain label 65_531
    h.advance(2);
    expect(room.world.tick).toBe(65_532);
    expect(a.snapshots().at(-1)!.margin).toBe(65_539 - 65_531);
  });

  it('limite les paquets d entrées à 70 par seconde', () => {
    const h = harness();
    const a = h.connect();
    h.create(a);
    for (let i = 0; i < 100; i++) h.sendInput(a, 5, [Input.RIGHT]);
    expect(h.server.metrics.inputsLimited).toBe(30);
    h.time += 1100;
    h.sendInput(a, 5, [Input.RIGHT]);
    expect(h.server.metrics.inputsLimited).toBe(30);
  });

  it('répond aux pings avec le tick et la fraction de tick', () => {
    const h = harness();
    const a = h.connect();
    h.create(a);
    h.advance(5);
    h.time += 8;
    h.sendPing(a, 123456);
    const p = a.pongs()[0];
    expect(p.clientTime).toBe(123456);
    expect(p.tick).toBe(5);
    expect(p.frac).toBeGreaterThan(0.3);
    expect(p.frac).toBeLessThan(0.7);
  });

  it('ne simule pas les salons vides', () => {
    const h = harness({ ROOM_IDLE_TTL_SEC: '600' });
    const a = h.connect();
    const code = h.create(a);
    h.advance(10);
    h.server.onClose(a);
    const tick = h.server.rooms.get(code)!.world.tick;
    h.advance(100);
    expect(h.server.rooms.get(code)!.world.tick).toBe(tick);
  });
});

describe('événements fiables', () => {
  it('répète SPAWN dans les snapshots jusqu à l accusé de réception', () => {
    const h = harness();
    const a = h.connect();
    const code = h.create(a);
    const b = h.connect('10.0.0.2');
    h.advance(10);
    h.join(b, code);
    h.advance(6);
    // Le joueur déjà présent apprend l'arrivée de l'autre, et l'événement est répété.
    const withSpawn = a.snapshots().filter((s) => s.eventCount > 0);
    expect(withSpawn.length).toBeGreaterThanOrEqual(2);
    const e = withSpawn[0].events[0];
    expect(e.type).toBe(ReliableType.SPAWN);
    expect(readSlotPosPayload(e.data, e.len).slot).toBe(1);
    // Le nouvel arrivant, lui, ne reçoit pas son propre SPAWN.
    expect(b.snapshots().every((s) => s.eventCount === 0)).toBe(true);
    // Accusé de réception : plus de répétition
    h.sendInput(a, 30, [0], e.id);
    h.advance(6);
    a.clear();
    h.advance(6);
    expect(a.snapshots().every((s) => s.eventCount === 0)).toBe(true);
  });

  it('livre aussi les événements quand des snapshots sont sautés (contre-pression)', () => {
    const h = harness();
    const a = h.connect();
    const code = h.create(a);
    h.advance(4);
    a.clear();
    a.bufferedAmount = 200_000;
    const b = h.connect('10.0.0.2');
    h.join(b, code);
    h.advance(20);
    expect(a.snapshots()).toHaveLength(0);
    expect(h.server.metrics.snapshotsSkipped).toBeGreaterThan(0);
    a.bufferedAmount = 0;
    h.advance(4);
    const first = a.snapshots()[0];
    expect(first.eventCount).toBeGreaterThanOrEqual(1);
    expect(first.events[0].type).toBe(ReliableType.SPAWN);
    expect(readSlotPosPayload(first.events[0].data, first.events[0].len).slot).toBe(1);
  });

  it('déconnecte un client dont le tampon dépasse 1 Mo', () => {
    const h = harness();
    const a = h.connect();
    h.create(a);
    a.bufferedAmount = 2_000_000;
    h.advance(4);
    expect(a.closed?.code).toBe(1013);
  });

  it('ignore un accusé de réception falsifié (avenir lointain)', () => {
    const h = harness();
    const a = h.connect();
    const code = h.create(a);
    const b = h.connect('10.0.0.2');
    h.join(b, code);
    h.advance(2);
    h.sendInput(a, 10, [0], 30000);
    h.advance(4);
    // L'événement SPAWN de l'autre joueur n'est pas considéré comme acquitté
    expect(a.snapshots().at(-1)!.eventCount).toBeGreaterThan(0);
  });

  it('émet FELL puis SPAWN quand un joueur tombe hors de la page', () => {
    const h = harness();
    const a = h.connect();
    const code = h.create(a);
    h.advance(70);
    const room = h.server.rooms.get(code)!;
    const p = room.world.players[0];
    p.x = 31 * 16;
    p.y = 34 * 16; // dans le fossé
    p.vy = 400;
    p.grounded = false;
    const before = room.reliable.lastId;
    h.advance(120);
    expect(room.reliable.lastId - before).toBeGreaterThanOrEqual(2);
    const types = new Set<number>();
    for (const s of a.snapshots())
      for (let i = 0; i < s.eventCount; i++) types.add(s.events[i].type);
    expect(types.has(ReliableType.FELL)).toBe(true);
    expect(room.world.events.count).toBeGreaterThanOrEqual(0);
    expect(SimEvent.FELL).toBeDefined();
  });
});

describe('enregistrement', () => {
  it('enregistre les entrées et permet de les rejouer à l identique', async () => {
    const { replayRecording, hashWorld } = await import('@stickyclaude/sim');
    const h = harness({ DEV_TOOLS: '1' });
    const a = h.connect();
    const b = h.connect('10.0.0.2');
    const code = h.create(a);
    h.advance(20);
    h.join(b, code);
    let label = 21;
    for (let round = 0; round < 40; round++) {
      h.sendInput(a, label + 3, [
        round % 3 === 0 ? Input.JUMP : Input.RIGHT,
        Input.RIGHT,
        0,
        Input.LEFT,
      ]);
      h.sendInput(b, label + 3, [Input.LEFT | Input.JUMP, Input.LEFT, Input.DOWN, 0]);
      h.advance(4);
      label += 4;
      h.time += 20; // éviter la limite de débit
    }
    const room = h.server.rooms.get(code)!;
    const rec = room.recording!.toRecording(room.world.tick);
    const replayed = replayRecording(rec, room.arena);
    expect(replayed.tick).toBe(room.world.tick);
    expect(hashWorld(replayed)).toBe(room.stateHash());
  });
});
