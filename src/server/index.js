import 'ses'
import '../core/lockdown'
import './bootstrap'

import fs from 'fs-extra'
import path from 'path'
import { pipeline } from 'stream/promises'
import Fastify from 'fastify'
import ws from '@fastify/websocket'
import cors from '@fastify/cors'
import compress from '@fastify/compress'
import statics from '@fastify/static'
import multipart from '@fastify/multipart'

import { loadPhysX } from './physx/loadPhysX'

import { createServerWorld } from '../core/createServerWorld'
import { hashFile } from '../core/utils-server'
import { getDB } from './db'
import { Storage } from './Storage'

// Import MCP dependencies
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { fastifyMCPSSE } from './tools/mcp-sse-plugin.js'
import { z } from 'zod'
import Database from 'better-sqlite3'
import { fileURLToPath } from 'url'

// Get current file's directory (ESM equivalent of __dirname)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const rootDir = path.join(__dirname, '../')
const worldDir = path.join(rootDir, process.env.WORLD)
const assetsDir = path.join(worldDir, '/assets')
const port = process.env.PORT

await fs.ensureDir(worldDir)
await fs.ensureDir(assetsDir)

// copy core assets
await fs.copy(path.join(rootDir, 'src/core/assets'), path.join(assetsDir))

const db = await getDB(path.join(worldDir, '/db.sqlite'))

const storage = new Storage(path.join(worldDir, '/storage.json'))
const world = createServerWorld()
world.init({ db, storage, loadPhysX })

const fastify = Fastify({ logger: { level: 'error' } })

fastify.register(cors)
fastify.register(compress)
fastify.register(statics, {
  root: path.join(__dirname, 'public'),
  prefix: '/',
  decorateReply: false,
  setHeaders: res => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')
  },
})
fastify.register(statics, {
  root: assetsDir,
  prefix: '/assets/',
  decorateReply: false,
  setHeaders: res => {
    // all assets are hashed & immutable so we can use aggressive caching
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable') // 1 year
    res.setHeader('Expires', new Date(Date.now() + 31536000000).toUTCString()) // older browsers
  },
})
fastify.register(multipart, {
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB
  },
})
fastify.register(ws)
fastify.register(worldNetwork)

const publicEnvs = {}
for (const key in process.env) {
  if (key.startsWith('PUBLIC_')) {
    const value = process.env[key]
    publicEnvs[key] = value
  }
}
const envsCode = `
  if (!globalThis.process) globalThis.process = {}
  globalThis.process.env = ${JSON.stringify(publicEnvs)}
`
fastify.get('/env.js', async (req, reply) => {
  reply.type('application/javascript').send(envsCode)
})

fastify.post('/api/upload', async (req, reply) => {
  // console.log('DEBUG: slow uploads')
  // await new Promise(resolve => setTimeout(resolve, 2000))
  const file = await req.file()
  const ext = file.filename.split('.').pop().toLowerCase()
  // create temp buffer to store contents
  const chunks = []
  for await (const chunk of file.file) {
    chunks.push(chunk)
  }
  const buffer = Buffer.concat(chunks)
  // hash from buffer
  const hash = await hashFile(buffer)
  const filename = `${hash}.${ext}`
  // save to fs
  const filePath = path.join(assetsDir, filename)
  const exists = await fs.exists(filePath)
  if (!exists) {
    await fs.writeFile(filePath, buffer)
  }
})

fastify.get('/api/upload-check', async (req, reply) => {
  const filename = req.query.filename
  const filePath = path.join(assetsDir, filename)
  const exists = await fs.exists(filePath)
  return { exists }
})

fastify.get('/health', async (request, reply) => {
  try {
    // Basic health check
    const health = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    }

    return reply.code(200).send(health)
  } catch (error) {
    console.error('Health check failed:', error)
    return reply.code(503).send({
      status: 'error',
      timestamp: new Date().toISOString(),
    })
  }
})

fastify.get('/status', async (request, reply) => {
  try {
    const status = {
      uptime: Math.round(world.time),
      protected: process.env.ADMIN_CODE !== undefined ? true : false,
      connectedUsers: [],
      commitHash: process.env.COMMIT_HASH,
    }
    for (const socket of world.network.sockets.values()) {
      status.connectedUsers.push({
        id: socket.player.data.userId,
        position: socket.player.position.current.toArray(),
        name: socket.player.data.name,
      })
    }

    return reply.code(200).send(status)
  } catch (error) {
    console.error('Status failed:', error)
    return reply.code(503).send({
      status: 'error',
      timestamp: new Date().toISOString(),
    })
  }
})

