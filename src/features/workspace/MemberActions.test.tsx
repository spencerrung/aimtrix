import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { demoWorkspace } from '../../demo/demoWorkspace';
import type { MemberSummary } from '../../matrix/viewModels';
import { MemberActions } from './MemberActions';

const room = { ...demoWorkspace.rooms[0], canManage: true, ownPowerLevel: 100 };
const member: MemberSummary = { id: '@synthetic:example.test', displayName: 'Synthetic buddy', presence: 'online', membership: 'join', powerLevel: 25 };

function setup(overrides: Partial<Parameters<typeof MemberActions>[0]> = {}) {
  const props = {
    room, member, currentUserId: '@self:example.test',
    onRemoveMember: vi.fn().mockResolvedValue(undefined),
    onSetMemberPower: vi.fn().mockResolvedValue(undefined),
    onRunAction: vi.fn(async (_label: string, action: () => Promise<void>) => { await action(); return true; }),
    onConfirm: vi.fn(), ...overrides,
  };
  render(<MemberActions {...props} />);
  return props;
}

describe('member action menu', () => {
  it.each([
    { currentUserId: member.id },
    { room: { ...room, canManage: false } },
    { member: { ...member, powerLevel: 100 } },
    { member: { ...member, powerLevel: 101 } },
    { onRemoveMember: undefined, onSetMemberPower: undefined },
  ])('hides actions without permission or an operation: %j', (overrides) => {
    setup(overrides);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers checked roles with keyboard navigation and restores the opener on Escape', () => {
    setup();
    const trigger = screen.getByRole('button', { name: 'Actions for Synthetic buddy' });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'Member' })).toHaveFocus();
    expect(screen.getByRole('menuitemradio', { name: 'Decorator' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitemradio', { name: 'Decorator' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(screen.getByRole('menuitem', { name: 'Ban member' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('uses the room action feedback path to change a role', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Moderator' }));
    expect(props.onRunAction).toHaveBeenCalledWith('Update role', expect.any(Function));
    expect(props.onSetMemberPower).toHaveBeenCalledWith(room.id, member.id, 50);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it.each([['Remove member', 'kick'], ['Ban member', 'ban']] as const)('requires confirmation before %s', async (label, action) => {
    const props = setup();
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('menuitem', { name: label }));
    expect(props.onRemoveMember).not.toHaveBeenCalled();
    expect(props.onConfirm).toHaveBeenCalledWith(expect.objectContaining({ label, title: `${label}: Synthetic buddy?` }));
    await vi.mocked(props.onConfirm).mock.calls[0][0].action();
    expect(props.onRemoveMember).toHaveBeenCalledWith(room.id, member.id, action);
  });

  it('only offers unban for a banned member', () => {
    const props = setup({ member: { ...member, membership: 'ban' } });
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByRole('menuitemradio')).not.toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(1);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unban member' }));
    expect(props.onRunAction).toHaveBeenCalledWith('Unban member', expect.any(Function));
    expect(props.onRemoveMember).toHaveBeenCalledWith(room.id, member.id, 'unban');
  });

  it('hands focus to the safe confirmation action and returns to the member opener', async () => {
    function Example() {
      const [confirmation, setConfirmation] = useState<Parameters<Parameters<typeof MemberActions>[0]['onConfirm']>[0]>();
      return <>
        <MemberActions room={room} member={member} currentUserId="@self:example.test" onRemoveMember={async () => undefined}
          onRunAction={async () => true} onConfirm={setConfirmation} />
        {confirmation ? <ConfirmDialog title={confirmation.title} description={confirmation.description} actionLabel={confirmation.label}
          onConfirm={confirmation.action} onClose={() => setConfirmation(undefined)} /> : null}
      </>;
    }
    render(<Example />);
    const trigger = screen.getByRole('button', { name: 'Actions for Synthetic buddy' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove member' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('does not offer removal for an invite or role changes to a moderator', () => {
    setup({ member: { ...member, membership: 'invite' }, room: { ...room, ownPowerLevel: 50 } });
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByRole('menuitemradio')).not.toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(1);
    expect(screen.getByRole('menuitem', { name: 'Ban member' })).toBeInTheDocument();
  });
});
