import { normalizeState } from "./core-v2.js";

const DB_NAME = "ssw-tg2-manufacturing-quiz";
const DB_VERSION = 1;
const STORE = "app";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadState() {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get("state");
      request.onsuccess = () => resolve(normalizeState(request.result));
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

let queue = Promise.resolve();
export function saveState(state) {
  const snapshot = structuredClone(state);
  queue = queue.catch(() => {}).then(async () => {
    const db = await openDatabase();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(snapshot, "state");
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  });
  return queue;
}

export function resetState() {
  queue = queue.catch(() => {}).then(async () => {
    const db = await openDatabase();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete("state");
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  });
  return queue;
}
