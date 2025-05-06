# Hyperfy Modding System

This directory contains the modding system for Hyperfy. Mods allow you to extend and customize the Hyperfy engine with new features and functionality without modifying the core codebase.

## Directory Structure

```
src/mods/
├── .gen/        # Auto-generated files (do not edit manually)
├── client/           # Client-side mods
│   ├── components/   # React components to be rendered in the UI
│   └── sidebar/      # Sidebar buttons and panes
├── core/             # Core mods (loaded by both client and server)
│   ├── client/       # Client-specific core mod code
│   ├── server/       # Server-specific core mod code
│   └── shared/       # Shared code between client and server
└── server/           # Server-only mods
```

## Mod Types

Hyperfy supports several types of mods:

1. **Client Components** - React components rendered in the UI
2. **Sidebar Extensions** - Custom buttons and panes in the sidebar
3. **Core System Mods** - Extend both client and server functionality
4. **Server-only Mods** - Add server-side functionality

## Creating Mods

### Client Components

Client components are React components that will be automatically injected into the UI. Place your component files in `src/mods/client/`.

Example:
```jsx
// src/mods/client/ExampleComponent.js
export default function ExampleComponent({ world }) {
  return (
    <div>
      <h1>Example Component</h1>
      <button onClick={() => world.chat.send('Hello from mod!')}>
        Send Message
      </button>
    </div>
  )
}
```

These components will be automatically discovered, bundled with the client, and rendered in the UI.

### Sidebar Extensions

Sidebar extensions allow you to add custom buttons and panes to the sidebar. Create a file in `src/mods/client/sidebar/` that exports two components:

1. A button component named `[Name]Button`
2. A pane component named `[Name]Pane`

Example:
```jsx
// src/mods/client/sidebar/MyTool.js
import { ToolIcon } from 'lucide-react'
import { Pane, Group } from '../../../client/components/Sidebar'

export function MyToolButton() {
  return <ToolIcon size='1.25rem' />
}

export function MyToolPane({ world, hidden }) {
  return (
    <Pane hidden={hidden}>
      <div>
        <h1>My Custom Tool</h1>
        <Group label="Actions" />
        <button onClick={() => console.log('Tool action')}>
          Do Something
        </button>
      </div>
    </Pane>
  )
}
```

See the [sidebar README](./client/sidebar/README.md) for more details.

### Core Mods

Core mods consist of client, server, and shared code. These are useful for adding functionality that needs to run on both client and server.

Structure:
```
src/mods/core/
├── client/     # Client-side code
├── server/     # Server-side code
└── shared/     # Code shared between client and server
```

Example client mod:
```js
// src/mods/core/client/physics-enhancer.js
export function init(world) {
  world.on('physics-tick', () => {
    // Custom physics handling
  })
  
  // Return cleanup function
  return () => {
    world.off('physics-tick')
  }
}
```

Example server mod:
```js
// src/mods/core/server/custom-commands.js
export function init(world) {
  world.chat.registerCommand('ping', (player) => {
    world.chat.send(player, 'Pong!')
  })
  
  return () => {
    // Cleanup if needed
  }
}
```

Shared code:
```js
// src/mods/core/shared/constants.js
export const GRAVITY = 9.8
export const JUMP_FORCE = 5
```

### Server-only Mods

Server-only mods add functionality that runs exclusively on the server.

```js
// src/mods/server/admin-tools.js
export function init(world) {
  world.on('player-join', (player) => {
    // Check if player is admin
    if (player.hasRole('admin')) {
      // Grant special abilities
    }
  })
}
```

## Working with the World Object

The `world` object is your interface to the Hyperfy engine. It provides access to various systems, entities, and utilities:

- `world.entities` - Access and manipulate entities in the world
- `world.network` - Network and multiplayer functionality
- `world.chat` - Chat system for sending messages and commands
- `world.ui` - UI system for interfacing with the user interface
- `world.prefs` - User preferences
- `world.controls` - Input controls
- `world.loader` - Asset loading utilities
- `world.on/off` - Event system for subscribing to world events

Example usage:
```js
// Create an entity
const entityId = world.entities.add({
  type: 'model',
  position: [0, 1, 0],
  model: 'asset://models/cube.glb'
})

// Listen for chat messages
world.chat.on('message', (message) => {
  if (message.body === '!help') {
    world.chat.send('Available commands: !help, !spawn')
  }
})

// Toggle UI pane
world.ui.togglePane('my-custom-pane')
```

## Build System

The Hyperfy build system automatically handles the discovery and integration of mods. When you add or modify mods, the build system will:

1. Scan the mods directories
2. Generate integration modules in the `.g` directory
3. Bundle client components and mods with the client
4. Load server and core mods when the server starts

## Best Practices

1. **Keep mods focused** - Each mod should focus on a specific feature or functionality.
2. **Clean up after yourself** - Always return cleanup functions from event subscriptions.
3. **Follow naming conventions** - Use clear, descriptive names for your mod files and functions.
4. **Respect the existing style** - Match the code style and patterns used in the core codebase.
5. **Error handling** - Add proper error handling to prevent mods from crashing the application.
6. **Performance** - Be mindful of performance, especially for mods that run on every frame.
7. **Use existing components** - Leverage existing UI components for a consistent look and feel.

## Advanced Usage

### Communicating Between Mods

Mods can communicate using the world events system:

```js
// In one mod
world.on('custom-event', (data) => {
  console.log('Received data:', data)
})

// In another mod
world.emit('custom-event', { message: 'Hello from mod A!' })
```

### Accessing Other Mods

You can also import and use code from other mods:

```js
// In src/mods/client/sidebar/UsesSharedLib.js
import { calculatePosition } from '../../core/shared/math-utils'

export function UsesSharedLibButton() {
  // Use the imported function
  const position = calculatePosition(x, y, z)
  // ...
}
```

## Debugging Mods

To debug mods:

1. Enable development mode with `npm run dev`
2. Check the console for errors and logs
3. Use `console.log()` and breakpoints for debugging
4. Inspect the generated files in `.g` to understand how mods are processed

## Examples

See the [example mods](./examples/) for more detailed examples of different mod types.

## API Reference

For a complete API reference, see the [API documentation](./API.md). 