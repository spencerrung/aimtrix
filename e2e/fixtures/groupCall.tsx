import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { GroupCallPrejoin } from '../../src/features/calls/GroupCallPrejoin';
import { GroupCallShelf } from '../../src/features/calls/GroupCallShelf';
import type { GroupCallSummary } from '../../src/matrix/viewModels';
import '../../src/styles.css';

declare global { interface Window { groupCallFixture: { joins: number; leaves: number; microphone: boolean; video: boolean; screenshare: boolean } } }
window.groupCallFixture = { joins: 0, leaves: 0, microphone: false, video: false, screenshare: false };

export function Fixture() {
  const [prejoin, setPrejoin] = useState(true);
  const [call, setCall] = useState<GroupCallSummary>();
  return <main className="app-shell"><h1 className="sr-only">Group call test room</h1>
    {prejoin ? <GroupCallPrejoin roomName="Welcome Lounge" initialVideo={false} onClose={() => setPrejoin(false)} onJoin={async (video, _devices, microphone) => {
      window.groupCallFixture.joins += 1;
      window.groupCallFixture.microphone = microphone;
      window.groupCallFixture.video = video;
      setCall({ roomId: 'welcome', state: 'connected', encrypted: true, microphoneMuted: !microphone, videoMuted: !video, screensharing: false, participants: [{ id: 'local', name: 'You', speaking: false, encrypted: true, microphoneMuted: !microphone, local: true }] });
    }} /> : null}
    {call ? <GroupCallShelf call={call} room={{ id: 'welcome', name: 'Welcome Lounge' } as Parameters<typeof GroupCallShelf>[0]['room']} onLeave={() => { window.groupCallFixture.leaves += 1; setCall(undefined); }} onMicrophone={(muted) => { window.groupCallFixture.microphone = !muted; setCall((current) => current && { ...current, microphoneMuted: muted }); }} onVideo={(muted) => { window.groupCallFixture.video = !muted; setCall((current) => current && { ...current, videoMuted: muted }); }} onScreenshare={(enabled) => { window.groupCallFixture.screenshare = enabled; setCall((current) => current && { ...current, screensharing: enabled }); }} onEnableAudio={() => undefined} /> : null}
  </main>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
