/**
 * Semantic Hook Engine
 * 
 * Orchestrates semantic hooks and integrates with policy engine
 */

import type { SemanticHook, SemanticContext, SemanticMatch, SemanticDecision, ExtractedRule, TechStack } from './types.js';
import { generateHookFromRule, generateTechStackHooks, saveHooksToFile } from './hook-generator.js';
import { detectTechStack } from './tech-stack-detector.js';
import { scanProjectRules } from './agent-md-scanner.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Semantic hook engine
 */
export class SemanticHookEngine {
  private hooks: Map<string, SemanticHook> = new Map();
  private enabled: boolean = true;
  
  /**
   * Register a semantic hook
   */
  register(hook: SemanticHook): void {
    this.hooks.set(hook.name, hook);
  }
  
  /**
   * Unregister a semantic hook
   */
  unregister(name: string): void {
    this.hooks.delete(name);
  }
  
  /**
   * Get all registered hooks
   */
  getHooks(): SemanticHook[] {
    return Array.from(this.hooks.values());
  }
  
  /**
   * Get hooks by source
   */
  getHooksBySource(source: SemanticHook['source']): SemanticHook[] {
    return this.getHooks().filter(h => h.source === source);
  }
  
  /**
   * Enable/disable the engine
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
  
  /**
   * Evaluate all hooks against a context
   */
  async evaluate(context: SemanticContext): Promise<SemanticDecision[]> {
    if (!this.enabled) {
      return [];
    }
    
    const decisions: SemanticDecision[] = [];
    
    for (const hook of this.hooks.values()) {
      try {
        const match = await hook.detect(context);
        
        if (match) {
          const decision = await hook.evaluate(match, context);
          decisions.push(decision);
        }
      } catch (error) {
        console.error(`Semantic hook ${hook.name} failed:`, error);
      }
    }
    
    return decisions;
  }
  
  /**
   * Get the most restrictive decision
   */
  resolveDecisions(decisions: SemanticDecision[]): SemanticDecision | null {
    if (decisions.length === 0) {
      return null;
    }
    
    // Priority: deny > modify > warn > allow
    const priority = { deny: 0, modify: 1, warn: 2, allow: 3 };
    
    return decisions.reduce((most, current) => {
      return priority[current.action] < priority[most.action] ? current : most;
    });
  }
  
  /**
   * Initialize hooks from project
   */
  async initializeFromProject(projectRoot: string): Promise<void> {
    // Detect tech stack
    const techStack = await detectTechStack(projectRoot);
    
    // Generate tech stack hooks
    const techHooks = generateTechStackHooks(techStack);
    for (const hook of techHooks) {
      this.register(hook);
    }
    
    // Scan for agent.md rules
    const rules = await scanProjectRules(projectRoot);
    
    // Generate hooks from rules
    for (const rule of rules) {
      const hook = generateHookFromRule(rule);
      this.register(hook);
    }
    
    // Save hook metadata
    const hooksDir = path.join(projectRoot, '.harness', 'semantic-hooks');
    saveHooksToFile(this.getHooks(), path.join(hooksDir, 'hooks.json'));
  }
  
  /**
   * Sync hooks with project (re-scan and update)
   */
  async syncWithProject(projectRoot: string): Promise<{
    added: string[];
    removed: string[];
    updated: string[];
  }> {
    const previousHooks = new Set(this.hooks.keys());
    
    // Clear existing hooks
    this.hooks.clear();
    
    // Re-initialize
    await this.initializeFromProject(projectRoot);
    
    const currentHooks = new Set(this.hooks.keys());
    
    // Calculate diff
    const added = Array.from(currentHooks).filter(h => !previousHooks.has(h));
    const removed = Array.from(previousHooks).filter(h => !currentHooks.has(h));
    const updated = Array.from(currentHooks).filter(h => previousHooks.has(h));
    
    return { added, removed, updated };
  }
}

/**
 * Create and initialize a semantic hook engine
 */
export async function createSemanticEngine(projectRoot: string): Promise<SemanticHookEngine> {
  const engine = new SemanticHookEngine();
  await engine.initializeFromProject(projectRoot);
  return engine;
}

/**
 * Build semantic context from event
 */
export function buildSemanticContext(
  event: any,
  projectRoot: string,
  techStack?: TechStack
): SemanticContext {
  const code = event.payload?.input?.file_path 
    ? {
        filePath: event.payload.input.file_path,
        fileType: path.extname(event.payload.input.file_path).slice(1),
        content: event.payload.input.content,
      }
    : undefined;
  
  return {
    event,
    code,
    project: {
      root: projectRoot,
      name: path.basename(projectRoot),
      techStack: techStack?.technologies || [],
    },
  };
}
