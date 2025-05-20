import { System } from './System'

export class Settings extends System {
  constructor(world) {
    super(world)

    this.title = null
    this.desc = null
    this.image = null
    this.model = null
    this.avatar = null
    this.public = null
    this.playerLimit = null
    this.llmProvider = null
    this.llmProviders = [] // Array of {id, label, defaultModel, availableModels[]}
    this.llmModel = null

    const defaultModels = {
      anthropic: 'claude-3-sonnet-20240229',
      openai: 'gpt-4-turbo',
      openrouter: 'openai/gpt-4o'
    };

    const determinedAvailableProviders = [];

    if (process.env.ANTHROPIC_API_KEY) {
      determinedAvailableProviders.push({
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
    }

    if (process.env.OPENAI_API_KEY) {
      determinedAvailableProviders.push({
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
    }

    if (process.env.OPENROUTER_API_KEY) {
      determinedAvailableProviders.push({
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
    }

    this.llmProviders = determinedAvailableProviders;

    if (this.llmProviders.length > 0) {
      // Set an initial default provider and model.
      // These might be overridden by deserialize() if settings are loaded from storage.
      // AIServer.js will perform final validation, selection, and potential correction based on these + persisted values.
      this.llmProvider = this.llmProviders[0].id;
      this.llmModel = this.llmProviders[0].defaultModel;
    } else {
      // No providers available based on ENV keys
      this.llmProvider = null;
      this.llmModel = null;
    }

    this.changes = null
  }

  deserialize(data) {
    this.title = data.title
    this.desc = data.desc
    this.image = data.image
    this.model = data.model
    this.avatar = data.avatar
    this.public = data.public
    this.playerLimit = data.playerLimit

    // For LLM settings, only override constructor defaults if explicitly present in loaded data
    if (data.hasOwnProperty('llmProviders')) {
      this.llmProviders = data.llmProviders
    }
    if (data.hasOwnProperty('llmProvider')) {
      this.llmProvider = data.llmProvider
    } else if (this.llmProviders && this.llmProviders.length > 0 && !this.llmProvider) {
      // If llmProvider wasn't in data, but we have llmProviders (e.g. from ENV) and no current llmProvider,
      // set to the first one from the list. This covers initializing from ENV when DB is empty.
      this.llmProvider = this.llmProviders[0].id;
    }

    if (data.hasOwnProperty('llmModel')) {
      this.llmModel = data.llmModel
    }
    
    // Ensure a valid model is selected if a provider is set, especially after deserialization or ENV init.
    // This might also correct a previously saved invalid model for a provider.
    if (this.llmProvider && this.llmProviders && this.llmProviders.length > 0) {
      const providerInfo = this.llmProviders.find(p => p.id === this.llmProvider);
      if (providerInfo) {
        if (!this.llmModel || !providerInfo.availableModels.includes(this.llmModel)) {
          this.llmModel = providerInfo.defaultModel; // Set to default if current is invalid or not set
        }
      } else {
        // The selected llmProvider is not in the list of available llmProviders.
        // This could happen if ENV vars changed, removing a previously configured provider.
        // Default to the first available provider from llmProviders list if any.
        if (this.llmProviders.length > 0) {
            this.llmProvider = this.llmProviders[0].id;
            this.llmModel = this.llmProviders[0].defaultModel;
        } else {
            // No providers available at all.
            this.llmProvider = null;
            this.llmModel = null;
        }
      }
    } else if (this.llmProviders && this.llmProviders.length > 0) {
        // No llmProvider selected, but providers are available. Default to the first one.
        this.llmProvider = this.llmProviders[0].id;
        this.llmModel = this.llmProviders[0].defaultModel;
    } else {
        // No providers available at all (e.g. no ENV vars and empty DB).
        this.llmProvider = null;
        this.llmModel = null;
    }

    this.emit('change', {
      title: { value: this.title },
      desc: { value: this.desc },
      image: { value: this.image },
      model: { value: this.model },
      avatar: { value: this.avatar },
      public: { value: this.public },
      playerLimit: { value: this.playerLimit },
      llmProvider: { value: this.llmProvider },
      llmProviders: { value: this.llmProviders },
      llmModel: { value: this.llmModel },
    })
  }

  serialize() {
    return {
      desc: this.desc,
      title: this.title,
      image: this.image,
      model: this.model,
      avatar: this.avatar,
      public: this.public,
      playerLimit: this.playerLimit,
      llmProvider: this.llmProvider,
      llmProviders: this.llmProviders,
      llmModel: this.llmModel,
    }
  }

  preFixedUpdate() {
    if (!this.changes) return
    this.emit('change', this.changes)
    this.changes = null
  }

  modify(key, value) {
    if (this[key] === value) return
    const prev = this[key]
    this[key] = value
    if (!this.changes) this.changes = {}
    if (!this.changes[key]) this.changes[key] = { prev, value: null }
    this.changes[key].value = value
  }

  set(key, value, broadcast) {
    this.modify(key, value)
    if (broadcast) {
      this.world.network.send('settingsModified', { key, value })
    }
  }
}
