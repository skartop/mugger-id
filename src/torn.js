// Torn API v2 client. The key is only ever sent to api.torn.com, in the Authorization header.
const BASE = 'https://api.torn.com/v2';

export const ERROR_MESSAGES = {
  0: 'Torn API returned an unknown error.',
  2: 'That API key is incorrect.',
  5: 'Too many requests. Torn allows 100 per minute per key.',
  8: 'Your IP is temporarily blocked by Torn for too many requests.',
  9: 'The Torn API is temporarily disabled. Try again later.',
  10: 'This key belongs to a player in federal jail.',
  13: 'This key is disabled because its owner has been inactive for more than 7 days.',
  16: "This key's access level is too low. Create a Limited key.",
  17: 'Torn had a temporary backend error.',
  18: 'This key is paused by its owner.',
};

export class TornError extends Error {
  constructor(code, message) {
    super(ERROR_MESSAGES[code] ?? message ?? `Torn API error ${code}`);
    this.code = code;
  }
}

export function createClient(key, opts = {}) {
  const fetchFn = opts.fetchFn ?? ((...args) => fetch(...args));
  const sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = opts.now ?? (() => Date.now());
  const minIntervalMs = opts.minIntervalMs ?? 750;
  let last = -Infinity;

  async function get(path) {
    for (let attempt = 0; ; attempt++) {
      const wait = last + minIntervalMs - now();
      if (wait > 0) await sleep(wait);
      last = now();
      let body;
      try {
        const res = await fetchFn(BASE + path, { headers: { Authorization: `ApiKey ${key}` } });
        body = await res.json();
      } catch {
        if (attempt < 2) {
          await sleep(2000 * (attempt + 1));
          continue;
        }
        throw new TornError(-1, 'Could not reach the Torn API. Check your connection.');
      }
      if (body.error) {
        if (body.error.code === 17) {
          if (attempt < 2) {
            await sleep(2000 * (attempt + 1));
            continue;
          }
          throw new TornError(17);
        }
        if (body.error.code === 5 && attempt < 3) {
          opts.onRateLimit?.();
          await sleep(60000);
          continue;
        }
        throw new TornError(body.error.code, body.error.error);
      }
      return body;
    }
  }

  async function keyInfo() {
    const access = (await get('/key/info')).info?.access ?? {};
    return { level: access.level ?? 0, type: access.type ?? 'Unknown', faction: access.faction === true };
  }

  async function pageAttacks(basePath, fromTs, onProgress) {
    const seen = new Map();
    let to = Math.floor(now() / 1000);
    for (;;) {
      const page = (await get(`${basePath}?filters=incoming&sort=DESC&limit=100&from=${fromTs}&to=${to}`)).attacks ?? [];
      const before = seen.size;
      for (const a of page) if (a.started >= fromTs) seen.set(a.id, a);
      onProgress?.(seen.size);
      if (page.length < 100) break;
      if (seen.size === before) break;
      const oldest = Math.min(...page.map((a) => a.started));
      if (oldest <= fromTs) break;
      // Torn treats `to` as exclusive, so +1 keeps attacks sharing the oldest second.
      to = oldest + 1;
    }
    return [...seen.values()].sort((a, b) => b.started - a.started);
  }

  const incomingAttacks = (fromTs, onProgress) => pageAttacks('/user/attacks', fromTs, onProgress);
  const factionAttacks = (fromTs, onProgress) => pageAttacks('/faction/attacks', fromTs, onProgress);
  const factionMembers = async () => {
    const m = (await get('/faction/members')).members;
    return (Array.isArray(m) ? m : Object.values(m ?? {})).map((x) => ({ id: x.id, name: x.name }));
  };

  const attackLog = async (code) => {
    const log = (await get(`/torn/attacklog?log=${encodeURIComponent(code)}`)).attacklog;
    return Array.isArray(log?.log) ? log : null;
  };
  const profile = async (id) => (await get(`/user/${id}/profile`)).profile;

  return { get, keyInfo, incomingAttacks, factionAttacks, factionMembers, attackLog, profile };
}
