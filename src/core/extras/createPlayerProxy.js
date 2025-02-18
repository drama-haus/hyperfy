import * as THREE from './three'

export function createPlayerProxy(player) {
  const world = player.world
  const position = new THREE.Vector3()
  const rotation = new THREE.Euler()
  const quaternion = new THREE.Quaternion()
  return {
    get networkId() {
      return player.data.owner
    },
    get entityId() {
      return player.data.id
    },
    get id() {
      return player.data.user.id
    },
    get name() {
      return player.data.user.name
    },
    get position() {
      return position.copy(player.base.position)
    },
    get rotation() {
      return rotation.copy(player.base.rotation)
    },
    get quaternion() {
      return quaternion.copy(player.base.quaternion)
    },
    teleport(position, rotationY) {
      if (player.data.owner === world.network.id) {
        world.network.enqueue('onPlayerTeleport', { position: position.toArray(), rotationY })
      } else if (world.network.isClient) {
        world.network.send('playerTeleport', { networkId: player.data.owner, position: position.toArray(), rotationY })
      } else {
        world.network.sendTo(player.data.owner, 'playerTeleport', { position: position.toArray(), rotationY })
      }
    },
    setEmote(emoteUrl, {loop = false, onFinish}) {
      if (player.emoting === undefined) return
      // console.log(emoteUrl, loop)
      player.emoting = true
      player.avatar.setEmote(emoteUrl, { loop, onFinish})

      // console.log(player)
    },
    replaceAnimations(newEmotes) {
      player.replaceAnimations(newEmotes)
    },
    getMoving() {
      const { flying, jumping, falling, moving } = player
      return { flying, jumping, falling, moving }
    },
  }
}
