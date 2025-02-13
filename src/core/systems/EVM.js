import { System } from './System'

/**
 * EVM System
 *
 * - runs on the client
 * - provides methods for interacting with EVM blockchains
 *
 */
export class EVM extends System {
  constructor(world) {
    super(world)
    this.evm = null
  }

  debug() {
    console.log(Object.entries(this))
  }
}