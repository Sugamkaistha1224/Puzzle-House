const NS = 'jigsaw-table';

export const keyOf = (key) => `${NS}:${key}`;

const read = (key, fallback) => {
  try {
    const raw = localStorage.getItem(keyOf(key));
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const write = (key, value) => {
  try {
    localStorage.setItem(keyOf(key), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

export const loadIndex = () => read('index', []);
export const saveIndex = (list) => write('index', list);
export const loadTable = (id) => read(`table:${id}`, null);
export const saveTable = (id, table) => write(`table:${id}`, table);
export const loadSettings = () => {
  const { assists, ...saved } = read('settings', {});
  return {
    assists: saved.v === 2 ? assists : true, sound: true, idleMin: 3, coached: false, table: 'felt', turnEdge: true, turnScroll: true, zoom: true, ...saved, v: 2,
  };
};
export const saveSettings = (settings) => write('settings', settings);
export const loadLastOpen = () => read('open', null);
export const saveLastOpen = (id) => write('open', id);
export const dropTable = (id) => {
  try { localStorage.removeItem(keyOf(`table:${id}`)); } catch {  }
};

let dbPromise;
const db = () => {
  dbPromise ??= new Promise((done, fail) => {
    const req = indexedDB.open(NS, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('images');
    req.onsuccess = () => done(req.result);
    req.onerror = () => fail(req.error);
  });
  return dbPromise;
};

const request = async (mode, act) => {
  const store = (await db()).transaction('images', mode).objectStore('images');
  return new Promise((done, fail) => {
    const req = act(store);
    req.onsuccess = () => done(req.result);
    req.onerror = () => fail(req.error);
  });
};

export const putImage = (id, blob) => request('readwrite', (s) => s.put(blob, id)).then(() => true, () => false);
export const getImage = (id) => request('readonly', (s) => s.get(id)).catch(() => undefined);
export const deleteImage = (id) => request('readwrite', (s) => s.delete(id)).catch(() => undefined);
