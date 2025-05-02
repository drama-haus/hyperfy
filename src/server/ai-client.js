import { EventEmitter } from 'events'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"

// Server configuration
const DEBUG = false

// Helper function for conditional logging
const debugLog = (message, ...args) => {
  if (DEBUG) {
    console.log(message, ...args)
  }
} 

export class AIClient extends EventEmitter {
  mcp;
  providers = {};
  selectedProvider;
  transport;
  tools;
  resources;
  // Add conversation history storage
  conversations = new Map();

  constructor() {
    super();
    debugLog('Initializing MCPClient...');
    // Only use provided providers, do not instantiate any here
    this.mcp = new Client({ name: 'mcp-client-cli', version: '1.0.0' });
    debugLog('MCP client initialized');
    this.resources = [];
  }

  registerProvider(key, provider) {
    this.providers[key] = provider;
    if (!this.selectedProvider) {
      this.selectedProvider = key;
    }
  }

  selectProvider(key) {
    if (!this.providers[key]) throw new Error(`Provider '${key}' not found`);
    this.selectedProvider = key;
  }

  getCurrentProvider() {
    return this.providers[this.selectedProvider];
  }

  // Add methods for conversation management
  getConversation(userId) {
    if (!this.conversations.has(userId)) {
      this.conversations.set(userId, {
        messages: [],
        lastActive: Date.now()
      });
    }
    return this.conversations.get(userId);
  }

  addMessageToConversation(userId, message) {
    const conversation = this.getConversation(userId);
    conversation.messages.push(message);
    conversation.lastActive = Date.now();
    return conversation;
  }

  clearConversation(userId) {
    this.conversations.delete(userId);
  }

  async connectToServer(serverUrl) {
    /**
     * Connect to an MCP server via SSE
     *
     * @param serverUrl - URL of the SSE endpoint (e.g., http://localhost:3000/sse)
     */
    debugLog(`Attempting to connect to MCP server at: ${serverUrl}`)
    try {
      // Initialize transport and connect to server
      debugLog('Creating SSE transport...')
      this.transport = new SSEClientTransport(new URL(serverUrl))
      debugLog('Transport created, connecting to server...')
      
      // Set up event handlers before connecting
      this.transport.onopen = () => {
        debugLog('SSE connection opened successfully')
      }
      
      this.transport.onerror = (error) => {
        console.error('SSE connection error:', error)
      }
      
      // Connect to the server
      await this.mcp.connect(this.transport)
      
      // Add a small delay to ensure connection is fully established
      await new Promise(resolve => setTimeout(resolve, 1000))
      debugLog('Connection established, fetching available tools...')

      // List available tools
      const toolsResult = await this.mcp.listTools()
      debugLog(toolsResult)
      debugLog('Tool list received:', JSON.stringify(toolsResult.tools.map(t => t.name), null, 2))
      this.tools = toolsResult.tools.map(tool => {
        debugLog(`Processing tool: ${tool.name}`)
        return {
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema,
        }
      })
      debugLog(
        'Connected to server with tools:',
        this.tools.map(({ name }) => name)
      )
      
      // List available resources
      // await this.listResources()
    } catch (e) {
      console.error('Failed to connect to MCP server: ', e)
      throw e
    }
  }
  
  /**
   * List all available resources from the server
   * 
   * @returns {Promise<Array>} List of available resources
   */
  async listResources() {
    try {
      debugLog('Fetching available resources...')
      const result = await this.mcp.listResources()
      this.resources = result.resources || []
      debugLog(`Found ${this.resources.length} available resources:`, 
        this.resources.map(r => r.name).join(', '))
      return this.resources
    } catch (error) {
      console.error('Error listing resources:', error)
      return []
    }
  }
  
  /**
   * Read a resource from the server
   * 
   * @param {string} uri - URI of the resource to read
   * @returns {Promise<Object>} Resource content
   */
  async readResource(uri) {
    try {
      debugLog(`Reading resource at URI: ${uri}`)
      const resource = await this.mcp.readResource({ uri })
      debugLog(`Successfully read resource: ${uri}`)
      return resource
    } catch (error) {
      console.error(`Error reading resource ${uri}:`, error)
      throw error
    }
  }
  
  /**
   * Get scripting rules content
   * 
   * @returns {Promise<string>} Scripting rules markdown content
   */
  async getScriptingRules() {
    try {
      const resource = await this.readResource('hyperfy://scripting-rules')
      if (resource && resource.contents && resource.contents.length > 0) {
        return resource.contents[0].text
      }
      throw new Error('Invalid resource format')
    } catch (error) {
      console.error('Error getting scripting rules:', error)
      return '# Error\n\nFailed to load scripting rules: ' + error.message
    }
  }

