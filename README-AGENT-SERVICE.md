# Agent Service Integration Guide

This document explains how to use the new AI-powered agent conversation system in the Chirper Simulation, which integrates the `@chirper/agent` package with all its plugins.

## Overview

The agent service provides sophisticated AI-powered conversations between simulation agents using:

- **Action Plugin**: Dice-based action resolution with success/failure outcomes
- **Memory Plugin**: Persistent memory formation and recall
- **Mood Plugin**: Sims-style needs and mood system
- **Relationship Plugin**: Dynamic relationship tracking between agents
- **Alliance Plugin**: Group formation and betrayal mechanics

## Architecture

```
Agent Store (Source of Truth) 
    ↓
ConversationService (New Service)
    ↓
@chirper/agent (AgentService + All Plugins)
    ↓
Phaser Bridge (Visual Updates)
```

## Quick Start

### 1. Initialize the Service

```typescript
import { initializeConversationService } from './services/agent';

// Initialize with your OpenAI API key
initializeConversationService('your-openai-api-key');
```

### 2. Start a Conversation

```typescript
import { conversationService } from './services/agent';

// Start conversation between two agents
const result = await conversationService.startConversation('agent_0', 'agent_12');
console.log(`Conversation ended: ${result.reason}`);
```

### 3. Listen to Events

```typescript
// Listen to speech events
conversationService.on('speech', (event) => {
  console.log(`${event.data.agentName}: "${event.data.content}"`);
});

// Listen to action events
conversationService.on('action', (event) => {
  console.log(`${event.data.agentName} ${event.data.action} - ${event.data.success ? 'SUCCESS' : 'FAILURE'}`);
});
```

## Features

### 🎲 Action System

Agents can attempt actions with dice rolls:

```xml
<action>
  <emoji>🏃</emoji>
  <description>Running toward the exit</description>
  <difficulty>12</difficulty>
</action>
```

- **Difficulty**: 1-20 scale (1=very easy, 20=very hard)
- **Dice Roll**: d20 against difficulty
- **Outcomes**: LLM-generated contextual results

### 🧠 Memory System

Agents form memories of significant interactions:

- **Conversation Memories**: Summaries of interactions
- **Action Memories**: Important successes/failures
- **Relationship Memories**: Changes in feelings toward others
- **Decay System**: Memories fade over time but important ones persist

### 😊 Mood & Needs

Sims-style needs that affect behavior:

- **Energy**: Physical tiredness
- **Hunger**: Need for food
- **Social**: Need for interaction
- **Hygiene**: Personal cleanliness
- **Comfort**: Physical comfort
- **Fun**: Entertainment needs
- **Bladder**: Bathroom needs
- **Environment**: Satisfaction with surroundings

### 💕 Relationship System

Dynamic relationships between agents:

- **Scale**: -100 (hostile) to +100 (loyal)
- **Action-Based**: Relationships change based on actions
- **Bidirectional**: Each agent has feelings about every other agent
- **Context-Aware**: Considers roles (prisoner vs guard)

### 🤝 Alliance System

Group dynamics and partnerships:

- **Alliance Types**: Temporary, permanent, secret, conditional
- **Loyalty Tracking**: 0-100 loyalty scale
- **Betrayal Mechanics**: Agents can betray alliances
- **Group Actions**: Coordinated activities between allies

## Integration Points

### Agent Store Integration

The service uses the existing agent store as the single source of truth:

```typescript
// Agent data is automatically synced
const agentData = getAgentData('agent_0');
console.log(agentData.memories); // Updated by MemoryPlugin
```

### Phaser Integration

Visual updates happen automatically via the Phaser bridge:

- **Speech Bubbles**: Automatically displayed for agent speech
- **Action Results**: Shown as temporary speech bubbles
- **Position Updates**: Agent movements reflected in game
- **Emoji Updates**: Mood and action indicators

### React Integration

Use the ConversationManager component for control:

```tsx
import { ConversationManager } from './components/ConversationManager';

function App() {
  return (
    <div>
      <ConversationManager />
      {/* Your other components */}
    </div>
  );
}
```

## API Reference

### ConversationService

#### Methods

- `startConversation(agent1Id, agent2Id, ...additionalAgents)`: Start a conversation
- `isAgentInConversation(agentId)`: Check if agent is busy
- `getActiveConversations()`: Get list of active conversations
- `stopAllConversations()`: Force stop all conversations

#### Events

- `'speech'`: Agent spoke something
- `'action'`: Agent attempted an action
- `'move'`: Agent moved position
- `'agent_updated'`: Agent properties changed
- `'started'`: Conversation began
- `'ended'`: Conversation completed

### Utility Functions

```typescript
// Start a random conversation
const result = await startRandomConversation();

// Initialize with API key
initializeConversationService('sk-...');
```

## Configuration

### Conversation Settings

```typescript
const conversationService = new ConversationService({
  maxMessages: 6,           // Messages per conversation
  debug: true,              // Enable debug logging
  conversationCooldown: 20000 // 20 second cooldown
});
```

### Plugin Settings

Each plugin can be configured when creating the AgentService:

```typescript
// Example: Custom mood settings
.use(new MoodPlugin({
  decayRate: 1.0,
  criticalThreshold: 20,
  enableUrgentBehaviors: true
}))
```

## Agent Object Structure

Agents are typed as `any` for flexibility, but typically contain:

```typescript
{
  id: string;
  name: string;
  role: 'prisoner' | 'guard';
  personality: string;
  position: { x: number; y: number };
  
  // Plugin-specific fields (initialized automatically)
  memories: Memory[];
  relationships: Map<string, number>;
  mood: MoodState;
  alliances: Alliance[];
}
```

## Example Conversation Flow

1. **Collision Detection**: Agents collide in Phaser
2. **Service Check**: Verify agents aren't busy
3. **Conversation Start**: Create AgentService with plugins
4. **LLM Generation**: Agents take turns speaking
5. **Plugin Processing**: Actions, memories, relationships updated
6. **Visual Updates**: Speech bubbles, positions updated in Phaser
7. **Natural Ending**: Conversation concludes based on content
8. **Memory Formation**: Agents remember the interaction

## Troubleshooting

### Common Issues

1. **"Cannot find module '@chirper/agent'"**
   - Ensure the agent package is properly installed
   - Check import paths are correct

2. **"OpenAI API key not provided"**
   - Initialize the service with a valid API key
   - Check environment variables

3. **"Agents already in conversation"**
   - Check if agents are busy before starting
   - Wait for conversations to complete

### Debug Mode

Enable debug logging to see detailed conversation flow:

```typescript
const conversationService = new ConversationService({
  debug: true
});
```

## Best Practices

1. **Always Initialize**: Set up the API key before starting conversations
2. **Check Availability**: Verify agents aren't busy before starting
3. **Handle Errors**: Wrap conversation starts in try-catch blocks
4. **Monitor Events**: Listen to events for real-time updates
5. **Respect Cooldowns**: Don't spam conversation starts
6. **Type Safety**: Use TypeScript interfaces for better development experience

## Future Enhancements

- **Custom Plugins**: Add simulation-specific plugins
- **Conversation Templates**: Pre-defined conversation scenarios
- **Advanced AI Models**: Support for different LLM providers
- **Conversation Analytics**: Detailed conversation statistics
- **Save/Load**: Persist agent states between sessions

## Support

For issues or questions:

1. Check the console for debug messages
2. Verify API key configuration
3. Ensure all dependencies are installed
4. Review the agent store data structure
5. Test with simple two-agent conversations first