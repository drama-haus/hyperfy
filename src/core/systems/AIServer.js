import { System } from './System'

import Database from 'better-sqlite3'
import fs from 'fs-extra'
import path from 'path'

import { z } from 'zod'
import { hashFile } from '../utils-server'
import { uuid } from '../utils'
import { AnthropicProvider } from '../../server/providers/AnthropicProvider.js'
import { OpenAIProvider } from '../../server/providers/OpenAIProvider.js'
import { OpenRouterProvider } from '../../server/providers/OpenRouterProvider.js'

// Server configuration
const DEBUG = false

// Helper function for conditional logging
const debugLog = (message, ...args) => {
  if (DEBUG) {
    console.log(message, ...args)
  }
}

export class AIServer extends System {
  constructor(world) {
    super(world)
    this.mcp = null
    this.appTools = new Map()
    this.activeStreams = new Map() // Track active streams by player ID
  }

  async init({ mcp, llmClient }) {
    try {
      // Use the mcp server instance if provided
      if (mcp) {
        debugLog('[MCP] Using provided MCP server')
        this.mcp = mcp
        this.llmClient = llmClient

        // Initialize and register providers only if llmClient is present
        if (this.llmClient && this.llmClient.registerProvider) {
          const availableProviders = [];
          const defaultModels = {
            anthropic: 'claude-3-sonnet-20240229',
            openai: 'gpt-4-turbo',
            openrouter: 'openai/gpt-4o'
          };

          // Only register Anthropic if API key is available
          if (process.env.ANTHROPIC_API_KEY) {
            const anthropicProvider = new AnthropicProvider({
              apiKey: process.env.ANTHROPIC_API_KEY,
            });
            this.llmClient.registerProvider('anthropic', anthropicProvider);
            availableProviders.push({
              id: 'anthropic',
              label: 'Anthropic',
              defaultModel: defaultModels.anthropic,
              availableModels: [
                'claude-3-opus-20240229',
                'claude-3-sonnet-20240229',
                'claude-3-haiku-20240307',
                'claude-2.1',
                'claude-2.0',
                'claude-instant-1.2'
              ]
            });
            debugLog('[AIServer] Registered Anthropic provider');
          }

          // Only register OpenAI if API key is available
          if (process.env.OPENAI_API_KEY) {
            const openaiProvider = new OpenAIProvider({
              apiKey: process.env.OPENAI_API_KEY,
            });
            this.llmClient.registerProvider('openai', openaiProvider);
            availableProviders.push({
              id: 'openai',
              label: 'OpenAI',
              defaultModel: defaultModels.openai,
              availableModels: [
                'gpt-4-turbo',
                'gpt-4-0125-preview',
                'gpt-4-1106-preview',
                'gpt-4',
                'gpt-3.5-turbo',
                'gpt-3.5-turbo-1106'
              ]
            });
            debugLog('[AIServer] Registered OpenAI provider');
          }

          // Only register OpenRouter if API key is available
          if (process.env.OPENROUTER_API_KEY) {
            const openRouterProvider = new OpenRouterProvider({
              apiKey: process.env.OPENROUTER_API_KEY,
              siteUrl: 'https://hyperfy.io',
              siteName: 'Hyperfy'
            });
            this.llmClient.registerProvider('openrouter', openRouterProvider);
            availableProviders.push({
              id: 'openrouter',
              label: 'OpenRouter',
              defaultModel: defaultModels.openrouter,
              availableModels: [
                'openai/gpt-4o',
                'openai/gpt-4-turbo',
                'openai/gpt-4',
                'anthropic/claude-3-opus',
                'anthropic/claude-3-sonnet',
                'anthropic/claude-3-haiku',
                'meta-llama/llama-3-70b-instruct',
                'meta-llama/llama-3-8b-instruct',
                'google/gemini-pro'
              ]
            });
            debugLog('[AIServer] Registered OpenRouter provider');
          }

          // Update settings with available providers
          this.world.settings.set('llmProviders', availableProviders, true);

          if (availableProviders.length > 0) {
            // Use the provider from settings if set and available, otherwise use first available
            const settingsProvider = this.world.settings.llmProvider;
            const initialProvider = availableProviders.find(p => p.id === settingsProvider)
              ? settingsProvider 
              : availableProviders[0].id;
            
            this.llmClient.selectProvider(initialProvider);
            debugLog(`[AIServer] Using ${initialProvider} as initial provider`);

            // Set the initial model if not already set
            const currentModel = this.world.settings.llmModel;
            const selectedProvider = availableProviders.find(p => p.id === initialProvider);
            
            if (!currentModel && selectedProvider) {
              this.world.settings.set('llmModel', selectedProvider.defaultModel, true);
              debugLog(`[AIServer] Set initial model to ${selectedProvider.defaultModel}`);
            }

            // Update settings to reflect available provider if current one isn't available
            if (settingsProvider !== initialProvider) {
              this.world.settings.set('llmProvider', initialProvider, true);
              
              // Also update the model to match the new provider
              this.world.settings.set('llmModel', selectedProvider.defaultModel, true);
            }

            // this.world.network.saveSettings();
            
            // Listen for provider changes in settings
            this.world.settings.on('change', changes => {
              if (changes.llmProvider && changes.llmProvider.value) {
                const newProvider = changes.llmProvider.value;
                if (availableProviders.some(p => p.id === newProvider)) {
                  try {
                    this.llmClient.selectProvider(newProvider);
                    debugLog(`[AIServer] Switched LLM provider to ${newProvider}`);
                    
                    // When provider changes, check if we need to update the model
                    const newProviderInfo = availableProviders.find(p => p.id === newProvider);
                    if (newProviderInfo) {
                      // Set the model to the default for this provider if the current model
                      // is not in the list of available models for this provider
                      const currentModel = this.world.settings.llmModel;
                      if (!currentModel || !newProviderInfo.availableModels.includes(currentModel)) {
                        this.world.settings.set('llmModel', newProviderInfo.defaultModel, true);
                        debugLog(`[AIServer] Updated model to ${newProviderInfo.defaultModel} for new provider`);
                      }
                    }
                  } catch (e) {
                    console.warn(`[AIServer] Failed to switch to LLM provider: ${newProvider}`, e);
                  }
                } else {
                  console.warn(`[AIServer] Tried to switch to unavailable LLM provider: ${newProvider}`);
                  // Revert to an available provider
                  this.world.settings.set('llmProvider', initialProvider, true);
                }
              }
              
              // Listen for model changes to update the provider config
              if (changes.llmModel && changes.llmModel.value) {
                const model = changes.llmModel.value;
                const provider = this.world.settings.llmProvider;
                if (provider && model) {
                  try {
                    // Apply model setting to the provider here if needed
                    // This will depend on how your LLM client implements model selection
                    debugLog(`[AIServer] Updated LLM model to ${model} for provider ${provider}`);
                  } catch (e) {
                    console.warn(`[AIServer] Failed to update model: ${e.message}`);
                  }
                }
              }
            });
          } else {
            console.warn('[AIServer] No LLM providers available - missing API keys');
            // Clear any existing provider settings since none are available
            this.world.settings.set('llmProvider', null, true);
            this.world.settings.set('llmProviders', [], true);
            this.world.settings.set('llmModel', null, true);
            // this.world.network.saveSettings();
          }
        }
      } else {
        debugLog('[MCP] No MCP server provided')
      }

      // Register a demo greeting tool if we have a server
      if (this.mcp) {

        registerBuilderTools(this.world, this.mcp)

        debugLog('[MCP] Server initialized successfully')

        if (this.llmClient) {
          this.llmClient.connectToServer(`http://localhost:${process.env.PORT}/sse`)
        }
      }
    } catch (err) {
      console.error('[MCP] Failed to initialize server:', err)
    }

    // Inject the registerMCPTool method and prompt function into the app runtime
    this.world.inject({
      app: {
        registerTool: (entity, toolName, schema, handler) => {
          return this.registerAppMCPTool(toolName, schema, handler, entity.data.id)
        },
        prompt: async (entity, { query, userId }) => {
          // Check scripting rules (optional, can be expanded)
          if (!query) throw new Error('Missing query for prompt')
          if (!this.llmClient) throw new Error('No LLM client available')
          // Optionally, fetch scripting rules here if needed
          // Use the current provider
          const providerKey = this.world.settings.llmProvider || 'openai';
          const model = this.world.settings.llmModel;
          
          try {
            this.llmClient.selectProvider(providerKey);
            debugLog(`[AIServer] App prompt using provider '${providerKey}'${model ? ` and model '${model}'` : ''}`);
          } catch (e) {
            throw new Error(`Unknown LLM provider: ${providerKey}`)
          }
          // Start a fresh prompt loop and return the full result
          return await this.llmClient.processQueryStream(query, userId, undefined, entity.data.id) // ,providerKey, model
        }
      },
      get tools() {
        return this.mcp._registeredTools
      }
    })

    this.world.network.onAiProcessQuery = this.onAiProcessQuery.bind(this)
    this.world.network.onAiCancelStream = this.onAiCancelStream.bind(this)
  }

