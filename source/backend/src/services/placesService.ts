import { distanceMeters } from './distanceService';

/** 投稿場所の候補になる周辺の施設。 */
export type NearbyPlace = {
  id: string;
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
  /** 検索地点からの距離 */
  distanceMeters: number;
  primaryType?: string;
};

/** google: Places API (New)。osm: OpenStreetMap(Overpass / Nominatim、キー不要)。 */
export type PlacesProvider = 'google' | 'osm';

const GOOGLE_ENDPOINT = 'https://places.googleapis.com/v1/places:searchNearby';
const GOOGLE_FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.location,places.primaryType';
/** Overpass の公開サーバー。同時に問い合わせて最初に返った結果を使う。 */
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
/** Overpass が全滅したときの最終手段。地点の最寄り1件だけ返す(1秒に1回まで)。 */
const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';
const NOMINATIM_SEARCH_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const GOOGLE_TEXT_ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
const USER_AGENT = 'local-area-sns-hackathon-demo/1.0 (student hackathon; contact via repository)';
const REQUEST_TIMEOUT_MS = 12_000;
const NOMINATIM_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 15 * 60 * 1000;
/** 公開サーバーの利用制限に掛からないよう、OSM への問い合わせは1本ずつ・この間隔で行う。 */
const OSM_MIN_INTERVAL_MS = 1_500;
export const DEFAULT_RADIUS_METERS = 300;

let fetchImpl: typeof fetch = fetch;

/** テスト用: ネットワークの代わりに使う fetch を差し替える(undefined で元に戻す)。 */
export function setPlacesFetch(replacement?: typeof fetch): void {
  fetchImpl = replacement ?? fetch;
}

const cache = new Map<string, { expires: number; places: NearbyPlace[] }>();

export function clearPlacesCache(): void {
  cache.clear();
}

export function placesApiKey(): string | undefined {
  const key = process.env.GOOGLE_PLACES_API_KEY?.trim();
  return key ? key : undefined;
}

export function placesProvider(): PlacesProvider {
  return placesApiKey() ? 'google' : 'osm';
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let osmQueue: Promise<unknown> = Promise.resolve();
let lastOsmRequestAt = 0;

/** OSM 系の問い合わせを直列化し、前回から一定間隔を空ける。 */
function throttledOsm<T>(task: () => Promise<T>): Promise<T> {
  const run = osmQueue.catch(() => undefined).then(async () => {
    const wait = lastOsmRequestAt + OSM_MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      return await task();
    } finally {
      lastOsmRequestAt = Date.now();
    }
  });
  osmQueue = run;
  return run;
}

type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  primaryType?: string;
};

type OverpassElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
};

type NominatimResult = {
  osm_type?: string;
  osm_id?: number;
  name?: string;
  category?: string;
  type?: string;
  lat?: string;
  lon?: string;
  address?: Record<string, string>;
};

function sortByDistance(places: NearbyPlace[]): NearbyPlace[] {
  return [...places].sort((a, b) => a.distanceMeters - b.distanceMeters);
}

