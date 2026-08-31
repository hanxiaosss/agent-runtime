/**
 * Semantic Hook System
 *
 * Provides semantic-level hooks for project-specific rules.
 * The multi-dimensional `SemanticRuleEngine` is the recommended API;
 * the legacy `SemanticHook` interface is retained for backward compatibility.
 */

export * from './types.js';
export * from './engine.js';
export * from './rule-engine.js';
export * from './hook-generator.js';
export * from './tech-stack-detector.js';
export * from './agent-md-scanner.js';
export * from './adapter.js';
