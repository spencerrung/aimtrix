import { useState, type CSSProperties } from 'react';
import { useMediaSource } from '../matrix/useMediaSource';
import { initialsFor, type PresenceState } from '../matrix/viewModels';

interface AvatarProps {
  name: string;
  src?: string;
  color?: string;
  presence?: PresenceState;
  size?: 'small' | 'medium' | 'large';
}

export function Avatar({
  name,
  src,
  color = '#6d91b3',
  presence,
  size = 'medium',
}: AvatarProps) {
  const pixelSize = size === 'large' ? 140 : size === 'small' ? 66 : 96;
  const mediaSrc = useMediaSource(src, pixelSize);
  const [failedSrc, setFailedSrc] = useState<string>();
  const showImage = Boolean(mediaSrc && failedSrc !== mediaSrc);

  return (
    <span
      className={`avatar avatar--${size}`}
      style={{ '--avatar-color': color } as CSSProperties}
      aria-hidden="true"
    >
      {showImage ? (
        <img src={mediaSrc} alt="" loading="lazy" onError={() => setFailedSrc(mediaSrc)} />
      ) : (
        <span>{initialsFor(name)}</span>
      )}
      {presence ? <i className={`presence presence--${presence}`} /> : null}
    </span>
  );
}
