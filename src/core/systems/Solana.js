import { System } from './System'

/**
 * Solana System
 *
 * - runs on the client
 * - provides methods for interacting with the Solana blockchain
 *
 */
export class Solana extends System {
  constructor(world) {
    super(world)
    this.wallet = null
    this.connection = null
  }

  async getBalance() {
    if (!this.wallet || !this.connection) return 0
    const balance = await this.connection.getBalance(this.wallet.publicKey)
    // Convert lamports to SOL and format to 4 decimal places
    return (balance / 1e9).toFixed(4)
  }

  debug() {
    console.log('wallet', this.wallet)
    console.log('connection', this.connection)
  }
}
