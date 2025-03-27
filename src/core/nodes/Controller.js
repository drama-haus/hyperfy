import * as THREE from '../extras/three'
import { isNumber, isBoolean, isString } from 'lodash-es'

import { DEG2RAD } from '../extras/general'

import { Node } from './Node'

const defaults = {
  radius: 0.4,
  height: 1,
  visible: false,
  tag: null,
}

export class Controller extends Node {
  constructor(data = {}) {
    super(data)
    this.name = 'controller'

    this.radius = data.radius
    this.height = data.height
    this.visible = data.visible
    this.tag = data.tag
  }

  mount() {
    this.needsRebuild = false
    if (this._visible) {
      const geometry = new THREE.CapsuleGeometry(this._radius, this._height, 2, 8)
      geometry.translate(0, this._height / 2 + this._radius, 0)
      geometry.computeBoundsTree()
      const material = new THREE.MeshStandardMaterial({ color: 'green' })
      this.mesh = new THREE.Mesh(geometry, material)
      this.mesh.receiveShadow = true
      this.mesh.castShadow = true
      this.mesh.matrixAutoUpdate = false
      this.mesh.matrixWorldAutoUpdate = false
      this.mesh.matrix.copy(this.matrix)
      this.mesh.matrixWorld.copy(this.matrixWorld)
      this.mesh.node = this
      this.ctx.world.graphics.scene.add(this.mesh)
    }
    const desc = new PHYSX.PxCapsuleControllerDesc()
    desc.height = this._height
    desc.radius = this._radius
    desc.climbingMode = PHYSX.PxCapsuleClimbingModeEnum.eCONSTRAINED
    desc.slopeLimit = Math.cos(60 * DEG2RAD) // 60 degrees
    desc.material = this.ctx.world.physics.defaultMaterial
    desc.contactOffset = 0.1 // PhysX default = 0.1
    desc.stepOffset = 0.5 // PhysX default = 0.5m
    this.controller = this.ctx.world.physics.controllerManager.createController(desc) // prettier-ignore
    PHYSX.destroy(desc)
    const worldPosition = this.getWorldPosition()
    this.controller.setFootPosition(worldPosition.toPxExtVec3())
    
    // Register controller with tag for physics queries
    const self = this
    this.controllerHandle = this.ctx.world.physics.registerController(this.controller, {
      node: this,
      get tag() {
        return self._tag
      },
      get playerId() {
        // const playerId = this.ctx.entity?.isPlayer ? this.ctx.entity.data.id : null
        return null
      }
    })
  }

  commit(didMove) {
    if (this.needsRebuild) {
      this.unmount()
      this.mount()
      return
    }
    if (didMove) {
      this.mesh?.matrix.copy(this.matrix)
      this.mesh?.matrixWorld.copy(this.matrixWorld)
    }
    // if (this.didMove) {
    //   console.log('character position change without move() ????')
    //   const worldPosition = this.getWorldPosition()
    //   this.controller.setFootPosition(worldPosition.toPxExtVec3())
    //   this.didMove = false
    // }
  }

  unmount() {
    if (this.mesh) {
      this.ctx.world.graphics.scene.remove(this.mesh)
    }
    if (this.controller) {
      this.ctx.world.physics.unregisterController(this.controllerHandle)
      this.controller.release()
      this.controller = null
      this.controllerHandle = null
    }
  }

  copy(source, recursive) {
    super.copy(source, recursive)
    this._radius = source._radius
    this._height = source._height
    this._visible = source._visible
    this._tag = source._tag
    return this
  }

  get radius() {
    return this._radius
  }

  set radius(value = defaults.radius) {
    if (!isNumber(value)) {
      throw new Error('[controller] radius not a number')
    }
    this._radius = value
    this.needsRebuild = true
    this.setDirty()
  }

  get height() {
    return this._height
  }

  set height(value = defaults.height) {
    if (!isNumber(value)) {
      throw new Error('[controller] height not a number')
    }
    this._height = value
    this.needsRebuild = true
    this.setDirty()
  }

  get visible() {
    return this._visible
  }

  set visible(value = defaults.visible) {
    if (!isBoolean(value)) {
      throw new Error('[collider] visible not a boolean')
    }
    this._visible = value
    this.needsRebuild = true
    this.setDirty()
  }

  get tag() {
    return this._tag
  }

  set tag(value = defaults.tag) {
    if (isNumber(value)) {
      value = value + ''
    }
    if (value !== null && !isString(value)) {
      throw new Error('[controller] tag not a string')
    }
    this._tag = value
    this.setDirty()
  }

  get isGrounded() {
    return this.moveFlags.isSet(PHYSX.PxControllerCollisionFlagEnum.eCOLLISION_DOWN)
  }

  get isCeiling() {
    return this.moveFlags.isSet(PHYSX.PxControllerCollisionFlagEnum.eCOLLISION_UP)
  }

  teleport(vec3) {
    if (!vec3?.isVector3) {
      throw new Error('[controller] teleport expected Vector3')
    }
    this.position.copy(vec3)
    this.controller.setFootPosition(vec3.toPxExtVec3())
  }

  move(vec3) {
    if (!vec3?.isVector3) {
      throw new Error('[controller] move expected Vector3')
    }
    this.moveFlags = this.controller.move(vec3.toPxVec3(), 0, 1 / 60, this.ctx.world.physics.controllerFilters)
    // this.isGrounded = moveFlags.isSet(PHYSX.PxControllerCollisionFlagEnum.eCOLLISION_DOWN) // prettier-ignore
    const pos = this.controller.getFootPosition()
    this.position.copy(pos)
    this.didMove = true
  }

  getProxy() {
    if (!this.proxy) {
      const self = this
      let proxy = {
        get radius() {
          return self.radius
        },
        set radius(value) {
          self.radius = value
        },
        get height() {
          return self.height
        },
        set height(value) {
          self.height = value
        },
        get visible() {
          return self.visible
        },
        set visible(value) {
          self.visible = value
        },
        get tag() {
          return self.tag
        },
        set tag(value) {
          self.tag = value
        },
        get isGrounded() {
          return self.isGrounded
        },
        get isCeiling() {
          return self.isCeiling
        },
        teleport(vec3) {
          return self.teleport(vec3)
        },
        move(vec3) {
          return self.move(vec3)
        },
      }
      proxy = Object.defineProperties(proxy, Object.getOwnPropertyDescriptors(super.getProxy())) // inherit Node properties
      this.proxy = proxy
    }
    return this.proxy
  }
}
