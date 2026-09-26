import { useEffect, useState } from 'react';
export interface ThreadAttentionActions {
  load(roomId: string, rootId: string): Promise<{ following: boolean; muted: boolean; supported: boolean }>;
  follow(roomId: string, rootId: string, value: boolean): Promise<void>;
  mute(roomId: string, rootId: string, value: boolean): Promise<void>;
}
export default function ThreadAttention({ actions, roomId, rootId }: { actions: ThreadAttentionActions; roomId: string; rootId: string }) {
  const [state, setState] = useState<{ following: boolean; muted: boolean; supported: boolean }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  useEffect(() => { let active = true; actions.load(roomId, rootId).then((result) => { if (active) setState(result); }).catch(() => { if (active) setError('Thread preferences could not load.'); }); return () => { active = false; }; }, [actions, roomId, rootId, retry]);
  async function change(kind: 'follow' | 'mute', value: boolean) {
    setBusy(true); setError(undefined);
    try { await actions[kind](roomId, rootId, value); setState(await actions.load(roomId, rootId)); }
    catch { setError('Thread preferences could not be saved completely. Refresh to check the server.'); try { setState(await actions.load(roomId, rootId)); } catch { setState(undefined); } }
    finally { setBusy(false); }
  }
  return <div style={{ padding: '8px 12px', borderBottom: '1px solid #8299b344' }} aria-label="Thread attention">
    {state ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button className="aqua-button" style={{ minHeight: 44 }} type="button" disabled={busy} onClick={() => void change('follow', !state.following)}>{state.following ? 'Hide from Home' : 'Follow in Home'}</button>
      {state.supported ? <button className="aqua-button" style={{ minHeight: 44 }} type="button" disabled={busy} onClick={() => void change('mute', !state.muted)}>{state.muted ? 'Use room alerts' : 'Mute thread alerts'}</button> : null}
    </div> : !error ? <p role="status">Loading thread preferences…</p> : null}
    <p style={{ fontSize: 12 }}>Following adds this thread to Home. Alerts use your Matrix rules.{state && !state.supported ? ' This homeserver does not support exact thread alert rules.' : ''}</p>
    {error ? <><p role="alert">{error}</p><button className="aqua-button" type="button" disabled={busy} onClick={() => setRetry((value) => value + 1)}>Refresh thread preferences</button></> : null}
  </div>;
}
