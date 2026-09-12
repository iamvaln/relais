// Le lien de l'email : https://<front>/relay/<token>. La page en tire le token
// et propose le deep link vers l'app.

import { describe, expect, it } from 'vitest'
import { appLink, tokenFromLocation } from '../src/token'

describe('tokenFromLocation', () => {
  it('lit le token du chemin /relay/:token, ou de ?token=, sinon null', () => {
    expect(tokenFromLocation('/relay/abc123DEF456-_ghi789JKL012mno345PQR', '')).toBe('abc123DEF456-_ghi789JKL012mno345PQR')
    expect(tokenFromLocation('/relay/abc123DEF456-_ghi789JKL012mno345PQR/', '')).toBe('abc123DEF456-_ghi789JKL012mno345PQR')
    expect(tokenFromLocation('/', '?token=abc123DEF456-_ghi789JKL012mno345PQR')).toBe('abc123DEF456-_ghi789JKL012mno345PQR')
    expect(tokenFromLocation('/relay/trop-court', '')).toBeNull()
    expect(tokenFromLocation('/relay/pas%20valide%20du%20tout%20avec%20espaces', '')).toBeNull()
    expect(tokenFromLocation('/autre', '')).toBeNull()
  })
})

describe('appLink', () => {
  it('le deep link de l’app, avec le même token', () => {
    expect(appLink('abc123DEF456-_ghi789JKL012mno345PQR')).toBe('relais://relay/abc123DEF456-_ghi789JKL012mno345PQR')
  })
})
