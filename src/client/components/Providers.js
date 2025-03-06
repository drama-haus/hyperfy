import { createConfig, http, injected, WagmiProvider } from 'wagmi'
import { base, mainnet, bsc, arbitrum, avalanche, polygon, optimism, baseSepolia } from 'wagmi/chains'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
const queryClient = new QueryClient()

const chains = [base, mainnet, bsc, arbitrum, avalanche, polygon, optimism, baseSepolia]

const transports = {
  [base.id]: http(),
  [mainnet.id]: http(),
  [bsc.id]: http(),
  [arbitrum.id]: http(),
  [avalanche.id]: http(),
  [polygon.id]: http(),
  [optimism.id]: http(),
  [baseSepolia.id]: http(),
}

export const Providers = ({ children }) => (
  <WagmiProvider
    config={createConfig({
      chains,
      transports,
      connectors: [injected()],
      multiInjectedProviderDiscovery: false,
    })}
  >
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  </WagmiProvider>
)
