import {
  Check,
  ImagePlus,
  Leaf,
  LogOut,
  PackagePlus,
  Pencil,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Avatar } from '../../components/Avatar';
import { loadStickerPack, type StickerPackDefinition } from '../media/stickerPacks';
import { useMediaSource } from '../../matrix/useMediaSource';
import { colorForId, type UserSummary } from '../../matrix/viewModels';
import {
  avatarFrameNames,
  bannerPresetNames,
  defaultProfilePersonalization,
  normalizeManifestUrl,
  profileCardNames,
  profileEffectNames,
  type ProfilePersonalization,
  type ProfileSticker,
} from '../../settings/profilePersonalization';

function StickerImage({ sticker, dataSaver }: { sticker: ProfileSticker; dataSaver: boolean }) {
  let remote = sticker.src.startsWith('mxc://');
  try { remote ||= new URL(sticker.src, window.location.origin).origin !== window.location.origin; } catch { remote = true; }
  const source = useMediaSource(dataSaver && remote ? undefined : sticker.src, 160);
  return source ? <img src={source} alt="" /> : <span className="spinner" aria-label="Loading sticker" />;
}

function ProfilePreview({
  user,
  profile,
  dataSaver,
}: {
  user: UserSummary;
  profile: ProfilePersonalization;
  dataSaver: boolean;
}) {
  const bannerSource = useMediaSource(dataSaver ? undefined : profile.bannerMxc, 1200);
  const bannerStyle = bannerSource
    ? ({ '--profile-banner-image': `url("${bannerSource}")` } as CSSProperties)
    : undefined;
  return (
    <article className={`decorated-profile profile-card--${profile.card}`} aria-label={`${user.displayName}'s Aimtrix profile`}>
      <div
        className={`decorated-profile__banner profile-banner--${profile.bannerPreset}${bannerSource ? ' has-custom-image' : ''}`}
        style={bannerStyle}
      >
        {profile.effect === 'bubbles' ? <div className="profile-effect profile-effect--bubbles" aria-hidden="true"><i /><i /><i /><i /></div> : null}
        {profile.effect === 'sparkles' ? <div className="profile-effect profile-effect--sparkles" aria-hidden="true">✦ <span>✧</span> ✦</div> : null}
      </div>
      <div className={`decorated-profile__avatar profile-frame--${profile.avatarFrame}`}>
        <Avatar
          name={user.displayName}
          src={user.avatarUrl}
          color={colorForId(user.id)}
          presence={user.presence}
          size="large"
        />
      </div>
      <div className="decorated-profile__identity">
        <span className="eyebrow"><Leaf size={11} /> My Aimtrix page</span>
        <h2>{user.displayName}</h2>
        <code>{user.id}</code>
        <p className="decorated-profile__status"><i className={`presence-swatch presence-swatch--${user.presence}`} /> {user.statusMessage || 'Available'}</p>
        <p className={`decorated-profile__bio${profile.bio ? '' : ' is-placeholder'}`}>
          {profile.bio || 'Add a little note about yourself…'}
        </p>
      </div>
      {profile.stickers.length ? (
        <div className="profile-pinned-stickers" aria-label="Pinned profile stickers">
          {profile.stickers.map((sticker) => <span key={`${sticker.id}:${sticker.src}`} title={sticker.name}><StickerImage sticker={sticker} dataSaver={dataSaver} /></span>)}
        </div>
      ) : null}
      <footer><Sparkles size={12} /> Decorated in Aimtrix</footer>
    </article>
  );
}

const labels = {
  banner: { sky: 'Blue sky', lagoon: 'Lagoon', meadow: 'Meadow', citrus: 'Citrus pop', twilight: 'Twilight' },
  frame: { chrome: 'Chrome', bubble: 'Bubble', leaf: 'Fresh leaf', candy: 'Candy' },
  card: { glass: 'Glass', lagoon: 'Lagoon', meadow: 'Meadow', citrus: 'Citrus' },
  effect: { bubbles: 'Bubbles', sparkles: 'Sparkles', none: 'Still' },
} as const;

