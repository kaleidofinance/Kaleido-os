import { useCallback, useState, useEffect, useRef } from "react"

// IndexedDB configuration
const DB_NAME = "KaleidoCache"
const DB_VERSION = 1
const STORES = {
  LISTINGS: "listings",
  REQUESTS: "requests",
  USER_DATA: "userData",
  METADATA: "metadata",
}

// Cache metadata interface
interface CacheMetadata {
  key: string
  lastUpdated: number
  size: number
  version: number
}

// IndexedDB utility class
class IndexedDBManager {
  private db: IDBDatabase | null = null
  private initPromise: Promise<IDBDatabase> | null = null

  // Initialize database
  private async initDB(): Promise<IDBDatabase> {
    if (this.db) return this.db

    if (this.initPromise) return this.initPromise

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => {
        console.error("❌ IndexedDB initialization failed:", request.error)
        reject(request.error)
      }

      request.onsuccess = () => {
        this.db = request.result
        console.log("✅ IndexedDB initialized successfully")
        resolve(this.db)
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result

        // Create stores if they don't exist
        Object.values(STORES).forEach((storeName) => {
          if (!db.objectStoreNames.contains(storeName)) {
            const store = db.createObjectStore(storeName, { keyPath: "key" })
            store.createIndex("lastUpdated", "lastUpdated", { unique: false })
            console.log(`📦 Created IndexedDB store: ${storeName}`)
          }
        })

        console.log("🔄 IndexedDB schema updated")
      }
    })

    return this.initPromise
  }

  // Generic get method
  async get<T>(storeName: string, key: string): Promise<T | null> {
    try {
      const db = await this.initDB()
      const transaction = db.transaction([storeName], "readonly")
      const store = transaction.objectStore(storeName)
      const request = store.get(key)

      return new Promise((resolve, reject) => {
        request.onsuccess = () => {
          const result = request.result
          if (result) {
            console.log(`📖 Retrieved from IndexedDB: ${key} (${this.formatSize(JSON.stringify(result.data).length)})`)
            resolve(result.data)
          } else {
            resolve(null)
          }
        }
        request.onerror = () => reject(request.error)
      })
    } catch (error) {
      console.error(`❌ Error getting ${key} from IndexedDB:`, error)
      return null
    }
  }

  // Generic set method
  async set<T>(storeName: string, key: string, data: T): Promise<boolean> {
    try {
      const db = await this.initDB()
      const transaction = db.transaction([storeName], "readwrite")
      const store = transaction.objectStore(storeName)

      const cacheItem = {
        key,
        data,
        lastUpdated: Date.now(),
        size: JSON.stringify(data).length,
        version: 1,
      }

      const request = store.put(cacheItem)

      return new Promise((resolve, reject) => {
        request.onsuccess = () => {
          console.log(`💾 Stored in IndexedDB: ${key} (${this.formatSize(cacheItem.size)})`)
          resolve(true)
        }
        request.onerror = () => {
          console.error(`❌ Error storing ${key}:`, request.error)
          reject(request.error)
        }
      })
    } catch (error) {
      console.error(`❌ Error setting ${key} in IndexedDB:`, error)
      return false
    }
  }

  // Delete method
  async delete(storeName: string, key: string): Promise<boolean> {
    try {
      const db = await this.initDB()
      const transaction = db.transaction([storeName], "readwrite")
      const store = transaction.objectStore(storeName)
      const request = store.delete(key)

      return new Promise((resolve, reject) => {
        request.onsuccess = () => {
          console.log(`🗑️ Deleted from IndexedDB: ${key}`)
          resolve(true)
        }
        request.onerror = () => reject(request.error)
      })
    } catch (error) {
      console.error(`❌ Error deleting ${key}:`, error)
      return false
    }
  }

  // Get all keys in a store
  async getAllKeys(storeName: string): Promise<string[]> {
    try {
      const db = await this.initDB()
      const transaction = db.transaction([storeName], "readonly")
      const store = transaction.objectStore(storeName)
      const request = store.getAllKeys()

      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result as string[])
        request.onerror = () => reject(request.error)
      })
    } catch (error) {
      console.error(`❌ Error getting keys from ${storeName}:`, error)
      return []
    }
  }

  // Get cache metadata
  async getMetadata(storeName: string, key: string): Promise<CacheMetadata | null> {
    try {
      const db = await this.initDB()
      const transaction = db.transaction([storeName], "readonly")
      const store = transaction.objectStore(storeName)
      const request = store.get(key)

      return new Promise((resolve, reject) => {
        request.onsuccess = () => {
          const result = request.result
          if (result) {
            resolve({
              key: result.key,
              lastUpdated: result.lastUpdated,
              size: result.size,
              version: result.version,
            })
          } else {
            resolve(null)
          }
        }
        request.onerror = () => reject(request.error)
      })
    } catch (error) {
      console.error(`❌ Error getting metadata for ${key}:`, error)
      return null
    }
  }

  // Clean old entries
  async cleanup(storeName: string, maxAge: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    try {
      const db = await this.initDB()
      const transaction = db.transaction([storeName], "readwrite")
      const store = transaction.objectStore(storeName)
      const index = store.index("lastUpdated")

      const cutoffTime = Date.now() - maxAge
      const range = IDBKeyRange.upperBound(cutoffTime)
      const request = index.openCursor(range)

      let deletedCount = 0

      return new Promise((resolve, reject) => {
        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result
          if (cursor) {
            cursor.delete()
            deletedCount++
            cursor.continue()
          } else {
            console.log(`🧹 Cleaned up ${deletedCount} old entries from ${storeName}`)
            resolve(deletedCount)
          }
        }
        request.onerror = () => reject(request.error)
      })
    } catch (error) {
      console.error(`❌ Error cleaning up ${storeName}:`, error)
      return 0
    }
  }

  // Get storage usage
  async getStorageUsage(): Promise<{ used: number; available: number }> {
    try {
      if ("storage" in navigator && "estimate" in navigator.storage) {
        const estimate = await navigator.storage.estimate()
        return {
          used: estimate.usage || 0,
          available: estimate.quota || 0,
        }
      }
    } catch (error) {
      console.warn("Could not get storage estimate:", error)
    }

    return { used: 0, available: 0 }
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + " B"
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB"
    return (bytes / (1024 * 1024)).toFixed(1) + " MB"
  }
}