fastify.setErrorHandler((err, req, reply) => {
  console.error(err)
  reply.status(500).send()
})

async function worldNetwork(fastify) {
  fastify.get('/ws', { websocket: true }, (ws, req) => {
    world.network.onConnection(ws, req.query.authToken)
  })
}

// =====================================
// MCP Server Implementation Below
// =====================================

// Helper function to get the SQLite DB path (uses the same world dir as the main server)
const getDbPathForMCP = () => {
  // If environment variable is provided, use that
  if (process.env.SQLITE_DB_PATH) {
    console.log(`Using DB path from env: ${process.env.SQLITE_DB_PATH}`)
    return process.env.SQLITE_DB_PATH
  }

  // Otherwise use the same DB path as the main server
  const dbPath = path.join(worldDir, '/db.sqlite')
  console.log(`Resolved DB path: ${dbPath}`)
  return dbPath
}

// Create the MCP server instance
const mcpServer = new McpServer({
  name: 'hyperfy-mcp-server',
  version: '0.0.1',
})

// Register the world-query tool
mcpServer.tool(
  'world-query',
  {
    sql: z.string().describe('SQL query to execute against the world database'),
  },
  async ({ sql }) => {
    let db = null
    try {
      const dbPath = getDbPathForMCP()
      db = new Database(dbPath)

      // better-sqlite3 has a synchronous API, no need for promisify
      const results = db.prepare(sql).all()

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(results, null, 2),
          },
        ],
      }
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${err.message}`,
          },
        ],
        isError: true,
      }
    } finally {
      if (db) {
        db.close()
      }
    }
  }
)

/**
 * Updates an entity with a new script file
 * @param {Object} world - The world instance
 * @param {Object} entity - The entity to update
 * @param {String} scriptContent - The script file content
 * @returns {Promise<void>}
 */
async function updateEntityScript(world, entity, scriptContent) {
  try {
    // Create a buffer from the script content
    const buffer = Buffer.from(scriptContent)

    // Hash the buffer
    const hash = await hashFile(buffer)

    // Use hash as script filename
    const filename = `${hash}.js`

    // Canonical URL to this file
    const url = `asset://${filename}`

    // Save file to assets directory
    const filePath = path.join(assetsDir, filename)
    const exists = await fs.exists(filePath)
    if (!exists) {
      await fs.writeFile(filePath, buffer)
    }

    // Get the blueprint using blueprintId from entity.data
    const blueprintId = entity.data.blueprint
    const blueprint = world.blueprints.get(blueprintId)

    if (!blueprint) {
      throw new Error(`Blueprint not found for entity ${entity.data.id}`)
    }

    // Update blueprint version and script
    const version = blueprint.version + 1

    // Update blueprint locally (also rebuilds apps)
    world.blueprints.modify({
      id: blueprint.id,
      version,
      script: url,
    })

    // Mark the blueprint as dirty for saving
    world.network.dirtyBlueprints.add(blueprint.id)

    // Broadcast blueprint change to connected clients
    world.network.send('blueprintModified', {
      id: blueprint.id,
      version,
      script: url,
    })

    return true
  } catch (err) {
    console.error('Error in updateEntityScript:', err)
    throw err
  }
}

if (process.env.MCP_SERVER === 'true') {
  // Register the update-entity-script tool
  mcpServer.tool(
    'update-entity-script',
    {
      entityId: z.string().describe('ID of the entity to update'),
      scriptContent: z.string().describe('New script content to apply to the entity'),
    },
    async ({ entityId, scriptContent }) => {
      try {
        // Find the entity by ID
        const entity = world.entities.get(entityId)

        if (!entity) {
          return {
            content: [
              {
                type: 'text',
                text: `Error: Entity with ID ${entityId} not found`,
              },
            ],
            isError: true,
          }
        }

        // Use the updateEntityScript function to update the entity
        await updateEntityScript(world, entity, scriptContent)

        return {
          content: [
            {
              type: 'text',
              text: `Successfully updated script for entity ${entityId}`,
            },
          ],
        }
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${err.message}`,
            },
          ],
          isError: true,
        }
      }
    }
  )

  // Register the MCP SSE plugin on the same Fastify instance
  fastify.register(fastifyMCPSSE, {
    server: mcpServer.server,
  })
}

// Start the server
try {
  await fastify.listen({ port, host: '0.0.0.0' })
} catch (err) {
  console.error(err)
  console.error(`failed to launch on port ${port}`)
  process.exit(1)
}

console.log(`running on port ${port}`)

// Graceful shutdown
process.on('SIGINT', async () => {
  await fastify.close()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  await fastify.close()
  process.exit(0)
})
