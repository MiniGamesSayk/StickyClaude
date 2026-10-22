import { HAT_NAMES, NAME_MAX, STROKE_NAMES, VICTORY_NAMES } from '@stickyclaude/shared';
import type { Look } from '@stickyclaude/shared';
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { account, apiBase, loginError, loginUrl, logout, stats } from '../app/account.ts';
import { setOptions, profile, setProfile } from '../app/options.ts';
import { actions, net, overlay, rooms, screen, urlCode } from '../app/store.ts';
import { lang, pick, t } from '../i18n/index.ts';
import { Button, Check, Choice, Swatches } from './components.tsx';

/** Le logo : chaque lettre tremble à son tour (le line boiling de l'interface). */
function Logo(): JSX.Element {
  return (
    <h1 class="logo" aria-label={t('app.title')}>
      {[...t('app.title')].map((c, i) => (
        <span
          key={i}
          class="wobble"
          aria-hidden="true"
          style={{ animationDelay: `${(i % 3) * 0.17}s` }}
        >
          {c}
        </span>
      ))}
    </h1>
  );
}

/** Éditeur d'apparence : encre, trait, accessoire, emote de victoire. */
export function LookEditor(p: {
  look: Look;
  onChange: (l: Look) => void;
  compact?: boolean;
}): JSX.Element {
  const l = p.look;
  return (
    <div class="field" style={{ gap: '0.6rem' }}>
      <div class="field">
        <span>{t('custom.color')}</span>
        <Swatches
          value={l.color}
          onChange={(c) => p.onChange({ ...l, color: c })}
          label={(i) => t('custom.color_n', { n: i + 1 })}
        />
      </div>
      <Choice
        label={t('custom.stroke')}
        value={l.stroke}
        options={STROKE_NAMES.map((n, i) => ({ value: i, label: pick(n) }))}
        onChange={(v) => p.onChange({ ...l, stroke: v })}
      />
      <div class="field">
        <span>{t('custom.hat')}</span>
        <div class="hats" role="radiogroup">
          {HAT_NAMES.map((n, i) => (
            <button
              type="button"
              key={i}
              role="radio"
              aria-checked={i === l.hat}
              class={`chip${i === l.hat ? ' on' : ''}`}
              onClick={(e) => {
                p.onChange({ ...l, hat: i });
                e.currentTarget.blur();
              }}
            >
              {pick(n)}
            </button>
          ))}
        </div>
      </div>
      <Choice
        label={t('custom.victory')}
        value={l.victory}
        options={VICTORY_NAMES.map((n, i) => ({ value: i, label: pick(n) }))}
        onChange={(v) => p.onChange({ ...l, victory: v })}
      />
    </div>
  );
}

/** Compte sayk.fr : connexion Discord, ou nom et statistiques du joueur connecté. */
function AccountBox(): JSX.Element | null {
  if (apiBase() === null) return null;
  const user = account.value;
  const s = stats.value;
  if (user === null) {
    const href = loginUrl();
    return (
      <div class="account">
        {href !== null && (
          <a class="btn secondary" href={href}>
            {t('account.login')}
          </a>
        )}
        <span class="hint">
          {loginError.value !== null ? t('account.error') : t('account.hint')}
        </span>
      </div>
    );
  }
  return (
    <div class="account">
      <span>{t('account.as', { name: user.name })}</span>
      <button type="button" class="link" onClick={() => void logout()}>
        {t('account.logout')}
      </button>
      {s !== null && (s.matches ?? 0) > 0 && (
        <span class="hint">
          {t('account.stats', { matches: s.matches ?? 0, wins: s.wins ?? 0, kos: s.kos ?? 0 })}
        </span>
      )}
    </div>
  );
}

