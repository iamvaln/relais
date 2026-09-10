import { createHash } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/prisma.js'
import { objectStore } from '../src/services/storage/index.js'
import { api, closeAll, generateDeviceKeys, registerUser, resetState, signWith, type DeviceKeys } from './helpers.js'

beforeEach(resetState)
afterAll(closeAll)

// Le test joue l'app : il chiffre "quelque chose" (ici des octets aléatoires —
// le serveur n'en sait rien), signe le SHA256 du blob, et l'envoie.
function blob(size = 256): Buffer {
  const b = Buffer.alloc(size)
  for (let i = 0; i < size; i++) b[i] = (i * 31 + 7) & 0xff
  return b
}
function signBlob(keys: DeviceKeys, data: Buffer): string {
  return signWith(keys, createHash('sha256').update(data).digest())
}

async function userWithKey(email = 'adjoua@example.cm') {
  const u = await registerUser(email)
  const keys = generateDeviceKeys()
  await (await api())
    .post('/auth/keys')
    .set('Authorization', `Bearer ${u.accessToken}`)
    .send({ ed25519_pk: keys.publicKeyBase64 })
    .expect(200)
  return { ...u, keys, auth: { Authorization: `Bearer ${u.accessToken}` } }
}

describe('POST /vault/sync (DEC-07, DEC-21)', () => {
  it('exige une clé publique enregistrée', async () => {
    const { accessToken } = await registerUser('adjoua@example.cm')
    const data = blob()
    const r = await (await api())
      .post('/vault/sync')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ category: 'accounts', payload: data.toString('base64'), signature: Buffer.alloc(64).toString('base64') })
      .expect(409)
    expect(r.body.error.code).toBe('AUTH_KEY_NOT_SET')
  })

  it('stocke le blob sous payloads/{user}/v1_{category}.enc et pointe storj_vault_path', async () => {
    const { userId, keys, auth } = await userWithKey()
    const data = blob(1024)
    const r = await (await api())
      .post('/vault/sync')
      .set(auth)
      .send({ category: 'accounts', payload: data.toString('base64'), signature: signBlob(keys, data) })
      .expect(200)
    expect(r.body.data).toMatchObject({ storj_path: `payloads/${userId}/v1_accounts.enc`, size: 1024 })

    const stored = await objectStore().get(`payloads/${userId}/v1_accounts.enc`)
    expect(Buffer.from(stored!).equals(data)).toBe(true)

    const cfg = await prisma().transmission_configs.findUniqueOrThrow({ where: { user_id: userId } })
    expect(cfg.storj_vault_path).toBe(`payloads/${userId}/`)
    expect(cfg.status).toBe('inactive')
  })

  it('refuse une signature d’une autre clé', async () => {
    const { keys, auth } = await userWithKey()
    const impostor = generateDeviceKeys()
    const data = blob()
    const r = await (await api())
      .post('/vault/sync')
      .set(auth)
      .send({ category: 'accounts', payload: data.toString('base64'), signature: signBlob(impostor, data) })
      .expect(401)
    expect(r.body.error.code).toBe('AUTH_TOKEN_INVALID')
    expect(await objectStore().head(`payloads/x/v1_accounts.enc`)).toBeNull()
    void keys
  })

  it('refuse un blob modifié après signature (intégrité)', async () => {
    const { keys, auth } = await userWithKey()
    const data = blob()
    const sig = signBlob(keys, data)
    const tampered = Buffer.from(data)
    tampered[10] = tampered[10]! ^ 0xff
    const r = await (await api())
      .post('/vault/sync')
      .set(auth)
      .send({ category: 'accounts', payload: tampered.toString('base64'), signature: sig })
      .expect(401)
    expect(r.body.error.code).toBe('AUTH_TOKEN_INVALID')
  })

  it('applique vault.max_size_mb depuis app_config', async () => {
    const { keys, auth } = await userWithKey()
    await prisma().app_config.update({ where: { key: 'vault.max_size_mb' }, data: { value: '1' } })
    try {
      const data = blob(1024 * 1024 + 1)
      const r = await (await api())
        .post('/vault/sync')
        .set(auth)
        .send({ category: 'finances', payload: data.toString('base64'), signature: signBlob(keys, data) })
        .expect(403)
      expect(r.body.error.code).toBe('PLAN_LIMIT_REACHED')
      expect(r.body.error.details.max_bytes).toBe(1024 * 1024)
    } finally {
      await prisma().app_config.update({ where: { key: 'vault.max_size_mb' }, data: { value: '50' } })
    }
  })

  it('un nouveau sync écrase l’ancien blob de la même catégorie', async () => {
    const { userId, keys, auth } = await userWithKey()
    const client = await api()
    const v1 = blob(100)
    const v2 = blob(200)
    await client.post('/vault/sync').set(auth).send({ category: 'messages', payload: v1.toString('base64'), signature: signBlob(keys, v1) }).expect(200)
    await client.post('/vault/sync').set(auth).send({ category: 'messages', payload: v2.toString('base64'), signature: signBlob(keys, v2) }).expect(200)
    const stored = await objectStore().get(`payloads/${userId}/v1_messages.enc`)
    expect(stored!.length).toBe(200)
  })

  it('refuse une catégorie inconnue et un payload vide', async () => {
    const { keys, auth } = await userWithKey()
    const client = await api()
    const data = blob()
    const bad = await client.post('/vault/sync').set(auth).send({ category: 'photos', payload: data.toString('base64'), signature: signBlob(keys, data) }).expect(400)
    expect(bad.body.error.code).toBe('VALIDATION_ERROR')
    const empty = await client.post('/vault/sync').set(auth).send({ category: 'accounts', payload: '', signature: signBlob(keys, Buffer.alloc(0)) }).expect(400)
    expect(empty.body.error.code).toBe('VALIDATION_ERROR')
  })
})