  /**
   * Handle a query processing request from the client
   * @param {Object} data - The query data
   * @returns {Object} - Success status
   */
  async onAiProcessQuery(socket, data) {
    try {
      if (!data.query) {
        console.error('[AIServer] Missing query in request:', data)
        return { success: false, error: 'Missing query parameter' }
      }

      // Get the player entity from socket
      const player = socket.player
      if (!player) {
        console.error(`[AIServer] No player found for socket`)
        return { success: false, error: 'Player not found' }
      }
      
      // Check if player has permission
      if (!this.world.network.isAdmin(player) && !this.world.settings.public) {
        console.error(`[AIServer] Player ${player.data.id} not authorized`)
        
        // Send error event directly to this player
        this.world.network.sendTo(socket.id, 'llmEvent', {
          type: 'error',
          data: {
            error: 'Unauthorized: You do not have permission to use AI features',
            userId: player.data.id
          }
        })
        
        return { success: false, error: 'Unauthorized' }
      }
      
      debugLog(`[AIServer] Processing query for player ${player.data.id}: ${data.query}`)
      
      // Check if we should continue conversation or start fresh
      const continueConversation = data.continueConversation !== false;
      
      // Start the LLM stream for this player
      const success = await this.onLLMStreamStartRequest(player, data.query, continueConversation)
      
      return { success }
    } catch (error) {
      console.error('[AIServer] Error processing query:', error)
      
      // Send error event if we have a socket
      if (socket) {
        this.world.network.sendTo(socket.id, 'llmEvent', {
          type: 'error',
          data: {
            error: error.message || 'Unknown error processing your request',
            userId: socket.player?.data.id
          }
        })
      }
      
      return { success: false, error: error.message || 'Unknown error' }
    }
  }
  
  /**
   * Handle a stream cancellation request
   * @param {Object} data - The cancellation data
   * @returns {Object} - Success status
   */
  onAiCancelStream(socket, data) {
    try {
      const player = socket.player
      if (!player) {
        console.error('[AIServer] No player found for socket')
        return { success: false, error: 'Player not found' }
      }

      const playerId = player.data.id
      debugLog(`[AIServer] Cancelling stream for player ${playerId}`)
      
      // Cancel the stream for this player
      const success = this.cancelLLMStream(playerId)
      
      return { success }
    } catch (error) {
      console.error('[AIServer] Error cancelling stream:', error)
      return { success: false, error: error.message || 'Unknown error' }
    }
  }

