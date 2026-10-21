import { GamePhase } from '@stickyclaude/shared';
import type { JSX } from 'preact';
import { banner, hud, lobby, mode, net, overlay, podium, round, screen } from '../app/store.ts';
import { t } from '../i18n/index.ts';
import { touchActive } from './device.ts';
import { Customize, Home } from './Home.tsx';
import { Hud, Podium } from './Hud.tsx';
import { LobbyPanel } from './Lobby.tsx';
import { OptionsModal } from './Options.tsx';
import { ConnectionOverlay, CreditsModal, HelpModal, PauseModal } from './Overlays.tsx';
import { TouchControls } from './TouchControls.tsx';
import { Training } from './Training.tsx';

/** Racine de l'interface : l'écran courant, la fenêtre ouverte, les messages de connexion. */
export function App(): JSX.Element {
  const m = mode.value;
  const ov = overlay.value;
  const scr = screen.value;
  const lob = lobby.value;
  const playing = m !== 'menu';
  const inLobby = lob !== null && lob.phase === GamePhase.LOBBY;
  const b = banner.value;
  const h = hud.value;
  const rd = round.value;
  const touch = playing && touchActive();
  const connecting = net.value.status === 'connecting';
  // annonce pour les lecteurs d'écran : manche, bannière
  const live = b
    ? `${b.text} ${b.sub}`
    : h.inMatch && rd
      ? t('a11y.live_round', { n: rd.round })
      : '';
  return (
    <>
      <a
        class="skip"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        {t('app.skip')}
      </a>
      <div id="main" tabIndex={-1} aria-label={t('a11y.canvas')}>
        {m === 'menu' && scr === 'home' && <Home />}
        {m === 'menu' && scr === 'customize' && <Customize />}
        {m === 'online' && (
          <>
            <Hud />
            {inLobby && <LobbyPanel />}
            {podium.value && <Podium />}
          </>
        )}
        {m === 'solo' && (
          <>
            <Hud solo />
            <Training touch={touch} />
          </>
        )}
        {touch && ov === null && <TouchControls />}
        {touch && (
          <div class="rotate" role="alert">
            {t('touch.rotate')}
          </div>
        )}
      </div>
      <div class="sr-only" role="status" aria-live="polite">
        {live}
        {connecting ? t('home.connecting') : ''}
      </div>
      <ConnectionOverlay />
      {ov === 'options' && <OptionsModal />}
      {ov === 'help' && <HelpModal />}
      {ov === 'credits' && <CreditsModal />}
      {ov === 'pause' && <PauseModal />}
    </>
  );
}
