import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/server';
import { clearPlacesCache, reverseAddress, searchNearbyPlaces, searchPlacesByName, setPlacesFetch } from '../src/services/placesService';

const googleSample = {
  places: [
    { id: 'g2', displayName: { text: '遠いカフェ' }, formattedAddress: 'テスト市 2', location: { latitude: 34.7035, longitude: 135.4959 }, primaryType: 'cafe' },
    { id: 'g1', displayName: { text: '近いラーメン' }, formattedAddress: 'テスト市 1', location: { latitude: 34.7026, longitude: 135.4959 }, primaryType: 'ramen_restaurant' },
    { id: 'broken', displayName: {} },
  ],
};

const osmSample = {
  elements: [
    { type: 'way', id: 2, center: { lat: 34.7035, lon: 135.4959 }, tags: { name: 'Far Cafe', 'name:ja': '遠いカフェ', shop: 'coffee', 'addr:city': 'テスト市', 'addr:block_number': '2' } },
    { type: 'node', id: 1, lat: 34.7026, lon: 135.4959, tags: { name: '近いラーメン;支店', amenity: 'restaurant' } },
    { type: 'node', id: 3, lat: 34.7027, lon: 135.4959, tags: { amenity: 'bench' } },
  ],
};

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('places', () => {
  const originalKey = process.env.GOOGLE_PLACES_API_KEY;
  const fakeFetch = vi.fn(async (url: string | URL | Request) => {
    const target = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
    return target.includes('googleapis') ? json(googleSample) : json(osmSample);
  });

  beforeEach(() => {
    fakeFetch.mockClear();
    clearPlacesCache();
    setPlacesFetch(fakeFetch as unknown as typeof fetch);
  });
  afterEach(() => {
    if (originalKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = originalKey;
  });
  afterAll(() => setPlacesFetch(undefined));

  it('uses OpenStreetMap when no Google key is configured', async () => {
    process.env.GOOGLE_PLACES_API_KEY = '';
    const places = await searchNearbyPlaces(34.7025, 135.4959, 150);
    expect(places.map((place) => place.id)).toEqual(['osm-node-1', 'osm-way-2']);
    expect(places[0]).toEqual(expect.objectContaining({ name: '近いラーメン 支店', primaryType: 'restaurant' }));
    expect(places[1]).toEqual(expect.objectContaining({ name: '遠いカフェ', address: 'テスト市2', primaryType: 'coffee' }));
    const [url, init] = fakeFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('overpass');
    expect((init.headers as Record<string, string>)['User-Agent']).toBeTruthy();
    const query = decodeURIComponent(init.body as string);
    expect(query).toContain('around:150,34.7025,135.4959');
    expect(query).toContain('["name"]');
    expect(query).toContain('amenity|shop');
  });

  it('uses Google Places when a key is configured', async () => {
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
    const places = await searchNearbyPlaces(34.7025, 135.4959, 150);
    expect(places.map((place) => place.id)).toEqual(['g1', 'g2']);
    expect(places[0].distanceMeters).toBeLessThan(places[1].distanceMeters);
    const [url, init] = fakeFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('googleapis');
    expect((init.headers as Record<string, string>)['X-Goog-Api-Key']).toBe('test-key');
  });

  it('caches results for the same spot', async () => {
    process.env.GOOGLE_PLACES_API_KEY = '';
    await searchNearbyPlaces(34.7025, 135.4959, 150);
    const callsAfterFirst = fakeFetch.mock.calls.length; // ミラー3台へ同時に問い合わせる
    expect(callsAfterFirst).toBe(3);
    await searchNearbyPlaces(34.7025, 135.4959, 150);
    expect(fakeFetch).toHaveBeenCalledTimes(callsAfterFirst);
  });

  it('uses whichever Overpass mirror answers first, even if another fails', async () => {
    process.env.GOOGLE_PLACES_API_KEY = '';
    const flaky = vi.fn(async (url: string | URL | Request) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      if (target.includes('overpass-api.de')) throw new Error('timeout');
      if (target.includes('private.coffee')) return new Response('busy', { status: 429 });
      return json(osmSample);
    });
    setPlacesFetch(flaky as unknown as typeof fetch);
    const places = await searchNearbyPlaces(34.7025, 135.4959, 150);
    expect(places).toHaveLength(2);
    expect(flaky).toHaveBeenCalledTimes(3);
  });

  it('falls back to Nominatim reverse geocoding when every Overpass mirror fails', async () => {
    process.env.GOOGLE_PLACES_API_KEY = '';
    const nominatim = { osm_type: 'node', osm_id: 77, name: 'セブン-イレブン', category: 'shop', type: 'convenience', lat: '34.7026', lon: '135.4959', address: { state: 'テスト県', city: 'テスト市', suburb: '吾妻' } };
    const failing = vi.fn(async (url: string | URL | Request) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      if (target.includes('nominatim')) return json(nominatim);
      return new Response('busy', { status: 429 });
    });
    setPlacesFetch(failing as unknown as typeof fetch);
    const places = await searchNearbyPlaces(34.7025, 135.4959, 150);
    expect(places).toHaveLength(1);
    expect(places[0]).toEqual(expect.objectContaining({ id: 'nominatim-node-77', name: 'セブン-イレブン', primaryType: 'convenience', address: 'テスト県テスト市吾妻' }));
    expect(places[0].distanceMeters).toBeGreaterThan(0);
  });

  it('reverse-geocodes a Japanese address and serves it from the route', async () => {
    const nominatim = { name: 'テスト食堂', address: { postcode: '530-0001', state: '大阪府', city: '大阪市北区', suburb: '梅田', house_number: '0-0' } };
    const fetchAddress = vi.fn(async () => json(nominatim));
    setPlacesFetch(fetchAddress as unknown as typeof fetch);

    const result = await reverseAddress(34.70, 135.50);
    expect(result).toEqual({ name: 'テスト食堂', address: '〒530-0001 大阪府大阪市北区梅田0-0' });

    const response = await request(createApp()).get('/api/places/address?latitude=34.70&longitude=135.50');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ name: 'テスト食堂', address: '〒530-0001 大阪府大阪市北区梅田0-0' });
    expect(fetchAddress).toHaveBeenCalledTimes(1); // 2回目はキャッシュ

    expect((await request(createApp()).get('/api/places/address?latitude=abc&longitude=1')).status).toBe(400);
  });

  it('searches places by name near a point (OpenStreetMap) and serves it from the route', async () => {
    process.env.GOOGLE_PLACES_API_KEY = '';
    const results = [
      { osm_type: 'node', osm_id: 2, name: '', display_name: 'テスト食堂 本店, 梅田, 大阪市北区', lat: '34.71', lon: '135.51', type: 'restaurant', address: { state: '大阪府', city: '大阪市北区' } },
      { osm_type: 'node', osm_id: 1, name: 'テスト食堂', lat: '34.7025', lon: '135.4959', type: 'restaurant', address: { state: '大阪府', city: '大阪市北区', suburb: '梅田' } },
    ];
    const fetchSearch = vi.fn(async () => json(results));
    setPlacesFetch(fetchSearch as unknown as typeof fetch);

    const places = await searchPlacesByName('テスト食堂', 34.7025, 135.4959);
    expect(places.map((place) => place.name)).toEqual(['テスト食堂', 'テスト食堂 本店']);
    expect(places[0].address).toBe('大阪府大阪市北区梅田');
    const url = String(fetchSearch.mock.calls[0][0]);
    expect(url).toContain('nominatim');
    expect(decodeURIComponent(url)).toContain('q=テスト食堂');

    const response = await request(createApp()).get('/api/places/search?q=テスト食堂&latitude=34.7025&longitude=135.4959');
    expect(response.status).toBe(200);
    expect(response.body.provider).toBe('osm');
    expect(response.body.places).toHaveLength(2);
    expect(fetchSearch).toHaveBeenCalledTimes(1); // キャッシュ

    expect((await request(createApp()).get('/api/places/search?q=テ&latitude=34&longitude=135')).status).toBe(400);
  });

  it('throws a readable error when every provider rejects the request', async () => {
    process.env.GOOGLE_PLACES_API_KEY = '';
    setPlacesFetch((async () => new Response('busy', { status: 429 })) as unknown as typeof fetch);
    await expect(searchNearbyPlaces(34.7025, 135.4959, 150)).rejects.toThrow(/429/);
  });

  it('GET /api/places/nearby returns places and the provider', async () => {
    process.env.GOOGLE_PLACES_API_KEY = '';
    const response = await request(createApp()).get('/api/places/nearby?latitude=34.7025&longitude=135.4959');
    expect(response.status).toBe(200);
    expect(response.body.provider).toBe('osm');
    expect(response.body.places.map((place: { id: string }) => place.id)).toEqual(['osm-node-1', 'osm-way-2']);
  });

  it('GET /api/places/nearby validates the coordinates and radius', async () => {
    const app = createApp();
    expect((await request(app).get('/api/places/nearby?latitude=abc&longitude=140')).status).toBe(400);
    expect((await request(app).get('/api/places/nearby?latitude=36&longitude=140&radius=5000')).status).toBe(400);
  });
});
