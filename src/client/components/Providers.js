import { createConfig, http, injected, WagmiProvider } from 'wagmi'
import * as chains from 'wagmi/chains'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
const queryClient = new QueryClient()

const chainStr = process.env.PUBLIC_EVM ?? 'mainnet'
const chain = chains[chainStr]
if (!chain) throw new Error('invalid chain name');

const transports = {
  [chain.id]: http(),
}


export const Providers = ({ children }) => (
  <WagmiProvider
    config={createConfig({
      chains: [chain],
      transports,
      connectors: [injected()],
      multiInjectedProviderDiscovery: false,
    })}
  >
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  </WagmiProvider>
)
