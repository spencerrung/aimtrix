/** Standard Matrix destinations; parsing never contacts a server or joins a room. */
export interface MatrixNavigationTarget {
  roomId?: string;
  roomAlias?: string;
  eventId?: string;
  userId?: string;
  via?: string[];
}

const MAX_LINK_LENGTH = 4096;
const MAX_VIA_SERVERS = 8;
const encoder = new TextEncoder();

function serverName(value: string): boolean {
  if (!value || value.length > 255 || /[^A-Za-z0-9.:[\]-]/u.test(value)) return false;
  const match = /^(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]+)(?::([0-9]+))?$/u.exec(value);
  if (!match || (match[2] && (Number(match[2]) < 1 || Number(match[2]) > 65535))) return false;
  if (!match[1].startsWith('[') && !match[1].replace(/\.$/u, '').split('.').every((part) =>
    part.length > 0 && part.length <= 63 && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u.test(part))) return false;
  try {
    // In particular, reject malformed bracketed IPv6 without doing DNS or I/O.
    return Boolean(new URL(`https://${value}`).hostname);
  } catch { return false; }
}

function identifier(value: unknown, sigil: string): value is string {
  if (typeof value !== 'string' || !value.startsWith(sigil) || value.length < 2
    || encoder.encode(value).length > 255 || /\p{Cs}/u.test(value) || value.includes('\u0000')) return false;
  // Room and event IDs are opaque; modern room versions omit the domain. An
  // encoded slash can legitimately be part of either identifier's base64 hash.
  if (sigil === '!' || sigil === '$') return !/[\s\p{Cc}]/u.test(value);
  const separator = value.indexOf(':', 1);
  // Alias localparts and historical MXIDs permit encoded whitespace/control
  // characters; historical MXIDs can also have an empty localpart. The URI
  // parser still rejects raw whitespace/control characters before decoding.
  return separator >= (sigil === '@' ? 1 : 2) && serverName(value.slice(separator + 1));
}

export function isMatrixEventId(value: unknown): value is string {
  return identifier(value, '$');
}

export function isMatrixNavigationTarget(value: MatrixNavigationTarget): boolean {
  if (!value || typeof value !== 'object') return false;
  const primary = [value.roomId, value.roomAlias, value.userId].filter((item) => item !== undefined);
  if (primary.length !== 1) return false;
  if (value.roomId !== undefined && !identifier(value.roomId, '!')) return false;
  if (value.roomAlias !== undefined && !identifier(value.roomAlias, '#')) return false;
  if (value.userId !== undefined && (!identifier(value.userId, '@') || value.eventId !== undefined)) return false;
  if (value.eventId !== undefined && !identifier(value.eventId, '$')) return false;
  return value.via === undefined || (Array.isArray(value.via) && value.via.length <= MAX_VIA_SERVERS
    && value.via.every((server) => typeof server === 'string' && serverName(server)));
}

/** https://spec.matrix.org/latest/appendices/#uris */
export function parseMatrixLink(input: string): MatrixNavigationTarget | undefined {
  const value = input.trim();
  if (!value || value.length > MAX_LINK_LENGTH || /[\s\p{Cc}]/u.test(value)) return undefined;
  try {
    let pathAndQuery: string;
    let matrixScheme = false;
    if (/^https:\/\/matrix\.to\/#\//iu.test(value)) {
      pathAndQuery = value.slice('https://matrix.to/#/'.length);
    } else if (/^matrix:/iu.test(value)) {
      matrixScheme = true;
      pathAndQuery = value.slice('matrix:'.length);
      // Authority and fragment remain reserved by the spec; do not silently
      // reinterpret a future URI or an unsupported target as a room link.
      if (pathAndQuery.startsWith('//') || pathAndQuery.includes('#')) return undefined;
    } else return undefined;

    const queryStart = pathAndQuery.indexOf('?');
    const path = queryStart < 0 ? pathAndQuery : pathAndQuery.slice(0, queryStart);
    const query = queryStart < 0 ? '' : pathAndQuery.slice(queryStart + 1);
    // URLSearchParams repairs malformed escapes; reject them before decoding.
    decodeURIComponent(query);
    const parts = path.split('/').map((part) => decodeURIComponent(part));
    let target: MatrixNavigationTarget;
    if (matrixScheme) {
      if (parts.length !== 2 && parts.length !== 4) return undefined;
      if (!parts[1]) return undefined;
      if (parts[0] === 'r') target = { roomAlias: `#${parts[1]}` };
      else if (parts[0] === 'roomid') target = { roomId: `!${parts[1]}` };
      else if (parts[0] === 'u') target = { userId: `@${parts[1]}` };
      else return undefined;
      if (parts.length === 4) {
        if (parts[2] !== 'e' || !parts[3]) return undefined;
        target.eventId = `$${parts[3]}`;
      }
    } else {
      if (parts.length !== 1 && parts.length !== 2) return undefined;
      if (parts[0].startsWith('!')) target = { roomId: parts[0] };
      else if (parts[0].startsWith('#')) target = { roomAlias: parts[0] };
      else if (parts[0].startsWith('@')) target = { userId: parts[0] };
      else return undefined;
      if (parts.length === 2) target.eventId = parts[1];
    }
    const via = new URLSearchParams(query).getAll('via');
    if (via.length > MAX_VIA_SERVERS) return undefined;
    if (via.length) target.via = [...new Set(via)];
    return isMatrixNavigationTarget(target) ? target : undefined;
  } catch { return undefined; }
}
