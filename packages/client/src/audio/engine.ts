import type { GameEvent } from '../net/client.ts';
import type { AudioSink } from '../app/source.ts';

/** Moteur audio : l'implémentation complète (Web Audio, sons générés) arrive dans `audio/`. */
export class AudioEngine implements AudioSink {
  setVolumes(_master: number, _sfx: number, _music: number): void {
    /* à venir */
  }
  unlock(): void {
    /* à venir */
  }
  event(_e: GameEvent, _own: number): void {
    /* à venir */
  }
  local(_type: number, _x: number, _y: number, _arg: number): void {
    /* à venir */
  }
  footstep(_x: number, _speed: number): void {
    /* à venir */
  }
}
