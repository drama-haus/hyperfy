# Hyperfy Modding API Reference

This document provides a detailed reference of the APIs available to Hyperfy mods.

## World Object

The `world` object is passed to all mods and provides access to all Hyperfy systems.

### Core Methods

```js
// Event system
world.on(eventName, callback)      // Subscribe to an event
world.off(eventName, callback)     // Unsubscribe from an event
world.once(eventName, callback)    // Subscribe to an event once
world.emit(eventName, ...args)     // Emit an event

// Logging
world.log(message)                 // Log a message to the console
world.warn(message)                // Log a warning to the console
world.error(message)               // Log an error to the console
```

### Entities

The `entities` system manages all entities in the world.

```js
// Get entities
world.entities.get(id)             // Get entity by ID
world.entities.find(predicate)     // Find entity by predicate
world.entities.findByType(type)    // Find entities by type
world.entities.player              // Get the local player entity

// Create and modify entities
world.entities.add(data, local)    // Add a new entity
world.entities.modify(id, data)    // Modify an entity
world.entities.destroy(id, local)  // Destroy an entity

// Events
world.entities.on('add', callback)    // Entity added
world.entities.on('modify', callback) // Entity modified
world.entities.on('destroy', callback) // Entity destroyed
```

### UI

The `ui` system manages the user interface.

```js
// Sidebar panes
world.ui.togglePane(paneId)        // Toggle a sidebar pane
world.ui.setApp(app)               // Set the active app

// Notifications
world.ui.toast(message)            // Show a temporary toast message

// State
world.ui.state                     // Current UI state
```

### Network

The `network` system handles multiplayer networking.

```js
// Properties
world.network.id                  // Local client ID
world.network.isHost              // Whether local client is host

// Methods
world.network.send(event, data)   // Send data to all clients
world.network.sendTo(id, event, data) // Send data to specific client
world.network.upload(file)        // Upload a file to the server

// Events
world.network.on('connect', callback)    // Client connected
world.network.on('disconnect', callback) // Client disconnected
world.network.on(eventName, callback)    // Custom network events
```

### Chat

The `chat` system manages in-game chat.

```js
// Methods
world.chat.send(message)          // Send a chat message
world.chat.command(command)       // Execute a chat command
world.chat.registerCommand(name, callback) // Register a command
world.chat.add(data, local)       // Add a chat message

// Events
world.chat.on('message', callback) // Chat message received
```

### Controls

The `controls` system handles user input.

```js
// Binding controls
const control = world.controls.bind({ priority })
control.release()                 // Release control binding

// Input state
control.mouseLeft.down            // Left mouse button down
control.mouseRight.pressed        // Right mouse button pressed this frame
control.keyW.down                 // W key down

// Pointer
control.pointer.locked            // Whether pointer is locked
control.pointer.lock()            // Lock the pointer
control.pointer.unlock()          // Unlock the pointer

// Set touch input (mobile)
world.controls.setTouchBtn(btn, state) // Set state of touch button
```

### Builder

The `builder` system provides world-building capabilities.

```js
// Properties
world.builder.enabled            // Whether builder mode is enabled

// Methods
world.builder.toggle(state)      // Toggle builder mode
world.builder.select(entity)     // Select an entity
world.builder.getSpawnTransform() // Get transform for new entity
```

### Preferences

The `prefs` system manages user preferences.

```js
// Get preferences
world.prefs.dpr                  // Display resolution
world.prefs.shadows              // Shadow quality
world.prefs.music                // Music volume

// Set preferences
world.prefs.setDPR(value)        // Set display resolution
world.prefs.setShadows(value)    // Set shadow quality
world.prefs.setMusic(value)      // Set music volume

// Events
world.prefs.on('change', callback) // Preferences changed
```

### Loader

The `loader` system handles asset loading.

```js
// Loading assets
world.loader.loadFile(url)        // Load a file
world.loader.insert(type, url, file) // Insert a file into cache
world.loader.getFile(url)         // Get a cached file

// Asset URLs
world.resolveURL(url)             // Resolve asset URL
```

### Settings

The `settings` system manages world settings.

```js
// Get settings
world.settings.title              // World title
world.settings.desc               // World description

// Set settings
world.settings.set(key, value, local) // Set a setting

// Events
world.settings.on('change', callback) // Settings changed
```

## React Components

