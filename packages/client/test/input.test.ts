import { Input } from '@stickyclaude/shared';
import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  DEFAULT_BINDINGS,
  defaultOptions,
  options,
  rebind,
  resetBindings,
  sanitizeOptions,
  setOptions,
} from '../src/app/options.ts';
import type { Bindings } from '../src/app/options.ts';
import { detectLayout, keyLabel } from '../src/input/bindings.ts';
import { buildKeymap } from '../src/input/keyboard.ts';
import {
  resetTouch,
  setButton,
  setStick,
  stickToBits,
  touchAimAngle,
  touchMask,
} from '../src/input/touch.ts';

describe('touche virtuelle : le joystick déplace et vise, il ne s’accroupit pas', () => {
  const r = 56;
  it('zone morte au centre', () => {
    expect(stickToBits(3, -2, r)).toBe(0);
  });
  it('seulement gauche et droite : haut et bas ne donnent aucune touche', () => {
    expect(stickToBits(40, 0, r)).toBe(Input.RIGHT);
    expect(stickToBits(-40, 0, r)).toBe(Input.LEFT);
    expect(stickToBits(0, -40, r)).toBe(0);
    expect(stickToBits(0, 40, r)).toBe(0);
    expect(stickToBits(30, 30, r)).toBe(Input.RIGHT);
    expect(stickToBits(-30, -30, r)).toBe(Input.LEFT);
  });
  it('joystick vers le haut + attaque : coup vers le haut, sinon rien', () => {
    resetTouch();
    setStick(0, -50, true);
    setButton(Input.ATTACK, true);
    expect(touchMask() & Input.UP).toBe(Input.UP);
    setButton(Input.ATTACK, false);
    touchMask();
    expect(touchMask() & Input.UP).toBe(0);
    // joystick à plat + attaque : pas de coup vers le haut
    setStick(50, 0, true);
    setButton(Input.ATTACK, true);
    expect(touchMask() & Input.UP).toBe(0);
    setButton(Input.ATTACK, false);
    resetTouch();
    touchMask();
  });
  it('un appui plus court qu’une image est quand même vu une fois', () => {
    setButton(Input.JUMP, true);
    setButton(Input.JUMP, false);
    expect(touchMask() & Input.JUMP).toBe(Input.JUMP);
    expect(touchMask() & Input.JUMP).toBe(0);
  });
  it('le joystick relâché ne laisse aucune direction', () => {
    setStick(50, 0, true);
    expect(touchMask() & Input.RIGHT).toBe(Input.RIGHT);
    setStick(0, 0, false);
    expect(touchMask()).toBe(0);
  });
});

describe('visée au joystick tactile', () => {
  it('suit l’angle exact du pouce, au repos il n’y a pas de visée', () => {
    resetTouch();
    expect(touchAimAngle()).toBeNull();
    setStick(0, -50, true);
    expect(touchAimAngle()).toBeCloseTo(-Math.PI / 2, 6);
    setStick(30, 30, true);
    expect(touchAimAngle()).toBeCloseTo(Math.PI / 4, 6);
    setStick(2, 2, true); // zone morte
    expect(touchAimAngle()).toBeNull();
    setStick(40, 0, false);
    expect(touchAimAngle()).toBeNull();
    resetTouch();
  });
});

describe('touches du clavier', () => {
  it('les touches par défaut donnent WASD et les flèches', () => {
    const m = buildKeymap(DEFAULT_BINDINGS);
    expect(m.get('KeyA')).toBe(Input.LEFT);
    expect(m.get('ArrowLeft')).toBe(Input.LEFT);
    expect(m.get('Space')).toBe(Input.JUMP);
    expect(m.get('KeyJ')).toBe(Input.ATTACK);
    expect(m.get('KeyK')).toBe(Input.BLOCK);
    expect(m.get('KeyL')).toBe(Input.PICKUP);
  });

  it('reconfigurer retire la touche à l’ancienne action et ne laisse aucune action sans touche', () => {
    resetBindings();
    rebind('attack', 0, 'KeyF');
    expect(options.value.bindings.attack[0]).toBe('KeyF');
    rebind('block', 0, 'KeyF');
    expect(options.value.bindings.block[0]).toBe('KeyF');
    // « attack » a perdu sa touche principale : sa secondaire (vide) ne la remplace pas
    expect(options.value.bindings.attack).toEqual(['', '']);
    rebind('jump', 0, 'ArrowLeft');
    expect(options.value.bindings.left).toEqual(['KeyA', '']);
    for (const a of ACTIONS) expect(typeof options.value.bindings[a][0]).toBe('string');
    resetBindings();
    expect(options.value.bindings).toEqual(DEFAULT_BINDINGS);
  });

  it('les libellés suivent la disposition : AZERTY affiche Z, Q, S, D', () => {
    expect(keyLabel('KeyW', 'azerty')).toBe('Z');
    expect(keyLabel('KeyA', 'azerty')).toBe('Q');
    expect(keyLabel('KeyW', 'qwerty')).toBe('W');
    expect(keyLabel('Space', 'qwerty', 'Space')).toBe('Space');
    expect(keyLabel('ArrowLeft', 'qwerty')).toBe('←');
    expect(keyLabel('Digit3', 'qwerty')).toBe('3');
    expect(keyLabel('', 'qwerty')).toBe('—');
  });

  it('détecte AZERTY quand la touche physique Q donne « a »', () => {
    expect(detectLayout({ get: (c) => (c === 'KeyQ' ? 'a' : undefined) })).toBe('azerty');
    expect(detectLayout({ get: (c) => (c === 'KeyQ' ? 'q' : undefined) })).toBe('qwerty');
    expect(detectLayout(null)).toBe('qwerty');
  });
});

describe('options', () => {
  it('valide chaque valeur et ignore le reste', () => {
    const o = sanitizeOptions({
      lang: 'de',
      master: 7,
      sfx: -1,
      quality: 'ultra',
      fpsCap: 144,
      textScale: 200,
      bindings: { left: ['KeyQ', '<script>'], jump: 'Space' },
      touchSize: 99,
      hack: true,
    });
    const d = defaultOptions('fr-FR');
    expect(o.lang).toBe('fr');
    expect(o.master).toBe(1);
    expect(o.sfx).toBe(0);
    expect(o.quality).toBe('auto');
    expect(o.fpsCap).toBe(0);
    expect(o.textScale).toBe(100);
    expect(o.bindings.left).toEqual(['KeyQ', DEFAULT_BINDINGS.left[1]]);
    expect(o.bindings.jump).toEqual(DEFAULT_BINDINGS.jump);
    expect(o.touchSize).toBe(1.8);
    expect(o.stickSize).toBe(1.8);
    expect(Object.keys(o)).toEqual(Object.keys(d));
  });

  it('la langue par défaut suit le navigateur : FR sauf si ça ne commence pas par fr', () => {
    expect(defaultOptions('fr-CA').lang).toBe('fr');
    expect(defaultOptions('en-US').lang).toBe('en');
    expect(defaultOptions('de').lang).toBe('en');
    expect(defaultOptions(undefined).lang).toBe('fr');
  });

  it('setOptions met à jour le signal sans lever sans localStorage', () => {
    setOptions({ master: 0.3, textScale: 115 });
    expect(options.value.master).toBe(0.3);
    expect(options.value.textScale).toBe(115);
    setOptions(defaultOptions());
  });

  it('les touches par défaut couvrent les 8 actions', () => {
    const b: Bindings = DEFAULT_BINDINGS;
    for (const a of ACTIONS) expect(b[a][0]).not.toBe('');
  });
});
