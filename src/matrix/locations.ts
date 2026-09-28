export interface StaticLocation {
  latitude: number;
  longitude: number;
  uri: string;
  description?: string;
}

export function parseGeoUri(value: unknown): StaticLocation | undefined {
  if (typeof value !== 'string' || value.length > 128) return undefined;
  const coordinate = '([+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+))';
  const match = new RegExp(`^geo:${coordinate},${coordinate}(?:,${coordinate})?((?:;[a-z]+=[a-z0-9.]+)*)$`, 'i').exec(value);
  if (!match) return undefined;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  const altitude = match[3] === undefined ? undefined : Number(match[3]);
  const parameters = match[4] ? match[4].slice(1).split(';') : [];
  const seen = new Set<string>();
  let uncertainty: number | undefined;
  for (const parameter of parameters) {
    const [name, raw] = parameter.split('=');
    if (seen.has(name) || name !== 'u' && name !== 'crs') return undefined;
    seen.add(name);
    if (name === 'crs' && raw.toLowerCase() !== 'wgs84') return undefined;
    if (name === 'u') uncertainty = Number(raw);
  }
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 ||
    (altitude !== undefined && !Number.isFinite(altitude)) ||
    (uncertainty !== undefined && (!Number.isFinite(uncertainty) || uncertainty < 0 || uncertainty > 100_000))) return undefined;
  return { latitude, longitude, uri: value };
}

export function createGeoUri(latitude: number, longitude: number): string {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new Error('Enter a latitude from -90 to 90 and longitude from -180 to 180.');
  }
  const decimal = (value: number) => value.toFixed(8).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return `geo:${decimal(latitude)},${decimal(longitude)}`;
}

export function locationFromMessage(content: Record<string, unknown>): StaticLocation | undefined {
  const modern = content['m.location'];
  const modernUri = modern && typeof modern === 'object' && !Array.isArray(modern) ? (modern as Record<string, unknown>).uri : undefined;
  const location = modern === undefined ? parseGeoUri(content.geo_uri) : parseGeoUri(modernUri);
  if (!location) return undefined;
  const description = modern && typeof modern === 'object' && !Array.isArray(modern) ? (modern as Record<string, unknown>).description : undefined;
  return { ...location, description: typeof description === 'string' && description.trim() ? description.trim().slice(0, 200) : undefined };
}
