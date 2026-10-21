/** Types de messages binaires. Client → serveur : 1..15. Serveur → client : 16..31. */
export const BinType = {
  INPUT: 1,
  PING: 2,
  SNAPSHOT: 17,
  PONG: 18,
} as const;
