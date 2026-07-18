import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  loadRuntimeConfig,
  type RuntimeConfigResult,
  type ThemeName,
} from './config/runtimeConfig';
import { demoWorkspace } from './demo/demoWorkspace';
import { ConnectionError } from './features/auth/ConnectionError';
import { LoginWindow } from './features/auth/LoginWindow';
import { StartupScreen } from './features/auth/StartupScreen';
import { Workspace } from './features/workspace/Workspace';
import { MatrixController } from './matrix/MatrixController';
import { MediaProvider } from './matrix/MediaProvider';
import {
  loadUserPreferences,
  saveUserPreferences,
  type UserPreferences,
} from './settings/preferences';

const THEME_KEY = 'aimtrix.theme';

function initialTheme(configured: ThemeName): ThemeName {
  const saved = localStorage.getItem(THEME_KEY);
  return saved === 'aqua' || saved === 'graphite' || saved === 'midnight' ? saved : configured;
}

function ConfiguredApp({ result }: { result: RuntimeConfigResult }) {
  const { config, warnings } = result;
  const controller = useMemo(() => new MatrixController(config), [config]);
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [demo, setDemo] = useState(
    () => config.features.demoMode && new URLSearchParams(window.location.search).get('demo') === '1',
  );
  const [theme, setTheme] = useState<ThemeName>(() => initialTheme(config.defaultTheme));
  const [preferences, setPreferences] = useState<UserPreferences>(() => loadUserPreferences());
  const matrixSettingsActions = useMemo(
    () => ({
      load: () => controller.loadSettings(),
      verifyDevice: (deviceId: string) => controller.verifyDevice(deviceId),
      renameDevice: (deviceId: string, displayName: string) =>
        controller.renameDevice(deviceId, displayName),
      removeDevice: (deviceId: string, password?: string) =>
        controller.removeDevice(deviceId, password),
      setIgnoredUsers: (userIds: string[]) => controller.setIgnoredUsers(userIds),
      uploadAvatar: (file: File) => controller.uploadProfileAvatar(file),
      setupRecovery: (passphrase: string, accountPassword: string) =>
        controller.setupRecovery(passphrase, accountPassword),
      restoreRecovery: (recoveryKey: string) => controller.restoreRecovery(recoveryKey),
      changePassword: (currentPassword: string, newPassword: string, logoutOtherDevices: boolean) =>
        controller.changePassword(currentPassword, newPassword, logoutOtherDevices),
      deactivateAccount: (password: string, erase: boolean) =>
        controller.deactivateAccount(password, erase),
    }),
    [controller],
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
    const color = theme === 'midnight' ? '#1d2b3a' : theme === 'graphite' ? '#77818b' : '#72aee6';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.accent = preferences.accent;
    root.dataset.density = preferences.density;
    root.dataset.messageScale = preferences.messageScale;
    root.dataset.motion = preferences.motion;
    saveUserPreferences(preferences);
    controller.setCallDevices({
      microphoneId: preferences.microphoneId,
      cameraId: preferences.cameraId,
    });
    controller.setNotificationPreferences({
      desktopNotifications: preferences.desktopNotifications,
      notificationSounds: preferences.notificationSounds,
      soundVolume: preferences.soundVolume,
    });
    if (snapshot.status === 'ready') controller.savePersonalization(preferences);
  }, [controller, preferences, snapshot.status]);

  useEffect(() => {
    if (snapshot.status !== 'ready') return;
    const remote = controller.loadPersonalization();
    if (remote) {
      queueMicrotask(() => setPreferences((current) => ({
        ...remote,
        microphoneId: current.microphoneId,
        cameraId: current.cameraId,
        speakerId: current.speakerId,
      })));
    } else {
      controller.savePersonalization(loadUserPreferences());
    }
  }, [controller, snapshot.status]);

  useEffect(() => {
    if (!demo) void controller.initialize();
  }, [controller, demo]);

  if (demo) {
    return (
      <Workspace
        workspace={demoWorkspace}
        config={config}
        theme={theme}
        preferences={preferences}
        onThemeChange={setTheme}
        onPreferencesChange={setPreferences}
        onSignOut={() => setDemo(false)}
      />
    );
  }

  if (snapshot.status === 'restoring' || snapshot.status === 'connecting') {
    return <StartupScreen message={snapshot.message} />;
  }

  if (snapshot.status === 'error') {
    return (
      <ConnectionError
        message={snapshot.error}
        onRetry={() => void controller.retry()}
        onForget={() => void controller.forgetSession()}
      />
    );
  }

  if (snapshot.status === 'signed-out' || snapshot.status === 'authenticating') {
    return (
      <LoginWindow
        config={config}
        snapshot={snapshot}
        warnings={warnings}
        onLogin={(credentials) => controller.login(credentials)}
        onSso={(credentials) => controller.startSso(credentials)}
        onDemo={() => setDemo(true)}
      />
    );
  }

  return (
    <MediaProvider resolver={controller.resolveMedia}>
      <Workspace
        workspace={snapshot.workspace}
        config={config}
        theme={theme}
        preferences={preferences}
        onThemeChange={setTheme}
        onPreferencesChange={setPreferences}
        onUpdateProfile={(update) => controller.updateProfile(update)}
        matrixSettingsActions={matrixSettingsActions}
        onSendMessage={(roomId, body) => controller.sendMessage(roomId, body)}
        onRoomSelected={(roomId) => controller.loadRoomHistory(roomId)}
        onSendReply={(roomId, body, target) => controller.sendReply(roomId, body, target)}
        onEditMessage={(roomId, eventId, body) => controller.editMessage(roomId, eventId, body)}
        onRedactMessage={(roomId, eventId) => controller.redactMessage(roomId, eventId)}
        onTogglePinnedMessage={(roomId, eventId, pinned) => controller.togglePinnedMessage(roomId, eventId, pinned)}
        onToggleReaction={(roomId, eventId, key, ownReactionEventId) =>
          controller.toggleReaction(roomId, eventId, key, ownReactionEventId)
        }
        onSendTyping={(roomId, typing) => controller.sendTyping(roomId, typing)}
        onSendSticker={(roomId, sticker) => controller.sendSticker(roomId, sticker)}
        onUploadAttachment={(roomId, file, onProgress) => controller.uploadAttachment(roomId, file, onProgress)}
        onCancelUpload={() => controller.cancelUpload()}
        onSendGif={(roomId, gif) => controller.sendGif(roomId, gif)}
        onMarkRoomRead={(roomId) => controller.markRoomRead(roomId)}
        onJoinRoom={(roomIdOrAlias) => controller.joinRoom(roomIdOrAlias)}
        onSearchPublicRooms={(query) => controller.searchPublicRooms(query)}
        onCreateDirectRoom={(userId) => controller.createDirectRoom(userId)}
        onCreateRoom={(options) => controller.createRoom(options)}
        onRejectInvite={(roomId) => controller.rejectInvite(roomId)}
        onStartCall={(roomId, video) => controller.startCall(roomId, video)}
        onAnswerCall={(video) => controller.answerCall(video)}
        onRejectCall={() => controller.rejectCall()}
        onHangupCall={() => controller.hangupCall()}
        onCallMicrophone={(muted) => controller.setCallMicrophoneMuted(muted)}
        onCallVideo={(muted) => controller.setCallVideoMuted(muted)}
        onScreenshare={(enabled) => controller.setScreensharing(enabled)}
        onUpdateRoom={(roomId, update) => controller.updateRoomDetails(roomId, update)}
        onUpdateRoomAvatar={(roomId, file) => controller.updateRoomAvatar(roomId, file)}
        onEnableRoomEncryption={(roomId) => controller.enableRoomEncryption(roomId)}
        onSetRoomMuted={(roomId, muted) => controller.setRoomMuted(roomId, muted)}
        onInviteToRoom={(roomId, userId) => controller.inviteToRoom(roomId, userId)}
        onRemoveRoomMember={(roomId, userId, action) => controller.removeRoomMember(roomId, userId, action)}
        onSetRoomMemberPower={(roomId, userId, level) => controller.setRoomMemberPower(roomId, userId, level)}
        onLeaveRoom={(roomId) => controller.leaveRoom(roomId)}
        onSignOut={() => void controller.logout()}
      />
    </MediaProvider>
  );
}

export default function App() {
  const [result, setResult] = useState<RuntimeConfigResult>();
  const [updateWorker, setUpdateWorker] = useState<ServiceWorker>();

  useEffect(() => {
    let active = true;
    void loadRuntimeConfig().then((loaded) => {
      if (active) setResult(loaded);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleUpdate = (event: Event) => {
      setUpdateWorker((event as CustomEvent<ServiceWorker>).detail);
    };
    window.addEventListener('aimtrix-update-ready', handleUpdate);
    return () => window.removeEventListener('aimtrix-update-ready', handleUpdate);
  }, []);

  return (
    <>
      {!result ? <StartupScreen /> : <ConfiguredApp result={result} />}
      {updateWorker ? (
        <div className="update-prompt" role="status">
          <span><strong>Aimtrix update ready</strong><small>Reload when you are ready to use it.</small></span>
          <button className="aqua-button aqua-button--primary" type="button" onClick={() => {
            navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
            updateWorker.postMessage('SKIP_WAITING');
          }}>Reload</button>
        </div>
      ) : null}
    </>
  );
}
