import { css } from '@firebolt-dev/css'
import { useEffect, useRef, useState } from 'react'
import { UserIcon, XIcon } from 'lucide-react'

import { usePane } from './usePane'
import { AvatarPreview } from '../AvatarPreview'

export function AvatarPane({ world, info }) {
  const paneRef = useRef()
  const headRef = useRef()
  const viewportRef = useRef()
  const previewRef = useRef()
  const [stats, setStats] = useState(null)
  usePane('avatar', paneRef, headRef)
  useEffect(() => {
    const viewport = viewportRef.current
    const preview = new AvatarPreview(world, viewport)
    previewRef.current = preview
    preview.load(info.file, info.url).then(stats => {
      console.log('stats', stats)
      setStats(stats)
    })
    return () => preview.destroy()
  }, [])
  return (
    <div
      ref={paneRef}
      className='vpane'
      css={css`
        position: absolute;
        top: 20px;
        left: 20px;
        width: 16rem;
        background-color: rgba(15, 16, 24, 0.8);
        pointer-events: auto;
        display: flex;
        flex-direction: column;
        font-size: 1rem;
        .vpane-head {
          height: 3.125rem;
          background: black;
          display: flex;
          align-items: center;
          padding: 0 0.4375rem 0 1.25rem;
          &-title {
            font-size: 1.2rem;
            font-weight: 500;
            flex: 1;
          }
          &-close {
            width: 2.5rem;
            height: 2.5rem;
            display: flex;
            align-items: center;
            justify-content: center;
            color: rgba(255, 255, 255, 0.5);
            &:hover {
              cursor: pointer;
              color: white;
            }
          }
        }
        .vpane-content {
          flex: 1;
        }
        .vpane-viewport {
          height: 300px;
          position: relative;
        }
        .vpane-actions {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          display: flex;
        }
        .vpane-action {
          flex-basis: 50%;
          height: 4.5rem;
          display: flex;
          align-items: center;
          justify-content: center;
          paint-order: stroke fill;
          -webkit-text-stroke: 0.25rem rgba(0, 0, 0, 0.2);
          &:hover {
            cursor: pointer;
            transform: scale(1.05);
          }
        }
      `}
    >
      <div className='vpane-head' ref={headRef}>
        <div className='vpane-head-title'>Avatar</div>
        <div className='vpane-head-close' onClick={() => world.emit('avatar', null)}>
          <XIcon size={20} />
        </div>
      </div>
      <div className='vpane-content noscrollbar'>
        <div className='vpane-viewport' ref={viewportRef}>
          <div className='vpane-actions'>
            <div className='vpane-action' onClick={info.onEquip}>
              <span>Equip</span>
            </div>
            <div className='vpane-action' onClick={info.onPlace}>
              <span>Place</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
