import 'ses'
import '../core/lockdown'
import * as THREE from 'three'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { css } from '@firebolt-dev/css'

import { createClientWorld } from '../core/createClientWorld'
import { loadPhysX } from './loadPhysX'
import { CoreUI } from './components/CoreUI'
import { Providers } from './components/Providers'
import * as evmActions from 'wagmi/actions'
import { useConfig, useAccount } from 'wagmi'
import * as utils from 'viem/utils'

function App() {
  const viewportRef = useRef()
  const uiRef = useRef()
  const world = useMemo(() => createClientWorld(), [])
  const { address } = useAccount()
  useEffect(() => {
    const viewport = viewportRef.current
    const ui = uiRef.current
    const wsUrl = process.env.PUBLIC_WS_URL
    const baseEnvironment = {
      model: '/base-environment.glb',
      bg: '/day2-2k.jpg',
      hdr: '/day2.hdr',
      sunDirection: new THREE.Vector3(-1, -2, -2).normalize(),
      sunIntensity: 1,
      sunColor: 0xffffff,
      fogNear: null,
      fogFar: null,
      fogColor: null,
    }
    world.init({ viewport, ui, wsUrl, loadPhysX, baseEnvironment })
  }, [])

  const config = useConfig()
  const [initialized, setInitialized] = useState(false)
  useEffect(() => {
    if (initialized) return
    setInitialized(true)

    let evm = { actions: {}, utils }
    for (const [action, fn] of Object.entries(evmActions)) {
      evm.actions[action] = (...args) => fn(config, ...args)
    }

    world.evm = evm
  }, [config])

  useEffect(() => {
    const handlePlayer = player => {
      world.entities.player.modify({ evm: address })
      world.off('player', handlePlayer)
    }
    world.on('player', handlePlayer)

    return () => {
      world.off(handlePlayer)
    }
  }, [])

  return (
    <div
      className='App'
      css={css`
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 100vh;
        height: 100dvh;
        .App__viewport {
          position: absolute;
          inset: 0;
        }
        .App__ui {
          position: absolute;
          inset: 0;
          pointer-events: none;
          user-select: none;
        }
      `}
    >
      <div className='App__viewport' ref={viewportRef}>
        <div className='App__ui' ref={uiRef}>
          <CoreUI world={world} />
        </div>
      </div>
    </div>
  )
}

const root = createRoot(document.getElementById('root'))
root.render(
  <Providers>
    <App />
  </Providers>
)
