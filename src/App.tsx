import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  loadRuntimeConfig,
  type RuntimeConfigResult,
  type ThemeName,
} from './config/runtimeConfig';
import { demoWorkspace } from './demo/demoWorkspace';
import { VolatileDrafts } from './features/workspace/volatileDrafts';
import { StructuredDraftStore, type DraftScope, type DraftStateSummary } from './features/workspace/structuredDrafts';
import { ConnectionBanner, SessionRecoveryScreen } from './features/auth/SessionRecovery';
import { ConnectionError } from './features/auth/ConnectionError';
import { LoginWindow } from './features/auth/LoginWindow';
import { InstallPrompt } from './features/pwa/InstallPrompt';
import { NetworkStatus } from './features/pwa/NetworkStatus';
import { StartupScreen } from './features/auth/StartupScreen';
import { Workspace } from './features/workspace/Workspace';
import { ConfirmDialog } from './components/ConfirmDialog';
import { MatrixController } from './matrix/MatrixController';
import type { PushRegistrationResult } from './matrix/MatrixController';
import { MediaProvider } from './matrix/MediaProvider';
import { getAimtrixPlatform } from './platform/aimtrixPlatform';
import { parsePushRoute, pushRouteFromMessage, routeUrl, type PushRoute } from './pwa/pushRouting';
import {
  defaultUserPreferences,
  loadUserPreferences,
  saveUserPreferences,
  type UserPreferences,
} from './settings/preferences';
import {
  defaultProfilePersonalization,
  loadProfilePersonalization,
  saveProfilePersonalization,
  type ProfilePersonalization,
} from './settings/profilePersonalization';

const EMPTY_DRAFT_STATE: DraftStateSummary = { hasDrafts: false, volatile: false, hasAttachments: false, sending: false };

const THEME_KEY = 'aimtrix.theme';
const DEMO_PROFILE_KEY = 'aimtrix.demo.profile.v1';

// Appearance is optional. Credential and crypto storage failures stay with the controller.
function optionalAppearance<T>(operation: (storage: Storage) => T, fallback: T): T {
  try { return operation(window.localStorage); } catch { return fallback; }
}

function initialTheme(configured: ThemeName): ThemeName {
  const saved = optionalAppearance((storage) => storage.getItem(THEME_KEY), null);
  return saved === 'aqua' || saved === 'graphite' || saved === 'midnight' ? saved : configured;
}

