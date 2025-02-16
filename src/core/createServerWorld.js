import { World } from './World'

import { Server } from './systems/Server'
import { ServerNetwork } from './systems/ServerNetwork'
import { ServerLoader } from './systems/ServerLoader'
import { Solana } from './systems/Solana'

export function createServerWorld() {
  const world = new World()
  world.register('server', Server)
  world.register('network', ServerNetwork)
  world.register('loader', ServerLoader)
  world.register('solana', Solana)
  return world
}
