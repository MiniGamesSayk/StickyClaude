import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  ACTIONS,
  defaultOptions,
  options,
  PAD_ACTIONS,
  rebind,
  rebindPad,
  resetBindings,
  resetPadBindings,
  setOptions,
} from '../app/options.ts';
import type { Action, PadAction } from '../app/options.ts';
import { actions, overlay } from '../app/store.ts';
import { t } from '../i18n/index.ts';
import type { MessageKey } from '../i18n/index.ts';
import { currentLayout, keyLabel } from '../input/bindings.ts';
import { bindingWarnings, detectEnv } from '../input/warnings.ts';
import { isTouchDevice } from '../input/touch.ts';
import { Button, Check, Choice, Modal, Slider } from './components.tsx';

type Tab = 'controls' | 'audio' | 'graphics' | 'access' | 'general';

const TABS: { id: Tab; key: MessageKey }[] = [
  { id: 'general', key: 'opt.tab_general' },
  { id: 'controls', key: 'opt.tab_controls' },
  { id: 'audio', key: 'opt.tab_audio' },
  { id: 'graphics', key: 'opt.tab_graphics' },
  { id: 'access', key: 'opt.tab_access' },
];

const ACTION_KEYS: Record<Action, MessageKey> = {
  left: 'act.left',
  right: 'act.right',
  up: 'act.up',
  down: 'act.down',
  jump: 'act.jump',
  attack: 'act.attack',
  block: 'act.block',
  pickup: 'act.pickup',
  dash: 'act.dash',
  spike: 'act.spike',
};

const pct = (v: number): string => `${Math.round(v * 100)} %`;

/** Une touche reconfigurable : cliquer puis appuyer sur la nouvelle. */
function KeyCap(p: { action: Action; slot: 0 | 1 }): JSX.Element {
  const [listening, setListening] = useState(false);
  const o = options.value;
  const code = o.bindings[p.action][p.slot];
  useEffect(() => {
    if (!listening) return;
    actions.captureKey((c) => {
      setListening(false);
      if (c !== 'Escape') rebind(p.action, p.slot, c);
    });
    return () => actions.captureKey(null);
  }, [listening]);
  return (
    <button
      type="button"
      class={`keycap${listening ? ' listening' : ''}`}
      aria-label={`${t(ACTION_KEYS[p.action])} : ${keyLabel(code, o.layout, t('act.jump'), o.lang)}`}
      onClick={() => setListening(!listening)}
    >
      {listening ? '…' : keyLabel(code, o.layout, 'Space', o.lang)}
    </button>
  );
}

/** Nom du bouton de manette (disposition standard), « — » s'il n'y en a pas. */
function padLabel(i: number): string {
  const names = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3'];
  if (i < 0) return '—';
  return names[i] ?? `B${i}`;
}

/** Un bouton de manette reconfigurable : cliquer puis appuyer sur le nouveau bouton. */
function PadCap(p: { action: PadAction; slot: 0 | 1 }): JSX.Element {
  const [listening, setListening] = useState(false);
  const button = options.value.padBindings[p.action][p.slot];
  useEffect(() => {
    if (!listening) return;
    actions.capturePad((i) => {
      setListening(false);
      rebindPad(p.action, p.slot, i);
    });
    return () => actions.capturePad(null);
  }, [listening]);
  return (
    <button
      type="button"
      class={`keycap${listening ? ' listening' : ''}`}
      aria-label={`${t(ACTION_KEYS[p.action])} : ${padLabel(button)}`}
      onClick={() => setListening(!listening)}
    >
      {listening ? '…' : padLabel(button)}
    </button>
  );
}

