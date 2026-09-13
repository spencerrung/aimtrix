import { useRef, useState } from 'react';
import { Ban, Check, MoreHorizontal, UserMinus } from 'lucide-react';
import { Popover } from '../../components/Popover';
import type { MemberSummary, RoomSummary } from '../../matrix/viewModels';

interface MemberActionConfirmation {
  title: string;
  description: string;
  label: string;
  action: () => Promise<void>;
}

/** The room owns action feedback and confirmation; rows only expose supported actions. */
export function MemberActions({ room, member, currentUserId, onRemoveMember, onSetMemberPower, onRunAction, onConfirm }: {
  room: RoomSummary;
  member: MemberSummary;
  currentUserId: string;
  onRemoveMember?: (roomId: string, userId: string, action: 'kick' | 'ban' | 'unban') => Promise<void>;
  onSetMemberPower?: (roomId: string, userId: string, level: number) => Promise<void>;
  onRunAction: (label: string, action: () => Promise<void>) => Promise<boolean>;
  onConfirm: (confirmation: MemberActionConfirmation) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const canManage = room.canManage && member.id !== currentUserId
    && (member.powerLevel ?? 0) < (room.ownPowerLevel ?? 0);
  const canSetRole = member.membership !== 'ban' && (room.ownPowerLevel ?? 0) >= 100 && Boolean(onSetMemberPower);
  if (!canManage || (!onRemoveMember && !canSetRole)) return null;

  const updateRole = (level: number) => {
    if (!onSetMemberPower) return;
    setOpen(false);
    void onRunAction('Update role', () => onSetMemberPower(room.id, member.id, level));
  };
  const removeMember = (action: 'kick' | 'ban' | 'unban') => {
    if (!onRemoveMember) return;
    setOpen(false);
    if (action === 'unban') {
      void onRunAction('Unban member', () => onRemoveMember(room.id, member.id, action));
      return;
    }
    const label = action === 'kick' ? 'Remove member' : 'Ban member';
    onConfirm({
      title: `${label}: ${member.displayName}?`,
      description: action === 'kick' ? 'They will need to rejoin or be invited again.' : 'They cannot rejoin until a moderator removes the ban.',
      label,
      action: () => onRemoveMember(room.id, member.id, action),
    });
  };
  const roleLevel = (member.powerLevel ?? 0) >= 50 ? 50 : (member.powerLevel ?? 0) >= 25 ? 25 : 0;

  return <span className="member-actions">
    <button ref={trigger} type="button" className="member-actions__trigger" aria-label={`Actions for ${member.displayName}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <MoreHorizontal size={18} aria-hidden="true" />
    </button>
    {open ? <Popover menu label={`Actions for ${member.displayName}`} className="member-actions__menu" trigger={trigger} onClose={() => setOpen(false)}>
      {canSetRole ? <div role="group" aria-label={`Role for ${member.displayName}`}>
        {([{ level: 0, label: 'Member' }, { level: 25, label: 'Decorator' }, { level: 50, label: 'Moderator' }] as const).map(({ level, label }) =>
          <button key={level} type="button" role="menuitemradio" aria-checked={roleLevel === level} onClick={() => updateRole(level)}>{label}</button>,
        )}
      </div> : null}
      {onRemoveMember ? member.membership === 'ban'
        ? <button type="button" role="menuitem" onClick={() => removeMember('unban')}><Check size={14} aria-hidden="true" /> Unban member</button>
        : <>
          {member.membership === 'join' ? <button type="button" role="menuitem" onClick={() => removeMember('kick')}><UserMinus size={14} aria-hidden="true" /> Remove member</button> : null}
          <button type="button" role="menuitem" onClick={() => removeMember('ban')}><Ban size={14} aria-hidden="true" /> Ban member</button>
        </> : null}
    </Popover> : null}
  </span>;
}
