import { System } from './System'

export class AIClient extends System {
  constructor(world) {
    super(world)
    
    this.responseSegments = []
    this.response = ''
    this.toolLogs = []
    this.status = ''
    this.isLoading = false
    
    this.registerEventHandlers()
  }
  
  registerEventHandlers() {
    // Bind the packet handlers to the network system
    this.world.network.onAiProcessQuery = this.onAiProcessQuery.bind(this)
    this.world.network.onAiCancelStream = this.onAiCancelStream.bind(this)
    this.world.network.onLlmEvent = this.onLlmEvent.bind(this)
  }
  
  /**
   * Handle an AI query request from the UI
   * @param {Object} socket - The socket object
   * @param {Object} data - The query data
   * @returns {Object} - Success status
   */
  onAiProcessQuery(socket, data) {
    if (!data.query) {
      return { success: false, error: 'No query provided' }
    }
    
    console.log(`[AIClient] Processing query: ${data.query}`)
    
    // Send the query to the server with continueConversation flag
    this.world.network.send('aiProcessQuery', {
      query: data.query,
      continueConversation: data.continueConversation !== false
    })
    
    return { success: true }
  }
  
  /**
   * Handle a request to cancel an active AI stream
   * @param {Object} socket - The socket object
   * @param {Object} data - The cancel data
   * @returns {Object} - Success status
   */
  onAiCancelStream(socket, data) {
    console.log(`[AIClient] Cancelling stream`)
    
    // Send the cancel request to the server
    this.world.network.send('aiCancelStream', {})
    
    return { success: true }
  }
  
  /**
   * Handle incoming LLM event from the server
   * @param {Object} event - The LLM event data
   */
  onLlmEvent(event) {
    console.log(`[AIClient] Received LLM event:`, event)
    
    // If event is not properly structured, try to parse it
    let type, data;
    
    if (typeof event === 'string') {
      try {
        const parsed = JSON.parse(event);
        type = parsed.type;
        data = parsed.data;
      } catch (err) {
        console.error('[AIClient] Failed to parse event string:', err);
        return;
      }
    } else if (event && typeof event === 'object') {
      // Determine if it's a properly formatted event or needs restructuring
      if (event.type && (event.data !== undefined)) {
        // Already formatted correctly
        type = event.type;
        data = event.data;
      } else if (event.type) {
        // Some events might not have data
        type = event.type;
        data = {};
      } else {
        console.error('[AIClient] Received malformed event object:', event);
        return;
      }
    } else {
      console.error('[AIClient] Received invalid event:', event);
      return;
    }
    
    console.log(`[AIClient] Processing event type: ${type} with data:`, data);
    
    // Update the state based on the event
    switch (type) {
      case 'start':
        this.isLoading = true
        this.status = 'Loading...'
        this.responseSegments = []
        this.response = ''
        this.toolLogs = []
        break
        
      case 'status':
        this.status = data.status
        break
        
      case 'text':
        // Append text to the last segment if it's a text segment
        if (this.responseSegments.length > 0 && 
            this.responseSegments[this.responseSegments.length - 1].type === 'text') {
          this.responseSegments[this.responseSegments.length - 1].content += data.text
        } else {
          this.responseSegments.push({ type: 'text', content: data.text })
        }
        
        // Also update the full response
        this.response += data.text
        break
        
      case 'tool_start':
        this.status = `Using tool: ${data.tool}...`
        
        // Create a new tool log
        const newToolLog = {
          id: `tool-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          tool: data.tool,
          type: 'start',
          args: data.args,
          expanded: false,
          timestamp: new Date().toISOString()
        }
        
        this.toolLogs.push(newToolLog)
        
        // Insert the tool log in the response segments
        this.responseSegments.push({ type: 'tool', id: newToolLog.id })
        break
        
      case 'tool_result':
        // Add result to existing tool log
        for (let i = 0; i < this.toolLogs.length; i++) {
          const log = this.toolLogs[i]
          if (log.tool === data.tool && log.type === 'start' && !log.result) {
            this.toolLogs[i] = { ...log, result: data.result, type: 'complete' }
            break
          }
        }
        
        this.status = `Tool ${data.tool} completed`
        break
        
      case 'tool_error':
        this.status = `Error using tool: ${data.tool}`
        
        // Add error to existing tool log
        for (let i = 0; i < this.toolLogs.length; i++) {
          const log = this.toolLogs[i]
          if (log.tool === data.tool && log.type === 'start') {
            this.toolLogs[i] = { ...log, error: data.error, type: 'error' }
            break
          }
        }
        
        // Add error indication in the response
        this.responseSegments.push({
          type: 'text',
          content: `\n❌ Error using tool ${data.tool}: ${data.error}`
        })
        
        // Update full response text
        this.response += `\n❌ Error using tool ${data.tool}: ${data.error}`
        break
        
      case 'complete':
        this.status = 'Done'
        this.isLoading = false
        
        // Include full responseSegments and toolLogs in the completion event
        // This ensures the UI has the full conversation data when saving to history
        data = {
          ...data,
          responseSegments: [...this.responseSegments],
          toolLogs: [...this.toolLogs],
          continueConversation: data.continueConversation
        }
        
        // Update final response if provided
        if (data.response) {
          this.response = data.response
        }
        break
        
      case 'error':
        this.status = `Error: ${data.error || 'An unknown error occurred'}`
        this.isLoading = false
        break
        
      default:
        console.warn(`[AIClient] Unknown event type: ${type}`)
    }
    
    // Create a properly formatted event to emit
    const formattedEvent = { 
      type, 
      data 
    };
    
    console.log('[AIClient] Emitting formatted event to UI:', formattedEvent);
    
    // Emit an event to notify the UI about the update
    this.world.emit('llmEvent', formattedEvent)
  }
}