  /**
   * Starts an LLM stream for a player with the given query
   * @param {Object} player - The player entity requesting the stream
   * @param {string} query - The query to process
   * @param {boolean} continueConversation - Whether to continue previous conversation
   * @returns {boolean} - True if stream started successfully
   */
  async onLLMStreamStartRequest(player, query, continueConversation = true) {
    if (!player || !query) {
      console.error('[LLM] Invalid player or query for stream request')
      return false
    }
    
    if (!this.llmClient) {
      console.error('[LLM] No LLM client available')
      this.world.network.sendTo(player.data.id, 'llmEvent', { 
        type: 'error', 
        data: { 
          error: 'LLM service unavailable',
          userId: player.data.id 
        } 
      })
      return false
    }
    
    const userId = player.data.id
    debugLog(`[LLM] Starting stream for player ${userId} with query: ${query}, continueConversation: ${continueConversation}`)
    
    // Select the provider based on current settings before every prompt
    const providerKey = this.world.settings.llmProvider || 'openai';
    const model = this.world.settings.llmModel;

    try {
      this.llmClient.selectProvider(providerKey);
      debugLog(`Selected LLM provider '${providerKey}' for this prompt.`);
      
      if (model) {
        debugLog(`Using model '${model}' for this prompt.`);
      }
    } catch (e) {
      console.warn(`[AIServer] Tried to select unknown LLM provider: ${providerKey}`);
    }
    
    // Check if the player already has an active stream
    if (this.activeStreams.has(userId)) {
      debugLog(`[LLM] Player ${userId} already has an active stream, ending previous one`)
      
      // Send completion event for the previous stream
      this.world.network.sendTo(userId, 'llmEvent', {
        type: 'complete',
        data: {
          userId,
          message: 'Stream replaced by new request'
        }
      })
    }
    
    // Track this stream as active
    this.activeStreams.set(userId, {
      startTime: Date.now(),
      query,
      continueConversation
    })
    
    // Set up event handlers for this player
    const eventHandlers = {
      onStart: (data) => {
        if (data.userId === userId || !data.userId) {
          this.onLLMChatEvent({ 
            type: 'start', 
            data: { 
              ...data, 
              continueConversation 
            } 
          }, player)
        }
      },
      
      onStatus: (data) => {
        if (data.userId === userId || !data.userId) {
          this.onLLMChatEvent({ type: 'status', data }, player)
        }
      },
      
      onText: (data) => {
        if (data.userId === userId || !data.userId) {
          this.onLLMChatEvent({ type: 'text', data }, player)
        }
      },
      
      onToolStart: (data) => {
        if (data.userId === userId || !data.userId) {
          this.onLLMChatEvent({ type: 'tool_start', data }, player)
        }
      },
      
      onToolResult: (data) => {
        if (data.userId === userId || !data.userId) {
          this.onLLMChatEvent({ type: 'tool_result', data }, player)
        }
      },
      
      onToolError: (data) => {
        if (data.userId === userId || !data.userId) {
          this.onLLMChatEvent({ type: 'tool_error', data }, player)
        }
      },
      
      onComplete: (data) => {
        if (data.userId === userId || !data.userId) {
          this.onLLMChatEvent({ type: 'complete', data }, player)
          
          // Remove this stream from active streams
          this.activeStreams.delete(userId)
          
          // Remove all event listeners
          this.removeEventListeners(this.llmClient, eventHandlers)
        }
      },
      
      onError: (data) => {
        if (data.userId === userId || !data.userId) {
          this.onLLMChatEvent({ type: 'error', data }, player)
          
          // Remove this stream from active streams
          this.activeStreams.delete(userId)
          
          // Remove all event listeners
          this.removeEventListeners(this.llmClient, eventHandlers)
        }
      }
    }
    
    // Add all event listeners
    this.llmClient.on('start', eventHandlers.onStart)
    this.llmClient.on('status', eventHandlers.onStatus)
    this.llmClient.on('text', eventHandlers.onText)
    this.llmClient.on('tool_start', eventHandlers.onToolStart)
    this.llmClient.on('tool_result', eventHandlers.onToolResult)
    this.llmClient.on('tool_error', eventHandlers.onToolError)
    this.llmClient.on('complete', eventHandlers.onComplete)
    this.llmClient.on('error', eventHandlers.onError)
    
    try {
      // Process the query
      this.world.network.sendTo(userId, 'llmEvent', {
        type: 'status',
        data: { 
          status: 'Starting LLM query processing...',
          userId,
          continueConversation
        }
      })
      
      // Start processing the query with the specified model if available
      await this.llmClient.processQueryStream(query, userId, undefined, undefined, continueConversation);
      return true
    } catch (error) {
      console.error(`[LLM] Error processing query stream for ${userId}:`, error)
      
      // Send error to client
      this.world.network.sendTo(userId, 'llmEvent', {
        type: 'error',
        data: { 
          error: error.message || 'Error processing query',
          userId 
        }
      })
      
      // Clean up
      this.activeStreams.delete(userId)
      this.removeEventListeners(this.llmClient, eventHandlers)
      return false
    }
  }
  
  /**
   * Helper method to remove all event listeners
   * @param {Object} emitter - The event emitter
   * @param {Object} handlers - Map of event handlers
   */
  removeEventListeners(emitter, handlers) {
    emitter.removeListener('start', handlers.onStart)
    emitter.removeListener('status', handlers.onStatus)
    emitter.removeListener('text', handlers.onText)
    emitter.removeListener('tool_start', handlers.onToolStart)
    emitter.removeListener('tool_result', handlers.onToolResult)
    emitter.removeListener('tool_error', handlers.onToolError)
    emitter.removeListener('complete', handlers.onComplete)
    emitter.removeListener('error', handlers.onError)
  }
  
  /**
   * Cancels an active LLM stream for a player
   * @param {string} userId - ID of the player whose stream should be cancelled
   * @returns {boolean} - True if a stream was cancelled
   */
  cancelLLMStream(userId) {
    if (!this.activeStreams.has(userId)) {
      return false
    }
    
    debugLog(`[LLM] Cancelling stream for player ${userId}`)
    
    // Send cancellation event
    this.world.network.sendTo(userId, 'llmEvent', {
      type: 'complete',
      data: {
        userId,
        message: 'Stream cancelled by system'
      }
    })
    
    // Remove from active streams
    this.activeStreams.delete(userId)
    return true
  }

