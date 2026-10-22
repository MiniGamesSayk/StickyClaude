import type { JSX } from 'preact';
import { actions, mode, net, overlay, testingLevel } from '../app/store.ts';
import { t } from '../i18n/index.ts';
import { Button, Modal } from './components.tsx';

/** Écran de reconnexion ou de maintenance : message clair, reconnexion automatique. */
export function ConnectionOverlay(): JSX.Element | null {
  const st = net.value.status;
  if (st !== 'reconnecting' && st !== 'maintenance') return null;
  const maintenance = st === 'maintenance';
  return (
    <div
      class="scrim"
      role="alertdialog"
      aria-live="assertive"
      aria-label={t(maintenance ? 'net.maint_title' : 'net.lost_title')}
    >
      <div class="card narrow">
        <h1>{t(maintenance ? 'net.maint_title' : 'net.lost_title')}</h1>
        <p class="sub">
          <span class="spinner" aria-hidden="true" />{' '}
          {t(maintenance ? 'net.maint_text' : 'net.lost_text')}
        </p>
        <Button secondary onClick={() => actions.cancelReconnect()}>
          {t('net.cancel')}
        </Button>
      </div>
    </div>
  );
}

export function HelpModal(): JSX.Element {
  return (
    <Modal title={t('help.title')} onClose={() => (overlay.value = null)}>
      <h1>{t('help.title')}</h1>
      <p>{t('help.goal')}</p>
      <p>{t('help.move')}</p>
      <p>{t('help.fight')}</p>
      <p>{t('help.weapons')}</p>
      <p>{t('help.ghost')}</p>
      <Button onClick={() => (overlay.value = null)}>{t('app.close')}</Button>
    </Modal>
  );
}

export function CreditsModal(): JSX.Element {
  return (
    <Modal title={t('credits.title')} onClose={() => (overlay.value = null)}>
      <h1>{t('credits.title')}</h1>
      <p>{t('credits.text')}</p>
      <p class="hint">{t('credits.libs')}</p>
      <Button onClick={() => (overlay.value = null)}>{t('app.close')}</Button>
    </Modal>
  );
}

/** Menu pause : en solo le jeu s'arrête, en ligne il continue. */
export function PauseModal(): JSX.Element {
  const m = mode.value;
  const close = (): void => {
    overlay.value = null;
    actions.resume();
  };
  return (
    <Modal title={t('pause.title')} onClose={close}>
      <h1>{t('pause.title')}</h1>
      <Button onClick={close}>{t('pause.resume')}</Button>
      <Button secondary onClick={() => (overlay.value = 'options')}>
        {t('pause.options')}
      </Button>
      <Button
        secondary
        onClick={() => {
          overlay.value = null;
          if (m === 'solo') actions.quitSolo();
          else actions.leave();
        }}
      >
        {m === 'solo' && testingLevel.value ? t('cr.back') : t('pause.leave')}
      </Button>
    </Modal>
  );
}
