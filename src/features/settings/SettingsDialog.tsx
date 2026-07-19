import {
  Check,
  LogOut,
  Paintbrush,
  Palette,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Avatar } from '../../components/Avatar';
import type { ThemeName } from '../../config/runtimeConfig';
import {
  MatrixSettingsPanel,
  type MatrixSettingsActions,
} from './MatrixSettingsPanel';
import { colorForId, type PresenceState, type UserSummary } from '../../matrix/viewModels';
import {
  accentNames,
  densityNames,
  messageScaleNames,
  motionNames,
  type AccentName,
  type UserPreferences,
} from '../../settings/preferences';

export interface ProfileUpdate {
  displayName: string;
  presence: PresenceState;
  statusMessage: string;
}

interface SettingsDialogProps {
  user: UserSummary;
  theme: ThemeName;
  preferences: UserPreferences;
  canEditProfile: boolean;
  onThemeChange: (theme: ThemeName) => void;
  onPreferencesChange: (preferences: UserPreferences) => void;
  onSaveProfile?: (update: ProfileUpdate) => Promise<void>;
  onOpenProfilePage: () => void;
  matrixActions?: MatrixSettingsActions;
  onSignOut: () => void;
  onClose: () => void;
}

const themeOptions: Array<{ id: ThemeName; label: string; detail: string }> = [
  { id: 'aqua', label: 'Aqua', detail: 'Tiger-era glass + Aero skies' },
  { id: 'graphite', label: 'Graphite', detail: 'Calm brushed neutral' },
  { id: 'midnight', label: 'Midnight', detail: 'Late-night buddy list' },
];

const accentLabels: Record<AccentName, string> = {
  blue: 'Blueberry',
  grape: 'Grape',
  rose: 'Watermelon',
  tangerine: 'Tangerine',
  lime: 'Lime',
};