  registerAppMCPTool(toolName, schema, handler, entityId) {
    // Only register on server side
    if (!this.mcp) {
      console.warn(`[MCP] Attempted to register tool '${toolName}' before MCP server is initialized`)
      return false
    }

    try {
      debugLog(`[MCP] Registering tool '${toolName}' `)

      // Create a wrapper handler that formats the response to MCP standard
      const wrappedHandler = async params => {
        try {
          // Call the original handler
          const result = await handler(params)

          // Format the result according to MCP standard
          if (result === undefined || result === null) {
            return {
              content: [{ type: 'text', text: '' }],
            }
          } else if (typeof result === 'object' && result.content) {
            // If the handler already returns in MCP format, use it as is
            return result
          } else {
            // Otherwise, convert to MCP format
            return {
              content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }],
            }
          }
        } catch (err) {
          console.error(`[MCP] Tool '${toolName}' execution failed:`, err)
          return {
            content: [{ type: 'text', text: err.message || 'Error in tool execution' }],
            isError: true,
          }
        }
      }

      // Register the tool with the MCP server
      this.mcp.tool(toolName, schema, wrappedHandler)

      // Keep track of registered tools
      this.appTools.set(toolName, { schema, handler: wrappedHandler, entityId })
      

      debugLog(`[MCP] Successfully registered tool '${toolName}'`)
      return true
    } catch (err) {
      console.error(`[MCP] Failed to register tool '${toolName}':`, err)
      return false
    }
  }

  unregisterAppMCPTools(entityId) {
    if (!this.mcp) {
      return false
    }

    try {
      // Get all tool names registered by this app
      const toolsToRemove = []
      for (const [toolName, details] of this.appTools.entries()) {
        if (details.entityId === entityId) {
          toolsToRemove.push(toolName)
        }
      }

      // Remove each tool
      for (const toolName of toolsToRemove) {
        debugLog(`[MCP] Unregistering tool '${toolName}' for entity ${entityId}`)
        
        // Remove from MCP server
        if (this.mcp.removeTool) {
          this.mcp.removeTool(toolName)
        } else if (this.mcp._registeredTools) {
          delete this.mcp._registeredTools[toolName]
        }
        
        // Remove from our tracking
        this.appTools.delete(toolName)
      }

      // Notify clients that tool list has changed
      if (toolsToRemove.length > 0) {
        if (this.mcp.sendToolListChanged) {
          this.mcp.sendToolListChanged()
        }
        debugLog(`[MCP] Successfully unregistered ${toolsToRemove.length} tools for entity ${entityId}`)
      }
      
      return true
    } catch (err) {
      console.error(`[MCP] Failed to unregister tools for entity ${entityId}:`, err)
      return false
    }
  }

  // Method to get the MCP server instance, useful for integration with fastify later
  getmcp() {
    return this.mcp
  }

  onLLMChatEvent(event, player) {
    // Only process events if we have a valid player
    if (!player) return

    const { type, data } = event

    // Add player ID to data
    const eventData = {
      ...data,
      userId: player.data.id
    }

    debugLog(`Sending LLM event type: ${type} to player: ${player.data.id}`, eventData);

    switch (type) {
      case 'start':
        this.world.network.sendTo(player.data.id, 'llmEvent', { type: 'start', data: eventData })
        break
      case 'status':
        this.world.network.sendTo(player.data.id, 'llmEvent', { type: 'status', data: eventData })
        break
      case 'text':
        this.world.network.sendTo(player.data.id, 'llmEvent', { type: 'text', data: eventData })
        break
      case 'tool_start':
        // Ensure tool args are properly formatted
        if (eventData.args && typeof eventData.args === 'string') {
          try {
            eventData.args = JSON.parse(eventData.args);
          } catch (e) {
            console.warn(`[AIServer] Failed to parse tool args as JSON, keeping as string`);
          }
        }
        
        debugLog(`Sending tool_start for ${eventData.tool} with args:`, eventData.args);
        this.world.network.sendTo(player.data.id, 'llmEvent', { type: 'tool_start', data: eventData })
        break
      case 'tool_result':
        debugLog(`Sending tool_result for ${eventData.tool} with result:`, eventData.result);
        this.world.network.sendTo(player.data.id, 'llmEvent', { type: 'tool_result', data: eventData })
        break
      case 'tool_error':
        debugLog(`Sending tool_error for ${eventData.tool} with error:`, eventData.error);
        this.world.network.sendTo(player.data.id, 'llmEvent', { type: 'tool_error', data: eventData })
        break
      case 'complete':
        this.world.network.sendTo(player.data.id, 'llmEvent', { type: 'complete', data: eventData })
        break
      case 'error':
        this.world.network.sendTo(player.data.id, 'llmEvent', { type: 'error', data: eventData })
        break
      default:
        console.warn(`[LLM] Unknown event type: ${type}`)
    }
  }
}

const rootDir = path.join(__dirname, '../')
const worldDir = path.join(rootDir, process.env.WORLD)
const assetsDir = path.join(worldDir, '/assets')
const docsDir = path.join(rootDir, './docs')
const repoRootDir = path.join(rootDir, '../../')
const scriptingRulesPath = path.join(repoRootDir, 'docs/scripting-rules.md')

// =====================================
// MCP Server Implementation Below
// =====================================
// Helper function to get the SQLite DB path (uses the same world dir as the main server)
const getDbPathForMCP = () => {
  // If environment variable is provided, use that
  if (process.env.SQLITE_DB_PATH) {
    debugLog(`Using DB path from env: ${process.env.SQLITE_DB_PATH}`)
    return process.env.SQLITE_DB_PATH
  }

  // Otherwise use the same DB path as the main server
  const dbPath = path.join(worldDir, '/db.sqlite')
  debugLog(`Resolved DB path: ${dbPath}`)
  return dbPath
}

