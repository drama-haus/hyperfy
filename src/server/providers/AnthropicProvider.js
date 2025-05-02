import { Anthropic } from '@anthropic-ai/sdk';
import { LLMProvider } from './LLMProvider.js';

export class AnthropicProvider extends LLMProvider {
  constructor({ apiKey, model = 'claude-3-5-sonnet-20241022', max_tokens = 8192, systemPrompt = null }) {
    super({ apiKey, model, max_tokens, systemPrompt });
    if (!apiKey) {
      throw new Error('AnthropicProvider requires an apiKey');
    }
    this.anthropic = new Anthropic({ apiKey });
    this.model = model;
    this.max_tokens = max_tokens;
    this.systemPrompt = systemPrompt;
  }

  /**
   * Format conversation history for Anthropic's API
   * @param {Array} conversationHistory - Array of message objects with role and content
   * @returns {Array} Formatted conversation history for Anthropic
   */
  formatConversationHistory(conversationHistory) {
    if (!conversationHistory || !Array.isArray(conversationHistory) || conversationHistory.length === 0) {
      return [];
    }
    
    return conversationHistory.map(msg => {
      if (typeof msg.content === 'string') {
        return {
          role: msg.role,
          content: msg.content
        };
      } else {
        // Handle complex content types (like tool calls)
        return msg;
      }
    });
  }

  /**
   * Send a message to the Anthropic LLM.
   * @param {Object} params - The parameters for the LLM call (messages, tools, userId, query, systemPrompt, etc).
   * @returns {Promise<Object>} The response from Anthropic.
   */
  async sendMessage(params) {
    const {
      messages,
      tools,
      systemPrompt,
      model,
      max_tokens,
      ...rest
    } = params;
    return this.anthropic.messages.create({
      model: model || this.model,
      max_tokens: max_tokens || this.max_tokens,
      system: systemPrompt || this.systemPrompt || undefined,
      messages,
      tools,
      // ...rest
    });
  }

  /**
   * Handle the full prompt + tool usage loop for Anthropic.
   * @param {Object} params - { query, userId, entityId, tools, systemPrompt, mcp, emit, getScriptingRules, conversationHistory, onAssistantResponse }
   * @returns {Promise<string>} The final response text.
   */
  async handlePromptLoop({ query, userId, entityId, tools, systemPrompt, mcp, emit, getScriptingRules, conversationHistory, onAssistantResponse }) {
    emit('start', { query, userId, entityId });
    
    // Format conversation history for Anthropic if provided
    let messages = this.formatConversationHistory(conversationHistory);
    
    // Add the current query as the last user message
    if (messages.length === 0 || messages[messages.length - 1].role !== 'user' || messages[messages.length - 1].content !== query) {
      messages.push({
        role: 'user',
        content: query,
      });
    }
    
    if (userId) {
      emit('status', { status: `Processing request for user ${userId.substring(0, 8)}...`, userId, entityId });
    } else {
      emit('status', { status: 'Thinking...', userId, entityId });
    }
    
    // Initial LLM call
    const initialResponse = await this.sendMessage({
      messages,
      tools,
      userId,
      entityId,
      query,
      systemPrompt,
    });
    const finalText = [];
    const toolResults = [];
    
    // Recursive response processor
    const processResponse = async (response) => {
      for (const content of response.content) {
        if (content.type === 'text') {
          finalText.push(content.text);
          emit('text', { text: content.text, userId });
        } else if (content.type === 'tool_use') {
          const toolName = content.name;
          const toolArgs = content.input;
          emit('tool_start', { tool: toolName, args: toolArgs, userId });
          try {
            const contextData = userId ? { userId } : undefined;
            const result = await mcp.callTool({
              name: toolName,
              arguments: toolArgs,
              metadata: contextData,
            }, undefined, { timeout: 90000 });
            toolResults.push(result);
            emit('tool_result', { tool: toolName, result, userId });
            
            // Continue conversation with tool results
            const toolId = `tool_${Date.now()}`;
            messages.push({
              role: 'assistant',
              content: [{ type: 'tool_use', id: toolId, name: toolName, input: toolArgs }],
            });
            messages.push({
              role: 'user',
              content: [{ type: 'tool_result', tool_use_id: toolId, content: result.content }],
            });
            emit('status', { status: 'Processing results...', userId });
            const followUpResponse = await this.sendMessage({
              messages,
              tools,
              userId,
              entityId,
              query,
              systemPrompt,
            });
            await processResponse(followUpResponse);
          } catch (error) {
            emit('tool_error', { tool: toolName, error: error.message, userId });
            finalText.push(`[Error executing tool ${toolName}: ${error.message}]`);
          }
        }
      }
    };
    
    await processResponse(initialResponse);
    
    // Get the final response text
    const finalResponse = finalText.join('\n');
    
    // Store the assistant's response in the conversation history
    if (onAssistantResponse && typeof onAssistantResponse === 'function') {
      onAssistantResponse(finalResponse);
    }
    
    emit('complete', { response: finalResponse, userId });
    return finalResponse;
  }
} 