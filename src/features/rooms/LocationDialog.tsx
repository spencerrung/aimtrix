import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { Dialog, DialogClose } from '../../components/Dialog';
import { createGeoUri } from '../../matrix/locations';
import './socialDialogs.css';

export function LocationDialog({ roomName, onSend, onClose }: {
  roomName: string;
  onSend: (latitude: number, longitude: number, description: string) => Promise<void>;
  onClose: () => void;
}) {
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [description, setDescription] = useState('');
  const [finding, setFinding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const lookup = useRef(0);
  useEffect(() => () => { lookup.current += 1; }, []);
  let uri: string | undefined;
  try { if (latitude.trim() && longitude.trim()) uri = createGeoUri(Number(latitude), Number(longitude)); } catch { /* Show the validation hint below. */ }
  const findCurrent = () => {
    if (!navigator.geolocation) { setError('Location access is unavailable here. Enter coordinates manually.'); return; }
    const current = ++lookup.current;
    setFinding(true); setError('');
    navigator.geolocation.getCurrentPosition((position) => {
      if (lookup.current !== current) return;
      setLatitude(String(position.coords.latitude)); setLongitude(String(position.coords.longitude)); setFinding(false);
    }, () => { if (lookup.current !== current) return; setFinding(false); setError('Location access was denied or unavailable. Enter coordinates manually.'); }, {
      enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000,
    });
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending.current || !uri) return;
    pending.current = true; setBusy(true); setError('');
    try { await onSend(Number(latitude), Number(longitude), description.trim()); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Location could not be shared. Review the coordinates and try again.'); }
    finally { pending.current = false; setBusy(false); }
  };
  return <Dialog className="room-dialog location-dialog" aria-labelledby="location-dialog-title" onClose={onClose} busy={busy}>
    <header><strong id="location-dialog-title">Share a location</strong><DialogClose aria-label="Close"><X size={16} /></DialogClose></header>
    <form onSubmit={(event) => void submit(event)}>
      <p>Choose one static point to share with everyone who can read {roomName}. Aimtrix does not load a map or track your movement.</p>
      <button className="aqua-button" type="button" disabled={busy || finding} onClick={findCurrent}>{finding ? 'Finding location…' : 'Use my current location'}</button>
      <label>Latitude<input type="number" min={-90} max={90} step="any" value={latitude} onChange={(event) => setLatitude(event.target.value)} data-initial-focus /></label>
      <label>Longitude<input type="number" min={-180} max={180} step="any" value={longitude} onChange={(event) => setLongitude(event.target.value)} /></label>
      <label>Description (optional)<input maxLength={200} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Meeting spot" /></label>
      {uri ? <div className="location-dialog__preview"><strong>Location preview</strong><span>{description.trim() || 'Shared location'}</span><code>{uri}</code></div> : <p className="settings-hint">Enter valid latitude and longitude to preview the point.</p>}
      {error ? <p role="alert" className="settings-error">{error}</p> : null}
      <button className="aqua-button aqua-button--primary" type="submit" disabled={!uri || busy || finding}>{busy ? 'Sharing…' : 'Share this location'}</button>
    </form>
  </Dialog>;
}
