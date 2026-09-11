// Buffer n'existe pas sous Hermes ; crypto-core, api-client et app-core
// l'utilisent pour base64 / hex. Chargé en tout premier par app/_layout.tsx.
import { Buffer } from 'buffer'

const g = globalThis as { Buffer?: typeof Buffer }
if (!g.Buffer) g.Buffer = Buffer
