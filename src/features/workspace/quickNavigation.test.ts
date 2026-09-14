import { describe, expect, it } from 'vitest';
import { demoWorkspace } from '../../demo/demoWorkspace';
import type { RoomSummary, SpaceSummary, WorkspaceSnapshot } from '../../matrix/viewModels';
import { getNavigationShortcut, navigationTargetKey, QUICK_NAVIGATION_LIMIT, rankNavigationTargets, type NavigationKeyEvent } from './quickNavigation';

const room = (id: string, name: string, extra: Partial<RoomSummary> = {}): RoomSummary => ({ ...demoWorkspace.rooms[0], id, name, kind: 'room', membership: 'join', unreadCount: 0, badgeCount: 0, highlighted: false, ...extra });
const space = (id: string, name: string, extra: Partial<SpaceSummary> = {}): SpaceSummary => ({ ...demoWorkspace.spaces[0], id, name, kind: 'matrix', membership: 'join', unreadCount: 0, highlighted: false, ...extra });
const workspace = (rooms: RoomSummary[], spaces: SpaceSummary[] = []): WorkspaceSnapshot => ({ ...demoWorkspace, rooms, spaces });
const keys = (result: ReturnType<typeof rankNavigationTargets>) => result.map((item) => item.key);
const key = (name: string, extra: Partial<NavigationKeyEvent> = {}): NavigationKeyEvent => ({ key: name, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra });

describe('quick navigation ranking', () => {
  it('ranks textual relevance ahead of recency, favorites and attention', () => {
    const snapshot = workspace([room('substring', 'Engineering general', { favorite: true, badgeCount: 40 }), room('prefix', 'General lounge'), room('exact', 'General')]);
    expect(keys(rankNavigationTargets(snapshot, 'general', ['room:substring']))).toEqual(['room:exact', 'room:prefix', 'room:substring']);
  });

  it('prefers an exact phrase over the same search words in another order', () => {
    const snapshot = workspace([room('reversed', 'Alpha Project'), room('exact', 'Project Alpha')]);
    expect(keys(rankNavigationTargets(snapshot, 'project alpha', ['room:reversed']))).toEqual(['room:exact', 'room:reversed']);
  });

  it('uses recents in supplied order, then explicit favorites, attention and deterministic names', () => {
    const snapshot = workspace([room('alpha', 'Alpha'), room('attention', 'Attention', { badgeCount: 10 }), room('favorite', 'Favorite', { favorite: true }), room('recent-a', 'Recent A'), room('recent-b', 'Recent B')]);
    expect(keys(rankNavigationTargets(snapshot, '', ['room:missing', 'room:recent-b', 'room:recent-a', 'room:recent-b']))).toEqual(['room:recent-b', 'room:recent-a', 'room:favorite', 'room:attention', 'room:alpha']);
  });

  it('matches room IDs and aliases and maps a person to one existing direct conversation', () => {
    const snapshot = workspace([
      room('!garden:example.test', 'Plant club', { canonicalAlias: '#garden:example.test' }),
      room('!dm:example.test', 'Mara Chen', { kind: 'direct', directUserId: '@mara:example.test' }),
    ], [space('!space:example.test', 'Garden space')]);
    expect(keys(rankNavigationTargets(snapshot, '#garden'))).toEqual(['room:!garden:example.test']);
    const people = rankNavigationTargets(snapshot, '@mara:example.test');
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ target: { kind: 'room', id: '!dm:example.test' }, category: 'person', detail: '@mara:example.test' });
    expect(keys(rankNavigationTargets(snapshot, '!garden:example.test'))).toEqual(['room:!garden:example.test']);
    expect(keys(rankNavigationTargets(snapshot, '#'))).toEqual(['room:!garden:example.test']);
    expect(keys(rankNavigationTargets(snapshot, '@'))).toEqual(['room:!dm:example.test']);
  });

  it('searches normalized words across a destination’s name and address', () => {
    const snapshot = workspace([room('!resume:example.test', 'Résumé studio')]);
    expect(rankNavigationTargets(snapshot, '  RESUME   example.test ')).toHaveLength(1);
    expect(rankNavigationTargets(snapshot, 'resume unknown')).toEqual([]);
  });

  it('excludes unjoined destinations, leaves member directory entries out, and deduplicates repeated IDs', () => {
    const joined = room('joined', 'Joined');
    const snapshot = workspace([joined, joined, room('invite', 'Invitation', { membership: 'invite' }), room('space-room', 'Space room', { kind: 'space' })], [space('space', 'Space'), space('invite-space', 'Invite space', { membership: 'invite' }), space('left-space', 'Left space', { membership: 'leave' })]);
    expect(keys(rankNavigationTargets(snapshot, ''))).toEqual(['room:joined', 'space:space']);
    expect(rankNavigationTargets(snapshot, '@someone-not-in-a-dm')).toEqual([]);
  });

  it('retains Home and direct-message scopes as working space destinations', () => {
    const snapshot = workspace([], [space('home', 'Home', { kind: 'home' }), space('directs', 'Direct messages', { kind: 'directs' })]);
    expect(rankNavigationTargets(snapshot, 'home')[0]).toMatchObject({ target: { kind: 'space', id: 'home' }, detail: 'All conversations' });
    expect(rankNavigationTargets(snapshot, 'direct')[0].detail).toBe('Your direct messages');
    expect(navigationTargetKey({ kind: 'room', id: '!room:example.test' })).toBe('room:!room:example.test');
  });

  it('caps results at 50 and produces the same order regardless of incoming snapshot order', () => {
    const rooms = Array.from({ length: 80 }, (_, index) => room(`id-${String(index).padStart(2, '0')}`, 'Same name'));
    const forward = rankNavigationTargets(workspace(rooms), '');
    const backward = rankNavigationTargets(workspace([...rooms].reverse()), '');
    expect(forward).toHaveLength(QUICK_NAVIGATION_LIMIT);
    expect(keys(forward)).toEqual(keys(backward));
    expect(forward[0].target.id).toBe('id-00');
    expect(forward.at(-1)?.target.id).toBe('id-49');
  });

  it('uses badge policy rather than muted raw counts and normalizes unusable attention values', () => {
    const snapshot = workspace([room('muted', 'Muted', { unreadCount: 99, badgeCount: 0 }), room('attention', 'Attention', { badgeCount: 1 }), room('invalid', 'Invalid', { badgeCount: Number.NaN })]);
    const ranked = rankNavigationTargets(snapshot, '');
    expect(ranked[0].target.id).toBe('attention');
    expect(ranked.find((item) => item.target.id === 'muted')?.attention).toBe(0);
    expect(ranked.find((item) => item.target.id === 'invalid')?.attention).toBe(0);
  });
});

