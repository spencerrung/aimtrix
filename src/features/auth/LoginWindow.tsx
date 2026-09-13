import { useState, type FormEvent } from 'react';
import { KeyRound, LockKeyhole, MessageCircleMore, Server, UserRound } from 'lucide-react';
import type { RuntimeConfig } from '../../config/runtimeConfig';
import type { LoginCredentials, MatrixControllerSnapshot } from '../../matrix/MatrixController';
import { ForgetSessionButton } from './SessionRecovery';
import { BrandMark } from '../../components/BrandMark';

interface LoginWindowProps {
  config: RuntimeConfig;
  snapshot: MatrixControllerSnapshot;
  warnings: string[];
  onLogin: (credentials: LoginCredentials) => Promise<void>;
  onSso: (credentials: Pick<LoginCredentials, 'userId' | 'homeserver'>) => Promise<void>;
  onDemo: () => void;
  onForget?: () => Promise<void>;
}

export function LoginWindow({ config, snapshot, warnings, onLogin, onSso, onDemo, onForget }: LoginWindowProps) {
  const recovery = 'recovery' in snapshot ? snapshot.recovery : undefined;
  const [userId, setUserId] = useState(recovery?.userId ?? '');
  const [password, setPassword] = useState('');
  const [homeserver, setHomeserver] = useState(recovery?.homeserver ?? config.defaultHomeserver.serverName);
  const busy = snapshot.status === 'authenticating' || snapshot.status === 'connecting';
  const error = 'error' in snapshot ? snapshot.error : undefined;

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

        {recovery ? <p className="session-recovery__note">Sign in to the same account to reconnect. Your encryption keys are retained on this device.</p> : null}

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
          <label>
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
          </label>
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

          <button className="aqua-button aqua-button--primary sign-on-button" disabled={busy}>
            {busy ? <span className="spinner" aria-hidden="true" /> : <MessageCircleMore size={17} />}
            {busy && 'message' in snapshot ? snapshot.message : 'Sign On'}
          </button>
          <div className="sso-divider"><span>or</span></div>
          {recovery ? <p className="session-recovery__note">Continuing through SSO leaves this page and clears unsent drafts in this tab.</p> : null}
          <button
            className="aqua-button sso-button"
            type="button"
            disabled={busy || !homeserver.trim()}
            onClick={() => void onSso({ userId, homeserver })}
          >
            <KeyRound size={16} /> Sign in with homeserver SSO
          </button>
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
