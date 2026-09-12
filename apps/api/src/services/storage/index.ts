// Stockage objet des blobs chiffrés (Backend Specs §5.2, DEC-10).
//
// Ce qui y va : P2 (backup du vault) et les Si_enc (parts Shamir). Toujours
// chiffré côté client ; le serveur transporte des octets qu'il ne peut pas
// lire (DEC-14, DEC-16). Storj est S3-compatible, d'où le client S3.
//
// Trois implémentations, une interface :
//   memory — tests
//   fs     — dev local, un fichier par clé sous STORAGE_FS_DIR
//   s3     — Storj DCS via gateway S3, en production

import { mkdir, readFile, rm, stat, writeFile, readdir } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { env } from '../../config/env.js'
import { keys, redis } from '../../lib/redis.js'

export interface ObjectMeta {
  size: number
  lastModified: Date
}

export interface ObjectStore {
  readonly name: 'memory' | 'fs' | 's3'
  put(key: string, data: Uint8Array): Promise<void>
  get(key: string): Promise<Uint8Array | null>
  head(key: string): Promise<ObjectMeta | null>
  delete(key: string): Promise<void>
  /** Supprime tout ce qui commence par `prefix`. '' vide tout le bucket. */
  deletePrefix(prefix: string): Promise<number>
  /** Lève si le backend est injoignable — pour /health. */
  ping(): Promise<void>
}

// Une clé ne peut être qu'un chemin relatif propre : pas de '..', pas de '/'
// initial, jamais un segment vide. Le layout est imposé par le service appelant.
const KEY_RE = /^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/
function assertKey(key: string): void {
  if (!KEY_RE.test(key) || key.split('/').includes('..')) throw new Error(`Clé de stockage invalide : ${key}`)
}

// --- Mémoire ------------------------------------------------------------------

export class MemoryObjectStore implements ObjectStore {
  readonly name = 'memory' as const
  private readonly objects = new Map<string, { data: Uint8Array; lastModified: Date }>()

  async put(key: string, data: Uint8Array): Promise<void> {
    assertKey(key)
    this.objects.set(key, { data: new Uint8Array(data), lastModified: new Date() })
  }
  async get(key: string): Promise<Uint8Array | null> {
    assertKey(key)
    const o = this.objects.get(key)
    return o ? new Uint8Array(o.data) : null
  }
  async head(key: string): Promise<ObjectMeta | null> {
    assertKey(key)
    const o = this.objects.get(key)
    return o ? { size: o.data.byteLength, lastModified: o.lastModified } : null
  }
  async delete(key: string): Promise<void> {
    assertKey(key)
    this.objects.delete(key)
  }
  async deletePrefix(prefix: string): Promise<number> {
    let n = 0
    for (const k of [...this.objects.keys()]) {
      if (k.startsWith(prefix)) {
        this.objects.delete(k)
        n++
      }
    }
    return n
  }
  async ping(): Promise<void> {}
}

// --- Système de fichiers --------------------------------------------------------

export class FsObjectStore implements ObjectStore {
  readonly name = 'fs' as const
  constructor(private readonly root: string) {}

  private path(key: string): string {
    assertKey(key)
    return join(this.root, key)
  }
  async put(key: string, data: Uint8Array): Promise<void> {
    const p = this.path(key)
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, data)
  }
  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.path(key)))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }
  async head(key: string): Promise<ObjectMeta | null> {
    try {
      const s = await stat(this.path(key))
      return { size: s.size, lastModified: s.mtime }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }
  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true })
  }
  async deletePrefix(prefix: string): Promise<number> {
    let n = 0
    const walk = async (dir: string): Promise<void> => {
      let entries: string[]
      try {
        entries = await readdir(dir)
      } catch {
        return
      }
      for (const e of entries) {
        const full = join(dir, e)
        const s = await stat(full)
        if (s.isDirectory()) await walk(full)
        else if (relative(this.root, full).split('\\').join('/').startsWith(prefix)) {
          await rm(full, { force: true })
          n++
        }
      }
    }
    await walk(this.root)
    return n
  }
  async ping(): Promise<void> {
    await mkdir(this.root, { recursive: true })
  }
}

// --- S3 / Storj -----------------------------------------------------------------

export class S3ObjectStore implements ObjectStore {
  readonly name = 's3' as const
  private readonly client: S3Client