async function searchGoogle(latitude: number, longitude: number, radius: number, key: string): Promise<NearbyPlace[]> {
  const response = await fetchImpl(GOOGLE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': GOOGLE_FIELD_MASK },
    body: JSON.stringify({
      locationRestriction: { circle: { center: { latitude, longitude }, radius } },
      maxResultCount: 10,
      rankPreference: 'DISTANCE',
      languageCode: 'ja',
      regionCode: 'JP',
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Places API error ${response.status}: ${detail.slice(0, 200)}`);
  }
  const json = (await response.json()) as { places?: GooglePlace[] };
  return sortByDistance((json.places ?? []).flatMap<NearbyPlace>((place) => {
    const name = place.displayName?.text;
    const placeLatitude = place.location?.latitude;
    const placeLongitude = place.location?.longitude;
    if (!place.id || !name || typeof placeLatitude !== 'number' || typeof placeLongitude !== 'number') return [];
    return [{
      id: place.id,
      name,
      address: place.formattedAddress,
      latitude: placeLatitude,
      longitude: placeLongitude,
      distanceMeters: Math.round(distanceMeters(latitude, longitude, placeLatitude, placeLongitude)),
      primaryType: place.primaryType,
    }];
  }));
}

/** OSM の店・施設らしいタグ。名前が付いているものだけを候補にする。 */
const OSM_CATEGORY_TAGS = ['amenity', 'shop', 'tourism', 'leisure', 'craft', 'office', 'healthcare'];

/** 名前があり、店・施設系のタグをどれか1つ持つ要素だけを1本のクエリで取る(複数 union より軽い)。 */
function overpassQuery(latitude: number, longitude: number, radius: number): string {
  const around = `around:${Math.round(radius)},${latitude},${longitude}`;
  const keys = OSM_CATEGORY_TAGS.join('|');
  return `[out:json][timeout:15];\nnwr(${around})["name"][~"^(${keys})$"~"."];\nout center 30;`;
}

function osmAddress(tags: Record<string, string>): string | undefined {
  if (tags['addr:full']) return tags['addr:full'];
  const parts = [tags['addr:province'], tags['addr:city'], tags['addr:quarter'] ?? tags['addr:neighbourhood'], tags['addr:block_number'], tags['addr:housenumber']].filter(Boolean);
  return parts.length > 0 ? parts.join('') : undefined;
}

async function fetchOverpassFrom(endpoint: string, query: string): Promise<{ elements?: OverpassElement[] }> {
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Overpass API error ${response.status} (${endpoint}): ${detail.slice(0, 200)}`);
  }
  return (await response.json()) as { elements?: OverpassElement[] };
}

/**
 * 複数の Overpass サーバーへ同時に問い合わせ、最初に成功した結果を使う。
 * 公開サーバーは混雑や利用制限で応答しないことがあるため、順番に待つと数十秒かかってしまう。
 */
async function fetchOverpass(query: string): Promise<{ elements?: OverpassElement[] }> {
  try {
    return await Promise.any(OVERPASS_ENDPOINTS.map((endpoint) => fetchOverpassFrom(endpoint, query)));
  } catch (error) {
    const reasons = error instanceof AggregateError ? error.errors.map((item) => String(item).slice(0, 120)).join(' / ') : String(error);
    throw new Error(`Overpass API unavailable: ${reasons}`);
  }
}

async function searchOverpass(latitude: number, longitude: number, radius: number): Promise<NearbyPlace[]> {
  const json = await fetchOverpass(overpassQuery(latitude, longitude, radius));
  const seen = new Set<string>();
  return sortByDistance((json.elements ?? []).flatMap<NearbyPlace>((element) => {
    const tags = element.tags ?? {};
    // OSM は複数の名前を ";" で並べることがあるので、読める形に整える
    const name = (tags['name:ja'] ?? tags.name)?.split(';').map((part) => part.trim()).filter(Boolean).join(' ');
    const placeLatitude = element.lat ?? element.center?.lat;
    const placeLongitude = element.lon ?? element.center?.lon;
    if (!name || typeof placeLatitude !== 'number' || typeof placeLongitude !== 'number') return [];
    const id = `osm-${element.type}-${element.id}`;
    if (seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      name,
      address: osmAddress(tags),
      latitude: placeLatitude,
      longitude: placeLongitude,
      distanceMeters: Math.round(distanceMeters(latitude, longitude, placeLatitude, placeLongitude)),
      primaryType: OSM_CATEGORY_TAGS.map((tag) => tags[tag]).find(Boolean),
    }];
  }));
}

/** Nominatim の逆ジオコーディングで、地点の最寄りの店・施設を1件だけ取る(Overpass 全滅時の保険)。 */
async function reverseNominatim(latitude: number, longitude: number): Promise<NearbyPlace[]> {
  const url = `${NOMINATIM_ENDPOINT}?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=18&accept-language=ja`;
  const response = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(NOMINATIM_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Nominatim error ${response.status}`);
  const json = (await response.json()) as NominatimResult;
  const name = json.name;
  const placeLatitude = Number(json.lat);
  const placeLongitude = Number(json.lon);
  if (!name || !json.category || !OSM_CATEGORY_TAGS.includes(json.category) || !Number.isFinite(placeLatitude) || !Number.isFinite(placeLongitude)) return [];
  return [{
    id: `nominatim-${json.osm_type ?? 'x'}-${json.osm_id ?? 0}`,
    name,
    address: formatJapaneseAddress(json.address),
    latitude: placeLatitude,
    longitude: placeLongitude,
    distanceMeters: Math.round(distanceMeters(latitude, longitude, placeLatitude, placeLongitude)),
    primaryType: json.type,
  }];
}

/** Nominatim の住所オブジェクトを日本の表記(〒 都道府県 市区町村 町名 番地)に組み立てる。 */
function formatJapaneseAddress(address: Record<string, string> | undefined): string | undefined {
  if (!address) return undefined;
  const prefecture = address.province ?? address.state ?? '';
  const city = address.city ?? address.town ?? address.village ?? address.municipality ?? '';
  const area = address.suburb ?? address.quarter ?? address.neighbourhood ?? address.hamlet ?? '';
  const block = address.house_number ?? '';
  const main = `${prefecture}${city}${area}${block}`;
  if (!main) return undefined;
  return address.postcode ? `〒${address.postcode} ${main}` : main;
}

export type ReverseAddress = { name?: string; address?: string };

const addressCache = new Map<string, { expires: number; value: ReverseAddress }>();

/** 座標から住所(と、その地点の施設名があれば名前)を逆引きする。投稿に住所が無いときの補完用。 */
export async function reverseAddress(latitude: number, longitude: number): Promise<ReverseAddress> {
  const cacheKey = `${latitude.toFixed(4)}:${longitude.toFixed(4)}`;
  const cached = addressCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.value;
  const value = await throttledOsm(async () => {
    const url = `${NOMINATIM_ENDPOINT}?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=18&accept-language=ja`;
    const response = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(NOMINATIM_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Nominatim error ${response.status}`);
    const json = (await response.json()) as NominatimResult;
    return { name: json.name || undefined, address: formatJapaneseAddress(json.address) };
  });
  addressCache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, value });
  return value;
}

