import { OpenAI } from 'openai';
import { LLMProvider } from './LLMProvider.js';

function convertToolFormat(tool) {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: tool.input_schema ? tool.input_schema.properties : tool.inputSchema?.properties,
        required: tool.input_schema ? tool.input_schema.required : tool.inputSchema?.required,
      },
    },
  };
}

export class OpenRouterProvider extends LLMProvider {
  constructor({ 
    apiKey, 
    model = 'openai/gpt-4o', 
    max_tokens = 4096, 
    systemPrompt = null,
    siteUrl = null,
    siteName = null
  }) {
    super({ apiKey, model, max_tokens, systemPrompt, siteUrl, siteName });
    if (!apiKey) {
      throw new Error('OpenRouterProvider requires an apiKey');
    }
    
    const defaultHeaders = {};
    if (siteUrl) {
      defaultHeaders['HTTP-Referer'] = siteUrl;
    }
    if (siteName) {
      defaultHeaders['X-Title'] = siteName;
    }
    
    this.openai = new OpenAI({ 
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey,
      defaultHeaders
    });
    
    this.model = model;
    this.max_tokens = max_tokens;
    this.systemPrompt = systemPrompt;
  }

  convertTools(tools) {
    if (!tools) return undefined;
    return tools.map(convertToolFormat);
  }

  async sendMessage(params) {
    const {
      messages,
      tools,
      systemPrompt,
      model,
      max_tokens,
      ...rest
    } = params;
    
    const openaiMessages = [];
    if (systemPrompt || this.systemPrompt) {
      openaiMessages.push({ role: 'system', content: systemPrompt || this.systemPrompt });
    }
    for (const msg of messages) {
      openaiMessages.push(msg);
    }
    const openaiTools = this.convertTools(tools);
    const response = await this.openai.chat.completions.create({
      model: model || this.model,
      max_tokens: max_tokens || this.max_tokens,
      messages: openaiMessages,
      tools: openaiTools,
    });
    return response.choices[0].message;
  }

  async handlePromptLoop({ query, userId, entityId, tools, systemPrompt, mcp, emit, getScriptingRules }) {
    emit('start', { query, userId, entityId });
    const messages = [];
    if (systemPrompt || this.systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt || this.systemPrompt });
    }
    messages.push({ role: 'user', content: query });
    if (userId) {
      emit('status', { status: `Processing request for user ${userId.substring(0, 8)}...`, userId, entityId });
    } else {
      emit('status', { status: 'Thinking...', userId, entityId });
    }
    const openaiTools = this.convertTools(tools);
    let response = await this.openai.chat.completions.create({
      model: this.model,
      max_tokens: this.max_tokens,
      messages,
      tools: openaiTools,
    });
    response = response.choices[0].message;
    const finalText = [];
    const toolResults = [];
    
    const processResponse = async (message) => {
      if (message.content) {
        finalText.push(message.content);
        emit('text', { text: message.content, userId });
      }
      if (message.tool_calls && message.tool_calls.length > 0) {
        for (const toolCall of message.tool_calls) {
          const toolName = toolCall.function.name;
          const toolArgs = JSON.parse(toolCall.function.arguments);
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
            
            messages.push({
              role: 'assistant',
              tool_calls: [toolCall],
              content: null,
            });
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolName,
              content: JSON.stringify(result.content),
            });
            emit('status', { status: 'Processing results...', userId });
            const followUp = await this.openai.chat.completions.create({
              model: this.model,
              max_tokens: this.max_tokens,
              messages,
              tools: openaiTools,
            });
            await processResponse(followUp.choices[0].message);
          } catch (error) {
            emit('tool_error', { tool: toolName, error: error.message, userId });
            finalText.push(`[Error executing tool ${toolName}: ${error.message}]`);
          }
        }
      }
    };
    await processResponse(response);
    emit('complete', { response: finalText.join('\n'), userId });
    return finalText.join('\n');
  }
} 