  async processQueryStream(query, userId = null, providerKey = null, entityId = null, continueConversation = true) {
    /**
     * Process a query using Claude and available tools with streaming updates
     *
     * @param query - The user's input query
     * @param userId - Optional user ID for context and permission checking
     * @param providerKey - Optional provider key to override the selected provider
     * @param entityId - Optional entity ID for context and permission checking
     * @param continueConversation - Whether to continue from previous conversation or start fresh
     * @returns Processed response as a string
     */
    debugLog(`Processing query: "${query}" for user: ${userId || 'anonymous'}, continueConversation: ${continueConversation}`)
    
    // Refresh the tools list at the start of each conversation
    try {
      debugLog('Refreshing available tools list...')
      const toolsResult = await this.mcp.listTools()
      this.tools = toolsResult.tools.map(tool => {
        return {
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema,
        }
      })
      debugLog(`Tools refreshed, found ${this.tools.length} available tools:`, 
        this.tools.map(({ name }) => name).join(', '))
    } catch (error) {
      console.error('Error refreshing tools list:', error)
      // Continue with existing tools if refresh fails
    }
    
    // Add this new query to conversation history
    if (userId) {
      // If we're starting a new conversation, clear previous history
      if (!continueConversation) {
        this.clearConversation(userId);
      }
      
      // Add the user message to conversation
      this.addMessageToConversation(userId, {
        role: 'user',
        content: query,
        timestamp: new Date().toISOString()
      });
    }
    
    this.emit('start', { query, userId, continueConversation })
    
    // Use selected provider or override
    const provider = providerKey ? this.providers[providerKey] : this.getCurrentProvider();
    if (!provider) throw new Error('No LLM provider available');
    
    // Try to get scripting rules and prepare system prompt
    let systemPrompt = "You are a helpful AI assistant for the Hyperfy platform.";
    try {
      const scriptingRules = await this.getScriptingRules();
      if (scriptingRules) {
        systemPrompt += " You have access to these documentation guidelines for Hyperfy scripting:\n\n" + 
          scriptingRules.substring(0, 10000); // Limit to first 10K chars if very long
      }
    } catch (err) {
      console.warn("Failed to load scripting rules for system prompt:", err);
    }
    
    // Get conversation history if available
    let conversationHistory = [];
    if (userId && continueConversation) {
      const conversation = this.getConversation(userId);
      conversationHistory = conversation.messages.slice();
      debugLog(`Using conversation history with ${conversationHistory.length} messages`);
    }
    
    // Delegate the full loop to the provider
    return provider.handlePromptLoop({
      query,
      userId,
      entityId,
      tools: this.tools,
      systemPrompt,
      mcp: this.mcp,
      emit: this.emit.bind(this),
      getScriptingRules: this.getScriptingRules.bind(this),
      conversationHistory,
      onAssistantResponse: (response) => {
        // Add assistant response to conversation history
        if (userId) {
          this.addMessageToConversation(userId, {
            role: 'assistant',
            content: response,
            timestamp: new Date().toISOString()
          });
        }
      }
    });
  }

  async processQuery(query, userId = null, providerKey = null, entityId = null, continueConversation = true) {
    return this.processQueryStream(query, userId, providerKey, entityId, continueConversation)
  }

  async cleanup() {
    /**
     * Clean up resources
     */
    debugLog('Cleaning up resources...')
    await this.mcp.close()
    debugLog('MCP client closed')
  }
}

// async function main() {
//   console.log('Starting MCP CLI application...')
//   console.log('Command line arguments:', process.argv)
  
//   if (process.argv.length < 3) {
//     console.log('Usage: node build/index.js <sse_server_url>')
//     return
//   }
  
//   const serverUrl = process.argv[2]
//   if (!serverUrl) {
//     console.error('Error: Server URL is undefined')
//     return
//   }
  
//   console.log(`Using server URL: ${serverUrl}`)
//   const mcpClient = new MCPClient()
//   try {
//     await mcpClient.connectToServer(serverUrl)
//     await mcpClient.chatLoop()
//   } catch (error) {
//     console.error('Error in main execution:', error)
//   } finally {
//     console.log('Performing cleanup...')
//     await mcpClient.cleanup()
//     console.log('Exiting application')
//     process.exit(0)
//   }
// }

// main()
