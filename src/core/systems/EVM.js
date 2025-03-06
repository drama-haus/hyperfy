import { createPublicClient, createWalletClient, getContract, http } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import { sonic } from 'viem/chains'
import * as utils from 'viem/utils'

import { System } from './System'

export class EVM extends System {
  constructor(world) {
    super(world)
    this.evm = null

    if (world.network.isServer) {
      const account = mnemonicToAccount(process.env.EVM_SEED_PHRASE);

      const wallet = createWalletClient({
        account,
        chain: sonic,
        transport: http()
      })

      const client = createPublicClient({
        chain: sonic,
        transport: http()
      })

      this.evm = {
        utils,
        client,
        wallet,
        getContract
      }

    }
  }

  debug() {
    console.log(Object.entries(this))
  }
}
