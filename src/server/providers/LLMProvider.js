export class LLMProvider {
  constructor(options = {}) {
    this.options = options;
  }

  /**
   * Send a message to the LLM and get a response.
   * @param {Object} params - The parameters for the LLM call.
   * @returns {Promise<Object>} The response from the LLM.
   */
  async sendMessage(params) {
    throw new Error('sendMessage() must be implemented by subclasses');
  }

  /**
   * Format conversation history for the specific provider
   * @param {Array} conversationHistory - Array of message objects with role and content
   * @returns {Array} Formatted conversation history for this provider
   */
  formatConversationHistory(conversationHistory) {
    // Default implementation just returns the array as is
    // Providers should override this if they need special formatting
    return conversationHistory || [];
  }

  /**
   * Handle the full prompt + tool usage loop.
   * @param {Object} params - { query, userId, tools, systemPrompt, mcp, emit, getScriptingRules, conversationHistory, onAssistantResponse }
   * @returns {Promise<string>} The final response text.
   */
  async handlePromptLoop(params) {
    throw new Error('handlePromptLoop() must be implemented by subclasses');
  }
} 