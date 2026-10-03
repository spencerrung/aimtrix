import { useEffect, useRef, useState, type FormEvent } from 'react';
import { KeyRound, LockKeyhole, MessageCircleMore, Server, UserRound } from 'lucide-react';
import type { RuntimeConfig } from '../../config/runtimeConfig';
import type { LoginCredentials, MatrixControllerSnapshot } from '../../matrix/MatrixController';
import type { LoginMethods } from '../../matrix/discovery';
import { ForgetSessionButton } from './SessionRecovery';
import { BrandMark } from '../../components/BrandMark';
import type { StoredAccountSummary } from '../../matrix/sessionStore';

interface LoginWindowProps {
  config: RuntimeConfig;
  snapshot: MatrixControllerSnapshot;
  warnings: string[];
  onLogin: (credentials: LoginCredentials) => Promise<void>;
  onSso: (credentials: Pick<LoginCredentials, 'userId' | 'homeserver'>) => Promise<void>;
  onDiscover: (credentials: Pick<LoginCredentials, 'userId' | 'homeserver'>) => Promise<LoginMethods>;
  onDemo: () => void;
  onForget?: () => Promise<void>;
  accounts?: StoredAccountSummary[];
  onChooseAccount?: (id: string) => Promise<void>;
}

export function LoginWindow({ config, snapshot, warnings, onLogin, onSso, onDiscover, onDemo, onForget, accounts, onChooseAccount }: LoginWindowProps) {
  const recovery = 'recovery' in snapshot ? snapshot.recovery : undefined;
  const [userId, setUserId] = useState(recovery?.userId ?? '');
  const [password, setPassword] = useState('');
  const [homeserver, setHomeserver] = useState(recovery?.homeserver ?? config.defaultHomeserver.serverName);
  const busy = snapshot.status === 'authenticating' || snapshot.status === 'connecting';
  const error = 'error' in snapshot ? snapshot.error : undefined;
  const query = `${userId}\0${homeserver}`;
  const [discovery, setDiscovery] = useState<{ query: string; methods?: LoginMethods; error?: boolean }>();
  const methods = discovery?.query === query ? discovery.methods : undefined;
  const methodsError = discovery?.query === query && Boolean(discovery.error);
  const methodsLoading = discovery?.query !== query;
  const discover = useRef(onDiscover);
  useEffect(() => { discover.current = onDiscover; }, [onDiscover]);
  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      void Promise.resolve().then(() => discover.current({ userId, homeserver })).then((available) => {
        if (current) setDiscovery(available ? { query, methods: available } : { query, error: true });
      }).catch(() => { if (current) setDiscovery({ query, error: true }); });
    }, 350);
    return () => { current = false; window.clearTimeout(timer); };
  }, [userId, homeserver, query]);
  const passwordAvailable = methods?.password ?? methodsError;
  const ssoAvailable = methods ? methods.oauth || methods.sso || methods.cas : methodsError;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onLogin({ userId, password, homeserver });
  };

  return (
    <main className="login-stage">
      <section className="login-window" aria-labelledby="login-title">
        <header className="login-window__titlebar">
          <span className="login-window__title">{config.brandName} Sign On</span>
        </header>
        <div className="login-window__hero">
          <BrandMark />
          <div>
            <p className="eyebrow">Welcome to</p>
            <h1 id="login-title">{config.brandName}</h1>
            <p>Yesterday’s buddy-list charm. Today’s private Matrix conversations.</p>
          </div>
        </div>

        {warnings.length > 0 ? (
          <div className="config-warning" role="status">
            {warnings[0]}
          </div>
        ) : null}
        {error ? <div className="form-error" role="alert">{error}</div> : null}

        {accounts?.length && !recovery ? <section className="saved-accounts" aria-label="Saved Matrix accounts">
          <strong>Accounts on this device</strong>
          {accounts.map((account) => <button className="aqua-button" type="button" key={account.id}
            onClick={() => void onChooseAccount?.(account.id)} disabled={busy}>
            {account.userId} · {account.serverName}{account.recovery ? ' · Sign in again' : ''}
          </button>)}
        </section> : null}

        {recovery ? <p className="session-recovery__note">Sign in to the same account to reconnect. Your encryption keys are retained on this device.</p> : null}
        {methodsLoading ? <p role="status">Checking sign-in options for this homeserver…</p> : null}
        {methodsError ? <p role="alert">Sign-in options could not be checked. Password sign-in may still work; SSO will be checked before redirecting.</p> : null}
        {methods && !passwordAvailable && !ssoAvailable ? <p role="alert">This homeserver does not advertise a supported sign-in method. Try another client or ask your server operator.</p> : null}

        <form className="login-form" onSubmit={submit}>
          <label>
            <span>Matrix ID</span>
            <span className="field-shell">
              <UserRound size={16} aria-hidden="true" />
              <input
                autoComplete="username"
                inputMode="email"
                placeholder="@you:example.com"
                readOnly={Boolean(recovery)}
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                disabled={busy}
                required
              />
            </span>
          </label>
          {passwordAvailable ? <label>
            <span>Password</span>
            <span className="field-shell">
              <LockKeyhole size={16} aria-hidden="true" />
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
                required
              />
            </span>
          </label> : null}
          {config.allowCustomHomeservers ? (
            <label>
              <span>Homeserver</span>
              <span className="field-shell">
                <Server size={16} aria-hidden="true" />
                <input
                  autoCapitalize="none"
                  spellCheck={false}
                  readOnly={Boolean(recovery)}
                  value={homeserver}
                  onChange={(event) => setHomeserver(event.target.value)}
                  disabled={busy}
                  required
                />
              </span>
            </label>
          ) : null}

          {passwordAvailable ? <button className="aqua-button aqua-button--primary sign-on-button" disabled={busy}>
            {busy ? <span className="spinner" aria-hidden="true" /> : <MessageCircleMore size={17} />}
            {busy && 'message' in snapshot ? snapshot.message : 'Sign On'}
          </button> : null}
          {passwordAvailable && ssoAvailable ? <div className="sso-divider"><span>or</span></div> : null}
          {recovery ? <p className="session-recovery__note">SSO leaves this page. Saved drafts return for the same account; changes kept only in this tab may be lost. Files need to be reattached.</p> : null}
          {ssoAvailable ? <button
            className="aqua-button sso-button"
            type="button"
            disabled={busy || !homeserver.trim()}
            onClick={() => void onSso({ userId, homeserver })}
          >
            <KeyRound size={16} /> Sign in with homeserver {methods?.oauth ? 'OAuth' : methods?.cas && !methods.sso ? 'CAS' : 'SSO'}
          </button> : null}
        </form>

        {recovery && onForget ? <div className="demo-entry"><ForgetSessionButton onForget={onForget} disabled={busy} /></div> : null}

        {config.features.demoMode && !recovery ? (
          <div className="demo-entry">
            <span>Just looking around?</span>
            <button className="text-button" type="button" onClick={onDemo} disabled={busy}>
              Explore the demo buddy list
            </button>
          </div>
        ) : null}

        <footer className="login-window__footer">
          <LockKeyhole size={13} aria-hidden="true" />
          Encryption storage opens before Matrix sync starts. Your password is never saved.
        </footer>
      </section>
      <p className="login-stage__note">An original client for the open Matrix network.</p>
    </main>
  );
}
