import Phaser from 'phaser';

import { Agent, Door } from '../sprites';
import { useAgentsStore, type AgentState } from '../store/agents';
import { useSimulationStore } from '../store/simulation';
import { setAgentManager } from '../bridge';

/**
 * Manages all Agents in the game world
 * 
 * Features:
 * - Spawns Agents at valid, non-colliding positions
 * - Handles collisions between Agents and world
 * - Manages Agent conversations and interactions
 * - Updates React overlay with position data
 * - Provides cleanup for all Agents
 */
export class AgentManager {
  // Core components
  private scene : Phaser.Scene;
  private agentList : Agent[] = [];
  private collisionLayer!: Phaser.Tilemaps.TilemapLayer;
  private doors!: Phaser.Physics.Arcade.Group;

  constructor(
    scene: Phaser.Scene,
    collisionLayer: Phaser.Tilemaps.TilemapLayer,
    doors: Phaser.Physics.Arcade.Group
  ) {
    this.scene = scene;
    this.collisionLayer = collisionLayer;
    this.doors = doors;
    setAgentManager(this);
  }


  /**
   * Set the doors group for pathfinding
   */

  /**
   * Spawn all agents from the Zustand store
   */
  spawnAgents() {
    const agents = useAgentsStore.getState().getAllAgents();
    agents.forEach((agentData) => {
      this.spawnSingleAgent(agentData);
    });
  }

  /**
   * Update all Agents and sync positions with centralized store
   */
  update(time : number, delta : number) {
    this.updateAllAgents(time, delta);
    this.updatePositionsInStore();
  }

  /**
   * Get all managed Agents
   */
  getAgents() : Agent[] {
    return [...this.agentList]; // Return copy to prevent external modification
  }

  getAgentById(agentId: string): Agent | undefined {
    return this.agentList.find(agent => agent.getId() === agentId);
  }

  /**
   * Destroy all Agents and clean up resources
   */
  destroyAll() {
    this.agentList.forEach((agent) => agent.destroy());
    this.agentList = [];
  }

  /**
   * Spawn a single Agent with collision setup
   */
  private spawnSingleAgent(agentData: AgentState) {
    const agent = this.createAgent(agentData);
    this.setupAgentCollisions(agent);
    this.agentList.push(agent);
  }

  /**
   * Create a new Agent from store data
   */
  private createAgent(agentData: AgentState) {
    const agent = new Agent(this.scene, {
      id: agentData.id,
      name: agentData.name,
      characterType: agentData.characterType,
      x: agentData.x,
      y: agentData.y,
      tint: agentData.tint,
      speed: agentData.speed,
      role: agentData.role as 'prisoner' | 'guard',
    });
    agent.setWorldLayer(this.collisionLayer, this.doors);
    return agent;
  }

  /**
   * Setup collision detection for an Agent
   */
  private setupAgentCollisions(agent : Agent) {
    // Collision with world boundaries/walls
    this.scene.physics.add.collider(agent, this.collisionLayer);

    // Agents no longer collide with each other
  }

  /**
   * Update all Agents in the simulation
   */
  private updateAllAgents(time : number, delta : number) {
    this.agentList.forEach((agent) => {
      agent.update(time, delta);
    });
  }

  /**
   * Update agent positions in the Zustand store
   */
  private updatePositionsInStore() {
    const simStore = useSimulationStore.getState();
    const agentsStore = useAgentsStore.getState();

    this.agentList.forEach(agent => {
      const screenPos = simStore.worldToScreen(agent.x, agent.y);
      agentsStore.updatePosition(agent.getId(), screenPos.x, screenPos.y);
    });
  }

}