/** Combinaisons de touches qui risquent de se heurter au navigateur. */
function BindingWarnings(): JSX.Element | null {
  const o = options.value;
  const list = bindingWarnings(o.bindings, detectEnv());
  if (list.length === 0) return null;
  return (
    <div class="warn-list" role="status">
      <strong>⚠ {t('opt.warn_title')}</strong>
      <ul>
        {list.map((w) => (
          <li key={w.id}>
            {t(`opt.warn.${w.id}` as MessageKey)}{' '}
            <span class="hint">
              ({w.keys.map((c) => keyLabel(c, o.layout, t('act.jump'), o.lang)).join(' + ')})
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Controls(): JSX.Element {
  const o = options.value;
  return (
    <div class="field" style={{ gap: '0.7rem' }}>
      <Choice
        label={t('opt.layout')}
        value={o.layout}
        options={[
          {
            value: 'auto' as const,
            label: `${t('opt.layout_auto')} (${currentLayout('auto').toUpperCase()})`,
          },
          { value: 'azerty' as const, label: t('opt.layout_azerty') },
          { value: 'qwerty' as const, label: t('opt.layout_qwerty') },
        ]}
        onChange={(v) => setOptions({ layout: v })}
      />
      <div class="field">
        <span>{t('opt.keys')}</span>
        <div class="keys">
          <span />
          <span class="hint">{t('opt.key_primary')}</span>
          <span class="hint">{t('opt.key_secondary')}</span>
          {ACTIONS.map((a) => (
            <>
              <span key={`l${a}`}>{t(ACTION_KEYS[a])}</span>
              <KeyCap key={`a${a}`} action={a} slot={0} />
              <KeyCap key={`b${a}`} action={a} slot={1} />
            </>
          ))}
        </div>
        <p class="hint">{t('opt.key_press')}</p>
        <p class="hint">{t('opt.mouse_hint')}</p>
        <p class="hint">{t('opt.keys_emotes')}</p>
        <BindingWarnings />
        <div>
          <Button small secondary onClick={() => resetBindings()}>
            {t('opt.key_reset')}
          </Button>
        </div>
      </div>
      <div class="field">
        <span>{t('opt.pad')}</span>
        <div class="keys">
          <span />
          <span class="hint">{t('opt.key_primary')}</span>
          <span class="hint">{t('opt.key_secondary')}</span>
          {PAD_ACTIONS.map((a) => (
            <>
              <span key={`pl${a}`}>{t(ACTION_KEYS[a])}</span>
              <PadCap key={`pa${a}`} action={a} slot={0} />
              <PadCap key={`pb${a}`} action={a} slot={1} />
            </>
          ))}
        </div>
        <p class="hint">{t('opt.pad_press')}</p>
        <p class="hint">{t('opt.gamepad')}</p>
        <div>
          <Button small secondary onClick={() => resetPadBindings()}>
            {t('opt.pad_reset')}
          </Button>
        </div>
      </div>
      <Choice
        label={t('opt.touch')}
        value={o.touch}
        options={[
          { value: 'auto' as const, label: t('opt.touch_auto') },
          { value: 'on' as const, label: t('opt.touch_on') },
          { value: 'off' as const, label: t('opt.touch_off') },
        ]}
        onChange={(v) => setOptions({ touch: v })}
      />
      <Slider
        label={t('opt.stick_size')}
        value={o.stickSize}
        min={0.6}
        max={1.8}
        step={0.05}
        onChange={(v) => setOptions({ stickSize: v })}
        format={pct}
      />
      <Slider
        label={t('opt.touch_size')}
        value={o.touchSize}
        min={0.6}
        max={1.8}
        step={0.05}
        onChange={(v) => setOptions({ touchSize: v })}
        format={pct}
      />
      <Check
        label={t('opt.touch_swap')}
        checked={o.touchSwap}
        onChange={(v) => setOptions({ touchSwap: v })}
      />
      <Check
        label={t('opt.show_scores')}
        checked={o.showScores}
        onChange={(v) => setOptions({ showScores: v })}
      />
      <Check
        label={t('opt.vibration')}
        checked={o.vibration}
        onChange={(v) => setOptions({ vibration: v })}
      />
      <Check
        label={t('opt.pad_rumble')}
        checked={o.padRumble}
        onChange={(v) => setOptions({ padRumble: v })}
      />
      {isTouchDevice() && (
        <Check
          label={t('opt.fullscreen')}
          checked={o.autoFullscreen}
          onChange={(v) => setOptions({ autoFullscreen: v })}
        />
      )}
    </div>
  );
}

/** Fenêtre des options : contrôles, son, graphismes, accessibilité, général. */
export function OptionsModal(): JSX.Element {
  const [tab, setTab] = useState<Tab>('general');
  const o = options.value;
  return (
    <Modal title={t('opt.title')} wide onClose={() => (overlay.value = null)}>
      <h1>{t('opt.title')}</h1>
      <div class="tabs" role="tablist" aria-label={t('opt.title')}>
        {TABS.map((x) => (
          <button
            type="button"
            key={x.id}
            role="tab"
            aria-selected={tab === x.id}
            onClick={(e) => {
              setTab(x.id);
              e.currentTarget.blur();
            }}
          >
            {t(x.key)}
          </button>
        ))}
      </div>
      <div role="tabpanel" class="field" style={{ gap: '0.7rem', minHeight: '12rem' }}>
        {tab === 'general' && (
          <>
            <Choice
              label={t('opt.language')}
              value={o.lang}
              options={[
                { value: 'fr' as const, label: t('opt.lang_fr') },
                { value: 'en' as const, label: t('opt.lang_en') },
              ]}
              onChange={(v) => setOptions({ lang: v })}
            />
            <Check
              label={t('opt.stats')}
              checked={o.showStats}
              onChange={(v) => setOptions({ showStats: v })}
            />
            <div>
              <Button
                small
                secondary
                onClick={() => setOptions(defaultOptions(navigator.language))}
              >
                {t('opt.reset_all')}
              </Button>
            </div>
          </>
        )}
        {tab === 'controls' && <Controls />}
        {tab === 'audio' && (
          <>
            <Slider
              label={t('opt.master')}
              value={o.master}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => setOptions({ master: v })}
              format={pct}
            />
            <Slider
              label={t('opt.sfx')}
              value={o.sfx}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => setOptions({ sfx: v })}
              format={pct}
            />
            <Slider
              label={t('opt.music')}
              value={o.music}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => setOptions({ music: v })}
              format={pct}
            />
          </>
        )}
        {tab === 'graphics' && (
          <>
            <Choice
              label={t('opt.quality')}
              value={o.quality}
              options={[
                { value: 'auto' as const, label: t('opt.quality_auto') },
                { value: 'low' as const, label: t('opt.quality_low') },
                { value: 'medium' as const, label: t('opt.quality_medium') },
                { value: 'high' as const, label: t('opt.quality_high') },
              ]}
              onChange={(v) => setOptions({ quality: v })}
            />
            <p class="hint">{t('opt.quality_hint')}</p>
            <Choice
              label={t('opt.fps')}
              value={o.fpsCap}
              options={[
                { value: 30 as const, label: '30' },
                { value: 60 as const, label: '60' },
                { value: 0 as const, label: t('opt.fps_unlimited') },
              ]}
              onChange={(v) => setOptions({ fpsCap: v })}
            />
            <Check
              label={t('opt.stats')}
              checked={o.showStats}
              onChange={(v) => setOptions({ showStats: v })}
            />
          </>
        )}
        {tab === 'access' && (
          <>
            <Choice
              label={t('opt.reduced')}
              value={o.reducedMotion}
              options={[
                { value: 'auto' as const, label: t('opt.reduced_auto') },
                { value: 'on' as const, label: t('opt.reduced_on') },
                { value: 'off' as const, label: t('opt.reduced_off') },
              ]}
              onChange={(v) => setOptions({ reducedMotion: v })}
            />
            <p class="hint">{t('opt.reduced_hint')}</p>
            <Choice
              label={t('opt.text_size')}
              value={o.textScale}
              options={[90, 100, 115, 130].map((n) => ({ value: n, label: `${n} %` }))}
              onChange={(v) => setOptions({ textScale: v })}
            />
          </>
        )}
      </div>
      <Button onClick={() => (overlay.value = null)}>{t('app.close')}</Button>
    </Modal>
  );
}
