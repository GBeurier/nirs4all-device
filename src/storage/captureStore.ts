import type { PipelineArtifact, SpectrumCapture } from "@/domain/types";

const DB_NAME = "nirs4all-device";
const DB_VERSION = 1;
const CAPTURES = "captures";
const PIPELINES = "pipelines";

export class CaptureStore {
  #db: Promise<IDBDatabase> | null = null;

  async listCaptures(): Promise<SpectrumCapture[]> {
    const rows = await this.#readAll<SpectrumCapture>(CAPTURES);
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async saveCapture(capture: SpectrumCapture): Promise<void> {
    await this.#put(CAPTURES, capture);
  }

  async deleteCapture(id: string): Promise<void> {
    await this.#delete(CAPTURES, id);
  }

  async listPipelines(): Promise<PipelineArtifact[]> {
    const rows = await this.#readAll<PipelineArtifact>(PIPELINES);
    return rows.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  }

  async savePipeline(pipeline: PipelineArtifact): Promise<void> {
    await this.#put(PIPELINES, pipeline);
  }

  async clear(): Promise<void> {
    const db = await this.#open();
    await Promise.all([clearStore(db, CAPTURES), clearStore(db, PIPELINES)]);
  }

  async #readAll<T>(storeName: string): Promise<T[]> {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const request = tx.objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
  }

  async #put(storeName: string, value: { id: string }): Promise<void> {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async #delete(storeName: string, id: string): Promise<void> {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  #open(): Promise<IDBDatabase> {
    if (!this.#db) this.#db = openDb();
    return this.#db;
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CAPTURES)) db.createObjectStore(CAPTURES, { keyPath: "id" });
      if (!db.objectStoreNames.contains(PIPELINES)) db.createObjectStore(PIPELINES, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function clearStore(db: IDBDatabase, storeName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
