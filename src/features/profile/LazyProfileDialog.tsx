import { useEffect, useState, type ComponentProps, type ComponentType } from 'react';
import { Dialog, DialogClose } from '../../components/Dialog';

type ProfileProps = ComponentProps<typeof import('./ProfileDialog').ProfileDialog>;
const loadProfile = () => import('./ProfileDialog').then((module) => module.ProfileDialog);

/** Load optional profile decoration code and styles only when the editor is opened. */
export function LazyProfileDialog({ load = loadProfile, ...props }: ProfileProps & { load?: () => Promise<ComponentType<ProfileProps>> }) {
  const [Content, setContent] = useState<ComponentType<ProfileProps>>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void load().then((component) => { if (active) setContent(() => component); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [load, attempt]);
  if (Content) return <Content {...props} />;
  return <Dialog className="room-dialog" backdropClassName="room-dialog-backdrop" aria-label="Profile page" onClose={props.onClose}>
    <header><strong>Profile page</strong><DialogClose aria-label="Close profile page">×</DialogClose></header>
    <div className="interaction-fields" style={{ padding: 20 }}>
      {failed ? <><p role="alert">The profile editor could not be loaded. Check your connection and try again.</p><button type="button" className="aqua-button" onClick={() => { setFailed(false); setAttempt((value) => value + 1); }}>Retry loading profile</button></> : <p role="status">Loading profile editor…</p>}
    </div>
  </Dialog>;
}
