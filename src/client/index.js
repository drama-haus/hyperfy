import 'ses'
import '../core/lockdown'
import { createRoot } from 'react-dom/client'

import { Client } from './world-client'

import * as buf from 'buffer'

const Buffer = buf.default.Buffer

// client support
if (typeof window !== 'undefined') {
  globalThis.Buffer = Buffer
}

function App() {
  return <Client wsUrl={process.env.PUBLIC_WS_URL} />
}

const root = createRoot(document.getElementById('root'))
root.render(<App />)