// Global IndexedDB manager instance
const dbManager = new IndexedDBManager()

// Custom hook for IndexedDB cache
export function useIndexedDBCache<T>(
  storeName: string,
  key: string,
  initialValue: T,
  options: {
    maxAge?: number // Cache expiry in milliseconds
    backgroundRefresh?: boolean // Whether to refresh in background
  } = {},
) {
  const [data, setData] = useState<T>(initialValue)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cacheMetadata, setCacheMetadata] = useState<CacheMetadata | null>(null)

  const refreshPromiseRef = useRef<Promise<T> | null>(null)
  const { maxAge = 24 * 60 * 60 * 1000, backgroundRefresh = true } = options

  // Load data from IndexedDB on mount
  useEffect(() => {
    const loadFromCache = async () => {
      try {
        setIsLoading(true)
        setError(null)

        // Get cached data
        const cachedData = await dbManager.get<T>(storeName, key)
        const metadata = await dbManager.getMetadata(storeName, key)

        if (cachedData && metadata) {
          setData(cachedData)
          setCacheMetadata(metadata)

          // Check if cache is still valid
          const isExpired = Date.now() - metadata.lastUpdated > maxAge

          if (isExpired) {
            console.log(`⏰ Cache expired for ${key}, will need refresh`)
          } else {
            console.log(`✅ Loaded fresh cache for ${key}`)
          }
        } else {
          console.log(`📭 No cache found for ${key}`)
        }
      } catch (err) {
        console.error(`❌ Error loading cache for ${key}:`, err)
        setError(err instanceof Error ? err.message : "Failed to load cache")
      } finally {
        setIsLoading(false)
      }
    }

    loadFromCache()
  }, [storeName, key, maxAge])

  // Save data to IndexedDB
  const saveToCache = useCallback(
    async (newData: T): Promise<boolean> => {
      try {
        const success = await dbManager.set(storeName, key, newData)
        if (success) {
          setData(newData)
          const metadata = await dbManager.getMetadata(storeName, key)
          setCacheMetadata(metadata)
        }
        return success
      } catch (err) {
        console.error(`❌ Error saving to cache:`, err)
        setError(err instanceof Error ? err.message : "Failed to save to cache")
        return false
      }
    },
    [storeName, key],
  )

  // Refresh data with fetch function
  const refreshData = useCallback(
    async (fetchFunction: () => Promise<T>, forceRefresh: boolean = false): Promise<T> => {
      // Prevent multiple simultaneous refreshes
      if (refreshPromiseRef.current && !forceRefresh) {
        return refreshPromiseRef.current
      }

      setIsRefreshing(true)
      setError(null)

      const refreshPromise = fetchFunction()
        .then(async (freshData) => {
          console.log(`🔄 Fresh data fetched for ${key}`)

          // Save to IndexedDB
          const saved = await saveToCache(freshData)
          if (!saved) {
            console.warn(`⚠️ Failed to save fresh data to cache for ${key}`)
          }

          return freshData
        })
        .catch((err) => {
          console.error(`❌ Error fetching fresh data for ${key}:`, err)
          setError(err instanceof Error ? err.message : "Failed to fetch fresh data")
          // Return current cached data on error
          return data
        })
        .finally(() => {
          setIsRefreshing(false)
          refreshPromiseRef.current = null
        })

      refreshPromiseRef.current = refreshPromise
      return refreshPromise
    },
    [key, saveToCache, data],
  )

  // Clear cache
  const clearCache = useCallback(async (): Promise<boolean> => {
    try {
      const success = await dbManager.delete(storeName, key)
      if (success) {
        setData(initialValue)
        setCacheMetadata(null)
      }
      return success
    } catch (err) {
      console.error(`❌ Error clearing cache:`, err)
      return false
    }
  }, [storeName, key, initialValue])

  // Get cache info
  const getCacheInfo = useCallback(async () => {
    const metadata = await dbManager.getMetadata(storeName, key)
    const storageUsage = await dbManager.getStorageUsage()

    return {
      metadata,
      storageUsage,
      isExpired: metadata ? Date.now() - metadata.lastUpdated > maxAge : true,
      hasData: Boolean(metadata),
    }
  }, [storeName, key, maxAge])

  // Check if cache is valid (not expired)
  const isCacheValid = cacheMetadata ? Date.now() - cacheMetadata.lastUpdated < maxAge : false

  // Check if we have any cached data
  const hasCachedData = Boolean(data && (Array.isArray(data) ? data.length > 0 : true))

  return {
    data,
    isLoading,
    isRefreshing,
    error,
    cacheMetadata,
    isCacheValid,
    hasCachedData,
    saveToCache,
    refreshData,
    clearCache,
    getCacheInfo,
  }
}

