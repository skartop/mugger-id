// Attack logs never change, so they are cached on this device by attack code.
// Falls back to memory when IndexedDB is unavailable (private windows, blocked storage).
const DB_NAME = 'mugger-id';
const STORE = 'logs';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function openCache() {
  const memory = new Map();
  let db = null;
  try {
    db = await openDb();
  } catch {
    db = null;
  }
  const run = (mode, fn) =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });

  return {
    async get(code) {
      if (memory.has(code)) return memory.get(code);
      if (!db) return undefined;
      try {
        const value = await run('readonly', (s) => s.get(code));
        if (value) memory.set(code, value);
        return value;
      } catch {
        return undefined;
      }
    },
    async put(code, log) {
      memory.set(code, log);
      if (!db) return;
      try {
        await run('readwrite', (s) => s.put(log, code));
      } catch {
        // memory copy is enough for this session
      }
    },
    async clear() {
      memory.clear();
      if (!db) return;
      try {
        await run('readwrite', (s) => s.clear());
      } catch {
        // nothing stored
      }
    },
  };
}
