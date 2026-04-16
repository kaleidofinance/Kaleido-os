// utils/indexeddb.ts
interface CacheData {
  key: string
  data: any
  timestamp: number
  version: number
}

class IndexedDBCache {
  private db: IDBDatabase | null = null
  private dbName = "AppCache"
  private storeName = "cache"
  private version = 1

  async init() {
    if (this.db) return this.db

    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version)

      request.onerror = () => reject(request.error)

      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: "key" })
          store.createIndex("timestamp", "timestamp", { unique: false })
        }
      }

      request.onsuccess = () => {
        this.db = request.result
        resolve(this.db)
      }
    })
  }

  async set(key: string, data: any, maxAge: number = 30 * 60 * 1000) {
    try {
      const db = await this.init()
      const transaction = db.transaction([this.storeName], "readwrite")
      const store = transaction.objectStore(this.storeName)

      const cacheData: CacheData = {
        key,
        data,
        timestamp: Date.now(),
        version: this.version,
      }

      await new Promise((resolve, reject) => {
        const request = store.put(cacheData)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })

      console.log(`✅ Cached ${key} to IndexedDB`)
    } catch (error) {
      console.warn("IndexedDB set failed:", error)
    }
  }

  //   async get(key: string, maxAge: number = 30 * 60 * 1000) {
  //     try {
  //       const db = await this.init()
  //       const transaction = db.transaction([this.storeName], "readonly")
  //       const store = transaction.objectStore(this.storeName)

  //       const result = await new Promise<CacheData | undefined>((resolve, reject) => {
  //         const request = store.get(key)
  //         request.onsuccess = () => resolve(request.result)
  //         request.onerror = () => reject(request.error)
  //       })

  //       if (!result) return null

  //       // Check if data is still valid
  //       const age = Date.now() - result.timestamp
  //       if (age > maxAge) {
  //         console.log(`🕒 Cache expired for ${key} (${Math.round(age / 1000)}s old)`)
  //         this.delete(key) // Clean up expired data
  //         return null
  //       }

  //       console.log(`📖 Retrieved ${key} from IndexedDB cache`)
  //       return result.data
  //     } catch (error) {
  //       console.warn("IndexedDB get failed:", error)
  //       return null
  //     }
  //   }

  async get(key: string) {
    try {
      const db = await this.init()
      const transaction = db.transaction([this.storeName], "readonly")
      const store = transaction.objectStore(this.storeName)

      const result = await new Promise<CacheData | undefined>((resolve, reject) => {
        const request = store.get(key)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })

      if (!result) return null

      // No expiration check — always return the cached data
      console.log(`📖 Retrieved ${key} from IndexedDB cache`)
      return result.data
    } catch (error) {
      console.warn("IndexedDB get failed:", error)
      return null
    }
  }

  async delete(key: string) {
    try {
      const db = await this.init()
      const transaction = db.transaction([this.storeName], "readwrite")
      const store = transaction.objectStore(this.storeName)

      await new Promise((resolve, reject) => {
        const request = store.delete(key)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    } catch (error) {
      console.warn("IndexedDB delete failed:", error)
    }
  }

  async clear() {
    try {
      const db = await this.init()
      const transaction = db.transaction([this.storeName], "readwrite")
      const store = transaction.objectStore(this.storeName)

      await new Promise((resolve, reject) => {
        const request = store.clear()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })

      console.log("🗑️ IndexedDB cache cleared")
    } catch (error) {
      console.warn("IndexedDB clear failed:", error)
    }
  }
}

export const cacheDB = new IndexedDBCache()