// Specialized hooks for your specific use cases
export function useListingsCache(initialValue: any[] = []) {
  return useIndexedDBCache(STORES.LISTINGS, "all-listings-cache", initialValue, {
    maxAge: 30 * 60 * 1000, // 30 minutes
    backgroundRefresh: true,
  })
}

export function useRequestsCache(initialValue: any[] = []) {
  return useIndexedDBCache(STORES.REQUESTS, "all-requests-cache", initialValue, {
    maxAge: 15 * 60 * 1000, // 15 minutes
    backgroundRefresh: true,
  })
}

// Utility functions for cache management
export const CacheManager = {
  // Clean all expired caches
  cleanupAll: async () => {
    const results = await Promise.allSettled([
      dbManager.cleanup(STORES.LISTINGS),
      dbManager.cleanup(STORES.REQUESTS),
      dbManager.cleanup(STORES.USER_DATA),
      dbManager.cleanup(STORES.METADATA),
    ])

    let totalCleaned = 0
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        totalCleaned += result.value
      }
    })

    console.log(`🧹 Total cleanup: ${totalCleaned} entries removed`)
    return totalCleaned
  },

  // Get storage usage info
  getStorageInfo: async () => {
    return await dbManager.getStorageUsage()
  },

  // Clear all caches
  clearAll: async () => {
    const stores = Object.values(STORES)
    const results = await Promise.allSettled(
      stores.map(async (storeName) => {
        const keys = await dbManager.getAllKeys(storeName)
        return Promise.all(keys.map((key) => dbManager.delete(storeName, key)))
      }),
    )

    console.log("🗑️ All caches cleared")
    return results
  },
}
