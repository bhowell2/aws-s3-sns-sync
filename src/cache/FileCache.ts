import { Stats } from "fs"

/**
 * Information kept when updating a file.
 */
export interface CacheEntry {
  lastModified: number
  etag: string
}

export interface FileCacheOptions {
  maxSize: number
}

/**
 * Provides an in-memory cache for filesAndDirs' stats. This keeps the app from
 * having to make file-system stat lookups for filesAndDirs, greatly increasing
 * the throughput of the program.
 *
 * The cache will only hold a maximum of {@link FileCacheOptions#maxSize}
 * filesAndDirs, each 10k entries in the cache is about 4MB.
 *
 * Cache entries are removed based on the most-infrequently updated file
 * entries.
 */
export default class FileCache {

  private cache: { [key: string]: CacheEntry } = {}
  private size: number = 0

  maxSize: number

  constructor(options: FileCacheOptions) {
    this.maxSize = options.maxSize;

  }

  /**
   * Adds a file for the provided httpPath. If adding the file will cause the size
   * of the cache to grow greater than maxSize then an entry will be evicted
   * from the cache. The eviction file is randomly chosen - maybe in the future
   * different eviction methods can be provided.
   *
   * @param key file's httpPath (key in cache)
   * @param etag
   * @param stats
   */
  addFile(key: string, etag: string, stats: Stats) {
    if (this.size === this.maxSize) {
      // need to randomly remove an entry
      let removePos = Math.floor(Math.random() * this.size);
      const keys = Object.keys(this.cache);
      for (let i = 0; i < keys.length; i++) {
        if (i == removePos) {
          this.removeFromCache(keys[i]);
          break;
        }
      }
    }
    this.cache[key] = {lastModified: stats.mtimeMs, etag};
    this.size++;
  }

  /**
   * Returns the cache entry or undefined if it does not exist in the cache.
   * @param key S3 object key
   */
  getCacheEntry(key: string): CacheEntry | undefined {
    return this.cache[key];
  }

  /**
   * Removes the cache entry for the specified key;
   * @param key
   */
  removeFromCache(key: string): boolean {
    const deleted = delete this.cache[key];
    if (deleted) {
      this.size--;
    }
    return deleted;
  }

}
