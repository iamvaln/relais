// crypto-core et app-core utilisent Buffer pour le base64 ; le navigateur n'en a pas.
import { Buffer } from 'buffer'

const g = globalThis as { Buffer?: typeof Buffer }
g.Buffer ??= Buffer