async function searchOsm(latitude: number, longitude: number, radius: number): Promise<NearbyPlace[]> {
  try {
    return await throttledOsm(() => searchOverpass(latitude, longitude, radius));
  } catch (error) {
    console.warn(`Overpass failed, falling back to Nominatim: ${String(error).slice(0, 200)}`);
    return throttledOsm(() => reverseNominatim(latitude, longitude));
  }
}

type NominatimSearchResult = NominatimResult & { display_name?: string };

/** 名前で店・施設を探す(OpenStreetMap)。地点の周辺を優先しつつ、範囲外も許す。 */
async function searchNominatimByName(query: string, latitude: number, longitude: number, max: number): Promise<NearbyPlace[]> {
  // 約 10km 四方を優先範囲にする
  const delta = 0.09;
  const params = new URLSearchParams({
    format: 'jsonv2',
    q: query,
    limit: String(max),
    'accept-language': 'ja',
    addressdetails: '1',
    viewbox: `${longitude - delta},${latitude + delta},${longitude + delta},${latitude - delta}`,
    bounded: '0',
  });
  const response = await fetchImpl(`${NOMINATIM_SEARCH_ENDPOINT}?${params.toString()}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(NOMINATIM_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Nominatim search error ${response.status}`);
  const json = (await response.json()) as NominatimSearchResult[];
  return sortByDistance(json.flatMap<NearbyPlace>((item) => {
    const placeLatitude = Number(item.lat);
    const placeLongitude = Number(item.lon);
    const name = item.name || item.display_name?.split(',')[0]?.trim();
    if (!name || !Number.isFinite(placeLatitude) || !Number.isFinite(placeLongitude)) return [];
    return [{
      id: `nominatim-${item.osm_type ?? 'x'}-${item.osm_id ?? 0}`,
      name,
      address: formatJapaneseAddress(item.address),
      latitude: placeLatitude,
      longitude: placeLongitude,
      distanceMeters: Math.round(distanceMeters(latitude, longitude, placeLatitude, placeLongitude)),
      primaryType: item.type,
    }];
  }));
}

/** 名前で店・施設を探す(Google Places API (New) の Text Search)。 */
async function searchGoogleByName(query: string, latitude: number, longitude: number, max: number, key: string): Promise<NearbyPlace[]> {
  const response = await fetchImpl(GOOGLE_TEXT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': GOOGLE_FIELD_MASK },
    body: JSON.stringify({
      textQuery: query,
      locationBias: { circle: { center: { latitude, longitude }, radius: 5000 } },
      maxResultCount: max,
      languageCode: 'ja',
      regionCode: 'JP',
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Places API error ${response.status}: ${detail.slice(0, 200)}`);
  }
  const json = (await response.json()) as { places?: GooglePlace[] };
  return sortByDistance((json.places ?? []).flatMap<NearbyPlace>((place) => {
    const name = place.displayName?.text;
    const placeLatitude = place.location?.latitude;
    const placeLongitude = place.location?.longitude;
    if (!place.id || !name || typeof placeLatitude !== 'number' || typeof placeLongitude !== 'number') return [];
    return [{
      id: place.id,
      name,
      address: place.formattedAddress,
      latitude: placeLatitude,
      longitude: placeLongitude,
      distanceMeters: Math.round(distanceMeters(latitude, longitude, placeLatitude, placeLongitude)),
      primaryType: place.primaryType,
    }];
  }));
}

/** 名前で店・施設を探す(場所検索)。近い順に返し、同じ検索は15分キャッシュする。 */
export async function searchPlacesByName(query: string, latitude: number, longitude: number, max = 5): Promise<NearbyPlace[]> {
  const provider = placesProvider();
  const cacheKey = `search:${provider}:${query.trim().toLowerCase()}:${latitude.toFixed(2)}:${longitude.toFixed(2)}:${max}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.places;
  const key = placesApiKey();
  const places = key
    ? await searchGoogleByName(query, latitude, longitude, max, key)
    : await throttledOsm(() => searchNominatimByName(query, latitude, longitude, max));
  cache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, places });
  return places;
}

/**
 * 地点の周辺にある店・施設を近い順に返す。
 * Google のキーがあれば Places API、無ければ OpenStreetMap を使う。
 * 近い地点(約100m 単位)の結果は15分間キャッシュし、公開サーバーへの負荷を抑える。
 */
export async function searchNearbyPlaces(latitude: number, longitude: number, radius = DEFAULT_RADIUS_METERS): Promise<NearbyPlace[]> {
  const provider = placesProvider();
  const cacheKey = `${provider}:${latitude.toFixed(3)}:${longitude.toFixed(3)}:${Math.round(radius)}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.places;
  const key = placesApiKey();
  const places = key ? await searchGoogle(latitude, longitude, radius, key) : await searchOsm(latitude, longitude, radius);
  cache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, places });
  return places;
}
