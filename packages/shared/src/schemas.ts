import { z } from 'zod';
import { GRID_H, GRID_W, MAX_PLAYERS, VOTE_OPTIONS } from './constants.ts';
import { EMOTE_COUNT } from './emotes.ts';
import { SUDDEN_MAX_SEC, SUDDEN_MIN_SEC } from './settings.ts';
import { isMovementKey } from './movement.ts';
import { SPAWNABLE_WEAPONS } from './weapons.ts';
import type { ArenaData } from './arena.ts';

/** Schémas zod : messages de contrôle (JSON) et fichiers d'arènes. Importé côté serveur et tests. */

const cell = z.tuple([z.number().int().min(0).max(GRID_W), z.number().int().min(0).max(GRID_H)]);

const rect = z.tuple([
  z.number().int().min(0).max(GRID_W),
  z.number().int().min(0).max(GRID_H),
  z.number().int().min(1).max(GRID_W),
  z.number().int().min(1).max(GRID_H),
]);

const GRID_ROW = new RegExp(`^[.#p\\-^lst]{${GRID_W}}$`);

export const arenaSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,40}$/),
    name: z.object({ fr: z.string().min(1).max(60), en: z.string().min(1).max(60) }).strict(),
    theme: z.string().min(1).max(40),
    size: z.tuple([z.literal(GRID_W), z.literal(GRID_H)]),
    grid: z.array(z.string().regex(GRID_ROW)).length(GRID_H),
    spawns: z
      .object({
        players: z.array(cell).min(MAX_PLAYERS).max(32),
        weapons: z.array(cell).max(32),
      })
      .strict(),
    movers: z
      .array(
        z
          .object({
            rect,
            path: z
              .array(z.tuple([z.number().min(0).max(GRID_W), z.number().min(0).max(GRID_H)]))
              .min(2)
              .max(16),
            period: z.number().positive().max(120),
          })
          .strict()
          .refine((m) => m.path[0][0] === m.rect[0] && m.path[0][1] === m.rect[1], {
            message: 'rect[0..1] must equal path[0]',
          }),
      )
      .max(8),
    props: z
      .array(z.object({ type: z.enum(['crate', 'balloon', 'tack']), at: cell }).strict())
      .max(64),
    modes: z
      .object({
        koth: z.object({ zone: rect }).strict().optional(),
        ball: z
          .object({ goals: z.tuple([rect, rect]), spawn: cell.optional() })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    decor: z
      .array(
        z
          .object({ type: z.string().max(20), at: cell, text: z.string().max(60).optional() })
          .strict(),
      )
      .max(128),
    suddenDeath: z.enum(['ink-rise', 'tear-edges']),
    weapons: z
      .array(
        z
          .number()
          .int()
          .refine((id) => SPAWNABLE_WEAPONS.includes(id)),
      )
      .min(1)
      .max(SPAWNABLE_WEAPONS.length)
      .refine((l) => new Set(l).size === l.length)
      .optional(),
  })
  .strict();

/** Garde-fou de compilation : le schéma produit bien un `ArenaData`. */
export function parseArena(data: unknown): ArenaData {
  return arenaSchema.parse(data);
}

const name = z.string().min(1).max(64);

/** Apparence : indices bornés ; les champs inconnus sont ignorés puis `sanitizeLook` valide. */
export const lookSchema = z
  .object({
    color: z.number(),
    stroke: z.number(),
    hat: z.number(),
    victory: z.number(),
  })
  .partial();

/** Réglages envoyés par l'hôte (partiels) : types stricts, clés inconnues refusées. */
export const settingsPatchSchema = z
  .object({
    mode: z.enum(['ffa', 'teams']),
    teams: z.number().int().min(2).max(4),
    friendlyFire: z.boolean(),
    roundsToWin: z.number().int().min(3).max(7),
    arenas: z.array(z.string().max(40)).max(32),
    weapons: z.boolean(),
    suddenDeath: z.boolean(),
    suddenDeathSec: z.number().int().min(SUDDEN_MIN_SEC).max(SUDDEN_MAX_SEC),
    bonusModes: z.array(z.number().int().min(0).max(31)).max(16),
    bonusEvery: z.number().int().min(0).max(6),
    ghosts: z.boolean(),
    voteMaps: z.boolean(),
    isPublic: z.boolean(),
  })
  .partial()
  .strict();

/** Messages de contrôle client → serveur (JSON, longueurs bornées, énumérations strictes). */
export const clientMessageSchema = z.discriminatedUnion('t', [
  z
    .object({
      t: z.literal('create'),
      v: z.number().int(),
      name,
      look: lookSchema.optional(),
      arena: z.string().max(40).optional(),
      isPublic: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      t: z.literal('join'),
      v: z.number().int(),
      name,
      look: lookSchema.optional(),
      code: z.string().min(1).max(8),
    })
    .strict(),
  z
    .object({ t: z.literal('quick'), v: z.number().int(), name, look: lookSchema.optional() })
    .strict(),
  z
    .object({
      t: z.literal('resume'),
      v: z.number().int(),
      token: z.string().regex(/^[0-9a-f]{32}$/),
      code: z.string().min(1).max(8),
    })
    .strict(),
  z.object({ t: z.literal('leave') }).strict(),
  z.object({ t: z.literal('ready'), ready: z.boolean() }).strict(),
  z.object({ t: z.literal('start') }).strict(),
  z.object({ t: z.literal('settings'), settings: settingsPatchSchema }).strict(),
  z
    .object({
      t: z.literal('teams'),
      assign: z.array(z.number().int().min(-1).max(3)).max(MAX_PLAYERS).optional(),
      shuffle: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      t: z.literal('kick'),
      slot: z
        .number()
        .int()
        .min(0)
        .max(MAX_PLAYERS - 1),
    })
    .strict(),
  z.object({ t: z.literal('look'), look: lookSchema }).strict(),
  /** Vote de carte : indice dans la liste proposée. */
  z
    .object({
      t: z.literal('vote'),
      pick: z
        .number()
        .int()
        .min(0)
        .max(VOTE_OPTIONS - 1),
    })
    .strict(),
  /** Un niveau créé par le joueur, proposé au salon (validé en entier côté serveur). */
  z.object({ t: z.literal('arena'), arena: arenaSchema }).strict(),
  z.object({ t: z.literal('arena_del'), id: z.string().max(60) }).strict(),
  z
    .object({
      t: z.literal('emote'),
      id: z
        .number()
        .int()
        .min(0)
        .max(EMOTE_COUNT - 1),
    })
    .strict(),
  z
    .object({
      t: z.literal('tune'),
      k: z.string().max(32).refine(isMovementKey, 'unknown movement key'),
      val: z.number().finite(),
    })
    .strict(),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