  constructor(
    private readonly bucket: string,
    opts: { endpoint: string; accessKeyId: string; secretAccessKey: string },
  ) {
    this.client = new S3Client({
      endpoint: opts.endpoint,
      region: 'auto',
      forcePathStyle: true,
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
    })
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    assertKey(key)
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: 'application/octet-stream' }),
    )
  }
  async get(key: string): Promise<Uint8Array | null> {
    assertKey(key)
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
      return r.Body ? await r.Body.transformToByteArray() : null
    } catch (err) {
      if ((err as { name?: string }).name === 'NoSuchKey') return null
      throw err
    }
  }
  async head(key: string): Promise<ObjectMeta | null> {
    assertKey(key)
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))
      return { size: r.ContentLength ?? 0, lastModified: r.LastModified ?? new Date(0) }
    } catch (err) {
      const name = (err as { name?: string }).name
      if (name === 'NotFound' || name === 'NoSuchKey') return null
      throw err
    }
  }
  async delete(key: string): Promise<void> {
    assertKey(key)
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }
  async deletePrefix(prefix: string): Promise<number> {
    let n = 0
    let token: string | undefined
    do {
      const list = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      )
      const keys = (list.Contents ?? []).map((o) => ({ Key: o.Key! })).filter((o) => o.Key)
      if (keys.length) {
        await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys } }))
        n += keys.length
      }
      token = list.IsTruncated ? list.NextContinuationToken : undefined
    } while (token)
    return n
  }
  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }))
  }
}

// --- Fabrique -------------------------------------------------------------------

// --- Erreurs du stockage : compteur glissant pour l'alerte « stockage dégradé » -------
//
// Point ouvert BO-01 (12/09/2026) : Storj n'expose ni taux d'erreur ni usage du
// bucket. Ce que l'API sait, c'est quand ses propres appels échouent : chaque
// erreur (hors « objet absent ») est datée dans un sorted set Redis ; le
// tableau de bord compte celles des 15 dernières minutes.

export const STORAGE_ERROR_WINDOW_MS = 15 * 60 * 1000

export async function recordStorageError(now = new Date()): Promise<void> {
  const key = keys.storageErrors()
  await redis()
    .multi()
    .zadd(key, now.getTime(), `${now.getTime()}:${Math.random().toString(36).slice(2, 10)}`)
    .zremrangebyscore(key, 0, now.getTime() - STORAGE_ERROR_WINDOW_MS)
    .expire(key, Math.ceil(STORAGE_ERROR_WINDOW_MS / 1000) + 60)
    .exec()
}

export async function storageErrorsInWindow(now = new Date()): Promise<number> {
  return redis().zcount(keys.storageErrors(), now.getTime() - STORAGE_ERROR_WINDOW_MS, '+inf')
}

/** Enveloppe un store : toute erreur levée par le backend est comptée avant d'être relancée. */
export function meteredStore(inner: ObjectStore): ObjectStore {
  const meter = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work()
    } catch (err) {
      await recordStorageError().catch(() => undefined)
      throw err
    }
  }
  return {
    name: inner.name,
    put: (key, data) => meter(() => inner.put(key, data)),
    get: (key) => meter(() => inner.get(key)),
    head: (key) => meter(() => inner.head(key)),
    delete: (key) => meter(() => inner.delete(key)),
    deletePrefix: (prefix) => meter(() => inner.deletePrefix(prefix)),
    ping: () => meter(() => inner.ping()),
  }
}

let instance: ObjectStore | undefined

export function objectStore(): ObjectStore {
  if (!instance) {
    const e = env()
    switch (e.STORAGE_BACKEND) {
      case 'memory':
        instance = new MemoryObjectStore()
        break
      case 's3':
        instance = meteredStore(
          new S3ObjectStore(e.STORJ_BUCKET, {
            endpoint: e.STORJ_ENDPOINT,
            accessKeyId: e.STORJ_ACCESS_KEY!,
            secretAccessKey: e.STORJ_SECRET_KEY!,
          }),
        )
        break
      default:
        instance = meteredStore(new FsObjectStore(e.STORAGE_FS_DIR))
    }
  }
  return instance
}

export function setObjectStoreForTests(store: ObjectStore): void {
  instance = store
}