Hyperfy provides several React components that you can use in your mods.

### Core UI Components

```jsx
import { Section, Btn, Content, Pane, Hint, Group } from '../../../client/components/Sidebar'
```

#### Sidebar Components

- `Section` - A container for sidebar buttons
- `Btn` - A sidebar button
- `Content` - A content container for sidebars
- `Pane` - A sidebar pane
- `Hint` - A hint tooltip component
- `Group` - A divider with optional label

### Form Fields

```jsx
import { 
  FieldText, 
  FieldTextarea,
  FieldNumber,
  FieldRange,
  FieldSwitch,
  FieldToggle,
  FieldFile,
  FieldBtn
} from '../../../client/components/Fields'
```

#### Field Components

- `FieldText` - Text input field
- `FieldTextarea` - Multi-line text input
- `FieldNumber` - Numeric input
- `FieldRange` - Slider input
- `FieldSwitch` - Option selector
- `FieldToggle` - Boolean toggle
- `FieldFile` - File selector
- `FieldBtn` - Action button

## Environment Variables

The following environment variables are available in your mods:

```js
process.env.NODE_ENV     // 'development' or 'production'
process.env.CLIENT       // 'true' when running on the client, 'false' otherwise
process.env.SERVER       // 'true' when running on the server, 'false' otherwise
process.env.SHARED       // 'true' for shared mods
```

## Common Patterns

### Initialization and Cleanup

```js
// In a mod
export function init(world) {
  // Set up event listeners, state, etc.
  const handleEvent = (data) => {
    // Handle event
  }
  
  world.on('custom-event', handleEvent)
  
  // Return cleanup function
  return () => {
    world.off('custom-event', handleEvent)
    // Clean up any other resources
  }
}
```

### Entity Templates

```js
// Create an entity from a template
function createItem(world, position, type) {
  return world.entities.add({
    type: 'item',
    itemType: type,
    position,
    model: `asset://models/items/${type}.glb`,
    interactive: true,
    state: {
      collected: false
    }
  })
}

// Usage
const itemId = createItem(world, [0, 1, 0], 'coin')
```

### Custom UI Components

```jsx
import { css } from '@firebolt-dev/css'

function CustomComponent({ world }) {
  return (
    <div
      css={css`
        background: rgba(11, 10, 21, 0.85);
        border: 0.0625rem solid #2a2b39;
        backdrop-filter: blur(5px);
        border-radius: 1rem;
        padding: 1rem;
      `}
    >
      Custom component content
    </div>
  )
}
```

## Debugging Tips

- Use `console.log()` for simple debugging
- Set breakpoints in browser dev tools
- Check the browser console for errors
- Monitor network traffic for server communication issues
- Use `world.log()`, `world.warn()`, and `world.error()` for consistent logging

## Advanced Topics

### Custom Entity Components

```js
// Define a custom component
world.entities.defineComponent('health', {
  schema: {
    current: 'number',
    max: 'number'
  },
  init(data) {
    return {
      current: data.current || data.max || 100,
      max: data.max || 100
    }
  }
})

// Use the component
const entityId = world.entities.add({
  type: 'enemy',
  position: [0, 0, 0],
  health: {
    max: 200
  }
})

// Access component data
const entity = world.entities.get(entityId)
const health = entity.health.current
```

### Custom Systems

```js
// Create a system that runs every frame
world.systems.add({
  name: 'health-regen',
  priority: 50, // Higher numbers run later
  tick(dt) {
    // Loop through entities with health component
    for (const [id, entity] of world.entities.items) {
      if (entity.health) {
        entity.health.current = Math.min(
          entity.health.current + dt * 5,
          entity.health.max
        )
      }
    }
  }
})
```

### Multiplayer Synchronization

```js
// Server-side: Handle player input
world.network.on('player-move', (clientId, data) => {
  const player = world.entities.findByClientId(clientId)
  if (player) {
    player.modify({
      position: data.position,
      rotation: data.rotation
    })
    // Broadcast to all other clients
    world.network.broadcast('player-moved', {
      id: player.id,
      position: data.position,
      rotation: data.rotation
    }, [clientId]) // Exclude the sender
  }
})

// Client-side: Send player input
function sendPlayerPosition() {
  world.network.send('player-move', {
    position: world.entities.player.position.toArray(),
    rotation: world.entities.player.rotation.toArray()
  })
}
``` 