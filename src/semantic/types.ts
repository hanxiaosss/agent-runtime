/**
 * Semantic Hook System - Core Types
 *
 * Provides semantic-level hook interfaces for project-specific rules.
 * Semantic hooks use multi-dimensional matching (tool_name × file_path ×
 * content × command × mcp_server × mcp_operation × file_type) to detect
 * intent-level patterns in agent behaviour.
 */

import type { UnifiedEvent, EventName } from '../core/event.js';

/**
 * Semantic context provided to hooks.
 * Built by `buildSemanticContext()` from a UnifiedEvent — extractors
 * populate every dimension so rules can match on any combination.
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

  /**
   * Pre-extracted dimension values — the raw strings that rules match
   * against.  Populated by `buildSemanticContext()` so individual hooks
   * don't have to re-parse the event payload.
   */
  dimensions?: {
    tool_name: string;
    file_path: string;
    content: string;
    command: string;
    mcp_server: string;
    mcp_operation: string;
    file_type: string;
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
  modifiedInput?: Record<string, unknown>;
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

// ─── Semantic Rule (multi-dimensional) ───────────────────────────────
//
// A "semantic rule" is the canonical unit of semantic-level matching.
// Unlike declarative policy rules (which match on event payload fields
// via dot-notation paths), semantic rules match on *operational
// dimensions* — the "what is the agent trying to do" rather than
// "which event field has what value".
//
// Dimensions are AND across, OR within:
//   • all specified dimensions must match
//   • within a dimension, any pattern can match

/**
 * Multi-dimensional match condition.
 * At least one dimension must be specified.
 */
export interface SemanticMatchDimensions {
  /** Tool name (Write, Bash, mcp__server__op, …) */
  tool_name?: string[];
  /** File path glob */
  file_path?: string[];
  /** Content pattern (written file content, inline code, …) */
  content?: string[];
  /** Shell command pattern (from Bash/terminal tool input.command) */
  command?: string[];
  /** MCP server name */
  mcp_server?: string[];
  /** MCP operation name */
  mcp_operation?: string[];
  /** File type / extension (ts, py, go, sql, …) */
  file_type?: string[];
}

/**
 * A semantic rule — the core unit of semantic-level hook matching.
 */
export interface SemanticRule {
  /** Rule name (unique identifier) */
  name: string;
  /** Human-readable description */
  description: string;
  /** Source label: 'built-in' | 'agent-md' | 'tech-stack' | file path */
  source: string;
  /** Source line number (if from a file) */
  line?: number;

  /**
   * Which events this rule applies to.
   * Default: ['tool.before', 'code.before_modify', 'mcp.before']
   * Supports glob: 'tool.*', '*'
   */
  events?: string[];

  /** Whether this rule is enabled. Default: true */
  enabled?: boolean;

  /**
   * Priority — lower numbers run first and win ties.
   * Default: 100
   */
  priority?: number;

  /** Multi-dimensional match condition */
  match: SemanticMatchDimensions;

  /** Action to take when matched */
  action: 'deny' | 'warn' | 'modify';

  /** Feedback message shown to the agent */
  feedback: string;

  /** Suggestions for the agent */
  suggestions?: string[];

  /**
   * When action is 'modify', this payload is merged into the tool
   * input before execution.
   */
  modifiedInput?: Record<string, unknown>;

  /**
   * Optional reflection prompt for agent self-analysis.
   * When provided, the hook returns a引导性问题 that prompts the agent
   * to reflect on potential risks, rather than calling an external LLM.
   * 
   * This is a zero-cost, zero-latency approach using agent self-analysis.
   * 
   * Example:
   *   reflection_prompt: "Check if this code might expose sensitive data like API keys or tokens in logs"
   */
  reflection_prompt?: string;

}
