import { World } from './World'

import { Server } from './systems/Server'
import { ServerLiveKit } from './systems/ServerLiveKit'
import { ServerNetwork } from './systems/ServerNetwork'
import { ServerLoader } from './systems/ServerLoader'
import { ServerEnvironment } from './systems/ServerEnvironment'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

/**
 * Dynamically imports and registers server-side mod systems.
 * Uses the generated mods manifest to know which modules to load.
 *
 * @param {ReturnType<typeof createServerWorld>} world – the world instance
 * @returns {Promise<void>}
 */
export async function loadServerMods(world) {
  try {
    // Get current file's directory
    const currentDir = dirname(fileURLToPath(import.meta.url))
    
    // Possible locations for the mods manifest
    const possibleManifestPaths = [
      join(currentDir, 'server-mods-manifest.json'), // Next to current file (in build dir)
      join(process.cwd(), 'build', 'server-mods-manifest.json'), // From project root
    ]
    
    let manifestPath = null
    for (const path of possibleManifestPaths) {
      if (existsSync(path)) {
        manifestPath = path
        console.log(`Found server mods manifest at ${manifestPath}`)
        break
      }
    }
    
    if (!manifestPath) {
      console.warn('Server mods manifest not found, skipping mod loading')
      return
    }
    
    // Load the manifest
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    
    // Load each mod in parallel
    await Promise.all(
      manifest.mods.map(async (modPath) => {
        try {
          // Use dynamic import to load the module
          const { default: system } = await import(modPath)
          if (typeof system === 'function') {
            console.log('Registering server mod', system.name)
            world.register(system.name, system)
            console.log(`✔ Loaded server mod ${modPath}`)
          } else {
            console.warn(`⚠ ${modPath} has no default function export`)
          }
        } catch (err) {
          console.error(`✖ Failed to load server mod ${modPath}:`, err)
        }
      })
    )
  } catch (err) {
    console.error('Error loading server mods:', err)
  }
}

export async function createServerWorld() {
  const world = new World()
  world.register('server', Server)
  world.register('livekit', ServerLiveKit)
  world.register('network', ServerNetwork)
  world.register('loader', ServerLoader)
  world.register('environment', ServerEnvironment)
  await loadServerMods(world)
  return world
}
