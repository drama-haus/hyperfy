import { System } from './System'
import { uuid } from '../utils'
import { cloneDeep } from 'lodash-es'

export class EntitySpawner extends System {
  constructor(world) {
    super(world)
  }

  async init() {
    const self = this
    this.world.inject({
      world: {
        spawnEntity(_, blueprintId, position, rotation) {
          if (self.world.isClient) return
          if (_.blueprint?.id === blueprintId) return

          const blueprint = self.world.blueprints.get(blueprintId)
          if (!blueprint) return

          let finalBlueprintId = blueprintId

          // If unique, duplicate the blueprint similar to client-side
          if (blueprint.unique) {
            const newBlueprint = {
              id: uuid(),
              version: 0,
              name: blueprint.name,
              image: blueprint.image,
              author: blueprint.author,
              url: blueprint.url,
              desc: blueprint.desc,
              model: blueprint.model,
              script: blueprint.script,
              props: cloneDeep(blueprint.props),
              preload: blueprint.preload,
              public: blueprint.public,
              locked: blueprint.locked,
              frozen: blueprint.frozen,
              unique: blueprint.unique,
            }
            self.world.blueprints.add(newBlueprint, true)
            finalBlueprintId = newBlueprint.id
          }

          // Create entity data similar to client-side
          const data = {
            id: uuid(),
            type: 'app',
            blueprint: finalBlueprintId,
            position: position ? (position.toArray ? position.toArray() : position) : [0, 0, 0],
            quaternion: rotation ? (rotation.toArray ? rotation.toArray() : rotation) : [0, 0, 0, 1],
            // mover: world.network.id,
            // uploader: null,
            pinned: false,
            state: {},
          }

          const entity = self.world.entities.add(data, true)
          if (entity.isApp) self.world.network.dirtyApps.add(entity.data.id)
          if (finalBlueprintId !== blueprintId) {
            self.world.network.dirtyBlueprints.add(finalBlueprintId)
          }
          return entity
        },
      },
    })
  }
}
