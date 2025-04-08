// import 'ses'
// import '../core/lockdown'
import * as THREE from 'three'
import { useEffect, useMemo, useRef, useState } from 'react'
import { css } from '@firebolt-dev/css'

import { createClientWorld } from '../core/createClientWorld'
import { loadPhysX } from './loadPhysX'
import { CoreUI } from './components/CoreUI'

export { System } from '../core/systems/System'

import * as evmActions from 'wagmi/actions'
import { useConfig, useAccount } from 'wagmi'
import * as utils from 'viem/utils'
import { erc20Abi } from 'viem'

export function Client({ wsUrl, onSetup }) {
  const viewportRef = useRef()
  const uiRef = useRef()
  const world = useMemo(() => createClientWorld(), [])
  useEffect(() => {
    const init = async () => {
      const viewport = viewportRef.current
      const ui = uiRef.current
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
      if (typeof wsUrl === 'function') {
        wsUrl = wsUrl()
        if (wsUrl instanceof Promise) wsUrl = await wsUrl
      }
      const config = { viewport, ui, wsUrl, loadPhysX, baseEnvironment }
      onSetup?.(world, config)
      world.init(config)
    }
    init()
  }, [])

  const config = useConfig()
  const { address } = useAccount()
  const [initialized, setInitialized] = useState(false)
  useEffect(() => {
    if (initialized) return
    setInitialized(true)

    let evm = { actions: {}, utils }
    for (const [action, fn] of Object.entries(evmActions)) {
      evm.actions[action] = (...args) => fn(config, ...args)
    }
    evm.abis = {
      erc20: erc20Abi,
      erc721: null,
    }

    world.evm = evm
  }, [config])

  useEffect(() => {
    const handlePlayer = player => {
      // console.log({ player, address })
      world.entities.player.modify({ evm: address })
      world.off('player', handlePlayer)
    }
    world.on('player', handlePlayer)

    if (!world.entities?.player) return
    world.entities.player.modify({ evm: address })

    return () => {
      world.off(handlePlayer)
    }
  }, [address, world.entities?.player])

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