function ConfiguredApp({ result, pushRoute, onDraftStateChange }: { result: RuntimeConfigResult; pushRoute?: PushRoute; onDraftStateChange: (state: DraftStateSummary) => void }) {
  const { config, warnings } = result;
  const platform = getAimtrixPlatform();
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
  const [preferences, setPreferences] = useState<UserPreferences>(() => optionalAppearance(loadUserPreferences, { ...defaultUserPreferences }));
  const [demoPersonalization, setDemoPersonalization] = useState<ProfilePersonalization>(() => optionalAppearance((storage) => loadProfilePersonalization(storage, DEMO_PROFILE_KEY), structuredClone(defaultProfilePersonalization)));
  const [accountPersonalization, setAccountPersonalization] = useState<{ owner: string; value: ProfilePersonalization }>();
  const profileOwner = snapshot.status === 'ready' ? snapshot.workspace.user.id : undefined;
  const profilePersonalization = snapshot.status === 'ready' && accountPersonalization?.owner === snapshot.workspace.user.id
    ? accountPersonalization.value : defaultProfilePersonalization;
  const [profileRequests] = useState(() => ({ generation: 0 }));
  useEffect(() => controller.subscribe(() => {
    if (controller.getSnapshot().status !== 'ready') profileRequests.generation++;
  }), [controller, profileRequests]);
  const [draftStore] = useState(() => new VolatileDrafts());
  const [structuredDraftStore] = useState(() => new StructuredDraftStore());
  const draftScope = controller.getDraftScope?.();
  const lastDraftScope = useRef<DraftScope | undefined>(undefined);
  const lastDraftStatus = useRef(snapshot.status);
  const lastDraftSummary = useRef(EMPTY_DRAFT_STATE);
  const reportDraftState = useCallback((state: DraftStateSummary) => { lastDraftSummary.current = state; onDraftStateChange(state); }, [onDraftStateChange]);
  const [draftCleanupFailed, setDraftCleanupFailed] = useState(false);
  const clearDrafts = useCallback((scope?: DraftScope) => {
    const currentScope = controller.getDraftScope?.() ?? lastDraftScope.current;
    if (!scope || scope.userId === currentScope?.userId && scope.homeserver === currentScope.homeserver) { draftStore.clear(); reportDraftState(EMPTY_DRAFT_STATE); }
    const result = structuredDraftStore.clear(scope ?? currentScope);
    if (!result.cleared) setDraftCleanupFailed(true);
  }, [controller, draftStore, structuredDraftStore, reportDraftState]);
  const forgetSession = async () => { clearDrafts(); await controller.forgetSession(); };
  const draftCleanupNotice = draftCleanupFailed ? <p role="alert" className="history-feedback">Your browser could not remove saved drafts. Clear this site's data to remove them from this device.</p> : null;
  useEffect(() => {
    const update = () => {
      const next = controller.getSnapshot();
      const scope = controller.getDraftScope?.();
      if (scope) lastDraftScope.current = scope;
      if (next.status !== 'ready' && lastDraftStatus.current === 'ready') { structuredDraftStore.suspend(); reportDraftState({ ...lastDraftSummary.current, sending: false }); }
      if (next.status === 'signed-out' && !next.recovery && lastDraftScope.current) clearDrafts();
      lastDraftStatus.current = next.status;
    };
    update();
    return controller.subscribe(update);
  }, [controller, structuredDraftStore, clearDrafts, reportDraftState]);
  const matrixSettingsActions = useMemo(
    () => ({
      load: () => controller.loadSettings(),
      verifyDevice: (deviceId: string, signal?: AbortSignal) => controller.verifyDevice(deviceId, signal),
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
      deactivateAccount: async (password: string, erase: boolean) => {
        const scope = controller.getDraftScope?.() ?? lastDraftScope.current;
        await controller.deactivateAccount(password, erase);
        clearDrafts(scope);
      },
      previewMessageSound: () => controller.previewMessageTone(),
      registerPushNotifications: (): Promise<PushRegistrationResult> => controller.registerPushNotifications(),
      unregisterPushNotifications: () => controller.unregisterPushNotifications(),
    }),
    [controller, clearDrafts],
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    optionalAppearance((storage) => storage.setItem(THEME_KEY, theme), undefined);
    const color = theme === 'midnight' ? '#1d2b3a' : theme === 'graphite' ? '#77818b' : '#72aee6';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
  }, [theme]);

  useEffect(() => {
    const refresh = () => {
      if (!platform.lifecycle.isHidden()) controller.refreshAfterPush();
    };
    const unsubscribe = platform.lifecycle.subscribe(refresh);
    if (pushRoute) controller.refreshAfterPush();
    return unsubscribe;
  }, [controller, platform, pushRoute]);

  useEffect(() => platform.lifecycle.subscribeShutdown(() => controller.shutdown()), [controller, platform]);

  useEffect(() => {
    if (snapshot.status !== 'ready' || !preferences.desktopNotifications) return;
    void controller.registerPushNotifications();
    const refreshPushRegistration = () => {
      if (!platform.lifecycle.isHidden()) void controller.registerPushNotifications();
    };
    const unsubscribe = platform.lifecycle.subscribe(refreshPushRegistration);
    const unsubscribeTokenRefresh = platform.push.onTokenRefresh(() => {
      void controller.registerPushNotifications();
    });
    return () => {
      unsubscribe();
      unsubscribeTokenRefresh();
    };
  }, [controller, platform, preferences.desktopNotifications, snapshot.status]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.accent = preferences.accent;
    root.dataset.density = preferences.density;
    root.dataset.messageScale = preferences.messageScale;
    root.dataset.motion = preferences.motion;
    root.dataset.messageSurface = preferences.messageSurface;
    optionalAppearance((storage) => saveUserPreferences(preferences, storage), undefined);
    controller.setCallDevices({
      microphoneId: preferences.microphoneId,
      cameraId: preferences.cameraId,
    });
    controller.setNotificationPreferences({
      sendReadReceipts: preferences.sendReadReceipts,
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
        messageSurface: current.messageSurface,
      })));
    } else {
      controller.savePersonalization(optionalAppearance(loadUserPreferences, { ...defaultUserPreferences }));
    }
  }, [controller, snapshot.status]);

  useEffect(() => {
    optionalAppearance((storage) => {
      if (demo) saveProfilePersonalization(demoPersonalization, storage, DEMO_PROFILE_KEY);
      else storage.removeItem('aimtrix.profile.v1');
    }, undefined);
  }, [demo, demoPersonalization]);

  useEffect(() => {
    let active = true;
    if (snapshot.status !== 'ready') {
      queueMicrotask(() => { if (active) setAccountPersonalization(undefined); });
    } else {
      const owner = profileOwner!;
      const remote = controller.loadProfilePersonalization() ?? defaultProfilePersonalization;
      queueMicrotask(() => { if (active) setAccountPersonalization({ owner, value: remote }); });
    }
    return () => { active = false; };
  }, [controller, snapshot.status, profileOwner]);

  useEffect(() => {
    if (!demo) void controller.initialize();
  }, [controller, demo]);

  if (demo) {
    return (
      <Workspace
        workspace={demoWorkspace}
        onDraftStateChange={reportDraftState}
        config={config}
        theme={theme}
        preferences={preferences}
        profilePersonalization={demoPersonalization}
        onThemeChange={setTheme}
        onPreferencesChange={setPreferences}
        onProfilePersonalizationChange={setDemoPersonalization}
        onSignOut={() => { reportDraftState(EMPTY_DRAFT_STATE); setDemo(false); }}
      />
    );
  }

  if (snapshot.status === 'restoring' || snapshot.status === 'connecting') {
    return <StartupScreen message={snapshot.message} />;
  }

  if (snapshot.status === 'reauthentication-required') {
    return <>{draftCleanupNotice}<SessionRecoveryScreen recovery={snapshot.recovery} error={snapshot.error} onSignIn={() => controller.reauthenticate()} onForget={forgetSession} /></>;
  }

  if (snapshot.status === 'error') {
    return (
      <>{draftCleanupNotice}<ConnectionError
        message={snapshot.error}
        issue={snapshot.issue}
        onRetry={() => void controller.retry()}
        onForget={forgetSession}
      /></>
    );
  }

  if (snapshot.status === 'signed-out' || snapshot.status === 'authenticating') {
    return (
      <>{draftCleanupNotice}<LoginWindow
        key={snapshot.recovery?.userId ?? 'login'}
        config={config}
        snapshot={snapshot}
        onForget={forgetSession}
        warnings={warnings}
        onLogin={(credentials) => controller.login(credentials)}
        onSso={(credentials) => controller.startSso(credentials)}
        onDemo={() => setDemo(true)}
      /></>
    );
  }

  return (
    <MediaProvider resolver={controller.resolveMedia}>
      <Workspace
        key={JSON.stringify([draftScope?.homeserver, snapshot.workspace.user.id])}
        workspace={snapshot.workspace}
        onDraftStateChange={reportDraftState}
        draftStore={draftStore}
        structuredDraftStore={structuredDraftStore}
        draftScope={draftScope}
        connectionNotice={snapshot.issue ? <ConnectionBanner issue={snapshot.issue} onRetry={() => controller.retry()} /> : undefined}
        config={config}
        theme={theme}
        preferences={preferences}
        profilePersonalization={profilePersonalization}
        onThemeChange={setTheme}
        onPreferencesChange={setPreferences}
        onProfilePersonalizationChange={async (next) => {
          const account = snapshot.workspace.user.id;
          const generation = profileRequests.generation;
          await controller.updateProfilePersonalization(next);
          const current = controller.getSnapshot();
          if (current.status === 'ready' && current.workspace.user.id === account && generation === profileRequests.generation) {
            setAccountPersonalization({ owner: account, value: next });
          }
        }}
        onUploadProfileBanner={(file) => controller.uploadProfileBanner(file)}
        onUpdateProfile={(update) => controller.updateProfile(update)}
        matrixSettingsActions={matrixSettingsActions}
        install={platform.install}
        pushRoute={pushRoute}
        onSendMessage={(roomId, body, mentions, inlineEmojis) => controller.sendMessage(roomId, body, mentions, inlineEmojis)}
        onRetryMessage={(roomId, eventId) => controller.retryMessage(roomId, eventId)}
        onCancelMessage={(roomId, eventId) => controller.cancelMessage(roomId, eventId)}
        onSendNudge={(roomId) => controller.sendNudge(roomId)}
        onLoadLinkPreview={(url) => controller.getLinkPreview(url)}
        onRoomSelected={(roomId) => controller.openRoomHistory(roomId)}
        onThreadSelected={(roomId, rootId, eventId) => controller.openThreadHistory(roomId, rootId, eventId)}
        onLoadThreadHistory={(roomId, rootId, direction) => controller.loadThreadHistory(roomId, rootId, direction)}
        onReturnThreadToLive={(roomId, rootId) => controller.returnThreadToLive(roomId, rootId)}
        onThreadHistoryDetached={(roomId, rootId, detached) => controller.setThreadHistoryDetached(roomId, rootId, detached)}
        onCloseThreadHistory={() => controller.closeThreadHistory()}
        onSendThreadMessage={(roomId, rootId, body, mentions, inlineEmojis) => controller.sendThreadMessage(roomId, rootId, body, mentions, inlineEmojis)}
        onLoadRoomHistory={(roomId, direction) => controller.loadRoomHistory(roomId, direction)}
        onOpenEventContext={(roomId, eventId) => controller.openEventContext(roomId, eventId)}
        onReturnToLive={(roomId) => controller.returnToLive(roomId)}
        onHistoryDetached={(roomId, detached) => controller.setHistoryDetached(roomId, detached)}
        onSpaceSelected={(spaceId) => controller.loadSpaceHierarchy(spaceId)}
        onReorganizeSpaceChildren={(update) => controller.reorganizeSpaceChildren(update)}
        onReorderRootSpaces={(spaceIds) => controller.reorderRootSpaces(spaceIds)}
        onSendReply={(roomId, body, target, mentions, inlineEmojis) => controller.sendReply(roomId, body, target, mentions, inlineEmojis)}
        onEditMessage={(roomId, eventId, body, mentions, inlineEmojis) => controller.editMessage(roomId, eventId, body, mentions, inlineEmojis)}
        onRedactMessage={(roomId, eventId) => controller.redactMessage(roomId, eventId)}
        onTogglePinnedMessage={(roomId, eventId, pinned) => controller.togglePinnedMessage(roomId, eventId, pinned)}
        onToggleReaction={(roomId, eventId, key, ownReactionEventId) =>
          controller.toggleReaction(roomId, eventId, key, ownReactionEventId)
        }
        onSendTyping={(roomId, typing) => controller.sendTyping(roomId, typing)}
        onSendSticker={(roomId, sticker, rootId) => controller.sendSticker(roomId, sticker, rootId)}
        onUploadAttachment={(roomId, file, onProgress, threadRootId, codeLanguage, options) => controller.uploadAttachment(roomId, file, onProgress, threadRootId, codeLanguage, options)}
        onCancelUpload={(id) => controller.cancelUpload(id)}
        onSendGif={(roomId, gif, rootId) => controller.sendGif(roomId, gif, rootId)}
        onMarkRoomRead={(roomId, options) => controller.markRoomRead(roomId, { ...options, publicReceipt: preferences.sendReadReceipts })}
        onMarkRoomUnread={(roomId, eventId) => controller.markRoomUnread(roomId, eventId)}
        onMarkThreadRead={(roomId, rootId, options) => controller.markThreadRead(roomId, rootId, { ...options, publicReceipt: preferences.sendReadReceipts })}
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
        onUploadRoomBackground={(file) => controller.uploadRoomBackground(file)}
        onSetRoomBackground={(roomId, background, personal) => controller.setRoomBackground(roomId, background, personal)}
        onSetRoomBackgroundPolicy={(roomId, permission) => controller.setRoomBackgroundPolicy(roomId, permission)}
        onEnableRoomEncryption={(roomId) => controller.enableRoomEncryption(roomId)}
        onSetRoomMuted={(roomId, muted) => controller.setRoomMuted(roomId, muted)}
        onSetRoomFavorite={(roomId, favorite) => controller.setRoomFavorite(roomId, favorite)}
        onResolveNavigationTarget={(target) => controller.resolveNavigationTarget(target)}
        onInviteToRoom={(roomId, userId) => controller.inviteToRoom(roomId, userId)}
        onRemoveRoomMember={(roomId, userId, action) => controller.removeRoomMember(roomId, userId, action)}
        onSetRoomMemberPower={(roomId, userId, level) => controller.setRoomMemberPower(roomId, userId, level)}
        onLeaveRoom={(roomId) => controller.leaveRoom(roomId)}
        onSignOut={() => { clearDrafts(); void controller.logout(); }}
      />
    </MediaProvider>
  );
}

