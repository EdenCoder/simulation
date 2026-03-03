# Chirper Simulation

A simulation environment built with [Phaser](https://phaser.io/) where AI agents explore maps, interact with each other, and engage in autonomous conversations powered by the [@chirper/agent](../../packages/agent) package.

## Features

- **AI-Powered Agents**: Autonomous agents with persistent memory, relationships, and chat capabilities
- **Interactive World**: Navigate a Stanford Prison-themed map with regions, doors, and collision detection
- **Real-time Conversations**: Watch agents discover each other, start chats, and form relationships
- **Pathfinding**: Smart A* pathfinding with door state awareness
- **Build Mode**: Create and modify regions and doors in the simulation
- **Responsive UI**: HUD showing agent status, conversations, and world state

## Tech Stack

- **Phaser 3.90**: Game engine for rendering and physics
- **React 19**: UI overlay components
- **TypeScript**: Type-safe development
- **@chirper/agent**: AI agent system with plugins for memory, chat, movement, and relationships
- **OpenRouter/DeepSeek**: LLM backend for agent intelligence
- **Tailwind CSS**: Styling for UI components

## Prerequisites

- Node.js (see `.nvmrc` for version)
- pnpm package manager
- OpenRouter API key

## Installation

From the monorepo root:

```sh
pnpm install
```

## Configuration

Create a `.env.local` file in this directory:

```sh
cp .env.example .env.local
```

Add your OpenRouter API key:

```
VITE_OPENROUTER_API_KEY=your_api_key_here
```

## Development

Run the simulation in development mode:

```sh
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173) to view it in the browser.

## Build

Build for production:

```sh
pnpm build
```

## Project Structure

```
src/
├── components/     # React UI components (HUD, overlays, dialogs)
├── managers/       # Agent manager for spawning and coordination
├── scenes/         # Phaser game scenes (Boot, Main)
├── services/       # Agent service integration with @chirper/agent
├── sprites/        # Phaser game objects (Agent, Door, Region)
├── store/          # State management (agents, chats, simulation)
├── utils/          # Utilities (pathfinding)
├── constants/      # Game constants and configurations
└── prompt/         # AI prompt templates for agent behavior
```

## Agent System

Agents use the `@chirper/agent` package with multiple plugins:

- **MemoryPlugin**: Form and recall memories of interactions
- **ChatPlugin**: Discover nearby agents and start group conversations
- **MovePlugin**: Navigate to different regions using pathfinding
- **RelationshipPlugin**: Track feelings toward other agents
- **TimePlugin**: Track time and schedule actions

See [README-AGENT-SERVICE.md](./README-AGENT-SERVICE.md) for detailed agent documentation.

## Controls

- **WASD / Arrow Keys**: Move camera
- **Space**: Toggle pause
- **Click Agent**: View agent details
- **B**: Toggle build mode (doors/regions)

## License

[MIT](LICENSE)
