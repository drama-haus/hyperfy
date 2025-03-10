import { System } from './System'

export class Solana extends System {
  constructor(world) {
    super(world)
    if (world.network.isClient) {
      this.wallet = null
      this.connection = null
    }
  }

  async getBalance() {
    if (!this.wallet || !this.connection) return 0
    const balance = await this.connection.getBalance(this.wallet.publicKey)
    return (balance / 1e9).toFixed(4)
  }

  debug() {
    console.log('wallet', this.wallet)
    console.log('connection', this.connection)
  }
}
