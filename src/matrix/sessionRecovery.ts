export interface SessionRecovery {
  userId: string;
  homeserver: string;
  softLogout: boolean;
}

export type ConnectionIssue = 'offline' | 'consent' | 'storage';

export function sessionErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { errcode?: unknown }).errcode;
  return typeof code === 'string' ? code : undefined;
}

export function isSessionRejected(error: unknown): boolean {
  return ['M_UNKNOWN_TOKEN', 'M_MISSING_TOKEN', 'M_USER_DEACTIVATED'].includes(sessionErrorCode(error) ?? '');
}

export function connectionIssue(error: unknown): ConnectionIssue {
  if (sessionErrorCode(error) === 'M_CONSENT_NOT_GIVEN') return 'consent';
  if (error && typeof error === 'object') {
    const { name, message } = error as { name?: unknown; message?: unknown };
    if ((typeof name === 'string' && /QuotaExceeded|InvalidState|SecurityError/.test(name)) ||
      (typeof message === 'string' && /indexeddb|crypto|wasm|secure credential storage/i.test(message))) return 'storage';
  }
  return 'offline';
}

export function connectionIssueMessage(issue: ConnectionIssue): string {
  if (issue === 'consent') return 'Your homeserver requires account consent. Complete it in another Matrix client or the server account page, then try again.';
  if (issue === 'storage') return 'Aimtrix could not access local encryption or credential storage. Check this browser or device’s storage settings, then try again.';
  return 'Aimtrix is waiting for your connection. Check your network and try again; your session and encryption keys are still here.';
}
