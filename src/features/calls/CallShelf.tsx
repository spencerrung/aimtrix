import {
  Mic,
  MicOff,
  MonitorUp,
  Phone,
  PhoneOff,
  Video,
  VideoOff,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { CallSummary, RoomSummary } from '../../matrix/viewModels';
import { Avatar } from '../../components/Avatar';
import { colorForId } from '../../matrix/viewModels';

function StreamVideo({ stream, muted, label, speakerId }: { stream?: MediaStream; muted?: boolean; label: string; speakerId?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = stream ?? null;
      if (speakerId && 'setSinkId' in ref.current) {
        void ref.current.setSinkId(speakerId).catch(() => undefined);
      }
    }
  }, [speakerId, stream]);
  if (!stream) return null;
  return <video ref={ref} autoPlay playsInline muted={muted} controls={!muted} aria-label={label} />;
}

interface CallShelfProps {
  call: CallSummary;
  room?: RoomSummary;
  speakerId?: string;
  onAnswer: (video: boolean) => void;
  onReject: () => void;
  onHangup: () => void;
  onMicrophone: (muted: boolean) => void;
  onVideo: (muted: boolean) => void;
  onScreenshare: (enabled: boolean) => void;
}

export function CallShelf({
  call,
  room,
  speakerId,
  onAnswer,
  onReject,
  onHangup,
  onMicrophone,
  onVideo,
  onScreenshare,
}: CallShelfProps) {
  const ringing = call.incoming && (call.state === 'ringing' || call.state === 'fledgling');
  const roomName = room?.name || 'Matrix call';
  return (
    <section className={`call-shelf${call.video ? ' call-shelf--video' : ''}`} aria-label={`Call with ${roomName}`}>
      <div className="call-shelf__visuals">
        <StreamVideo stream={call.remoteStream} label="Remote video" speakerId={speakerId} />
        <StreamVideo stream={call.localStream} muted label="Your video" />
        {!call.remoteStream ? (
          <Avatar name={roomName} src={room?.avatarUrl} color={colorForId(call.roomId)} size="large" />
        ) : null}
      </div>
      <div className="call-shelf__copy">
        <strong>{ringing ? `${roomName} is calling` : roomName}</strong>
        <span>{call.error || (ringing ? 'Incoming Matrix call' : call.state.replaceAll('_', ' '))}</span>
      </div>
      <div className="call-shelf__controls">
        {ringing ? (
          <>
            <button className="call-control call-control--answer" type="button" aria-label="Answer voice call" onClick={() => onAnswer(false)}><Phone size={18} /></button>
            <button className="call-control call-control--answer" type="button" aria-label="Answer video call" onClick={() => onAnswer(true)}><Video size={18} /></button>
            <button className="call-control call-control--hangup" type="button" aria-label="Reject call" onClick={onReject}><PhoneOff size={18} /></button>
          </>
        ) : (
          <>
            <button className="call-control" type="button" aria-label={call.microphoneMuted ? 'Unmute microphone' : 'Mute microphone'} onClick={() => onMicrophone(!call.microphoneMuted)}>{call.microphoneMuted ? <MicOff size={18} /> : <Mic size={18} />}</button>
            <button className="call-control" type="button" aria-label={call.videoMuted ? 'Turn camera on' : 'Turn camera off'} onClick={() => onVideo(!call.videoMuted)}>{call.videoMuted ? <VideoOff size={18} /> : <Video size={18} />}</button>
            <button className={`call-control${call.screensharing ? ' is-active' : ''}`} type="button" aria-label={call.screensharing ? 'Stop screen sharing' : 'Share screen'} onClick={() => onScreenshare(!call.screensharing)}><MonitorUp size={18} /></button>
            <button className="call-control call-control--hangup" type="button" aria-label="Hang up" onClick={onHangup}><PhoneOff size={18} /></button>
          </>
        )}
      </div>
    </section>
  );
}
