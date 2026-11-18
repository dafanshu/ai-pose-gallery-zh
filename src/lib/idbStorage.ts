import { storageKey, persistedValue } from './runtime'
const DB_NAME = storageKey('pose_atlas_studio_db')
const STORE_NAME = 'kv_store'
const DB_VERSION = 1

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function idbRead<T>(key: string): Promise<T | undefined> {
  const db = await openDb()
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).get(key)
      req.onsuccess = () => resolve(req.result as T | undefined)
      req.onerror = () => reject(req.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally { db.close() }
}
export async function idbGet<T>(key: string): Promise<T | undefined> {
  try { return await idbRead<T>(key) } catch { return undefined }
}

export async function idbSet<T>(key: string, value: T): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(persistedValue(value), key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    // ignore storage errors in private browsing
  }
}

// 确认保存成功的操作必须等待事务提交。
export async function idbWrite<T>(key: string, value: T): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(persistedValue(value), key)
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('浏览器存储写入失败'))
    })
  } finally { db.close() }
}

export async function idbWriteMany(entries: [string, unknown][]): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      for (const [key, value] of entries) tx.objectStore(STORE_NAME).put(persistedValue(value), key)
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('备份导入失败'))
    })
  } finally { db.close() }
}

/** Delete only the explicitly selected record; report transaction failure. */
export async function idbDelete(key: string): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).delete(key)
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => reject(new Error('浏览器存储删除失败'))
    })
  } finally { db.close() }
}