export function ProfileDialog({
  user,
  personalization,
  stickerPacks,
  canUpload,
  dataSaver,
  onChange,
  onUploadBanner,
  onSignOut,
  onClose,
}: {
  user: UserSummary;
  personalization: ProfilePersonalization;
  stickerPacks: StickerPackDefinition[];
  canUpload: boolean;
  dataSaver: boolean;
  onChange: (personalization: ProfilePersonalization) => void;
  onUploadBanner?: (file: File) => Promise<string>;
  onSignOut: () => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(personalization);
  const [activePack, setActivePack] = useState(stickerPacks[0]?.manifestUrl ?? '');
  const [stickers, setStickers] = useState<ProfileSticker[]>([]);
  const [packStatus, setPackStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [newPackName, setNewPackName] = useState('');
  const [newPackUrl, setNewPackUrl] = useState('');
  const [notice, setNotice] = useState<string>();
  const bannerInput = useRef<HTMLInputElement>(null);
  const availablePacks = useMemo<StickerPackDefinition[]>(() => {
    const installedUrls = new Set(draft.installedStickerPacks.map((pack) => pack.manifestUrl));
    const retained = stickerPacks.filter((pack) => pack.source !== 'personal' || installedUrls.has(pack.manifestUrl));
    const known = new Set(retained.map((pack) => pack.manifestUrl));
    return [
      ...retained,
      ...draft.installedStickerPacks
        .filter((pack) => !known.has(pack.manifestUrl))
        .map((pack) => ({ ...pack, source: 'personal' as const })),
    ];
  }, [draft.installedStickerPacks, stickerPacks]);
  const selectedPack = availablePacks.find((pack) => pack.manifestUrl === activePack);
  const personalPacks = availablePacks.filter((pack) => pack.source === 'personal');

  useEffect(() => {
    if (!editing || !activePack) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setPackStatus('loading');
        setStickers([]);
      }
    });
    void loadStickerPack(activePack, controller.signal)
      .then((items) => {
        setStickers(items);
        setPackStatus('idle');
      })
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== 'AbortError') setPackStatus('error');
      });
    return () => controller.abort();
  }, [activePack, editing]);

  const pinnedKeys = useMemo(() => new Set(draft.stickers.map((sticker) => `${sticker.id}:${sticker.src}`)), [draft.stickers]);
  const update = (patch: Partial<ProfilePersonalization>) => setDraft((current) => ({ ...current, ...patch }));

  const toggleSticker = (sticker: ProfileSticker) => {
    const key = `${sticker.id}:${sticker.src}`;
    setDraft((current) => ({
      ...current,
      stickers: pinnedKeys.has(key)
        ? current.stickers.filter((item) => `${item.id}:${item.src}` !== key)
        : [...current.stickers, sticker].slice(-3),
    }));
  };

  const installPack = async (event: FormEvent) => {
    event.preventDefault();
    setNotice(undefined);
    const manifestUrl = normalizeManifestUrl(newPackUrl);
    if (!manifestUrl || !newPackName.trim()) {
      setNotice('Enter a name and an HTTPS manifest URL.');
      return;
    }
    try {
      await loadStickerPack(manifestUrl);
      const installedStickerPacks = [
        ...draft.installedStickerPacks.filter((pack) => pack.manifestUrl !== manifestUrl),
        { id: `personal:${manifestUrl}`, name: newPackName.trim().slice(0, 40), manifestUrl },
      ].slice(-12);
      update({ installedStickerPacks });
      setNewPackName('');
      setNewPackUrl('');
      setActivePack(manifestUrl);
      setNotice('Pack checked and ready. Save your page to sync it.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'That sticker pack could not be loaded.');
    }
  };

  const uploadBanner = async (file: File) => {
    if (!onUploadBanner) return;
    setNotice('Uploading your banner to Matrix…');
    try {
      const bannerMxc = await onUploadBanner(file);
      update({ bannerMxc });
      setNotice('Banner uploaded. Save your page to keep it.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Your banner could not be uploaded.');
    }
  };

  return (
    <div className="profile-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="profile-dialog__titlebar">
          <div><Sparkles size={16} /><strong id="profile-dialog-title">My profile page</strong></div>
          <button type="button" aria-label="Close profile page" onClick={onClose}><X size={17} /></button>
        </header>
        <div className={`profile-dialog__layout${editing ? ' is-editing' : ''}`}>
          <div className="profile-dialog__preview">
            <ProfilePreview user={user} profile={draft} dataSaver={dataSaver} />
            <div className="profile-dialog__actions">
              <button className="aqua-button aqua-button--primary" type="button" onClick={() => setEditing((value) => !value)}>
                {editing ? <X size={14} /> : <Pencil size={14} />} {editing ? 'Stop editing' : 'Decorate my page'}
              </button>
              {!editing ? <button className="aqua-button" type="button" onClick={onSignOut}><LogOut size={14} /> Sign out</button> : null}
            </div>
            <p className="profile-privacy-note">Your name, picture, presence, and away message are standard Matrix profile fields that people you share rooms with can see in any client. Your profile note and page decorations are private Matrix account data—only you can see them, synced between your Aimtrix sessions. Account data and banner media are not end-to-end encrypted—keep them non-sensitive.</p>
          </div>

          {editing ? (
            <div className="profile-decorator">
              <section>
                <div className="profile-decorator__heading"><div><h3>Landscape banner</h3><p>Pick an original Aero scene or upload your own.</p></div><ImagePlus size={17} /></div>
                <div className="banner-choice-grid">
                  {bannerPresetNames.map((preset) => <button type="button" key={preset} className={`profile-banner--${preset}${draft.bannerPreset === preset && !draft.bannerMxc ? ' is-active' : ''}`} aria-pressed={draft.bannerPreset === preset && !draft.bannerMxc} onClick={() => update({ bannerPreset: preset, bannerMxc: undefined })}><span>{labels.banner[preset]}</span></button>)}
                </div>
                <input ref={bannerInput} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadBanner(file); event.target.value = ''; }} />
                <div className="profile-inline-actions">
                  <button className="aqua-button" type="button" disabled={!canUpload} onClick={() => bannerInput.current?.click()}><ImagePlus size={13} /> Upload image</button>
                  {draft.bannerMxc ? <button className="text-button" type="button" onClick={() => update({ bannerMxc: undefined })}>Use preset instead</button> : null}
                </div>
              </section>

              <section>
                <h3>About me</h3>
                <label className="settings-field"><span>Profile note <small>private · {draft.bio.length}/180</small></span><textarea value={draft.bio} maxLength={180} rows={3} placeholder="A note for your own Aimtrix page — only you can read it…" onChange={(event) => update({ bio: event.target.value })} /></label>
                <div className="profile-option-row"><span>Avatar frame</span><div className="aqua-segmented">{avatarFrameNames.map((frame) => <button type="button" key={frame} className={draft.avatarFrame === frame ? 'is-active' : ''} onClick={() => update({ avatarFrame: frame })}>{labels.frame[frame]}</button>)}</div></div>
                <div className="profile-option-row"><span>Card surface</span><div className="aqua-segmented">{profileCardNames.map((card) => <button type="button" key={card} className={draft.card === card ? 'is-active' : ''} onClick={() => update({ card })}>{labels.card[card]}</button>)}</div></div>
                <div className="profile-option-row"><span>Banner effect</span><div className="aqua-segmented">{profileEffectNames.map((effect) => <button type="button" key={effect} className={draft.effect === effect ? 'is-active' : ''} onClick={() => update({ effect })}>{labels.effect[effect]}</button>)}</div></div>
              </section>

              <section>
                <div className="profile-decorator__heading"><div><h3>Profile stickers</h3><p>Pin up to three. Choosing a fourth replaces the oldest.</p></div><Sparkles size={17} /></div>
                <label className="settings-field"><span>Sticker pack</span><select aria-label="Profile sticker pack" value={activePack} onChange={(event) => setActivePack(event.target.value)}>{availablePacks.map((pack) => <option value={pack.manifestUrl} key={pack.id}>{pack.name}{pack.source === 'operator' ? ' · Host' : pack.source === 'personal' ? ' · Mine' : ''}</option>)}</select></label>
                {selectedPack?.description ? <p className="sticker-pack-description">{selectedPack.description}</p> : null}
                <div className="profile-sticker-grid" aria-busy={packStatus === 'loading'}>
                  {packStatus === 'loading' ? <p><span className="spinner" /> Loading pack…</p> : packStatus === 'error' ? <p role="alert">This pack could not be loaded.</p> : stickers.map((sticker) => {
                    const selected = pinnedKeys.has(`${sticker.id}:${sticker.src}`);
                    return <button type="button" className={selected ? 'is-active' : ''} aria-pressed={selected} aria-label={`${selected ? 'Unpin' : 'Pin'} ${sticker.name}`} title={sticker.name} key={`${sticker.id}:${sticker.src}`} onClick={() => toggleSticker(sticker)}><StickerImage sticker={sticker} dataSaver={dataSaver} />{selected ? <Check size={13} /> : null}</button>;
                  })}
                </div>
              </section>

              <section>
                <div className="profile-decorator__heading"><div><h3>My sticker packs</h3><p>Manifest content is loaded directly from sites you trust.</p></div><PackagePlus size={17} /></div>
                <form className="pack-install-form" onSubmit={(event) => void installPack(event)}>
                  <input aria-label="Sticker pack name" value={newPackName} maxLength={40} placeholder="Pack name" onChange={(event) => setNewPackName(event.target.value)} />
                  <input aria-label="Sticker manifest URL" value={newPackUrl} inputMode="url" placeholder="https://example/manifest.json" onChange={(event) => setNewPackUrl(event.target.value)} />
                  <button className="aqua-button" type="submit"><PackagePlus size={13} /> Check & install</button>
                </form>
                {personalPacks.length ? <ul className="installed-pack-list">{personalPacks.map((pack) => <li key={pack.id}><span><strong>{pack.name}</strong><small>{pack.manifestUrl}</small></span><button type="button" aria-label={`Remove ${pack.name}`} onClick={() => { update({ installedStickerPacks: draft.installedStickerPacks.filter((item) => item.manifestUrl !== pack.manifestUrl) }); if (activePack === pack.manifestUrl) setActivePack(stickerPacks[0]?.manifestUrl ?? ''); }}><Trash2 size={14} /></button></li>)}</ul> : null}
              </section>

              {notice ? <p className="profile-editor-notice" role="status">{notice}</p> : null}
              <div className="profile-editor-save">
                <button className="text-button" type="button" onClick={() => setDraft({ ...defaultProfilePersonalization, installedStickerPacks: draft.installedStickerPacks })}><RotateCcw size={13} /> Reset decorations</button>
                <button className="aqua-button aqua-button--primary" type="button" onClick={() => { onChange(draft); setEditing(false); setNotice(undefined); }}><Check size={14} /> Save my page</button>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
