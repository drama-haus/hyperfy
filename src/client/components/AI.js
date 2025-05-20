import { useState, useEffect, useRef } from 'react'

import { Pane } from './Sidebar'
import { storage } from '../../core/storage'

import { css } from '@firebolt-dev/css'
import {
  MessageSquareTextIcon,
  BrainCircuitIcon,
  SendIcon,
  XIcon,
  Trash2Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  PlusCircleIcon,
  AlertCircleIcon,
  LoaderIcon,
  MessagesSquareIcon,
  HistoryIcon,
} from 'lucide-react'

// Utility functions
const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

const formatTimestamp = timestamp => {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now - date
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHr = Math.floor(diffMin / 60)
  const diffDays = Math.floor(diffHr / 24)
  const diffWeeks = Math.floor(diffDays / 7)
  const diffMonths = Math.floor(diffDays / 30)
  const diffYears = Math.floor(diffDays / 365)

  if (diffSec < 60) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffWeeks < 5) return `${diffWeeks}w ago`
  if (diffMonths < 12) return `${diffMonths}mo ago`
  return `${diffYears}y ago`
}

const truncateText = (text, maxLength = 60) => {
  if (!text) return ''
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength) + '...'
}

// Shared tool log related styles
const toolStyles = {
  toolLog: {
    margin: '0.875rem 0',
    borderRadius: '0.375rem',
    overflow: 'hidden',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    background: 'transparent',
    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.2)',
    position: 'relative',
    width: '100%',
  },
  toolHeader: {
    background: 'transparent',
    padding: '0.625rem 0.875rem',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'row',
    flexWrap: 'nowrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
  },
  toolName: {
    fontWeight: 'bold',
    display: 'flex',
    alignItems: 'center',
    color: 'rgba(255, 255, 255, 0.9)',
    fontFamily: 'monospace',
    wordBreak: 'break-word',
    flexGrow: 1,
    marginRight: '0.5rem',
  },
  toolNameError: {
    color: '#ff6666',
  },
  toolExpandIcon: isExpanded => ({
    transition: 'transform 0.2s',
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: '0.7rem',
    flexShrink: 0,
    transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
  }),
  toolDetails: isExpanded => ({
    padding: isExpanded ? '0.75rem' : 0,
    background: 'rgba(0, 0, 0, 0.2)',
    borderTop: '1px solid rgba(255, 255, 255, 0.05)',
    transition: 'all 0.3s ease-in-out',
    maxHeight: isExpanded ? '1000px' : '0',
    opacity: isExpanded ? 1 : 0,
    overflow: 'hidden',
  }),
  sectionTitle: {
    fontWeight: 'bold',
    marginBottom: '0.25rem',
    color: 'rgba(255, 255, 255, 0.7)',
  },
  argsResult: {
    marginBottom: '0.75rem',
    background: 'rgba(0, 0, 0, 0.1)',
    padding: '0.5rem',
    borderRadius: '0.25rem',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    overflowWrap: 'break-word',
    whiteSpace: 'pre-wrap',
    wordWrap: 'break-word',
  },
  error: {
    color: '#ff6666',
    background: 'rgba(255, 102, 102, 0.1)',
    padding: '0.5rem',
    borderRadius: '0.25rem',
    border: '1px solid rgba(255, 102, 102, 0.2)',
    overflowWrap: 'break-word',
    whiteSpace: 'pre-wrap',
    wordWrap: 'break-word',
  },
  pre: {
    margin: 0,
    whiteSpace: 'pre-wrap',
    wordWrap: 'break-word',
  },
}

// Save conversation to history
const saveConversationToHistory = (
  conversation,
  currentQuery,
  conversationId,
  responseSegments,
  toolLogs,
  response
) => {
  // Get existing history map or initialize an empty object
  const historyMap = storage.get('ai-conversation-history-map', {})

  // Use responseSegments and toolLogs from the data if provided
  // Otherwise use the current state
  const finalResponseSegments = [...responseSegments]
  const finalToolLogs = [...toolLogs]

  // Generate or use existing conversation ID
  const convId = conversationId || `conv-${generateId()}`

  // Create/update conversation entry with tool logs and segments
  const conversationEntry = historyMap[convId] || {
    id: convId,
    firstTimestamp: new Date().toISOString(),
    messages: [],
    isMultiTurn: true,
  }

  // Update conversation with latest messages
  const formattedConversation = conversation.map(message => ({
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
  }))

  // Add the assistant's response
  const responseText = response
  conversationEntry.messages = [
    ...formattedConversation,
    {
      role: 'assistant',
      content: responseText,
      responseSegments: finalResponseSegments,
      toolLogs: finalToolLogs,
      timestamp: new Date().toISOString(),
    },
  ]

  // Update timestamp to sort by most recent activity
  conversationEntry.lastTimestamp = new Date().toISOString()
  conversationEntry.lastQuery = currentQuery

  // Save updated conversation to the map
  historyMap[convId] = conversationEntry

  // Save the updated map to storage
  storage.set('ai-conversation-history-map', historyMap)

  return convId
}

