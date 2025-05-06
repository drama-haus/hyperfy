import { ModComponents } from '../../../mods/.gen/ModComponents'

export function ModsComponents({ world }) {
  // Render all mod components, passing world prop to each
  return (
    <>
      {Object.entries(ModComponents).map(([name, Component]) => (
        <Component key={name} world={world} />
      ))}
    </>
  )
} 