export function SettingsDialog({
  user,
  theme,
  preferences,
  canEditProfile,
  onThemeChange,
  onPreferencesChange,
  onSaveProfile,
  onOpenProfilePage,
  matrixActions,
  onSignOut,
  onClose,
}: SettingsDialogProps) {
  const [section, setSection] = useState<'profile' | 'appearance' | 'matrix'>('profile');
  const [displayName, setDisplayName] = useState(user.displayName);
  const [presence, setPresence] = useState<PresenceState>(user.presence);
  const [statusMessage, setStatusMessage] = useState(user.statusMessage);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();

  const updatePreferences = (update: Partial<UserPreferences>) => {
    onPreferencesChange({ ...preferences, ...update });
  };

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (!onSaveProfile) return;
    setSaving(true);
    setSaved(false);
    setError(undefined);
    try {
      await onSaveProfile({ displayName: displayName.trim(), presence, statusMessage: statusMessage.trim() });
      setSaved(true);
    } catch {
      setError('Your homeserver did not accept that profile update.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="settings-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-titlebar">
          <div>
            <Sparkles size={16} aria-hidden="true" />
            <strong id="settings-title">Personalize Aimtrix</strong>
          </div>
          <button type="button" aria-label="Close settings" onClick={onClose}><X size={17} /></button>
        </header>

        <div className="settings-layout">
          <nav className="settings-nav" aria-label="Settings sections">
            <div className="settings-account-mini">
              <Avatar
                name={user.displayName}
                src={user.avatarUrl}
                color={colorForId(user.id)}
                presence={user.presence}
                size="small"
              />
              <span><strong>{user.displayName}</strong><small>{user.id}</small></span>
            </div>
            <button
              type="button"
              className={section === 'profile' ? 'is-active' : ''}
              onClick={() => setSection('profile')}
            >
              <UserRound size={16} /> Profile & status note
            </button>
            <button
              type="button"
              className={section === 'appearance' ? 'is-active' : ''}
              onClick={() => setSection('appearance')}
            >
              <Palette size={16} /> Appearance
            </button>
            <button
              type="button"
              className={section === 'matrix' ? 'is-active' : ''}
              onClick={() => setSection('matrix')}
            >
              <ShieldCheck size={16} /> Matrix & security
            </button>
            <button className="settings-signout" type="button" onClick={onSignOut}>
              <LogOut size={15} /> Sign out
            </button>
          </nav>

          <div className="settings-content">
            {section === 'profile' ? (
              <form onSubmit={(event) => void saveProfile(event)}>
                <div className={`settings-profile-preview accent-${preferences.accent}`}>
                  <div className="settings-profile-preview__glow" />
                  <Avatar
                    name={displayName || user.displayName}
                    src={user.avatarUrl}
                    color={colorForId(user.id)}
                    presence={presence}
                    size="large"
                  />
                  <div>
                    <span className="eyebrow">My buddy card</span>
                    <h2>{displayName || user.displayName}</h2>
                    <p>{statusMessage || 'Available'}</p>
                  </div>
                </div>

                <div className="settings-section-heading settings-section-heading--with-action">
                  <div><h2>Profile and status note</h2><p>Standard Matrix display name and presence—visible in any client to people who share a room with you.</p></div>
                  <button className="aqua-button profile-page-shortcut" type="button" onClick={onOpenProfilePage}><Paintbrush size={14} /> Decorate profile page</button>
                </div>
                {!canEditProfile ? <p className="settings-demo-note">Profile editing is disabled in demo mode.</p> : null}
                <label className="settings-field">
                  <span>Display name</span>
                  <input
                    value={displayName}
                    maxLength={80}
                    disabled={!canEditProfile || saving}
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
                </label>
                <fieldset className="presence-picker" disabled={!canEditProfile || saving}>
                  <legend>Buddy status</legend>
                  {(['online', 'away', 'offline'] as PresenceState[]).map((option) => (
                    <button
                      type="button"
                      key={option}
                      className={presence === option ? 'is-active' : ''}
                      aria-pressed={presence === option}
                      onClick={() => setPresence(option)}
                    >
                      <i className={`presence-swatch presence-swatch--${option}`} />
                      {option === 'away' ? 'Away' : option[0].toUpperCase() + option.slice(1)}
                    </button>
                  ))}
                </fieldset>
                <label className="settings-field">
                  <span>Status note <small>shown under your name in buddy lists</small></span>
                  <input
                    value={statusMessage}
                    maxLength={140}
                    placeholder="What are you up to?"
                    disabled={!canEditProfile || saving}
                    onChange={(event) => setStatusMessage(event.target.value)}
                  />
                </label>
                <p className="settings-hint">Buddies see this under your name—even while you're online—in Aimtrix, Element, and other Matrix clients. It clears while you're offline. For anything private, use the note on your profile page instead.</p>
                {error ? <p className="settings-error" role="alert">{error}</p> : null}
                <div className="settings-save-row">
                  {saved ? <span><Check size={14} /> Saved to Matrix</span> : null}
                  <button
                    className="aqua-button aqua-button--primary"
                    type="submit"
                    disabled={!canEditProfile || saving || !displayName.trim()}
                  >
                    {saving ? 'Saving…' : 'Save profile'}
                  </button>
                </div>
              </form>
            ) : section === 'appearance' ? (
              <div>
                <div className="settings-section-heading">
                  <h2>Appearance</h2>
                  <p>Make the buddy list feel like yours. Changes apply immediately.</p>
                </div>

                <fieldset className="settings-choice-grid theme-choice-grid">
                  <legend>Window theme</legend>
                  {themeOptions.map((option) => (
                    <button
                      type="button"
                      key={option.id}
                      className={`theme-choice theme-choice--${option.id}${theme === option.id ? ' is-active' : ''}`}
                      aria-pressed={theme === option.id}
                      onClick={() => onThemeChange(option.id)}
                    >
                      <i><span /></i>
                      <strong>{option.label}</strong>
                      <small>{option.detail}</small>
                    </button>
                  ))}
                </fieldset>

                <fieldset className="accent-picker">
                  <legend>Candy color</legend>
                  {accentNames.map((accent) => (
                    <button
                      type="button"
                      key={accent}
                      className={`accent-dot accent-dot--${accent}${preferences.accent === accent ? ' is-active' : ''}`}
                      aria-label={accentLabels[accent]}
                      aria-pressed={preferences.accent === accent}
                      title={accentLabels[accent]}
                      onClick={() => updatePreferences({ accent })}
                    ><Check size={13} /></button>
                  ))}
                </fieldset>

                <div className="settings-control-row">
                  <label><SlidersHorizontal size={15} /> Buddy-list density</label>
                  <div className="aqua-segmented">
                    {densityNames.map((density) => (
                      <button
                        type="button"
                        key={density}
                        className={preferences.density === density ? 'is-active' : ''}
                        onClick={() => updatePreferences({ density })}
                      >{density}</button>
                    ))}
                  </div>
                </div>
                <div className="settings-control-row">
                  <label>Message text</label>
                  <div className="aqua-segmented">
                    {messageScaleNames.map((messageScale) => (
                      <button
                        type="button"
                        key={messageScale}
                        className={preferences.messageScale === messageScale ? 'is-active' : ''}
                        onClick={() => updatePreferences({ messageScale })}
                      >{messageScale}</button>
                    ))}
                  </div>
                </div>
                <div className="settings-control-row">
                  <label>Interface motion</label>
                  <select
                    value={preferences.motion}
                    onChange={(event) => updatePreferences({ motion: event.target.value as UserPreferences['motion'] })}
                  >
                    {motionNames.map((motion) => <option value={motion} key={motion}>{motion}</option>)}
                  </select>
                </div>
                <label className="settings-toggle-row">
                  <span><strong>Open the buddy drawer</strong><small>Show the personality panel when Aimtrix starts.</small></span>
                  <input
                    type="checkbox"
                    checked={preferences.detailsOpenByDefault}
                    onChange={(event) => updatePreferences({ detailsOpenByDefault: event.target.checked })}
                  />
                </label>
              </div>
            ) : (
              <MatrixSettingsPanel
                preferences={preferences}
                onPreferencesChange={onPreferencesChange}
                actions={matrixActions}
              />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
