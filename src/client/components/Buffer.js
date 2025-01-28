import * as buf from 'buffer'

const Buffer = buf.default.Buffer

// client support
if (typeof window !== 'undefined') {
  globalThis.Buffer = Buffer
}
