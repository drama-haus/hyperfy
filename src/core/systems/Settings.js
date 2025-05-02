import { System } from './System'

export class Settings extends System {
  constructor(world) {
    super(world)

    this.title = null
    this.desc = null
    this.model = null
    this.avatar = null
    this.public = null
    this.playerLimit = null
    this.llmProvider = null
    this.llmProviders = [] // Array of available LLM providers
    this.llmModel = null  // Model to use for the current provider

    this.changes = null
  }

  deserialize(data) {
    this.title = data.title
    this.desc = data.desc
    this.model = data.model
    this.avatar = data.avatar
    this.public = data.public
    this.playerLimit = data.playerLimit
    this.llmProvider = data.llmProvider || null
    this.llmProviders = data.llmProviders || []
    this.llmModel = data.llmModel || null
    this.emit('change', {
      title: { value: this.title },
      desc: { value: this.desc },
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