describe('GET /vault/sync-status et POST /vault/restore', () => {
  it('status vide, puis renseigné par catégorie ; restore rend le blob intact', async () => {
    const { keys, auth } = await userWithKey()
    const client = await api()

    const before = await client.get('/vault/sync-status').set(auth).expect(200)
    expect(before.body.data).toEqual({ accounts: null, messages: null, finances: null })

    const data = blob(512)
    await client.post('/vault/sync').set(auth).send({ category: 'finances', payload: data.toString('base64'), signature: signBlob(keys, data) }).expect(200)

    const after = await client.get('/vault/sync-status').set(auth).expect(200)
    expect(after.body.data.accounts).toBeNull()
    expect(after.body.data.finances).toMatchObject({ size: 512 })
    expect(after.body.data.finances.synced_at).toBeTypeOf('string')

    const restored = await client.post('/vault/restore').set(auth).send({ category: 'finances' }).expect(200)
    expect(Buffer.from(restored.body.data.payload, 'base64').equals(data)).toBe(true)

    const missing = await client.post('/vault/restore').set(auth).send({ category: 'accounts' }).expect(404)
    expect(missing.body.error.code).toBe('NOT_FOUND')
  })

  it('un utilisateur ne voit jamais le backup d’un autre', async () => {
    const a = await userWithKey('adjoua@example.cm')
    const b = await userWithKey('herve@example.cm')
    const client = await api()
    const data = blob()
    await client.post('/vault/sync').set(a.auth).send({ category: 'accounts', payload: data.toString('base64'), signature: signBlob(a.keys, data) }).expect(200)

    const status = await client.get('/vault/sync-status').set(b.auth).expect(200)
    expect(status.body.data.accounts).toBeNull()
    await client.post('/vault/restore').set(b.auth).send({ category: 'accounts' }).expect(404)
  })

  it('exige un access token', async () => {
    const client = await api()
    expect((await client.get('/vault/sync-status').expect(401)).body.error.code).toBe('AUTH_TOKEN_INVALID')
    expect((await client.post('/vault/restore').send({ category: 'accounts' }).expect(401)).body.error.code).toBe('AUTH_TOKEN_INVALID')
  })
})

describe('/health', () => {
  it('rapporte le stockage comme non configuré hors S3', async () => {
    const r = await (await api()).get('/health').expect(200)
    expect(r.body.data.services.storj).toBe('unconfigured')
  })
})
