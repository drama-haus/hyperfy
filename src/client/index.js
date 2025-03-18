import 'ses'
import '../core/lockdown'
import { createRoot } from 'react-dom/client'

import { Providers } from './components/Providers'
import { Client } from './world-client'

function App() {
  return <Client wsUrl={process.env.PUBLIC_WS_URL} />
}

const root = createRoot(document.getElementById('root'))
root.render(
  <Providers>
    <App />
  </Providers>
)
