import { EMOTES, Input } from '@stickyclaude/shared';
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { options, setOptions } from '../app/options.ts';
import { actions, overlay } from '../app/store.ts';
import { pick, t } from '../i18n/index.ts';
import { resetTouch, setButton, setStick, STICK_RADIUS, vibrate } from '../input/touch.ts';
import { Button } from './components.tsx';

/**
 * Contrôles tactiles (analyse §1.6) : joystick virtuel à gauche (à 8 directions), boutons à droite
 * placés dans les `safe-area-inset`, taille réglable, vibration. Le jeu est en paysage : en
 * portrait un message demande de tourner le téléphone.
 */

function Btn(p: {
  cls: string;
  bit: number;
  children: JSX.Element | string;
  label: string;
}): JSX.Element {
  const [down, setDown] = useState(false);
  const o = options.value;
  const press = (on: boolean): void => {
    setButton(p.bit, on);
    setDown(on);
    if (on && o.vibration) vibrate(12);
  };
  return (
    <button
      type="button"
      class={`tbtn ${p.cls}${down ? ' down' : ''}`}
      aria-label={p.label}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        press(true);
      }}
      onPointerUp={() => press(false)}
      onPointerCancel={() => press(false)}
      onLostPointerCapture={() => press(false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {p.children}
    </button>
  );
}

function Stick(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const o = options.value;
  const track = (e: PointerEvent): void => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const radius = Math.max(STICK_RADIUS * o.stickSize, r.width / 2);
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > radius) {
      dx = (dx / len) * radius;
      dy = (dy / len) * radius;
    }
    setStick(dx, dy, true, radius);
    if (knob.current) knob.current.style.transform = `translate(${dx * 0.55}px, ${dy * 0.55}px)`;
  };
  const release = (): void => {
    setStick(0, 0, false);
    if (knob.current) knob.current.style.transform = '';
  };
  return (
    <div
      ref={ref}
      class={`stickzone${o.touchSwap ? ' swap' : ''}`}
      role="application"
      aria-label={t('touch.stick')}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        track(e);
      }}
      onPointerMove={(e) => {
        if (e.buttons !== 0 || e.pointerType === 'touch') track(e);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div class="knob" ref={knob} />
    </div>
  );
}

/** Plein écran (si le navigateur le permet et si l'on vient d'un geste du joueur). */
export function enterFullscreen(): void {
  try {
    const el = document.documentElement;
    if (document.fullscreenElement || !el.requestFullscreen) return;
    if (navigator.userActivation && !navigator.userActivation.isActive) return;
    el.requestFullscreen().catch(() => {
      /* refusé : sans importance */
    });
  } catch {
    /* refusé : sans importance */
  }
}

export function TouchControls(): JSX.Element {
  const o = options.value;
  const [emotes, setEmotes] = useState(false);
  // Démonté en plein appui (fin de partie, menu) : aucun bouton ne reste enfoncé pour la suite.
  useEffect(() => resetTouch, []);
  return (
    <div
      class="touch"
      style={{ '--touch-size': String(o.touchSize), '--stick-size': String(o.stickSize) }}
    >
      <Stick />
      <div class={`tbtns${o.touchSwap ? ' swap' : ''}`}>
        <Btn cls="jump" bit={Input.JUMP} label={t('touch.jump')}>
          ⤒
        </Btn>
        <Btn cls="attack" bit={Input.ATTACK} label={t('touch.attack')}>
          ✊
        </Btn>
        <Btn cls="block" bit={Input.BLOCK} label={t('touch.block')}>
          🛡
        </Btn>
        <Btn cls="special" bit={Input.SPECIAL} label={t('touch.special')}>
          ✦
        </Btn>
        <Btn cls="crouch" bit={Input.DOWN} label={t('touch.crouch')}>
          ⤓
        </Btn>
        <Btn cls="pickup" bit={Input.PICKUP} label={t('touch.pickup')}>
          ✋
        </Btn>
        <Btn cls="dash" bit={Input.DASH} label={t('touch.dash')}>
          ⇥
        </Btn>
      </div>
      <div class="tsmall">
        <Button
          small
          secondary
          label={t('touch.emote')}
          onClick={() => setEmotes(!emotes)}
          pressed={emotes}
        >
          ☺
        </Button>
        <Button
          small
          secondary
          label={t('touch.scores')}
          title={t('touch.scores')}
          pressed={o.showScores}
          onClick={() => setOptions({ showScores: !o.showScores })}
        >
          🏆
        </Button>
        <Button small secondary label={t('touch.fullscreen')} onClick={enterFullscreen}>
          ⛶
        </Button>
        <Button
          small
          secondary
          label={t('touch.menu')}
          onClick={() => {
            resetTouch();
            overlay.value = 'pause';
          }}
        >
          ≡
        </Button>
      </div>
      {emotes && (
        <div
          class="card"
          style={{ position: 'absolute', top: '3.6rem', right: '0.5rem', padding: '0.5rem' }}
        >
          <div class="emotes">
            {EMOTES.map((e, i) => (
              <Button
                key={i}
                small
                secondary
                title={pick(e)}
                onClick={() => {
                  actions.emote(i);
                  setEmotes(false);
                }}
              >
                {i + 1}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
