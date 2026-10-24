import { Input } from '@stickyclaude/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ACTIONS,
  DEFAULT_BINDINGS,
  defaultOptions,
  options,
  rebind,
  rebindPad,
  resetBindings,
  resetPadBindings,
  sanitizeOptions,
  setOptions,
} from '../src/app/options.ts';
import type { Bindings } from '../src/app/options.ts';
import { detectLayout, keyLabel } from '../src/input/bindings.ts';
import { DEFAULT_PAD_BINDINGS } from '../src/app/options.ts';
import { GamepadInput } from '../src/input/gamepad.ts';
import { buildKeymap, KeyboardInput } from '../src/input/keyboard.ts';
import { bindingWarnings } from '../src/input/warnings.ts';
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
    expect(m.get('KeyE')).toBe(Input.BLOCK);
    expect(m.get('KeyL')).toBe(Input.PICKUP);
  });

  it('l’ancienne touche de parade par défaut (K) devient E', () => {
    expect(DEFAULT_BINDINGS.block[0]).toBe('KeyE');
    const o = sanitizeOptions({ bindings: { block: ['KeyK', ''] } });
    expect(o.bindings.block).toEqual(['KeyE', 'Mouse1']);
    expect(sanitizeOptions({ bindings: { block: ['KeyK', 'KeyP'] } }).bindings.block[0]).toBe(
      'KeyK',
    );
  });

  it('reconfigurer retire la touche à l’ancienne action et ne laisse aucune action sans touche', () => {
    resetBindings();
    rebind('attack', 0, 'KeyF');
    expect(options.value.bindings.attack[0]).toBe('KeyF');
    rebind('block', 0, 'KeyF');
    expect(options.value.bindings.block[0]).toBe('KeyF');
    // « attack » a perdu sa touche principale : sa secondaire (le clic gauche) la remplace
    expect(options.value.bindings.attack).toEqual(['Mouse0', '']);
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

describe('manette : un bouton tenu depuis les menus ne reste pas collé en jeu', () => {
  const pad = (pressed: number[], axes: number[] = [0, 0]): unknown => ({
    connected: true,
    axes,
    buttons: Array.from({ length: 17 }, (_, i) => ({
      pressed: pressed.includes(i),
      value: pressed.includes(i) ? 1 : 0,
    })),
  });
  const plug = (p: unknown): void => {
    vi.stubGlobal('navigator', { getGamepads: () => [p] });
  };
  afterEach(() => vi.unstubAllGlobals());

  it('un bouton déjà enfoncé après la remise à zéro est ignoré jusqu’au relâchement', () => {
    const g = new GamepadInput();
    plug(pad([1]));
    g.disarm();
    g.sample();
    expect(g.sample() & Input.BLOCK).toBe(0);
    plug(pad([]));
    g.sample();
    plug(pad([1]));
    expect(g.sample() & Input.BLOCK).toBe(Input.BLOCK);
  });

  it('une gâchette qui ment (pressée mais à zéro) ne compte pas', () => {
    const g = new GamepadInput();
    const liar = pad([]) as { buttons: { pressed: boolean; value: number }[] };
    liar.buttons[6] = { pressed: true, value: 0 };
    plug(liar);
    g.sample();
    expect(g.sample() & Input.BLOCK).toBe(0);
  });

  it('les boutons suivent les réglages, et le dash est configurable', () => {
    const g = new GamepadInput();
    g.bindings = { ...DEFAULT_PAD_BINDINGS, dash: [8, -1], jump: [4, 0] };
    plug(pad([]));
    g.sample(); // relâchés : les boutons sont armés
    plug(pad([8]));
    expect(g.sample() & Input.DASH).toBe(Input.DASH);
    plug(pad([4]));
    expect(g.sample() & Input.DASH).toBe(0);
    expect(g.sample() & Input.JUMP).toBe(Input.JUMP);
  });

  it('capture : le prochain bouton pressé est transmis, pas Start ni la croix', () => {
    const g = new GamepadInput();
    plug(pad([0]));
    const got: number[] = [];
    g.capture((i) => got.push(i));
    g.navigate(0);
    expect(got).toEqual([]); // A tenu au départ : ignoré
    plug(pad([9, 12]));
    g.navigate(10);
    expect(got).toEqual([]);
    plug(pad([5]));
    g.navigate(20);
    expect(got).toEqual([5]);
    plug(pad([]));
    expect(g.navigate(30)).toBeNull();
  });

  it('les directions ne sont pas désarmées', () => {
    const g = new GamepadInput();
    plug(pad([], [1, 0]));
    g.disarm();
    expect(g.sample() & Input.RIGHT).toBe(Input.RIGHT);
  });
});

describe('réglages de la manette', () => {
  it('rebindPad retire le bouton à l’autre action et valide les valeurs', () => {
    resetPadBindings();
    rebindPad('dash', 0, 2);
    expect(options.value.padBindings.dash[0]).toBe(2);
    // l'action qui perd son premier bouton passe son second en premier
    expect(options.value.padBindings.attack).toEqual([7, -1]);
    const bad = sanitizeOptions({ padBindings: { jump: [9, 99], dash: ['x', 12] } });
    expect(bad.padBindings.jump).toEqual(DEFAULT_PAD_BINDINGS.jump);
    expect(bad.padBindings.dash).toEqual(DEFAULT_PAD_BINDINGS.dash);
    resetPadBindings();
  });
});

describe('touche de dash par défaut', () => {
  it('Maj gauche et A (AZERTY) ; l’ancien réglage par défaut est migré, un choix perso est gardé', () => {
    expect(DEFAULT_BINDINGS.dash).toEqual(['ShiftLeft', 'KeyQ']);
    const old = sanitizeOptions({ bindings: { dash: ['ShiftLeft', 'ShiftRight'] } });
    expect(old.bindings.dash).toEqual(['ShiftLeft', 'KeyQ']);
    const custom = sanitizeOptions({ bindings: { dash: ['KeyX', ''] } });
    expect(custom.bindings.dash).toEqual(['KeyX', '']);
  });
});

describe('souris paramétrable : plus rien de sous-entendu', () => {
  it('par défaut : clic gauche attaque, clic droit attaque spéciale, clic molette défense', () => {
    const m = buildKeymap(DEFAULT_BINDINGS);
    expect(m.get('Mouse0')).toBe(Input.ATTACK);
    expect(m.get('Mouse2')).toBe(Input.SPECIAL);
    expect(m.get('Mouse1')).toBe(Input.BLOCK);
    expect(m.get('KeyE')).toBe(Input.BLOCK);
    expect(m.get('KeyK')).toBe(Input.SPECIAL);
  });

  it('on peut lier la défense au clic droit, et le libellé suit la langue', () => {
    resetBindings();
    rebind('block', 1, 'Mouse2');
    expect(options.value.bindings.block).toEqual(['KeyE', 'Mouse2']);
    // le clic droit n'appartient plus à l'attaque spéciale
    expect(options.value.bindings.special).toEqual(['KeyK', '']);
    expect(buildKeymap(options.value.bindings).get('Mouse2')).toBe(Input.BLOCK);
    expect(keyLabel('Mouse2', 'qwerty', 'Space', 'fr')).toBe('Clic D');
    expect(keyLabel('Mouse2', 'qwerty', 'Space', 'en')).toBe('Right click');
    resetBindings();
  });

  it('d’anciens réglages gardent le clic gauche et reçoivent le clic droit spécial et la molette', () => {
    const o = sanitizeOptions({ bindings: { attack: ['KeyJ', ''], block: ['KeyE', ''] } });
    expect(o.bindings.attack).toEqual(['KeyJ', 'Mouse0']);
    expect(o.bindings.special).toEqual(['KeyK', 'Mouse2']);
    expect(o.bindings.block).toEqual(['KeyE', 'Mouse1']);
    // une touche déjà prise n'est pas dupliquée
    const o2 = sanitizeOptions({ bindings: { pickup: ['KeyK', 'Mouse2'] } });
    expect(o2.bindings.pickup).toEqual(['KeyK', 'Mouse2']);
    expect(o2.bindings.special).toEqual(['', '']);
    const o4 = sanitizeOptions({
      bindings: { dash: ['ShiftLeft', 'Mouse1'], block: ['KeyE', ''] },
    });
    expect(o4.bindings.block).toEqual(['KeyE', '']);
    // des réglages déjà à jour ne sont pas retouchés
    const o3 = sanitizeOptions({
      bindings: { attack: ['KeyJ', ''], special: ['KeyH', ''] },
    });
    expect(o3.bindings.attack).toEqual(['KeyJ', '']);
    expect(o3.bindings.special).toEqual(['KeyH', '']);
  });

  it('l’ancien nom de l’action (« spike ») est repris par l’attaque spéciale', () => {
    const o = sanitizeOptions({
      bindings: { attack: ['KeyJ', 'Mouse0'], spike: ['KeyH', 'Mouse2'] },
      padBindings: { spike: [8, -1] },
    });
    expect(o.bindings.special).toEqual(['KeyH', 'Mouse2']);
    expect(o.padBindings.special).toEqual([8, -1]);
  });
});

describe('avertissements de combinaisons', () => {
  const ff = { firefox: true, mac: false };
  const other = { firefox: false, mac: false };
  const base = (): Bindings => structuredClone(DEFAULT_BINDINGS);

  it('Maj + clic droit sous Firefox', () => {
    const b = base();
    expect(bindingWarnings(b, ff).map((w) => w.id)).toContain('shift_rightclick');
    expect(bindingWarnings(b, other).map((w) => w.id)).not.toContain('shift_rightclick');
    b.special[1] = '';
    expect(bindingWarnings(b, ff).map((w) => w.id)).not.toContain('shift_rightclick');
  });

  it('Ctrl avec W, T, N… ; Alt avec les flèches ; touches de fonction ; boutons latéraux', () => {
    const b = base();
    b.dash = ['ControlLeft', ''];
    expect(bindingWarnings(b, other).map((w) => w.id)).toContain('ctrl_tab');
    b.dash = ['AltLeft', ''];
    const ids = bindingWarnings(b, other).map((w) => w.id);
    expect(ids).toContain('alt_arrows');
    expect(ids).toContain('alt_alone');
    b.dash = ['F5', ''];
    expect(bindingWarnings(b, other).map((w) => w.id)).toContain('function_key');
    b.dash = ['Mouse3', ''];
    expect(bindingWarnings(b, other).map((w) => w.id)).toContain('mouse_side');
  });

  it('une même touche pour deux actions', () => {
    const b = base();
    b.pickup = ['KeyE', ''];
    expect(bindingWarnings(b, other).find((w) => w.id === 'duplicate')?.keys).toEqual(['KeyE']);
  });

  it('les réglages par défaut ne dérangent personne hors Firefox', () => {
    expect(bindingWarnings(base(), other)).toEqual([]);
  });
});

describe('manette : attaque spéciale et défense', () => {
  const pad = (pressed: number[]): unknown => ({
    connected: true,
    axes: [0, 0],
    buttons: Array.from({ length: 17 }, (_, i) => ({
      pressed: pressed.includes(i),
      value: pressed.includes(i) ? 1 : 0,
    })),
  });
  const plug = (p: unknown): void => {
    vi.stubGlobal('navigator', { getGamepads: () => [p] });
  };
  afterEach(() => vi.unstubAllGlobals());

  it('le clic du stick droit envoie l’attaque spéciale tant qu’il est tenu', () => {
    const g = new GamepadInput();
    plug(pad([]));
    g.sample();
    plug(pad([11]));
    expect(g.sample() & Input.SPECIAL).toBe(Input.SPECIAL);
    expect(g.sample() & Input.SPECIAL).toBe(Input.SPECIAL);
    plug(pad([]));
    expect(g.sample() & Input.SPECIAL).toBe(0);
  });

  it('B pare tant qu’il est tenu', () => {
    const g = new GamepadInput();
    plug(pad([]));
    g.sample();
    plug(pad([1]));
    expect(g.sample() & Input.BLOCK).toBe(Input.BLOCK);
    expect(g.sample() & Input.BLOCK).toBe(Input.BLOCK);
    plug(pad([]));
    expect(g.sample() & Input.BLOCK).toBe(0);
  });

  it('un bouton tenu depuis un menu ne pare pas', () => {
    const g = new GamepadInput();
    plug(pad([1]));
    g.disarm();
    expect(g.sample() & Input.BLOCK).toBe(0);
  });
});

describe('clavier : une touche relâchée ne reste jamais collée', () => {
  type Handler = (e: unknown) => void;
  class Dummy {}
  const rig = (): {
    kb: KeyboardInput;
    fire: (type: string, e: Record<string, unknown>) => void;
    body: object;
    field: object;
    canvas: object;
  } => {
    const handlers = new Map<string, Handler[]>();
    const target = {
      addEventListener: (t: string, fn: Handler) => {
        handlers.set(t, [...(handlers.get(t) ?? []), fn]);
      },
    };
    vi.stubGlobal('document', {
      hidden: false,
      addEventListener: () => {},
      documentElement: { addEventListener: () => {} },
    });
    class Input_ extends Dummy {}
    class Canvas_ extends Dummy {}
    vi.stubGlobal('HTMLInputElement', Input_);
    vi.stubGlobal('HTMLTextAreaElement', class extends Dummy {});
    vi.stubGlobal('HTMLSelectElement', class extends Dummy {});
    vi.stubGlobal('HTMLCanvasElement', Canvas_);
    vi.stubGlobal('Element', Dummy);
    const kb = new KeyboardInput(target as unknown as Window);
    return {
      kb,
      fire: (type, e) => handlers.get(type)?.forEach((fn) => fn({ preventDefault() {}, ...e })),
      body: new Dummy(),
      field: new Input_(),
      canvas: new Canvas_(),
    };
  };
  afterEach(() => vi.unstubAllGlobals());

  it('la parade se tient au clavier et à la molette, et se lâche au relâchement', () => {
    const { kb, fire, body, canvas } = rig();
    fire('keydown', { code: 'KeyE', target: body });
    expect(kb.sample() & Input.BLOCK).toBe(Input.BLOCK);
    fire('keydown', { code: 'KeyE', repeat: true, target: body });
    expect(kb.sample() & Input.BLOCK).toBe(Input.BLOCK);
    fire('keyup', { code: 'KeyE', target: body });
    expect(kb.sample() & Input.BLOCK).toBe(0);
    fire('pointerdown', {
      button: 1,
      pointerType: 'mouse',
      target: canvas,
      clientX: 5,
      clientY: 5,
    });
    expect(kb.sample() & Input.BLOCK).toBe(Input.BLOCK);
    fire('pointerup', { button: 1, pointerType: 'mouse', target: canvas });
    expect(kb.sample() & Input.BLOCK).toBe(0);
  });

  it('le clic droit est l’attaque spéciale, tenu comme un bouton', () => {
    const { kb, fire, canvas, body } = rig();
    fire('pointerdown', {
      button: 2,
      pointerType: 'mouse',
      target: canvas,
      clientX: 5,
      clientY: 5,
    });
    kb.sample();
    expect(kb.sample() & Input.SPECIAL).toBe(Input.SPECIAL);
    fire('pointerup', { button: 2, pointerType: 'mouse', target: body });
    expect(kb.sample() & Input.SPECIAL).toBe(0);
  });

  it('relâchée pendant la pause, elle ne revient pas collée à la reprise', () => {
    const { kb, fire, body } = rig();
    fire('keydown', { code: 'KeyD', target: body });
    expect(kb.sample() & Input.RIGHT).toBe(Input.RIGHT);
    kb.enabled = false; // pause, options
    fire('keyup', { code: 'KeyD', target: body });
    kb.enabled = true;
    expect(kb.sample() & Input.RIGHT).toBe(0);
    expect(kb.sample() & Input.RIGHT).toBe(0);
  });

  it('relâchée dans un champ de texte, elle est bien relâchée', () => {
    const { kb, fire, body, field } = rig();
    fire('keydown', { code: 'KeyD', target: body });
    fire('keyup', { code: 'KeyD', target: field });
    kb.sample();
    expect(kb.sample() & Input.RIGHT).toBe(0);
  });

  it('une touche tenue pendant la pause est oubliée à la reprise', () => {
    const { kb, fire, body } = rig();
    fire('keydown', { code: 'KeyD', target: body });
    kb.enabled = false;
    kb.enabled = true;
    expect(kb.sample() & Input.RIGHT).toBe(0);
  });

  it('une touche tenue au clavier continue de compter tant qu’elle n’est pas lâchée', () => {
    const { kb, fire, body } = rig();
    fire('keydown', { code: 'KeyD', target: body });
    kb.sample();
    expect(kb.sample() & Input.RIGHT).toBe(Input.RIGHT);
    fire('keyup', { code: 'KeyD', target: body });
    expect(kb.sample() & Input.RIGHT).toBe(0);
  });

  it('le clic relâché hors du canvas relâche l’attaque', () => {
    const { kb, fire, body, canvas } = rig();
    fire('pointerdown', {
      button: 0,
      pointerType: 'mouse',
      target: canvas,
      clientX: 5,
      clientY: 5,
    });
    kb.sample();
    expect(kb.sample() & Input.ATTACK).toBe(Input.ATTACK);
    fire('pointerup', { button: 0, pointerType: 'mouse', target: body });
    expect(kb.sample() & Input.ATTACK).toBe(0);
  });
});

describe('manette : navigation des menus', () => {
  const padAt = (axes: number[]): unknown => ({
    connected: true,
    axes,
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
  });
  const plug = (p: unknown): void => {
    vi.stubGlobal('navigator', { getGamepads: () => [p] });
  };
  afterEach(() => vi.unstubAllGlobals());

  it('deux appuis rapprochés sont tous deux acceptés', () => {
    const g = new GamepadInput();
    plug(padAt([1, 0]));
    expect(g.navigate(1000)?.dx).toBe(1);
    plug(padAt([0, 0]));
    g.navigate(1050);
    plug(padAt([1, 0]));
    expect(g.navigate(1100)?.dx).toBe(1);
  });

  it('tenu, il attend 350 ms avant de répéter, puis 140 ms', () => {
    const g = new GamepadInput();
    plug(padAt([0, 1]));
    expect(g.navigate(0)?.dy).toBe(1);
    expect(g.navigate(200)).toBeNull();
    expect(g.navigate(360)?.dy).toBe(1);
    expect(g.navigate(450)).toBeNull();
    expect(g.navigate(510)?.dy).toBe(1);
  });

  it('changer de direction sans passer par le centre compte comme un nouvel appui', () => {
    const g = new GamepadInput();
    plug(padAt([1, 0]));
    g.navigate(0);
    plug(padAt([-1, 0]));
    expect(g.navigate(50)?.dx).toBe(-1);
  });

  it('une vibration refusée ne lève rien', async () => {
    const g = new GamepadInput();
    const pad = {
      ...(padAt([0, 0]) as object),
      vibrationActuator: { playEffect: () => Promise.reject(new Error('non')) },
    };
    plug(pad);
    g.rumble(1, 100);
    await new Promise((r) => setTimeout(r, 0)); // un rejet non géré ferait échouer le test
  });
});