/**
 * Saves a file to the assets directory and returns its hash and URL
 * @param {Buffer|String} content - The file content to save
 * @param {String} extension - The file extension (e.g., 'js', 'glb')
 * @returns {Promise<{hash: String, url: String, filePath: String}>}
 */
async function saveAssetFile(content, extension) {
  // Create a buffer from the content if it's a string
  const buffer = typeof content === 'string' ? Buffer.from(content) : content
  
  // Hash the buffer
  const hash = await hashFile(buffer)
  
  // Use hash as filename with the proper extension
  const filename = `${hash}.${extension}`
  
  // Canonical URL to this file
  const url = `asset://${filename}`
  
  // Save file to assets directory
  const filePath = path.join(assetsDir, filename)
  const exists = await fs.exists(filePath)
  if (!exists) {
    await fs.writeFile(filePath, buffer)
  }
  
  return { hash, url, filePath }
}

/**
 * Updates a blueprint with a new script file
 * @param {Object} world - The world instance
 * @param {Object} blueprint - The blueprint to update
 * @param {String} scriptContent - The script file content
 * @returns {Promise<Object>} The updated blueprint data
 */
async function updateBlueprintScript(world, blueprint, scriptContent) {
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

    return {
      id: blueprint.id,
      version,
      script: url
    }
  } catch (err) {
    console.error('Error in updateBlueprintScript:', err)
    throw err
  }
}

// Common response formatter for consistency
function formatResponse(data, error = null) {
  debugLog(`formatResponse: Formatting response with error=${!!error}`);
  
  if (error) {
    debugLog(`formatResponse: Error details:`, error);
    const response = {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: error.message || error,
          details: error.stack
        }, null, 2)
      }],
      isError: true
    };
    debugLog(`formatResponse: Returning error response:`, JSON.stringify(response, null, 2));
    return response;
  }

  const response = {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        data
      }, null, 2)
    }]
  };
  debugLog(`formatResponse: Returning success response with data type=${typeof data}, length=${Array.isArray(data) ? data.length : 'N/A'}`);
  return response;
}

/**
 * Searches for documentation files in the docs directory that match a query
 * @param {string} query - The search query
 * @returns {Promise<Array<{file: string, content: string, matchCount: number}>>} Matching documentation files
 */
async function searchDocs(query) {
  try {
    if (!query) return []
    
    // Normalize the query to lowercase for case-insensitive matching
    const normalizedQuery = query.toLowerCase()
    
    // Get all markdown files in the docs directory
    const files = await fs.readdir(docsDir)
    const mdFiles = files.filter(file => file.endsWith('.md'))
    
    // Check subdirectories
    const subdirs = (await fs.readdir(docsDir, { withFileTypes: true }))
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name)
    
    // Gather all markdown files from subdirectories
    for (const subdir of subdirs) {
      try {
        const subdirFiles = await fs.readdir(path.join(docsDir, subdir))
        const subdirMdFiles = subdirFiles
          .filter(file => file.endsWith('.md'))
          .map(file => path.join(subdir, file))
        mdFiles.push(...subdirMdFiles)
      } catch (err) {
        console.error(`Error reading subdir ${subdir}:`, err)
      }
    }
    
    // Read each file and check for matches
    const results = []
    
    for (const file of mdFiles) {
      try {
        const filePath = path.join(docsDir, file)
        const content = await fs.readFile(filePath, 'utf8')
        
        // Count how many times the query appears in the content
        const matchCount = (content.toLowerCase().match(new RegExp(normalizedQuery, 'g')) || []).length
        
        // If there are matches, add to results
        if (matchCount > 0) {
          results.push({
            file,
            content,
            matchCount
          })
        }
      } catch (err) {
        console.error(`Error reading file ${file}:`, err)
      }
    }
    
    // Sort by relevance (match count)
    return results.sort((a, b) => b.matchCount - a.matchCount)
  } catch (err) {
    console.error('Error in searchDocs:', err)
    throw err
  }
}

/**
 * Creates a new entity in the world based on a blueprint
 * @param {Object} world - The world instance
 * @param {String} blueprintId - The ID of the blueprint to use
 * @param {Array<number>} position - Position [x, y, z]
 * @param {Array<number>} quaternion - Rotation as quaternion [x, y, z, w]
 * @param {String} creatorId - ID of the player creating the entity (optional)
 * @returns {Promise<Object>} The created entity
 */
async function createEntity(world, blueprintId, position, quaternion, creatorId = null) {
  try {
    // Check if blueprint exists
    const blueprint = world.blueprints.get(blueprintId)
    if (!blueprint) {
      throw new Error(`Blueprint with ID ${blueprintId} not found`)
    }

    // Create entity data
    const entityData = {
      id: uuid(),
      type: 'app',
      blueprint: blueprintId,
      position: position || [0, 0, 0],
      quaternion: quaternion || [0, 0, 0, 1],
      mover: null,
      uploader: null,
      pinned: false,
      state: {},
    }

    // If creator ID is provided, add it to the entity data
    if (creatorId) {
      entityData.creatorId = creatorId
    }

    // Add the entity to the world
    const entity = world.entities.add(entityData, true)

    return entity
  } catch (err) {
    console.error('Error in createEntity:', err)
    throw err
  }
}

// Helper function to find the correct path for the scripting rules file
function findScriptingRulesFile() {
  const possiblePaths = [
    scriptingRulesPath,
    path.join(rootDir, '../../docs/scripting-rules.md'),
    path.join(rootDir, '../docs/scripting-rules.md'),
    path.join(docsDir, 'scripting-rules.md'),
    path.join(repoRootDir, 'docs/scripting-rules.md')
  ];
  
  for (const filePath of possiblePaths) {
    if (fs.existsSync(filePath)) {
      debugLog(`Found scripting rules at: ${filePath}`);
      return filePath;
    }
  }
  
  console.error("Could not find scripting-rules.md in any expected location");
  return null;
}

