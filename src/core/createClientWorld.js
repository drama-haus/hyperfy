import { World } from './World'

import { Client } from './systems/Client'
import { ClientLiveKit } from './systems/ClientLiveKit'
import { ClientPointer } from './systems/ClientPointer'
import { ClientPrefs } from './systems/ClientPrefs'
import { ClientControls } from './systems/ClientControls'
import { ClientNetwork } from './systems/ClientNetwork'
import { ClientLoader } from './systems/ClientLoader'
import { ClientGraphics } from './systems/ClientGraphics'
import { ClientEnvironment } from './systems/ClientEnvironment'
import { ClientAudio } from './systems/ClientAudio'
import { ClientStats } from './systems/ClientStats'
import { ClientBuilder } from './systems/ClientBuilder'
import { ClientActions } from './systems/ClientActions'
import { ClientTarget } from './systems/ClientTarget'
import { ClientUI } from './systems/ClientUI'
import { LODs } from './systems/LODs'
import { Nametags } from './systems/Nametags'
import { Particles } from './systems/Particles'
import { Snaps } from './systems/Snaps'
import { Wind } from './systems/Wind'
import { XR } from './systems/XR'

/**
 * Dynamically imports and registers client-side mod systems.
 * Uses the generated mods manifest to know which modules to load.
 * 
 * @param {ReturnType<typeof createClientWorld>} world - the world instance
 * @returns {Promise<void>}
 */
export async function loadClientMods(world) {
  try {
    // In the browser, we'll use a manifest file generated at build time
    // that contains the paths to all client mods
    const manifestResponse = await fetch('/mods-manifest.json');
    if (!manifestResponse.ok) {
      console.warn('Client mods manifest not found, skipping mod loading');
      return;
    }
    
    const manifest = await manifestResponse.json();
    
    // Load each mod in parallel
    await Promise.all(
      manifest.mods.map(async (modPath) => {
        try {
          // Use dynamic import to load the module
          const { default: system } = await import(modPath);
          if (typeof system === 'function') {
            console.log('Registering client mod', system.name);
            world.register(system.name, system);
            console.log(`✔ Loaded client mod ${modPath}`);
          } else {
            console.warn(`⚠ ${modPath} has no default function export`);
          }
        } catch (err) {
          console.error(`✖ Failed to load client mod ${modPath}:`, err);
        }
      })
    );
  } catch (err) {
    console.error('Error loading client mods:', err);
  }
}

export function createClientWorld() {
  const world = new World()
  world.register('client', Client)
  world.register('livekit', ClientLiveKit)
  world.register('pointer', ClientPointer)
  world.register('prefs', ClientPrefs)
  world.register('controls', ClientControls)
  world.register('network', ClientNetwork)
  world.register('loader', ClientLoader)
  world.register('graphics', ClientGraphics)
  world.register('environment', ClientEnvironment)
  world.register('audio', ClientAudio)
  world.register('stats', ClientStats)
  world.register('builder', ClientBuilder)
  world.register('actions', ClientActions)
  world.register('target', ClientTarget)
  world.register('ui', ClientUI)
  world.register('lods', LODs)
  world.register('nametags', Nametags)
  world.register('particles', Particles)
  world.register('snaps', Snaps)
  world.register('wind', Wind)
  world.register('xr', XR)
  return world
}
