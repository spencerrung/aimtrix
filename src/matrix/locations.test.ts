import { describe, expect, it } from 'vitest';
import { createGeoUri, locationFromMessage, parseGeoUri } from './locations';

describe('static Matrix locations', () => {
  it('accepts bounded coordinates and formats an interoperable geo URI', () => {
    expect(createGeoUri(40.7128, -74.006)).toBe('geo:40.7128,-74.006');
    expect(parseGeoUri('geo:40.7128,-74.006;u=25')).toMatchObject({ latitude: 40.7128, longitude: -74.006 });
    expect(parseGeoUri('geo:40.7128,-74.006,10;crs=wgs84;u=25')).toMatchObject({ latitude: 40.7128, longitude: -74.006 });
    expect(locationFromMessage({ 'm.location': { uri: 'geo:40.7128,-74.006', description: 'Meeting spot' } }))
      .toMatchObject({ description: 'Meeting spot', latitude: 40.7128 });
    expect(locationFromMessage({ geo_uri: 'geo:40.7128,-74.006' })).toMatchObject({ longitude: -74.006 });
  });

  it('rejects malformed, out-of-range, and conflicting modern locations', () => {
    for (const uri of ['https://map.test/?q=40,-74', 'geo:91,0', 'geo:0,181', 'geo:NaN,0', 'geo:0,0;u=Infinity', 'geo:0,0;foo=1']) {
      expect(parseGeoUri(uri)).toBeUndefined();
    }
    expect(() => createGeoUri(91, 0)).toThrow('latitude');
    expect(locationFromMessage({ 'm.location': { uri: 'https://bad.test' }, geo_uri: 'geo:1,2' })).toBeUndefined();
  });
});
