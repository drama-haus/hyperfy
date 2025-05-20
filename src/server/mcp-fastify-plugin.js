import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

// import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { EventEmitter } from 'node:events'

// type SessionEvents = {
//   connected: [string];
//   terminated: [string];
//   error: [unknown];
// };

export class Sessions extends EventEmitter {
  // private readonly sessions: Map<string, SSEServerTransport>;
  // private readonly playerSessions: Map<string, Set<string>>;

  constructor() {
    super({ captureRejections: true })
    this.sessions = new Map()
    // Map of player IDs to session IDs
    this.playerSessions = new Map()
  }

  add = (id, transport, playerId = null) => {
    if (this.sessions.has(id)) {
      throw new Error('Session already exists')
    }

    this.sessions.set(id, transport)
    
    // If a player ID is provided, associate this session with the player
    if (playerId) {
      if (!this.playerSessions.has(playerId)) {
        this.playerSessions.set(playerId, new Set())
      }
      this.playerSessions.get(playerId).add(id)
    }
    
    this.emit('connected', id, playerId)
  }

  remove = id => {
    // Find and remove any player associations
    for (const [playerId, sessionIds] of this.playerSessions.entries()) {
      if (sessionIds.has(id)) {
        sessionIds.delete(id)
        // Clean up empty player entries
        if (sessionIds.size === 0) {
          this.playerSessions.delete(playerId)
        }
        break
      }
    }
    
    this.sessions.delete(id)
    this.emit('terminated', id)
  }

  get = id => {
    return this.sessions.get(id)
  }
  
  // Get all sessions for a specific player
  getByPlayer = playerId => {
    if (!playerId || !this.playerSessions.has(playerId)) {
      return []
    }
    
    return Array.from(this.playerSessions.get(playerId))
      .map(sessionId => this.sessions.get(sessionId))
      .filter(Boolean)
  }
  
  // Associate an existing session with a player
  associateWithPlayer = (sessionId, playerId) => {
    if (!this.sessions.has(sessionId)) {
      return false
    }
    
    if (!this.playerSessions.has(playerId)) {
      this.playerSessions.set(playerId, new Set())
    }
    
    this.playerSessions.get(playerId).add(sessionId)
    return true
  }

  get count() {
    return this.sessions.size
  }
  
  get playerCount() {
    return this.playerSessions.size
  }

  [Symbol.iterator]() {
    return this.sessions.values()
  }
}


// type MCPSSEPluginOptions = {
//   server: Server;
//   sessions?: Sessions;
//   sseEndpoint?: string;
//   messagesEndpoint?: string;
//   allowLocalOnly?: boolean;
//   authHandler?: (authToken: string) => Promise<string|null>; // Function to validate auth and return player ID
// };


// FastifyPluginCallback<MCPSSEPluginOptions>
export const fastifyMCPSSE = (
  fastify,
  options,
  done,
) => {
  const {
    server,
    sessions = new Sessions(),
    sseEndpoint = "/sse",
    messagesEndpoint = "/messages",
    allowLocalOnly = true,
    authHandler = null, // Optional auth handler function
  } = options;


  // sessions.on("connected", (sessionId) => {
  //   console.log(`Session ${sessionId} connected`);
  // });
  
  // sessions.on("terminated", (sessionId) => {
  //   console.log(`Session ${sessionId} terminated`);
  // });

  // Helper function to check if request is from localhost
  function isLocalhost(req) {
    const ip = req.ip || req.socket.remoteAddress;
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  }

  fastify.get(sseEndpoint, async (req, reply) => {
    // Validate request comes from localhost if restriction is enabled
    if (allowLocalOnly && !isLocalhost(req)) {
      fastify.log.warn("Rejected non-localhost connection attempt", { ip: req.ip });
      reply.status(403).send({ error: "Access denied" });
      return;
    }

    // Get the auth token if provided
    const authToken = req.query.authToken || req.headers.authorization?.replace('Bearer ', '');
    let playerId = null;
    
    // If authHandler is provided and auth token exists, get the player ID
    if (authHandler && authToken) {
      try {
        playerId = await authHandler(authToken);
      } catch (err) {
        fastify.log.warn("Failed to authenticate session", { error: err.message });
      }
    }

    const transport = new SSEServerTransport(messagesEndpoint, reply.raw);
    const sessionId = transport.sessionId;

    // Add session with player ID if available
    sessions.add(sessionId, transport, playerId);

    reply.raw.on("close", () => {
      sessions.remove(sessionId);
    });

    fastify.log.info("Starting new session", { sessionId, playerId });
    await server.connect(transport);
  });

  fastify.post(messagesEndpoint, async (req, reply) => {
    // Validate request comes from localhost if restriction is enabled
    if (allowLocalOnly && !isLocalhost(req)) {
      fastify.log.warn("Rejected non-localhost connection attempt", { ip: req.ip });
      reply.status(403).send({ error: "Access denied" });
      return;
    }
    
    const sessionId = extractSessionId(req);
    if (!sessionId) {
      reply.status(400).send({ error: "Invalid session" });
      return;
    }

    const transport = sessions.get(sessionId);
    if (!transport) {
      reply.status(400).send({ error: "Invalid session" });
      return;
    }

    await transport.handlePostMessage(req.raw, reply.raw, req.body);
  });

  return done();
};

// req: FastifyRequest
function extractSessionId(req) {
  if (typeof req.query !== "object" || req.query === null) {
    return undefined;
  }

  if ("sessionId" in req.query === false) {
    return undefined;
  }

  const sessionId = req.query["sessionId"];
  if (typeof sessionId !== "string") {
    return undefined;
  }

  return sessionId;
}