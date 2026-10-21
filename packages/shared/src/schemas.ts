import { z } from 'zod';
import { GRID_H, GRID_W, MAX_PLAYERS } from './constants.ts';
import { isMovementKey } from './movement.ts';
import type { ArenaData } from './arena.ts';

/** Schémas zod : messages de contrôle (JSON) et fichiers d'arènes. Importé côté serveur et tests. */

const cell = z.tuple([z.number().int().min(0).max(GRID_W), z.number().int().min(0).max(GRID_H)]);

const rect = z.tuple([
  z.number().int().min(0).max(GRID_W),
  z.number().int().min(0).max(GRID_H),
  z.number().int().min(1).max(GRID_W),
  z.number().int().min(1).max(GRID_H),
]);

const GRID_ROW = new RegExp(`^[.#p\\-^]{${GRID_W}}$`);

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
    props: z.array(z.object({ type: z.string().max(20), at: cell }).strict()).max(64),
    modes: z
      .object({
        koth: z.object({ zone: rect }).strict().optional(),
        ball: z
          .object({ goals: z.tuple([rect, rect]) })
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
  })
  .strict();

/** Garde-fou de compilation : le schéma produit bien un `ArenaData`. */
export function parseArena(data: unknown): ArenaData {
  return arenaSchema.parse(data);
}

const name = z.string().min(1).max(64);

/** Messages de contrôle client → serveur (JSON, longueurs bornées, énumérations strictes). */
export const clientMessageSchema = z.discriminatedUnion('t', [
  z
    .object({
      t: z.literal('create'),
      v: z.number().int(),
      name,
      arena: z.string().max(40).optional(),
    })
    .strict(),
  z
    .object({
      t: z.literal('join'),
      v: z.number().int(),
      name,
      code: z.string().min(1).max(8),
    })
    .strict(),
  z.object({ t: z.literal('leave') }).strict(),
  z
    .object({
      t: z.literal('tune'),
      k: z.string().max(32).refine(isMovementKey, 'unknown movement key'),
      val: z.number().finite(),
    })
    .strict(),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
