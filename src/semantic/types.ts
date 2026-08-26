/**
 * Semantic Hook System - Core Types
 * 
 * Provides semantic-level hook interfaces for project-specific rules
 */

import type { UnifiedEvent } from '../core/event.js';

/**
 * Semantic context provided to hooks
 */
export interface SemanticContext {
  /** The unified event being processed */
  event: UnifiedEvent;
  
  /** Code context (if available) */
  code?: {
    filePath: string;
    fileType: string;
    content?: string;
    language?: string;
  };
  
  /** Project context */
  project?: {
    root: string;
    name: string;
    techStack: string[];
    environment?: 'development' | 'staging' | 'production';
  };
  
  /** Detected intent (if analyzed) */
  intent?: {
    action: string;
    target: string;
    confidence: number;
  };
}

/**
 * Match result from semantic hook detection
 */
export interface SemanticMatch {
  /** Hook name that matched */
  hookName: string;
  
  /** Confidence score (0-1) */
  confidence: number;
  
  /** Rule that triggered the match */
  rule: string;
  
  /** Evidence supporting the match */
  evidence: string[];
  
  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * Decision from semantic hook evaluation
 */
export interface SemanticDecision {
  /** Action to take */
  action: 'allow' | 'deny' | 'warn' | 'modify';
  
  /** Reason for the decision */
  reason: string;
  
  /** Feedback message for the agent */
  feedback?: string;
  
  /** Suggestions for the agent */
  suggestions?: string[];
  
  /** Modified input (if action is 'modify') */
  modifiedInput?: any;
}

/**
 * Semantic hook interface
 */
export interface SemanticHook {
  /** Unique hook name */
  name: string;
  
  /** Human-readable description */
  description: string;
  
  /** Hook version */
  version: string;
  
  /** Source of the hook (tech-stack | agent-md | custom) */
  source: 'tech-stack' | 'agent-md' | 'custom' | 'built-in';
  
  /** Detect if this hook matches the context */
  detect(context: SemanticContext): Promise<SemanticMatch | null>;
  
  /** Evaluate and return decision */
  evaluate(match: SemanticMatch, context: SemanticContext): Promise<SemanticDecision>;
}

/**
 * Rule extracted from agent.md
 */
export interface ExtractedRule {
  /** Rule name/identifier */
  name: string;
  
  /** Rule description */
  description: string;
  
  /** Rule category */
  category: 'security' | 'quality' | 'architecture' | 'performance' | 'custom';
  
  /** Pattern to match */
  pattern: string;
  
  /** Action to take */
  action: 'deny' | 'warn' | 'modify';
  
  /** Feedback message */
  feedback: string;
  
  /** Source file and line */
  source: {
    file: string;
    line?: number;
  };
}

/**
 * Tech stack detection result
 */
export interface TechStack {
  /** Detected technologies */
  technologies: string[];
  
  /** Framework */
  framework?: string;
  
  /** Language */
  language: string;
  
  /** Package manager */
  packageManager?: string;
  
  /** Database (if detected) */
  database?: string;
  
  /** Confidence score */
  confidence: number;
}

/**
 * Semantic hook configuration
 */
export interface SemanticHookConfig {
  /** Enable/disable hook */
  enabled: boolean;
  
  /** Hook-specific configuration */
  config?: Record<string, any>;
  
  /** Override default patterns */
  patterns?: string[];
  
  /** Override default feedback */
  feedback?: string;
}
