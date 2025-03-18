import { createPublicClient, createWalletClient, erc20Abi, getContract, http } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import * as utils from 'viem/utils'
import * as chains from 'viem/chains';
import { System } from './System'

export class EVM extends System {
  constructor(world) {
    super(world)
    this.evm = null

    const chainName = process.env.PUBLIC_EVM ?? 'mainnet'
    const chain = chains[chainName]

    if (!chain) throw new Error("invalid chain string");

    if (world.network.isServer) {
      const account = mnemonicToAccount(process.env.EVM_SEED_PHRASE);

      const wallet = createWalletClient({
        account,
        chain,
        transport: http()
      })

      const client = createPublicClient({
        chain,
        transport: http()
      })

      this.utils = utils
      this.actions = client
      this.wallet = wallet
      this.getContract = getContract
      this.abis = {
        erc20: erc20Abi,
        erc721: null
      }

    }
  }

  debug() {
    console.log(Object.entries(this))
  }
}
