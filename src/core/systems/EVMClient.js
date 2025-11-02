import { System } from './System'
import { storage } from '../storage'

const key = 'hyp:solana:auths'
const template = 'Connect to world:\n{address}'

export class EVM extends System {
  constructor(world) {
    super(world)
    this.auths = storage.get(key, []) // [...{ address, signature }]
    this.connected = false
  }

  async bind({ connectors, connect, config, actions, abis, address, isConnected, isConnecting, disconnect }) {
    // console.log('bind', { isConnected, isConnecting })
    // {connectors, connect, config, actions, abis, address}
    this.actions = actions
    this.abis = abis
    this.connection = { connect, disconnect, connectors }
    // this.connectors = connectors
    // this.connect = connect
    this.config = config
    this.address = address
    // this.disconnect = disconnect
    if (isConnected && !this.connected) {
      this.connected = true
      this.world.network.send('evmConnect', address)
    }
    if (!isConnected && this.connected) {
      this.connected = false
      this.world.network.send('evmDisconnect')
    }
  }

  connect(player) {
    // console.log('connect', player.data.id !== this.world.network.id, this.connected)
    if (player && player.data.id !== this.world.network.id) {
      throw new Error('[solana] cannot connect a remote player from client')
    }
    if (this.connected) return
    this.connection.connect({ connector: this.connection.connectors[0] })
    this.connected = true
    // if (!this.wallet) return
    // if (this.wallet.connected) return
    // this.modal.setVisible(true)
  }

  disconnect(player) {
    if (player && player.data.id !== this.world.network.id) {
      throw new Error('[solana] cannot disconnect a remote player from client')
    }
    if (!this.connected) return
    this.connection.disconnect()
    this.connected = false
    // this.world.network.send('evmDisconnect')
  }

  deposit(playerId, amount) {
    throw new Error('[solana] deposit can only be called on the server')
  }

  withdraw(playerId, amount) {
    throw new Error('[solana] withdraw can only be called on the server')
  }

  async onDepositRequest({ depositId, serializedTx }) {
    // console.log('onDepositRequest', { depositId, serializedTx })
    // const tx = Transaction.from(Buffer.from(serializedTx, 'base64'))
    // const signedTx = await this.wallet.signTransaction(tx)
    // const serializedSignedTx = Buffer.from(signedTx.serialize()).toString('base64')
    this.world.network.send('depositResponse', { depositId, serializedSignedTx })
    // console.log('depositResponse', { depositId, serializedSignedTx })
  }

  async onWithdrawRequest({ withdrawId, serializedTx }) {
    // console.log('onWithdrawRequest', { withdrawId, serializedTx })
    // const tx = Transaction.from(Buffer.from(serializedTx, 'base64'))
    // const signedTx = await this.wallet.signTransaction(tx)
    // const serializedSignedTx = Buffer.from(signedTx.serialize({ requireAllSignatures: false })).toString('base64')
    this.world.network.send('withdrawResponse', { withdrawId, serializedSignedTx })
    // console.log('withdrawResponse', { withdrawId, serializedSignedTx })
  }
}