// Shared CSS for AI components
const sharedStyles = css`
  .noscrollbar {
    scrollbar-width: none; /* Firefox */
    -ms-overflow-style: none; /* IE and Edge */

    &::-webkit-scrollbar {
      display: none; /* Chrome, Safari and Opera */
    }
  }

  .scrollable {
    &::-webkit-scrollbar {
      width: 8px;
    }

    &::-webkit-scrollbar-track {
      background: rgba(0, 0, 0, 0.1);
      border-radius: 4px;
    }

    &::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.1);
      border-radius: 4px;

      &:hover {
        background: rgba(255, 255, 255, 0.2);
      }
    }

    /* Firefox scrollbar */
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.1) rgba(0, 0, 0, 0.1);
  }

  .response-text {
    margin: 0;
    white-space: pre-wrap;
    font-family: inherit;
    font-size: inherit;
    line-height: 1.5;
  }
`

function ToolLogRenderer({ tool, isExpanded, onToggleExpanded }) {
  if (!tool) return null

  return (
    <div style={toolStyles.toolLog}>
      <div style={toolStyles.toolHeader} onClick={() => onToggleExpanded(tool.id)}>
        <div
          style={{
            ...toolStyles.toolName,
            ...(tool.type === 'error' ? toolStyles.toolNameError : {}),
          }}
        >
          {tool.type === 'error' ? '❌ ' : '🔧 '}
          {tool.tool}
        </div>
        <div style={toolStyles.toolExpandIcon(isExpanded)}>{<ChevronDownIcon />}</div>
      </div>
      <div style={toolStyles.toolDetails(isExpanded)}>
        <div style={toolStyles.argsResult}>
          <div style={toolStyles.sectionTitle}>Arguments:</div>
          <pre style={toolStyles.pre}>{JSON.stringify(tool.args, null, 2)}</pre>
        </div>

        {tool.result && (
          <div style={toolStyles.argsResult}>
            <div style={toolStyles.sectionTitle}>Result:</div>
            <pre style={toolStyles.pre}>{JSON.stringify(tool.result, null, 2)}</pre>
          </div>
        )}

        {tool.error && (
          <div style={toolStyles.error}>
            <div style={toolStyles.sectionTitle}>Error:</div>
            <pre style={toolStyles.pre}>{tool.error}</pre>
          </div>
        )}
      </div>
    </div>
  )
}