/** Accueil : pseudo, parties, salons publics, entraînement. */
export function Home(): JSX.Element {
  const prof = profile.value;
  const n = net.value;
  const [code, setCode] = useState(urlCode.value);
  const [isPublic, setPublic] = useState(false);
  const [missing, setMissing] = useState(false);
  const busy = n.status === 'connecting';
  const list = rooms.value;
  const lg = lang.value;

  const join = (c: string): void => {
    if (c.trim() === '') {
      setMissing(true);
      return;
    }
    setMissing(false);
    actions.join(c.trim());
  };

  return (
    <div class="screen left">
      <div class="card main">
        <Logo />
        <p class="sub">{t('app.tagline')}</p>
        <AccountBox />
        <label>
          {t('home.name')}
          <input
            type="text"
            value={prof.name}
            maxLength={NAME_MAX}
            autocomplete="off"
            spellcheck={false}
            aria-describedby="name-hint"
            onInput={(e) => setProfile({ name: e.currentTarget.value })}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              if (code.trim() !== '') join(code);
              else actions.quick();
            }}
          />
          <span class="hint" id="name-hint">
            {t('home.name_hint')}
          </span>
        </label>
        <div class="row">
          <Button class="grow" onClick={() => actions.quick()} disabled={busy}>
            {t('home.quick')}
          </Button>
          <Button secondary onClick={() => (screen.value = 'customize')}>
            {t('home.customize')}
          </Button>
        </div>
        <div class="row">
          <Button secondary class="grow" onClick={() => actions.create(isPublic)} disabled={busy}>
            {t('home.create')}
          </Button>
          <Check label={t('home.public')} checked={isPublic} onChange={setPublic} />
        </div>
        <label>
          {t('home.join_label')}
          <div class="row nowrap">
            <input
              type="text"
              class="code grow"
              value={code}
              placeholder={t('home.code')}
              maxLength={8}
              autocomplete="off"
              spellcheck={false}
              onInput={(e) => setCode(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') join(code);
              }}
            />
            <Button secondary onClick={() => join(code)} disabled={busy}>
              {t('home.join')}
            </Button>
          </div>
        </label>
        <div class="error" role="alert">
          {missing ? t('home.code_missing') : (n.error ?? '')}
        </div>
        <Button secondary block onClick={() => actions.solo()} title={t('home.solo_hint')}>
          ✏️ {t('home.solo')} <span class="hint">· {t('home.solo_hint')}</span>
        </Button>
        <h2>{t('home.rooms')}</h2>
        <div class="rooms">
          {list.length === 0 ? (
            <p class="hint">{t('home.rooms_empty')}</p>
          ) : (
            list.map((r) => (
              <div class="room" key={r.code}>
                <span>{r.host || '—'}</span>
                <span class="meta">
                  {t('home.room_meta', {
                    players: r.players,
                    max: r.maxPlayers,
                    mode: r.mode === 'teams' ? t('home.mode_teams') : t('home.mode_ffa'),
                    phase: r.phase === 'lobby' ? t('home.room_lobby') : t('home.room_playing'),
                  })}
                </span>
                <Button small secondary onClick={() => join(r.code)} disabled={busy}>
                  {t('home.join')}
                </Button>
              </div>
            ))
          )}
        </div>
        <div class="row" style={{ justifyContent: 'center' }}>
          <button type="button" class="link" onClick={() => (overlay.value = 'options')}>
            {t('home.options')}
          </button>
          <button type="button" class="link" onClick={() => (overlay.value = 'help')}>
            {t('home.help')}
          </button>
          <button type="button" class="link" onClick={() => (overlay.value = 'credits')}>
            {t('home.credits')}
          </button>
          <button
            type="button"
            class="link"
            aria-label="Langue / Language"
            onClick={() => setOptions({ lang: lg === 'fr' ? 'en' : 'fr' })}
          >
            {lg === 'fr' ? 'English' : 'Français'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Personnalisation : le stickman en grand (dessiné par le rendu) réagit aux choix. */
export function Customize(): JSX.Element {
  const prof = profile.value;
  const emote = (id: number): void => actions.preview(prof.look, id, -1);
  const change = (look: Look): void => {
    setProfile({ look });
    actions.preview(look, 0, -1);
  };
  return (
    <div class="screen left">
      <div class="card main">
        <h1>{t('custom.title')}</h1>
        <LookEditor look={prof.look} onChange={change} />
        <p class="hint">{t('custom.pattern_hint')}</p>
        <p class="hint">{t('custom.unique')}</p>
        <div class="row">
          <Button small secondary onClick={() => emote(6)}>
            {t('custom.emote_wave')}
          </Button>
          <Button small secondary onClick={() => emote(7)}>
            {t('custom.emote_dance')}
          </Button>
          <Button small secondary onClick={() => emote(8)}>
            {t('custom.emote_laugh')}
          </Button>
          <Button small secondary onClick={() => actions.preview(prof.look, 0, prof.look.victory)}>
            {t('custom.try')}
          </Button>
        </div>
        <Button
          onClick={() => {
            actions.preview(prof.look, 0, -1);
            screen.value = 'home';
          }}
        >
          {t('custom.done')}
        </Button>
      </div>
    </div>
  );
}