export default function App() {
  const [result, setResult] = useState<RuntimeConfigResult>();
  const [updateWorker, setUpdateWorker] = useState<ServiceWorker>();
  const [draftState, setDraftState] = useState<DraftStateSummary>(EMPTY_DRAFT_STATE);
  const [confirmReload, setConfirmReload] = useState(false);
  const applyUpdate = () => {
    if (!updateWorker || draftState.sending) return;
    navigator.serviceWorker?.addEventListener('controllerchange', () => window.location.reload(), { once: true });
    updateWorker.postMessage('SKIP_WAITING');
  };
  const reloadDescription = [
    draftState.volatile ? 'Some drafts are only in this tab. Reloading will lose unsaved changes.' : 'Drafts saved on this device will return for the same account after reloading.',
    draftState.hasAttachments ? 'File contents are not saved. Reattach files after reloading; if a send was interrupted, check the conversation before sending again.' : '',
    'Encrypted account storage is preserved.',
  ].filter(Boolean).join(' ');
  const [pushRoute, setPushRoute] = useState<PushRoute | undefined>(() => parsePushRoute(new URL(window.location.href)));

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
    const applyRoute = (value: unknown) => {
      const route = pushRouteFromMessage(value);
      if (!route) return;
      setPushRoute(route);
      window.history.replaceState(window.history.state, '', routeUrl(route, window.location.href));
    };
    const handlePushRoute = (event: MessageEvent) => {
      if (event.data?.type === 'AIMTRIX_PUSH_ROUTE') applyRoute(event.data);
    };
    const handleNativeRoute = (event: Event) => applyRoute((event as CustomEvent).detail);
    window.addEventListener('aimtrix-push-route', handleNativeRoute);
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', handlePushRoute);
    return () => {
      window.removeEventListener('aimtrix-push-route', handleNativeRoute);
      if ('serviceWorker' in navigator) navigator.serviceWorker.removeEventListener('message', handlePushRoute);
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
      {!result ? <StartupScreen /> : <ConfiguredApp result={result} pushRoute={pushRoute} onDraftStateChange={setDraftState} />}
      <NetworkStatus />
      <InstallPrompt />
      {updateWorker ? (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            zIndex: 100,
            right: 18,
            bottom: 'calc(18px + env(safe-area-inset-bottom, 0px))',
            display: 'flex',
            width: 'min(540px, calc(100vw - 36px))',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 14,
            padding: '11px 12px',
            color: 'var(--text)',
            border: '1px solid var(--border-strong)',
            borderRadius: 9,
            background: 'var(--surface-raised)',
            boxShadow: '0 14px 40px rgba(20,35,46,0.36)',
          }}
        >
          <span style={{ display: 'grid', minWidth: 0, gap: 2 }}>
            <strong>Aimtrix update ready</strong>
            <small style={{ color: 'var(--text-faint)', fontSize: '0.62rem' }}>{draftState.sending ? 'Wait for current sends to finish before reloading.' : 'Reload when you are ready. Encrypted account storage is preserved.'}</small>
          </span>
          <div style={{ display: 'flex', flex: '0 0 auto', alignItems: 'center', gap: 7 }}>
            <button className="text-button" type="button" onClick={() => { setUpdateWorker(undefined); setConfirmReload(false); }}>Later</button>
            <button className="aqua-button aqua-button--primary" type="button" disabled={draftState.sending} onClick={() => {
              if (draftState.hasDrafts || draftState.hasAttachments) setConfirmReload(true);
              else applyUpdate();
            }}>Reload</button>
          </div>
        </div>
      ) : null}
      {confirmReload && updateWorker ? <ConfirmDialog title="Reload Aimtrix?" description={draftState.sending ? 'A send is now in progress. Wait for it to finish before reloading.' : reloadDescription} actionLabel="Reload now" onClose={() => setConfirmReload(false)} onConfirm={async () => { if (draftState.sending) throw new Error('Send in progress'); applyUpdate(); }} /> : null}
    </>
  );
}