// Common message rendering component for both current response and conversation history
const ResponseContent = ({ segments, toolLogs, expandedTools, onToggleToolExpanded, isFromHistory = false }) => {
  const [autoExpandedTools, setAutoExpandedTools] = useState({})
  const [lastToolId, setLastToolId] = useState(null)
  const [lastSegmentCount, setLastSegmentCount] = useState(0)
  const [isTransitioning, setIsTransitioning] = useState(false)

  // Track when new text segments arrive
  useEffect(() => {
    // Skip for history view or during transitions
    if (isFromHistory || isTransitioning) return

    // Check if we have more segments than before
    if (segments.length > lastSegmentCount) {
      setLastSegmentCount(segments.length)

      // If we have a lastToolId and a new segment has arrived, collapse that tool
      if (lastToolId) {
        // Find the position of the last tool in segments
        const lastToolPosition = segments.findIndex(s => s.type === 'tool' && s.id === lastToolId)

        // If there are new segments after the last tool, collapse it
        if (lastToolPosition !== -1 && lastToolPosition < segments.length - 1) {
          // Mark that we're transitioning to prevent double-triggering
          setIsTransitioning(true)

          // Collapse the tool
          onToggleToolExpanded([lastToolId], false)

          // After animation completes, reset transition state
          setTimeout(() => {
            setIsTransitioning(false)
            setLastToolId(null)
          }, 300) // Match with CSS transition time
        }
      }
    }
  }, [segments, lastToolId, lastSegmentCount, onToggleToolExpanded, isFromHistory, isTransitioning])

  // Auto-expand new tools
  useEffect(() => {
    // Skip animation if this is from history or transitioning
    if (isFromHistory || isTransitioning) return

    // Process tools that aren't already tracked
    const newTools = toolLogs.filter(tool => autoExpandedTools[tool.id] === undefined)

    if (newTools.length > 0) {
      // Set all new tools to be initially collapsed
      const initialCollapsed = newTools.reduce((acc, tool) => {
        acc[tool.id] = false
        return acc
      }, {})

      setAutoExpandedTools(prev => ({
        ...prev,
        ...initialCollapsed,
      }))

      // After a short delay, expand them
      setTimeout(() => {
        // Mark that we're transitioning
        setIsTransitioning(true)

        const expanded = newTools.reduce((acc, tool) => {
          acc[tool.id] = true
          return acc
        }, {})

        setAutoExpandedTools(prev => ({
          ...prev,
          ...expanded,
        }))

        onToggleToolExpanded(
          newTools.map(t => t.id),
          true
        )

        // Store the last tool ID so we know what to collapse when a new segment arrives
        if (newTools.length > 0) {
          setLastToolId(newTools[newTools.length - 1].id)
        }

        // Reset transition state after animation completes
        setTimeout(() => {
          setIsTransitioning(false)
        }, 300) // Match with CSS transition time
      }, 300) // Wait 300ms before expanding
    }
  }, [toolLogs, onToggleToolExpanded, isFromHistory, autoExpandedTools, isTransitioning])

  return segments.map((segment, index) => {
    if (segment.type === 'text') {
      return (
        <pre key={`text-${index}`} className='response-text'>
          {segment.content}
        </pre>
      )
    } else if (segment.type === 'tool') {
      const tool = toolLogs.find(log => log.id === segment.id)
      if (tool) {
        const isExpanded = expandedTools[tool.id] || false
        return (
          <div key={`tool-${tool.id || index}`}>
            <ToolLogRenderer tool={tool} isExpanded={isExpanded} onToggleExpanded={onToggleToolExpanded} />
          </div>
        )
      }
    }
    return null
  })
}