export function registerBuilderTools(world, mcpServer) {
  // Register the scripting rules as a static resource
  debugLog(`Registering scripting rules resource from path: ${scriptingRulesPath}`)
  const scriptingRulesFilePath = findScriptingRulesFile();
  
  if (scriptingRulesFilePath) {
    mcpServer.resource(
      "scripting-rules",
      "hyperfy://scripting-rules",
      async (uri) => {
        try {
          // Read the markdown file
          const markdown = await fs.readFile(scriptingRulesFilePath, 'utf8')
          debugLog(`Successfully loaded scripting rules (${markdown.length} characters)`)

          return {
            contents: [{
              uri: uri.href,
              text: markdown
            }]
          }
        } catch (error) {
          console.error('Error reading scripting rules file:', error)
          return {
            contents: [{
              uri: uri.href,
              text: `# Scripting Rules\n\nError: ${error.message}`
            }]
          }
        }
      }
    )
  } else {
    console.error('Could not register scripting rules resource - file not found')
    // Register a placeholder resource with an error message
    mcpServer.resource(
      "scripting-rules",
      "hyperfy://scripting-rules",
      async (uri) => ({
        contents: [{
          uri: uri.href,
          text: "# Scripting Rules\n\nError: Documentation file not found"
        }]
      })
    )
  }

  // Register the get-entity-script tool
  mcpServer.tool(
    'get-entity-script',
    {
      entityId: z.string().describe('ID of the entity to get script from'),
    },
    async ({ entityId }) => {
      debugLog(`get-entity-script: Starting for entityId=${entityId}`);
      let db = null;
      try {
        const dbPath = getDbPathForMCP()
        debugLog(`get-entity-script: Using database at ${dbPath}`);
        db = new Database(dbPath)

        // Get entity and blueprint data in a single query
        const query = `
          SELECT 
            e.id as entityId,
            e.data as entityData,
            b.id as blueprintId,
            b.data as blueprintData
          FROM entities e
          LEFT JOIN blueprints b ON json_extract(e.data, '$.blueprint') = b.id
          WHERE e.id = ?
        `;
        debugLog(`get-entity-script: Executing query for entity ${entityId}`);
        const result = db.prepare(query).get(entityId);

        if (!result) {
          debugLog(`get-entity-script: No entity found with ID ${entityId}`);
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

        debugLog(`get-entity-script: Found entity and blueprint data`);
        // Parse the JSON data
        const entityData = JSON.parse(result.entityData);
        const blueprintData = JSON.parse(result.blueprintData);
        debugLog(`get-entity-script: Blueprint ID=${blueprintData.id}`);

        // Get the script URL from the blueprint
        const scriptUrl = blueprintData.script;
        if (!scriptUrl) {
          debugLog(`get-entity-script: No script URL found for app ${result.blueprintId}`);
          return {
            content: [
              {
                type: 'text',
                text: `Error: No script found for app ${result.blueprintId}`,
              },
            ],
            isError: true,
          }
        }

        // Extract filename from asset:// URL
        const filename = scriptUrl.replace('asset://', '')
        const scriptPath = path.join(assetsDir, filename)
        debugLog(`get-entity-script: Reading script from ${scriptPath}`);

        // Read the script file
        const scriptContent = await fs.readFile(scriptPath, 'utf8')
        debugLog(`get-entity-script: Successfully read script file (${scriptContent.length} chars)`);

        return {
          content: [
            {
              type: 'text',
              text: scriptContent,
            },
          ],
          metadata: {
            entity: entityData,
            app: blueprintData
          }
        }
      } catch (err) {
        console.error(`[ERROR] get-entity-script: Failed with error:`, err);
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
          debugLog(`get-entity-script: Closing database connection`);
          db.close()
        }
      }
    }
  )

  // Register the update-blueprint-script tool
  mcpServer.tool(
    'update-app-script',
    {
      blueprintId: z.string().describe('ID of the app to update'),
      scriptContent: z.string().describe('New script content to apply to the app'),
    },
    async ({ blueprintId, scriptContent }) => {
      debugLog(`update-app-script: Starting for blueprintId=${blueprintId}`);
      try {
        // Find the blueprint by ID
        const blueprint = world.blueprints.get(blueprintId)
        debugLog(`update-app-script: Looking up blueprint`);

        if (!blueprint) {
          debugLog(`update-app-script: Blueprint not found with ID ${blueprintId}`);
          return {
            content: [
              {
                type: 'text',
                text: `Error: App with ID ${blueprintId} not found`,
              },
            ],
            isError: true,
          }
        }

        debugLog(`update-app-script: Found blueprint, updating script`);
        // Use the updateBlueprintScript function to update the blueprint
        const result = await updateBlueprintScript(world, blueprint, scriptContent)
        debugLog(`update-app-script: Script updated successfully, new version=${result.version}`);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                data: {
                  appId: result.id,
                  version: result.version,
                  script: result.script
                }
              }, null, 2)
            },
          ],
        }
      } catch (err) {
        console.error(`[ERROR] update-app-script: Failed with error:`, err);
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

  // Enhanced blueprint search tool with more search options
  mcpServer.tool(
    'get-app-scripts',
    {
      searchQuery: z.object({
        name: z.string().optional().describe('Search by app name'),
        author: z.string().optional().describe('Search by app author'),
        desc: z.string().optional().describe('Search in app description'),
        id: z.string().optional().describe('Search by exact app ID'),
        customQuery: z.string().optional().describe('Custom SQL WHERE clause for blueprint data'),
        props: z.record(z.any()).optional().describe('Search by app props'),
        tags: z.array(z.string()).optional().describe('Search by app tags'),
        modifiedSince: z.string().optional().describe('Find apps modified since date'),
        scriptContains: z.string().optional().describe('Search in script content')
      }).describe('Search criteria for finding apps'),
      includeEntities: z.boolean().default(false).describe('Whether to include entities using these apps'),
      includeScripts: z.boolean().default(true).describe('Whether to include script content'),
      limit: z.number().optional().default(100).describe('Maximum number of results')
    },
    async ({ searchQuery, includeEntities = false, includeScripts = true, limit = 100 }) => {
      debugLog(`get-app-scripts: Starting search with criteria:`, JSON.stringify(searchQuery));
      let db = null;
      try {
        const dbPath = getDbPathForMCP()
        debugLog(`get-app-scripts: Using database at ${dbPath}`);
        db = new Database(dbPath)

        const conditions = [];
        const params = [];

        // Enhanced search conditions
        if (searchQuery.id) {
          conditions.push('b.id = ?');
          params.push(searchQuery.id);
        }
        if (searchQuery.name) {
          conditions.push("json_extract(b.data, '$.name') LIKE ?");
          params.push(`%${searchQuery.name}%`);
        }
        if (searchQuery.author) {
          conditions.push("json_extract(b.data, '$.author') LIKE ?");
          params.push(`%${searchQuery.author}%`);
        }
        if (searchQuery.desc) {
          conditions.push("json_extract(b.data, '$.desc') LIKE ?");
          params.push(`%${searchQuery.desc}%`);
        }
        if (searchQuery.props) {
          Object.entries(searchQuery.props).forEach(([key, value]) => {
            conditions.push(`json_extract(b.data, '$.props.${key}') = ?`);
            params.push(value);
          });
        }
        if (searchQuery.tags) {
          const tagConditions = searchQuery.tags.map(tag => {
            params.push(`%${tag}%`);
            return "json_extract(b.data, '$.tags') LIKE ?";
          });
          conditions.push(`(${tagConditions.join(' OR ')})`);
        }
        if (searchQuery.modifiedSince) {
          conditions.push('b.updatedAt > ?');
          params.push(searchQuery.modifiedSince);
        }
        if (searchQuery.customQuery) {
          conditions.push(searchQuery.customQuery);
        }

        debugLog(`get-app-scripts: Built ${conditions.length} search conditions with ${params.length} parameters`);

        const whereClause = conditions.length > 0 
          ? 'WHERE ' + conditions.join(' AND ')
          : '';

        let query = `
          SELECT 
            b.id as blueprintId,
            json(b.data) as blueprintData,
            b.updatedAt
          FROM blueprints b
          ${whereClause}
          LIMIT ${limit}
        `;

        if (includeEntities) {
          query = `
            WITH matching_blueprints AS (${query})
            SELECT 
              mb.blueprintId,
              mb.blueprintData,
              mb.updatedAt,
              COALESCE(
                json_group_array(
                  CASE WHEN e.id IS NOT NULL THEN
                    json_object(
                      'id', e.id,
                      'data', json(e.data)
                    )
                  ELSE NULL END
                ),
                '[]'
              ) as entities
            FROM matching_blueprints mb
            LEFT JOIN entities e ON json_extract(e.data, '$.blueprint') = mb.blueprintId
            GROUP BY mb.blueprintId
          `;
        }

        debugLog(`get-app-scripts: Executing query`);
        const results = db.prepare(query).all(...params);
        debugLog(`get-app-scripts: Found ${results.length} results`);
        
        if (!results || results.length === 0) {
          debugLog(`get-app-scripts: No results found`);
          return formatResponse({ 
            message: 'No apps found matching the search criteria',
            searchQuery 
          });
        }

        debugLog(`get-app-scripts: Processing results`);
        const processedResults = await Promise.all(results.map(async (result) => {
          try {
            const blueprintData = typeof result.blueprintData === 'string' 
              ? JSON.parse(result.blueprintData)
              : result.blueprintData;

            const response = {
              app: blueprintData,
              updatedAt: result.updatedAt,
              entities: includeEntities ? parseEntities(result.entities) : null
            };

            if (includeScripts) {
              const scriptUrl = blueprintData.script;
              if (scriptUrl) {
                const filename = scriptUrl.replace('asset://', '');
                const scriptPath = path.join(assetsDir, filename);
                debugLog(`get-app-scripts: Reading script for blueprint ${blueprintData.id} from ${scriptPath}`);
                
                if (await fs.exists(scriptPath)) {
                  const scriptContent = await fs.readFile(scriptPath, 'utf8');
                  
                  // Filter by script content if requested
                  if (searchQuery.scriptContains && !scriptContent.includes(searchQuery.scriptContains)) {
                    debugLog(`get-app-scripts: Script content filter did not match for ${blueprintData.id}`);
                    return null;
                  }
                  
                  response.script = scriptContent;
                } else {
                  debugLog(`get-app-scripts: Script file not found for ${blueprintData.id}`);
                  response.error = `Script file not found: ${filename}`;
                }
              } else {
                debugLog(`get-app-scripts: No script URL in blueprint ${blueprintData.id}`);
                response.error = 'No script URL in app';
              }
            }

            return response;
          } catch (err) {
            console.error(`[ERROR] get-app-scripts: Error processing blueprint result:`, err);
            return {
              app: result.blueprintId,
              error: `Failed to process app: ${err.message}`
            };
          }
        }));

        // Filter out null results (from script content filtering)
        const filteredResults = processedResults.filter(r => r !== null);
        debugLog(`get-app-scripts: Returning ${filteredResults.length} processed results`);
        
        return formatResponse(filteredResults);
      } catch (err) {
        console.error(`[ERROR] get-app-scripts: Failed with error:`, err);
        return formatResponse(null, err);
      } finally {
        if (db) {
          debugLog(`get-app-scripts: Closing database connection`);
          db.close();
        }
      }
    }
  )

  // New tool: Get all entities using a specific script
  mcpServer.tool(
    'find-app-script-usage',
    {
      scriptHash: z.string().optional().describe('Find entities using this script hash'),
      scriptContent: z.string().optional().describe('Find entities with scripts containing this content'),
      blueprintProps: z.record(z.any()).optional().describe('Additional app properties to match')
    },
    async ({ scriptHash, scriptContent, blueprintProps }) => {
      debugLog(`[DEBUG] find-app-script-usage: Starting search with hash=${scriptHash}, hasContent=${!!scriptContent}`);
      let db = null;
      try {
        if (!scriptHash && !scriptContent) {
          throw new Error('Either scriptHash or scriptContent must be provided');
        }

        const dbPath = getDbPathForMCP()
        debugLog(`[DEBUG] find-app-script-usage: Using database at ${dbPath}`);
        db = new Database(dbPath)

        const conditions = [];
        const params = [];

        if (scriptHash) {
          conditions.push("json_extract(b.data, '$.script') LIKE ?");
          params.push(`%${scriptHash}%`);
        }

        if (blueprintProps) {
          Object.entries(blueprintProps).forEach(([key, value]) => {
            conditions.push(`json_extract(b.data, '$.props.${key}') = ?`);
            params.push(value);
          });
        }

        debugLog(`[DEBUG] find-app-script-usage: Built ${conditions.length} search conditions`);

        const query = `
          SELECT 
            b.id as blueprintId,
            json(b.data) as blueprintData,
            json_group_array(
              json_object(
                'id', e.id,
                'data', json(e.data)
              )
            ) as entities
          FROM blueprints b
          LEFT JOIN entities e ON json_extract(e.data, '$.blueprint') = b.id
          ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
          GROUP BY b.id
        `;

        debugLog(`[DEBUG] find-app-script-usage: Executing query`);
        const results = db.prepare(query).all(...params);
        debugLog(`[DEBUG] find-app-script-usage: Found ${results.length} initial results`);

        const processedResults = await Promise.all(results.map(async (result) => {
          try {
            const blueprintData = typeof result.blueprintData === 'string' 
              ? JSON.parse(result.blueprintData)
              : result.blueprintData;

            const scriptUrl = blueprintData.script;
            if (!scriptUrl) {
              debugLog(`[DEBUG] find-app-script-usage: No script URL for blueprint ${blueprintData.id}`);
              return null;
            }

            const filename = scriptUrl.replace('asset://', '');
            const scriptPath = path.join(assetsDir, filename);
            debugLog(`[DEBUG] find-app-script-usage: Checking script at ${scriptPath}`);

            if (!await fs.exists(scriptPath)) {
              debugLog(`[DEBUG] find-app-script-usage: Script file not found for ${blueprintData.id}`);
              return null;
            }

            const script = await fs.readFile(scriptPath, 'utf8');
            
            // Filter by script content if requested
            if (scriptContent && !script.includes(scriptContent)) {
              debugLog(`[DEBUG] find-app-script-usage: Script content filter did not match for ${blueprintData.id}`);
              return null;
            }

            return {
              app: blueprintData,
              script,
              entities: parseEntities(result.entities)
            };
          } catch (err) {
            console.error(`[ERROR] find-app-script-usage: Error processing result:`, err);
            return null;
          }
        }));

        const filteredResults = processedResults.filter(r => r !== null);
        debugLog(`[DEBUG] find-app-script-usage: Returning ${filteredResults.length} processed results`);
        return formatResponse(filteredResults);
      } catch (err) {
        console.error(`[ERROR] find-app-script-usage: Failed with error:`, err);
        return formatResponse(null, err);
      } finally {
        if (db) {
          debugLog(`[DEBUG] find-app-script-usage: Closing database connection`);
          db.close();
        }
      }
    }
  )

  // Register the search-docs tool
  mcpServer.tool(
    'search-docs',
    {
      query: z.string().describe('Search term to find in documentation files'),
      limit: z.number().optional().default(5).describe('Maximum number of results to return')
    },
    async ({ query, limit = 5 }) => {
      debugLog(`[DEBUG] search-docs: Starting search with query="${query}", limit=${limit}`);
      try {
        const results = await searchDocs(query)
        debugLog(`[DEBUG] search-docs: Found ${results.length} total matches`);
        
        // Limit the number of results
        const limitedResults = results.slice(0, limit)
        debugLog(`[DEBUG] search-docs: Returning ${limitedResults.length} results after limit`);
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                data: {
                  query,
                  resultsCount: results.length,
                  results: limitedResults.map(r => ({
                    file: r.file,
                    matchCount: r.matchCount,
                    content: r.content
                  }))
                }
              }, null, 2)
            },
          ],
        }
      } catch (err) {
        console.error(`[ERROR] search-docs: Failed with error:`, err);
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

  // Register the create-entity tool
  mcpServer.tool(
    'create-entity',
    {
      blueprintId: z.string().describe('ID of the app to create an entity from'),
      position: z.array(z.number()).length(3).optional().describe('Position [x, y, z]'),
      quaternion: z.array(z.number()).length(4).optional().describe('Rotation as quaternion [x, y, z, w]'),
      creatorId: z.string().optional().describe('ID of the player creating the entity')
    },
    async ({ blueprintId, position, quaternion, creatorId }) => {
      debugLog(`[DEBUG] create-entity: Starting creation for blueprint=${blueprintId}`);
      try {
        // Use default position/rotation if not provided
        const pos = position || [0, 0, 0]
        const rot = quaternion || [0, 0, 0, 1]
        debugLog(`[DEBUG] create-entity: Using position=${pos}, rotation=${rot}`);
        
        // Create the entity
        debugLog(`[DEBUG] create-entity: Creating entity with creatorId=${creatorId}`);
        const entity = await createEntity(world, blueprintId, pos, rot, creatorId)
        debugLog(`[DEBUG] create-entity: Entity created successfully with id=${entity.data.id}`);
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                data: {
                  entity: entity.data
                }
              }, null, 2)
            },
          ],
        }
      } catch (err) {
        console.error(`[ERROR] create-entity: Failed with error:`, err);
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

  // Return the server instance instead of registering it directly
  return mcpServer;
}

// Helper function to parse entities JSON array
function parseEntities(entitiesJson) {
  try {
    // If it's already an object/array, return it
    if (typeof entitiesJson === 'object') {
      return entitiesJson;
    }
    // Parse JSON string if needed
    return JSON.parse(entitiesJson || '[]');
  } catch (err) {
    console.error('Error parsing entities:', err);
    return [];
  }
}