describe('navigation shortcut classification', () => {
  it('uses the platform modifier and accepts either modifier when the platform is omitted', () => {
    expect(getNavigationShortcut(key('k', { ctrlKey: true }), 'Win32')).toBe('switcher');
    expect(getNavigationShortcut(key('k', { metaKey: true }), 'MacIntel')).toBe('switcher');
    expect(getNavigationShortcut(key('k', { ctrlKey: true }), 'MacIntel')).toBeUndefined();
    expect(getNavigationShortcut(key('k', { metaKey: true }), 'Linux x86_64')).toBeUndefined();
    expect(getNavigationShortcut(key('K', { metaKey: true }))).toBe('switcher');
    expect(getNavigationShortcut(key('k', { ctrlKey: true, metaKey: true }))).toBeUndefined();
  });

  it.each(['input', 'textarea', 'select', 'contenteditable', 'textbox'])('allows mod+K in %s but preserves editing keys and help shortcuts', (type) => {
    const target = document.createElement(['input', 'textarea', 'select'].includes(type) ? type : 'div');
    if (type === 'contenteditable') target.setAttribute('contenteditable', 'true');
    if (type === 'textbox') target.setAttribute('role', 'textbox');
    expect(getNavigationShortcut(key('k', { target, ctrlKey: true }))).toBe('switcher');
    expect(getNavigationShortcut(key('ArrowDown', { target, altKey: true, shiftKey: true }))).toBeUndefined();
    expect(getNavigationShortcut(key('/', { target, ctrlKey: true }))).toBeUndefined();
  });

  it('recognizes unread navigation and help outside editors without capturing unrelated combinations', () => {
    expect(getNavigationShortcut(key('ArrowUp', { altKey: true, shiftKey: true }))).toBe('previous-unread');
    expect(getNavigationShortcut(key('ArrowDown', { altKey: true, shiftKey: true }))).toBe('next-unread');
    expect(getNavigationShortcut(key('/', { ctrlKey: true }))).toBe('help');
    expect(getNavigationShortcut(key('?', { metaKey: true, shiftKey: true }))).toBe('help');
    expect(getNavigationShortcut(key('ArrowDown', { altKey: true }))).toBeUndefined();
    expect(getNavigationShortcut(key('k', { ctrlKey: true, altKey: true }))).toBeUndefined();
    expect(getNavigationShortcut(key('k', { ctrlKey: true, shiftKey: true }))).toBeUndefined();
  });

  it.each([{ isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }, { repeat: true }])('ignores composition and already handled or repeated key events: %j', (extra) => {
    expect(getNavigationShortcut(key('k', { ctrlKey: true, ...extra }))).toBeUndefined();
    expect(getNavigationShortcut(key('ArrowDown', { altKey: true, shiftKey: true, ...extra }))).toBeUndefined();
  });
});