export function AISidebar({ world, hidden }) {
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [response, setResponse] = useState('')
  const [responseSegments, setResponseSegments] = useState([])
  const [showResponse, setShowResponse] = useState(false)
  const [authError, setAuthError] = useState(null)
  const [toolLogs, setToolLogs] = useState([])
  const [expandedTools, setExpandedTools] = useState({}) // Track which tools are expanded in the conversation
  const [streamOpen, setStreamOpen] = useState(false)
  const [currentQuery, setCurrentQuery] = useState('')
  const [conversation, setConversation] = useState([]) // Store the entire conversation
  const [continuingConversation, setContinuingConversation] = useState(true) // Whether to continue conversation
  const [conversationId, setConversationId] = useState(null) // Track the current conversation ID
  const [showHistory, setShowHistory] = useState(false) // Toggle between chat and history view
  const inputRef = useRef(null)
  const responseAreaRef = useRef(null)
  const toolLogsRef = useRef([])
  const conversationEndRef = useRef(null) // Reference to scroll to the bottom of the conversation

  // Update ref whenever toolLogs changes
  useEffect(() => {
    toolLogsRef.current = toolLogs
  }, [toolLogs])

  // Auto-resize textarea as content changes
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
      const scrollHeight = inputRef.current.scrollHeight
      inputRef.current.style.height = `${Math.min(scrollHeight, 150)}px`
    }
  }, [input])

  // Scroll response area to bottom when content changes
  useEffect(() => {
    if (responseAreaRef.current) {
      responseAreaRef.current.scrollTop = responseAreaRef.current.scrollHeight
    }
    // Also scroll to the bottom of conversation
    if (conversationEndRef.current) {
      conversationEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [responseSegments, toolLogs, conversation])

  // Set up event listeners for LLM events when component mounts
  useEffect(() => {
    const handleLLMEvent = event => {
      if (!event || !event.type) {
        console.error('[AISidebar] Received malformed event:', event)
        return
      }

      const { type, data } = event

      switch (type) {
        case 'start':
          setIsLoading(true)
          setStatus('Loading...')

          // If starting a new conversation (not continuing), clear previous state
          if (data && data.continueConversation === false) {
            setConversation([
              {
                role: 'user',
                content: currentQuery,
                timestamp: new Date().toISOString(),
              },
            ])
          } else if (currentQuery) {
            // Add the query to conversation only if it's not already the last message
            setConversation(prev => {
              // Check if the last message is from the user with the same content
              const lastMessage = prev.length > 0 ? prev[prev.length - 1] : null
              if (lastMessage?.role === 'user' && lastMessage?.content === currentQuery) {
                // The message is already in the conversation, don't add it again
                return prev
              }

              // Add the new message
              return [
                ...prev,
                {
                  role: 'user',
                  content: currentQuery,
                  timestamp: new Date().toISOString(),
                },
              ]
            })
          }

          setResponseSegments([])
          setResponse('')
          setToolLogs([])
          setStreamOpen(true)
          setShowResponse(true)
          break

        case 'status':
          setStatus(data.status)
          break

        case 'text':
          // Append text to the last segment if it's a text segment
          setResponseSegments(prev => {
            const newSegments = [...prev]
            if (newSegments.length > 0 && newSegments[newSegments.length - 1]?.type === 'text') {
              newSegments[newSegments.length - 1].content += data.text
            } else {
              newSegments.push({ type: 'text', content: data.text })
            }
            return newSegments
          })

          // Also update the full response for history saving
          setResponse(prev => prev + data.text)
          break

        case 'tool_start':
          setStatus(`Using tool: ${data.tool}...`)

          // Create a new tool log with a unique ID
          const toolId = `tool-${generateId()}`
          const newToolLog = {
            id: toolId,
            tool: data.tool,
            type: 'start',
            args: data.args || {},
            expanded: false, // Start collapsed by default
            timestamp: new Date().toISOString(),
          }

          setToolLogs(prev => [...prev, newToolLog])

          // No longer need to set expanded here - the auto-expander will handle this
          // Let the animation handle expansion

          // Insert the tool log in the response segments
          setResponseSegments(prev => [...prev, { type: 'tool', id: toolId }])
          break

        case 'tool_result':
          // Add result to existing tool log
          setToolLogs(prev => {
            const updated = prev.map(log => {
              if (log.tool === data.tool && log.type === 'start' && !log.result) {
                return { ...log, result: data.result, type: 'complete' }
              }
              return log
            })

            return updated
          })

          setStatus(`Tool ${data.tool} completed`)

          // Add a small space after tool result to trigger collapse of the tool
          // when using the new collapsing behavior
          setResponseSegments(prev => {
            // Only add this spacer if the last segment was a tool
            const lastSegment = prev[prev.length - 1]
            if (lastSegment && lastSegment.type === 'tool') {
              return [...prev, { type: 'text', content: '' }]
            }
            return prev
          })

          break

        case 'tool_error':
          setStatus(`Error using tool: ${data.tool}`)

          // Add error to existing tool log
          setToolLogs(prev => {
            const updated = prev.map(log => {
              if (log.tool === data.tool && log.type === 'start') {
                return { ...log, error: data.error, type: 'error' }
              }
              return log
            })

            return updated
          })

          // Add error indication in the response
          setResponseSegments(prev => {
            const newSegments = [...prev]
            newSegments.push({
              type: 'text',
              content: `\n❌ Error using tool ${data.tool}: ${data.error}`,
            })
            return newSegments
          })

          // Update full response text
          setResponse(prev => prev + `\n❌ Error using tool ${data.tool}: ${data.error}`)
          break

        case 'complete':
          setStatus('Done')
          setIsLoading(false)
          setStreamOpen(false)

          // Collapse any open tools to ensure smooth transition
          if (toolLogs.length > 0) {
            const toolIds = toolLogs.map(tool => tool.id)
            toggleToolExpanded(toolIds, false)
          }

          // Add the assistant's response to the conversation
          const responseText = data.response || response
          if (responseText.trim()) {
            setConversation(prev => [
              ...prev,
              {
                role: 'assistant',
                content: responseText,
                responseSegments: data.responseSegments || [...responseSegments],
                toolLogs: data.toolLogs || [...toolLogs],
                timestamp: new Date().toISOString(),
              },
            ])
          }

          // Save this conversation to history after completion
          const convId = saveConversationToHistory(
            conversation,
            currentQuery,
            conversationId,
            data.responseSegments || [...responseSegments],
            data.toolLogs || [...toolLogs],
            responseText
          )

          // Store the conversation ID for future updates
          setConversationId(convId)

          // Instead of immediately clearing response segments, wait for animations to complete
          // This prevents jerky transitions when message completes
          setTimeout(() => {
            // Clear response segments since they're now shown in conversation
            setResponseSegments([])
          }, 500) // Wait for animation to finish before clearing

          setContinuingConversation(true) // Default to continuing conversation
          break

        case 'error':
          try {
            setStatus(`Error: ${data.error || 'An unknown error occurred'}`)
            if (data.error?.includes('auth') || data.error?.includes('permission')) {
              setAuthError('You may not have permission to use this feature.')
            }
          } catch (err) {
            setStatus('An error occurred')
          }
          setIsLoading(false)
          setStreamOpen(false)
          break

        default:
          console.warn(`[AISidebar] Unknown event type: ${type}`)
      }
    }

    world.on('llmEvent', handleLLMEvent)

    return () => {
      world.off('llmEvent', handleLLMEvent)
    }
  }, [world, input, response, responseSegments, toolLogs, currentQuery, expandedTools, conversation, conversationId])

  const handleSubmit = async e => {
    if (e) e.preventDefault()
    const query = input.trim()
    if (!query) return

    try {
      // Store the query before clearing input
      setCurrentQuery(query)

      // Clear previous state (but not conversation)
      setResponse('')
      setResponseSegments([])
      setStatus('Starting...')
      setIsLoading(true)
      setShowResponse(true)
      setAuthError(null)
      setToolLogs([])
      setStreamOpen(true)

      // Use world.ai to process the query
      if (!world.ai) {
        throw new Error('AI system is not available')
      }

      // Send the query to the AI system with continueConversation flag
      world.network.send('aiProcessQuery', {
        query,
        continueConversation: continuingConversation,
      })

      // Clear input after submission
      setInput('')
    } catch (error) {
      console.error('Error sending prompt to AI system:', error)
      setStatus(`Error: ${error.message}`)
      setIsLoading(false)
      setStreamOpen(false)

      if (error.message.includes('auth') || error.message.includes('permission')) {
        setAuthError('You may not have permission to use this feature.')
      }
    }
  }

  const startNewConversation = () => {
    // Clear conversation and set flag to start fresh
    setConversation([])
    setContinuingConversation(false)
    setConversationId(null) // Reset conversation ID for a new conversation

    // Clear UI state
    setResponse('')
    setResponseSegments([])
    setToolLogs([])
    setShowResponse(false)
    setAuthError(null)
    setShowHistory(false)
  }

  const clearResponse = () => {
    setShowResponse(false)

    // Cancel the stream if it's still active
    if (streamOpen) {
      world.network.send('aiCancelStream')
      setStreamOpen(false)
      setIsLoading(false)
    }
  }

  const toggleToolExpanded = (toolIds, forceState) => {
    // Handle both single toolId (string) and arrays of toolIds
    const ids = Array.isArray(toolIds) ? toolIds : [toolIds]

    // Update for tools in conversation history
    setExpandedTools(prev => {
      const newState = { ...prev }
      ids.forEach(id => {
        // If forceState is provided, use it, otherwise toggle
        newState[id] = forceState !== undefined ? forceState : !(prev[id] || false)
      })
      return newState
    })
  }

  // Render a single conversation message
  const renderConversationMessage = (message, index) => {
    const isUser = message.role === 'user'

    return (
      <div key={index} className={`conversation-message ${isUser ? 'user' : 'assistant'}`}>
        <div className='message-header'>
          <div className='message-role'>{isUser ? 'You' : 'Assistant'}</div>
          {/* <div className='message-time'>
            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div> */}
        </div>

        <div className='message-content'>
          {isUser ? (
            <div className='user-query'>{message.content}</div>
          ) : (
            <div>
              {message.responseSegments && message.responseSegments.length > 0 ? (
                <ResponseContent
                  segments={message.responseSegments}
                  toolLogs={message.toolLogs || []}
                  expandedTools={expandedTools}
                  onToggleToolExpanded={toggleToolExpanded}
                  isFromHistory={true}
                />
              ) : (
                <pre className='response-text'>{message.content}</pre>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  const loadConversationFromHistory = historyConversation => {
    if (!historyConversation || !historyConversation.messages) return

    // Set conversation ID for future updates
    setConversationId(historyConversation.id)

    // Load messages from history
    setConversation(historyConversation.messages || [])

    // Switch back to chat view
    setShowHistory(false)

    // Set continuing conversation mode
    setContinuingConversation(true)

    // Show the conversation area
    setShowResponse(true)
  }

  // Add a method to clear history that can be passed to AIHistory
  const handleClearHistory = () => {
    // Clear conversations list in history component by forcing a remount
    setShowHistory(false)
    setTimeout(() => setShowHistory(true), 50)
  }

  return (
    <Pane hidden={hidden} width='30rem'>
      <div
        className='ai-chat'
        css={css`
          ${sharedStyles}

          background: rgba(11, 10, 21, 0.85);
          border: 0.0625rem solid #2a2b39;
          backdrop-filter: blur(5px);
          border-radius: 1rem;
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 30rem;

          .ai-header {
            height: 3.125rem;
            padding: 0 1rem;
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: rgba(21, 20, 36, 0.4);
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            border-top-left-radius: 1rem;
            border-top-right-radius: 1rem;
          }

          .ai-title {
            font-weight: 500;
            font-size: 1rem;
            line-height: 1;
            display: flex;
            align-items: center;
          }

          .ai-controls {
            display: flex;
            gap: 0.25rem;
          }

          .ai-btn {
            width: 2.25rem;
            height: 2.25rem;
            display: flex;
            align-items: center;
            justify-content: center;
            color: rgba(255, 255, 255, 0.5);
            cursor: pointer;
            border-radius: 50%;
            transition: all 0.2s;

            &:hover {
              color: white;
              background: rgba(255, 255, 255, 0.1);
            }
          }

          .ai-body {
            flex: 1;
            overflow: hidden;
            display: flex;
            flex-direction: column;
          }

          .conversation-container {
            flex: 1;
            overflow-y: auto;
            padding: 1rem 0;
            display: flex;
            flex-direction: column;
            gap: 1rem;
          }

          .conversation-message {
            padding: 0 1rem;
            margin-bottom: 1rem;

            &.user {
              align-self: flex-end;
              max-width: 100%;
              text-align: right;
            }

            &.assistant {
              align-self: flex-start;
              max-width: 100%;
            }
          }

          .message-header {
            display: flex;
            justify-content: space-between;
            margin-bottom: 0.25rem;
            font-size: 0.75rem;
          }

          .message-role {
            font-weight: 500;
            color: rgba(255, 255, 255, 0.8);
          }

          .message-time {
            color: rgba(255, 255, 255, 0.5);
          }

          .message-content {
            .user-query {
              padding: 0.75rem 0;
              font-weight: 500;
            }
          }

          .response-area {
            flex: 1;
            background: rgba(0, 0, 0, 0.2);
            border-radius: 0.75rem;
            margin: 1rem;
            padding: 1rem;
            overflow-y: auto;
            white-space: pre-wrap;
            font-family: monospace;
            font-size: 0.875rem;
            line-height: 1.5;

            pre {
              margin: 0;
              white-space: pre-wrap;
              font-size: 0.8125rem;
              max-height: 200px;
              overflow-y: auto;
              background: rgba(0, 0, 0, 0.3);
              padding: 0.625rem;
              border-radius: 0.375rem;
            }
          }

          .query-input {
            padding: 0.75rem 1rem;
            padding-top: 0.5rem;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            background: rgba(0, 0, 0, 0.2);

            .input-container {
              position: relative;
              display: flex;

              .input-controls {
                position: absolute;
                bottom: 0.55rem;
                right: 0.5rem;
                display: flex;
                gap: 0.5rem;
              }

              .new-chat-btn {
                background: rgba(30, 30, 40, 0.7);
                padding: 0.25rem 0.5rem;
                border-radius: 0.375rem;
                font-size: 0.75rem;
                cursor: pointer;
                display: flex;
                align-items: center;

                svg {
                  margin-right: 0.25rem;
                }

                &:hover {
                  background: rgba(40, 40, 50, 0.8);
                }
              }
            }

            textarea {
              flex: 1;
              height: 2.5rem;
              min-height: 2.5rem;
              max-height: 150px;
              resize: none;
              background: rgba(20, 20, 30, 0.7);
              border: 1px solid rgba(255, 255, 255, 0.1);
              border-radius: 0.75rem;
              color: white;
              line-height: 1.5;
              font-size: 0.875rem;
              padding: 0.625rem 1rem;
              padding-right: 3rem;
              outline: none;
              transition: all 0.2s;
              overflow-y: auto;

              &:focus {
                border-color: rgba(255, 255, 255, 0.3);
                background: rgba(25, 25, 35, 0.7);
              }

              &::placeholder {
                color: rgba(255, 255, 255, 0.5);
              }
            }

            .submit-btn {
              position: absolute;
              right: 0.625rem;
              bottom: 50%;
              transform: translateY(50%);
              background: rgba(50, 50, 70, 0.8);
              color: white;
              border-radius: 50%;
              width: 1.75rem;
              height: 1.75rem;
              display: flex;
              align-items: center;
              justify-content: center;
              cursor: pointer;
              transition: all 0.2s;

              &:hover {
                background: rgba(70, 70, 90, 0.9);
              }

              &.loading {
                background: rgba(40, 40, 60, 0.6);
                cursor: not-allowed;
              }

              svg {
                transition: transform 0.2s;
                transform: translateX(0);
              }

              &:hover svg {
                transform: translateX(2px);
              }
            }
          }

          .status-bar {
            font-size: 0.75rem;
            color: rgba(255, 255, 255, 0.6);
            padding: 0 1rem 0.5rem;
            display: flex;
            align-items: center;

            .status-spinner {
              animation: spin 1s linear infinite;
              display: inline-block;
              margin-right: 0.375rem;

              @keyframes spin {
                0% {
                  transform: rotate(0deg);
                }
                100% {
                  transform: rotate(360deg);
                }
              }
            }
          }

          .auth-error {
            margin: 1rem;
            background: rgba(220, 60, 60, 0.2);
            border: 1px solid rgba(220, 60, 60, 0.5);
            border-radius: 0.5rem;
            padding: 0.875rem 1rem;
            font-size: 0.875rem;
            color: rgba(255, 255, 255, 0.9);
          }
        `}
      >
        <div className='ai-header'>
          <div className='ai-title'>
            <BrainCircuitIcon size='1.25rem' style={{ marginRight: '0.5rem' }} />
            {showHistory ? 'Conversations' : 'AI Chat'}
          </div>
          <div className='ai-controls'>
            <div className='ai-btn' onClick={startNewConversation} title='New conversation'>
              <PlusCircleIcon size='1rem' />
            </div>
            {showHistory && (
              <div
                className='ai-btn'
                onClick={() => {
                  if (confirm('Are you sure you want to clear your conversation history?')) {
                    storage.set('ai-conversation-history-map', {})
                    // Use the handleClearHistory to refresh the component
                    handleClearHistory()
                  }
                }}
                title='Clear history'
              >
                <Trash2Icon size='1rem' />
              </div>
            )}
            <div
              className='ai-btn'
              onClick={() => setShowHistory(!showHistory)}
              title={showHistory ? 'Show conversation' : 'Show history'}
            >
              {showHistory ? <MessageSquareTextIcon size='1rem' /> : <HistoryIcon size='1rem' />}
            </div>
          </div>
        </div>

        {showHistory ? (
          <AIHistory
            world={world}
            hidden={false}
            onSelectConversation={loadConversationFromHistory}
            onClearHistory={handleClearHistory}
          />
        ) : (
          <div className='ai-body'>
            {authError && (
              <div className='auth-error'>
                <AlertCircleIcon size='1rem' style={{ marginRight: '0.5rem' }} />
                {authError}
              </div>
            )}

            {conversation.length > 0 ? (
              <div className='conversation-container scrollable noscrollbar' ref={responseAreaRef}>
                {conversation.map(renderConversationMessage)}

                {responseSegments.length > 0 && (
                  <div className='conversation-message assistant'>
                    <div className='message-header'>
                      <div className='message-role'>Assistant</div>
                      <div className='message-time'>Now</div>
                    </div>
                    <div className='message-content'>
                      <ResponseContent
                        segments={responseSegments}
                        toolLogs={toolLogs}
                        expandedTools={expandedTools}
                        onToggleToolExpanded={toggleToolExpanded}
                        isFromHistory={false}
                      />
                    </div>
                  </div>
                )}

                {/* Invisible element to scroll to */}
                <div ref={conversationEndRef} />
              </div>
            ) : isLoading && responseSegments.length > 0 ? (
              <div className='response-area scrollable noscrollbar' ref={responseAreaRef}>
                <ResponseContent
                  segments={responseSegments}
                  toolLogs={toolLogs}
                  expandedTools={expandedTools}
                  onToggleToolExpanded={toggleToolExpanded}
                  isFromHistory={false}
                />
              </div>
            ) : (
              <div
                className='response-area'
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'center',
                  color: 'rgba(255, 255, 255, 0.5)',
                  textAlign: 'center',
                }}
              >
                <BrainCircuitIcon size='3rem' style={{ opacity: 0.5, marginBottom: '1rem' }} />
                <h3 style={{ margin: '0 0 0.5rem' }}>Hyperfy AI Assistant</h3>
                <p style={{ margin: '0 0 1rem', maxWidth: '80%' }}>
                  Ask anything about Hyperfy, request code examples, or get help building your applications.
                </p>
              </div>
            )}
          </div>
        )}

        {!showHistory && (
          <>
            <form onSubmit={handleSubmit} className='query-input'>
              <div className='input-container'>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder='Ask me anything...'
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSubmit()
                    }
                  }}
                  className='noscrollbar'
                />

                <button
                  type={isLoading ? 'button' : 'submit'}
                  className={`submit-btn ${isLoading ? 'loading' : ''}`}
                  onClick={isLoading ? clearResponse : undefined}
                  disabled={!isLoading && !input.trim()}
                >
                  {isLoading ? <XIcon size='0.875rem' /> : <SendIcon size='0.875rem' />}
                </button>
              </div>
            </form>

            {isLoading && (
              <div className='status-bar'>
                <LoaderIcon size='0.75rem' className='status-spinner' />
                {status}
              </div>
            )}
          </>
        )}
      </div>
    </Pane>
  )
}

export function AIHistory({ world, hidden, onSelectConversation, onClearHistory }) {
  const [conversationsMap, setConversationsMap] = useState({})
  const [conversationsList, setConversationsList] = useState([])

  // Load conversation history from local storage
  useEffect(() => {
    loadConversationHistory()
  }, [])

  const loadConversationHistory = () => {
    try {
      // Get history map from local storage
      const historyMap = storage.get('ai-conversation-history-map', {})
      setConversationsMap(historyMap)

      // Create a sorted list for display
      const sortedList = Object.values(historyMap).sort((a, b) => new Date(b.lastTimestamp) - new Date(a.lastTimestamp))
      setConversationsList(sortedList)
    } catch (err) {
      console.error('Failed to load conversation history:', err)
    }
  }

  return (
    <div
      className='ai-history'
      css={css`
        ${sharedStyles}

        display: flex;
        flex-direction: column;
        flex: 1;
        overflow: hidden;

        .history-empty {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          color: rgba(255, 255, 255, 0.5);
          padding: 2rem;

          svg {
            margin-bottom: 1rem;
            opacity: 0.5;
          }
        }

        .history-list {
          flex: 1;
          overflow-y: auto;
          padding: 0.5rem 0;
        }

        .history-item {
          padding: 0.875rem 1rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          cursor: pointer;
          transition: background 0.2s;

          &:hover {
            background: rgba(255, 255, 255, 0.07);
          }

          &:active {
            background: rgba(255, 255, 255, 0.1);
          }

          .history-item-text {
            font-weight: 500;
            margin-bottom: 0.25rem;
          }

          .history-item-meta {
            font-size: 0.75rem;
            color: rgba(255, 255, 255, 0.5);
            display: flex;
            align-items: center;
            justify-content: space-between;
          }

          .history-item-time {
            display: flex;
            align-items: center;
          }

          .multi-turn-indicator {
            display: flex;
            align-items: center;

            svg {
              margin-right: 0.25rem;
            }
          }
        }
      `}
    >
      {conversationsList.length === 0 && (
        <div className='history-empty'>
          <MessageSquareTextIcon size={48} />
          <p>No conversation history yet</p>
        </div>
      )}

      {conversationsList.length > 0 && (
        <div className='history-list scrollable noscrollbar'>
          {conversationsList.map(convo => (
            <div key={convo.id} className='history-item' onClick={() => onSelectConversation(convo)}>
              <div className='history-item-text'>
                {truncateText(convo.lastQuery || convo.messages[0]?.content || '')}
              </div>
              <div className='history-item-meta'>
                <div className='history-item-time'>{formatTimestamp(convo.lastTimestamp)}</div>

                <div className='multi-turn-indicator'>
                  <MessagesSquareIcon size={12} />
                  {convo.messages && convo.messages.length > 0
                    ? `${Math.floor(convo.messages.length / 2)} turns`
                    : 'Conversation'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
