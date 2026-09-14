import type { WorkspaceSnapshot } from '../../matrix/viewModels';

export interface NavigationTarget {
  kind: 'room' | 'space';
  id: string;
}

export interface NavigationResult {
  key: string;
  target: NavigationTarget;
  label: string;
  detail: string;
  category: 'room' | 'person' | 'space';
  favorite: boolean;
  attention: number;
}

export const QUICK_NAVIGATION_LIMIT = 50;
export const navigationTargetKey = (target: NavigationTarget): string => `${target.kind}:${target.id}`;
const normalize = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const count = (value: number | undefined) => Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;

/** Search uses only the current account's already available destinations. */
export function rankNavigationTargets(workspace: WorkspaceSnapshot, query: string, recents: readonly string[] = []): NavigationResult[] {
  const normalized = normalize(query);
  const filter = normalized.startsWith('#') ? 'room' : normalized.startsWith('@') ? 'person' : undefined;
  const terms = (filter ? normalized.slice(1).trim() : normalized).split(' ').filter(Boolean);
  const candidates: Array<NavigationResult & { fields: string[] }> = [];
  const seen = new Set<string>();
  for (const room of workspace.rooms) {
    if (room.membership !== 'join' || room.kind === 'space') continue;
    const target = { kind: 'room' as const, id: room.id };
    const key = navigationTargetKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ key, target, label: room.name, detail: room.directUserId ?? room.canonicalAlias ?? room.id,
      category: room.kind === 'direct' ? 'person' : 'room', favorite: room.favorite === true,
      attention: count(room.badgeCount ?? room.unreadCount),
      fields: [room.name, room.id, room.canonicalAlias ?? '', room.directUserId ?? ''].map(normalize),
    });
  }
  for (const space of workspace.spaces) {
    if (space.membership !== 'join') continue;
    const target = { kind: 'space' as const, id: space.id };
    const key = navigationTargetKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ key, target, label: space.name, detail: space.kind === 'matrix' ? space.id : space.kind === 'home' ? 'All conversations' : 'Your direct messages',
      category: 'space', favorite: false, attention: count(space.unreadCount), fields: [space.name, space.id].map(normalize),
    });
  }
  const recentOrder = new Map<string, number>();
  for (const key of recents) if (!recentOrder.has(key)) recentOrder.set(key, recentOrder.size);
  const ranked = candidates.flatMap((candidate) => {
    if (filter && candidate.category !== filter) return [];
    const fields = candidate.fields.flatMap((field) => [field, field.replace(/^[@#]/, '')]);
    const phrase = terms.join(' ');
    let score = terms.length > 1 ? fields.includes(phrase) ? 1000 : fields.some((field) => field.startsWith(phrase)) ? 500 : 0 : 0;
    for (const term of terms) {
      let best = 0;
      for (const field of fields) {
        const match = field === term ? 1000 : field.startsWith(term) ? 800 : field.split(/[\s._:#@/!-]+/).some((word) => word.startsWith(term)) ? 600 : field.includes(term) ? 400 : 0;
        best = Math.max(best, match);
      }
      if (!best) return [];
      score += best;
    }
    return [{ candidate, score, recent: recentOrder.get(candidate.key) ?? Number.MAX_SAFE_INTEGER }];
  });
  ranked.sort((left, right) => right.score - left.score || left.recent - right.recent
    || Number(right.candidate.favorite) - Number(left.candidate.favorite)
    || right.candidate.attention - left.candidate.attention
    || compare(normalize(left.candidate.label), normalize(right.candidate.label))
    || compare(left.candidate.key, right.candidate.key));
  return ranked.slice(0, QUICK_NAVIGATION_LIMIT).map(({ candidate }) => ({
    key: candidate.key, target: candidate.target, label: candidate.label, detail: candidate.detail,
    category: candidate.category, favorite: candidate.favorite, attention: candidate.attention,
  }));
}

export type NavigationShortcut = 'switcher' | 'previous-unread' | 'next-unread' | 'help';
export type NavigationKeyEvent = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>
  & Partial<Pick<KeyboardEvent, 'target' | 'isComposing' | 'keyCode' | 'defaultPrevented' | 'repeat'>>;

/** Classifies keys only; callers own preventing defaults and invoking navigation. */
export function getNavigationShortcut(event: NavigationKeyEvent, platform?: string): NavigationShortcut | undefined {
  if (event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229 || event.key === 'Process' || event.key === 'Dead') return;
  if (event.ctrlKey && event.metaKey) return;
  const modifier = platform === undefined ? event.ctrlKey || event.metaKey
    : /mac|iphone|ipad|ipod/i.test(platform) ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  const key = event.key.toLowerCase();
  if (modifier && !event.altKey && !event.shiftKey && key === 'k') return 'switcher';
  const target = event.target as Element | null | undefined;
  if (typeof target?.closest === 'function' && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"]')) return;
  if (modifier && !event.altKey && (key === '/' || key === '?')) return 'help';
  if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey) {
    if (event.key === 'ArrowUp') return 'previous-unread';
    if (event.key === 'ArrowDown') return 'next-unread';
  }
}
