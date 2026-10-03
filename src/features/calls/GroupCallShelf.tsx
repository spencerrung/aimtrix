import { Mic, MicOff, MonitorUp, PhoneOff, ShieldCheck, ShieldAlert, Video, VideoOff, Volume2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { GroupCallParticipant, GroupCallSummary, RoomSummary } from '../../matrix/viewModels';
import './groupCall.css';

function Media({ stream, kind, muted, speakerId, label }: { stream?: MediaStream; kind: 'audio' | 'video'; muted?: boolean; speakerId?: string; label: string }) {
  const ref = useRef<HTMLMediaElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.srcObject = stream ?? null;
    if (!muted && speakerId && 'setSinkId' in element) void element.setSinkId(speakerId).catch(() => undefined);
    return () => { element.srcObject = null; };
  }, [stream, muted, speakerId]);
  if (!stream) return null;
  return kind === 'audio'
    ? <audio ref={ref as React.RefObject<HTMLAudioElement>} autoPlay aria-label={label} />
    : <video ref={ref as React.RefObject<HTMLVideoElement>} autoPlay playsInline muted={muted} aria-label={label} />;
}

function ParticipantTile({ participant, speakerId }: { participant: GroupCallParticipant; speakerId?: string }) {
  const video = participant.screenStream ?? participant.videoStream;
  return <li className={`group-call-shelf__participant${participant.speaking ? ' is-speaking' : ''}`}>
    <div className="group-call-shelf__picture">
      {video ? <Media stream={video} kind="video" muted={participant.local} label={`${participant.name} video`} /> : <span aria-hidden="true">{participant.name.slice(0, 1).toUpperCase()}</span>}
      <Media stream={participant.audioStream} kind="audio" speakerId={speakerId} label={`${participant.name} audio`} />
    </div>
    <div className="group-call-shelf__participant-label"><strong>{participant.name}</strong><span>{participant.microphoneMuted ? 'Muted' : participant.speaking ? 'Speaking' : 'Listening'}{participant.encrypted ? '' : ' · Media not encrypted'}</span></div>
  </li>;
}

interface Props {
  call: GroupCallSummary;
  room?: RoomSummary;
  speakerId?: string;
  onLeave: () => void;
  onMicrophone: (muted: boolean) => void;
  onVideo: (muted: boolean) => void;
  onScreenshare: (enabled: boolean) => void;
  onEnableAudio: () => void;
}

export function GroupCallShelf({ call, room, speakerId, onLeave, onMicrophone, onVideo, onScreenshare, onEnableAudio }: Props) {
  const active = call.state === 'connected';
  return <section className="group-call-shelf" aria-label={`Group call in ${room?.name || 'room'}`}>
    <header><div><strong>{room?.name || 'Group call'}</strong><span>{call.state === 'joining' ? 'Joining encrypted call…' : call.state === 'reconnecting' ? 'Reconnecting…' : call.state === 'error' ? 'Call unavailable' : `${call.participants.length} participant${call.participants.length === 1 ? '' : 's'}`}</span></div><span className={`group-call-shelf__security${call.encrypted ? ' is-encrypted' : ''}`}>{call.encrypted ? <ShieldCheck size={15} /> : <ShieldAlert size={15} />}{call.encrypted ? 'Media encrypted' : 'Encryption pending or unavailable'}</span></header>
    {call.error ? <p role="alert">{call.error}</p> : null}
    {call.audioPlaybackBlocked ? <button className="aqua-button" type="button" onClick={onEnableAudio}><Volume2 size={16} /> Enable call audio</button> : null}
    <ul className="group-call-shelf__grid" aria-label="Call participants">{call.participants.map((participant) => <ParticipantTile key={participant.id} participant={participant} speakerId={speakerId} />)}</ul>
    <footer>
      <button type="button" disabled={!active} aria-label={call.microphoneMuted ? 'Unmute group microphone' : 'Mute group microphone'} onClick={() => onMicrophone(!call.microphoneMuted)}>{call.microphoneMuted ? <MicOff size={17} /> : <Mic size={17} />}</button>
      <button type="button" disabled={!active} aria-label={call.videoMuted ? 'Turn group camera on' : 'Turn group camera off'} onClick={() => onVideo(!call.videoMuted)}>{call.videoMuted ? <VideoOff size={17} /> : <Video size={17} />}</button>
      <button type="button" disabled={!active} aria-label={call.screensharing ? 'Stop sharing group screen' : 'Share group screen'} aria-pressed={call.screensharing} onClick={() => onScreenshare(!call.screensharing)}><MonitorUp size={17} /></button>
      <button className="group-call-shelf__leave" type="button" aria-label="Leave group call" onClick={onLeave}><PhoneOff size={17} /> Leave</button>
    </footer>
  </section>;
}
