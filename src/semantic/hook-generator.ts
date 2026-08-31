/**
 * Semantic Hook Generator
 *
 * Generates semantic hooks from extracted rules and tech stack.
 *
 * Two output formats:
 *   • `generateHookFromRule()` → legacy `SemanticHook` (detect/evaluate)
 *   • `generateSemanticRuleFromExtracted()` → canonical `SemanticRule`
 *     (multi-dimensional match)
 *
 * Prefer `SemanticRule` for new code.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ExtractedRule, SemanticHook, SemanticContext, SemanticMatch, SemanticDecision, TechStack, SemanticRule, SemanticMatchDimensions } from './types.js';

/**
 * Generate a semantic hook from an extracted rule
 */
export function generateHookFromRule(rule: ExtractedRule): SemanticHook {
  return {
    name: rule.name,
    description: rule.description,
    version: '1.0.0',
    source: 'agent-md',
    
    async detect(context: SemanticContext): Promise<SemanticMatch | null> {
      const { event, code } = context;
      
      // Only check code modification events
      if (event.name !== 'code.before_modify' && event.name !== 'tool.before') {
        return null;
      }
      
      const filePath = code?.filePath || '';
      const content = code?.content || '';
      
      // Get tool name and input based on event type
      let toolName = '';
      let input: any = {};
      
      if (event.name === 'tool.before' && 'payload' in event) {
        const payload = event.payload as any;
        toolName = payload.toolName || '';
        input = payload.input || {};
      }
      
      // Check if rule pattern matches
      const pattern = rule.pattern.toLowerCase();
      const matchEvidence: string[] = [];
      
      // File path matching
      if (filePath && filePath.toLowerCase().includes(pattern)) {
        matchEvidence.push(`File path matches pattern: ${pattern}`);
      }
      
      // Content matching
      if (content && content.toLowerCase().includes(pattern)) {
        matchEvidence.push(`Content matches pattern: ${pattern}`);
      }
      
      // Tool/command matching
      if (toolName && toolName.toLowerCase().includes(pattern)) {
        matchEvidence.push(`Tool name matches pattern: ${pattern}`);
      }
      
      // Input matching
      const inputStr = JSON.stringify(input).toLowerCase();
      if (inputStr.includes(pattern)) {
        matchEvidence.push(`Input matches pattern: ${pattern}`);
      }
      
      // Check for specific dangerous patterns
      const dangerousPatterns = [
        /rm\s+-rf/i,
        /drop\s+table/i,
        /drop\s+database/i,
        /truncate\s+table/i,
        /delete\s+from.*where\s+1\s*=\s*1/i,
        /\.env/i,
        /password/i,
        /secret/i,
        /api[_-]?key/i,
      ];
      
      for (const dp of dangerousPatterns) {
        if (dp.test(pattern) && (dp.test(content) || dp.test(inputStr))) {
          matchEvidence.push(`Dangerous pattern detected: ${dp.toString()}`);
        }
      }
      
      if (matchEvidence.length === 0) {
        return null;
      }
      
      return {
        hookName: rule.name,
        confidence: 0.8,
        rule: rule.description,
        evidence: matchEvidence,
        metadata: {
          source: rule.source,
          category: rule.category,
        },
      };
    },
    
    async evaluate(match: SemanticMatch, context: SemanticContext): Promise<SemanticDecision> {
      return {
        action: rule.action,
        reason: `Rule violation: ${rule.description}`,
        feedback: rule.feedback,
        suggestions: generateSuggestions(rule),
      };
    },
  };
}

/**
 * Generate suggestions based on rule
 */
function generateSuggestions(rule: ExtractedRule): string[] {
  const suggestions: string[] = [];
  
  if (rule.category === 'security') {
    suggestions.push('Review security implications before proceeding');
    suggestions.push('Consider using environment variables for sensitive data');
  }
  
  if (rule.category === 'architecture') {
    suggestions.push('Consult architecture guidelines');
    suggestions.push('Consider impact on system design');
  }
  
  if (rule.category === 'quality') {
    suggestions.push('Follow coding standards');
    suggestions.push('Consider code review implications');
  }
  
  if (rule.description.toLowerCase().includes('production') || 
      rule.description.toLowerCase().includes('prod')) {
    suggestions.push('Use staging environment for testing');
    suggestions.push('Follow deployment pipeline for production changes');
  }
  
  if (rule.description.toLowerCase().includes('database') || 
      rule.description.toLowerCase().includes('migration')) {
    suggestions.push('Backup database before making changes');
    suggestions.push('Test migrations in development first');
  }
  
  return suggestions;
}

/**
 * Generate built-in hooks based on tech stack
 */
export function generateTechStackHooks(techStack: TechStack): SemanticHook[] {
  const hooks: SemanticHook[] = [];
  
  // CRITICAL: Redline protection hook (must be first!)
  hooks.push(createRedlineProtectionHook());
  
  // Database protection hook
  if (techStack.database || techStack.technologies.includes('database-migrations')) {
    hooks.push(createDatabaseProtectionHook());
  }
  
  // React/Vue security hooks
  if (techStack.framework === 'react' || techStack.framework === 'nextjs') {
    hooks.push(createReactSecurityHook());
  }
  if (techStack.framework === 'vue') {
    hooks.push(createVueSecurityHook());
  }
  
  // Environment protection hook (always add)
  hooks.push(createEnvironmentProtectionHook());
  
  // Secret detection hook (always add)
  hooks.push(createSecretDetectionHook());
  
  // Production protection hook (always add)
  hooks.push(createProductionProtectionHook());
  
  return hooks;
}

/**
 * Create redline protection hook
 * CRITICAL: This hook protects agent instruction files and .harness/ directory
 * from being modified by the AI agent itself.
 */
function createRedlineProtectionHook(): SemanticHook {
  return {
    name: 'redline-protection',
    description: 'Protect agent instruction files and harness configuration from modification',
    version: '1.0.0',
    source: 'tech-stack',
    
    async detect(context: SemanticContext): Promise<SemanticMatch | null> {
      const { code, event } = context;
      const filePath = code?.filePath || '';
      
      // Also check tool input for file paths
      let inputFilePath = '';
      if (event.name === 'tool.before' && 'payload' in event) {
        const payload = event.payload as any;
        const input = payload.input || {};
        inputFilePath = input.file_path || input.path || input.file || '';
      }
      
      const pathToCheck = filePath || inputFilePath;
      
      if (!pathToCheck) {
        return null;
      }
      
      // Protected patterns (agent instruction files)
      const redlinePatterns = [
        // Agent instruction files
        { pattern: /(^|\/|\\)agent\.md$/i, name: 'agent.md' },
        { pattern: /(^|\/|\\)AGENT\.md$/i, name: 'AGENT.md' },
        { pattern: /(^|\/|\\)\.agent\.md$/i, name: '.agent.md' },
        { pattern: /(^|\/|\\)CLAUDE\.md$/i, name: 'CLAUDE.md' },
        { pattern: /(^|\/|\\)COPILOT\.md$/i, name: 'COPILOT.md' },
        { pattern: /(^|\/|\\)\.cursorrules$/i, name: '.cursorrules' },
        { pattern: /(^|\/|\\)\.cursor\/rules\.md$/i, name: '.cursor/rules.md' },
        
        // Harness configuration (CRITICAL)
        { pattern: /(^|\/|\\)\.harness\/config\.yaml$/i, name: '.harness/config.yaml' },
        { pattern: /(^|\/|\\)\.harness\/policies\//i, name: '.harness/policies/*' },
        { pattern: /(^|\/|\\)\.harness\/hooks\//i, name: '.harness/hooks/*' },
        { pattern: /(^|\/|\\)\.harness\/semantic-hooks\//i, name: '.harness/semantic-hooks/*' },
      ];
      
      for (const { pattern, name } of redlinePatterns) {
        if (pattern.test(pathToCheck)) {
          return {
            hookName: 'redline-protection',
            confidence: 1.0,  // Maximum confidence - no ambiguity
            rule: `Protected file: ${name}`,
            evidence: [
              `Attempted to modify redline file: ${name}`,
              `File path: ${pathToCheck}`,
              `This file contains agent instructions or harness configuration`,
            ],
            metadata: { 
              protectedFile: name,
              filePath: pathToCheck,
            },
          };
        }
      }
      
      return null;
    },
    
    async evaluate(match: SemanticMatch): Promise<SemanticDecision> {
      return {
        action: 'deny',
        reason: 'Redline file modification blocked',
        feedback: `You cannot modify ${match.metadata?.protectedFile}. This file contains agent instructions or harness configuration that must remain unchanged. Only human users can modify these files.`,
        suggestions: [
          'Do not attempt to modify agent instruction files',
          'Do not attempt to modify .harness/ configuration',
          'If you need to change rules, ask the human user to update the files manually',
          'Continue with your task without modifying protected files',
        ],
      };
    },
  };
}

/**
 * Create database protection hook
 */
function createDatabaseProtectionHook(): SemanticHook {
  return {
    name: 'database-protection',
    description: 'Prevent dangerous database operations',
    version: '1.0.0',
    source: 'tech-stack',
    
    async detect(context: SemanticContext): Promise<SemanticMatch | null> {
      const { code, event } = context;
      const content = code?.content || '';
      const filePath = code?.filePath || '';
      
      // Check for migration files
      if (!filePath.includes('migration') && !filePath.includes('migrate')) {
        return null;
      }
      
      const dangerousPatterns = [
        { pattern: /DROP\s+TABLE/i, name: 'DROP TABLE' },
        { pattern: /DROP\s+DATABASE/i, name: 'DROP DATABASE' },
        { pattern: /TRUNCATE\s+TABLE/i, name: 'TRUNCATE TABLE' },
        { pattern: /DELETE\s+FROM\s+\w+\s+WHERE\s+1\s*=\s*1/i, name: 'DELETE ALL' },
      ];
      
      for (const { pattern, name } of dangerousPatterns) {
        if (pattern.test(content)) {
          return {
            hookName: 'database-protection',
            confidence: 0.95,
            rule: `Dangerous database operation: ${name}`,
            evidence: [`Found ${name} in migration file`],
            metadata: { operation: name },
          };
        }
      }
      
      return null;
    },
    
    async evaluate(match: SemanticMatch): Promise<SemanticDecision> {
      return {
        action: 'deny',
        reason: 'Dangerous database operation detected',
        feedback: 'Database migration contains destructive operations. Please review and remove DROP/TRUNCATE statements.',
        suggestions: [
          'Use ALTER TABLE instead of DROP TABLE',
          'Add conditional checks before DELETE',
          'Create a backup before migration',
        ],
      };
    },
  };
}

/**
 * Create React security hook
 */
function createReactSecurityHook(): SemanticHook {
  return {
    name: 'react-security',
    description: 'Prevent insecure React patterns',
    version: '1.0.0',
    source: 'tech-stack',
    
    async detect(context: SemanticContext): Promise<SemanticMatch | null> {
      const { code } = context;
      const content = code?.content || '';
      
      const insecurePatterns = [
        { pattern: /dangerouslySetInnerHTML/i, name: 'dangerouslySetInnerHTML' },
        { pattern: /innerHTML\s*=/i, name: 'innerHTML' },
        { pattern: /eval\s*\(/i, name: 'eval()' },
      ];
      
      for (const { pattern, name } of insecurePatterns) {
        if (pattern.test(content)) {
          return {
            hookName: 'react-security',
            confidence: 0.85,
            rule: `Insecure React pattern: ${name}`,
            evidence: [`Found ${name} in code`],
            metadata: { pattern: name },
          };
        }
      }
      
      return null;
    },
    
    async evaluate(match: SemanticMatch): Promise<SemanticDecision> {
      return {
        action: 'warn',
        reason: 'Potentially insecure React pattern',
        feedback: `Using ${match.metadata?.pattern} can lead to XSS vulnerabilities. Consider safer alternatives.`,
        suggestions: [
          'Use textContent instead of innerHTML',
          'Sanitize user input before rendering',
          'Use React\'s built-in escaping mechanisms',
        ],
      };
    },
  };
}

/**
 * Create Vue security hook
 */
function createVueSecurityHook(): SemanticHook {
  return {
    name: 'vue-security',
    description: 'Prevent insecure Vue patterns',
    version: '1.0.0',
    source: 'tech-stack',
    
    async detect(context: SemanticContext): Promise<SemanticMatch | null> {
      const { code } = context;
      const content = code?.content || '';
      
      const insecurePatterns = [
        { pattern: /v-html/i, name: 'v-html' },
        { pattern: /eval\s*\(/i, name: 'eval()' },
      ];
      
      for (const { pattern, name } of insecurePatterns) {
        if (pattern.test(content)) {
          return {
            hookName: 'vue-security',
            confidence: 0.85,
            rule: `Insecure Vue pattern: ${name}`,
            evidence: [`Found ${name} in code`],
            metadata: { pattern: name },
          };
        }
      }
      
      return null;
    },
    
    async evaluate(match: SemanticMatch): Promise<SemanticDecision> {
      return {
        action: 'warn',
        reason: 'Potentially insecure Vue pattern',
        feedback: `Using ${match.metadata?.pattern} can lead to XSS vulnerabilities. Consider safer alternatives.`,
        suggestions: [
          'Use text interpolation instead of v-html',
          'Sanitize user input before rendering',
          'Use Vue\'s built-in escaping mechanisms',
        ],
      };
    },
  };
}

/**
 * Create environment protection hook
 */
function createEnvironmentProtectionHook(): SemanticHook {
  return {
    name: 'environment-protection',
    description: 'Prevent modification of environment files',
    version: '1.0.0',
    source: 'tech-stack',
    
    async detect(context: SemanticContext): Promise<SemanticMatch | null> {
      const { code } = context;
      const filePath = code?.filePath || '';
      
      const envPatterns = [
        /\.env$/,
        /\.env\.local$/,
        /\.env\.production$/,
        /\.env\.staging$/,
      ];
      
      for (const pattern of envPatterns) {
        if (pattern.test(filePath)) {
          return {
            hookName: 'environment-protection',
            confidence: 0.9,
            rule: 'Environment file modification',
            evidence: [`File matches environment pattern: ${pattern.toString()}`],
            metadata: { filePath },
          };
        }
      }
      
      return null;
    },
    
    async evaluate(match: SemanticMatch): Promise<SemanticDecision> {
      return {
        action: 'warn',
        reason: 'Environment file modification detected',
        feedback: 'Modifying environment files can affect application configuration. Ensure changes are intentional.',
        suggestions: [
          'Verify the changes are necessary',
          'Document the reason for changes',
          'Consider using version control for tracking',
        ],
      };
    },
  };
}

/**
 * Create secret detection hook
 */
function createSecretDetectionHook(): SemanticHook {
  return {
    name: 'secret-detection',
    description: 'Detect hardcoded secrets',
    version: '1.0.0',
    source: 'tech-stack',
    
    async detect(context: SemanticContext): Promise<SemanticMatch | null> {
      const { code } = context;
      const content = code?.content || '';
      
      const secretPatterns = [
        { pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}['"]/i, name: 'hardcoded password' },
        { pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][^'"]{8,}['"]/i, name: 'hardcoded API key' },
        { pattern: /(?:secret|token)\s*[:=]\s*['"][^'"]{8,}['"]/i, name: 'hardcoded secret' },
        { pattern: /-----BEGIN\s+(RSA|DSA|EC|OPENSSH)\s+PRIVATE\s+KEY-----/, name: 'private key' },
      ];
      
      for (const { pattern, name } of secretPatterns) {
        if (pattern.test(content)) {
          return {
            hookName: 'secret-detection',
            confidence: 0.95,
            rule: `Hardcoded secret detected: ${name}`,
            evidence: [`Found ${name} in code`],
            metadata: { type: name },
          };
        }
      }
      
      return null;
    },
    
    async evaluate(match: SemanticMatch): Promise<SemanticDecision> {
      return {
        action: 'deny',
        reason: 'Hardcoded secret detected',
        feedback: 'Never hardcode secrets in source code. Use environment variables or a secrets manager.',
        suggestions: [
          'Use environment variables (process.env)',
          'Use a secrets manager (AWS Secrets Manager, HashiCorp Vault)',
          'Use .env files (and add to .gitignore)',
        ],
      };
    },
  };
}

/**
 * Create production protection hook
 */
function createProductionProtectionHook(): SemanticHook {
  return {
    name: 'production-protection',
    description: 'Prevent direct production modifications',
    version: '1.0.0',
    source: 'tech-stack',
    
    async detect(context: SemanticContext): Promise<SemanticMatch | null> {
      const { code } = context;
      const filePath = code?.filePath || '';
      
      const prodPatterns = [
        /prod(uction)?\.ya?ml$/i,
        /prod(uction)?\.json$/i,
        /prod(uction)?\.env$/i,
        /\/prod(uction)?\//i,
      ];
      
      for (const pattern of prodPatterns) {
        if (pattern.test(filePath)) {
          return {
            hookName: 'production-protection',
            confidence: 0.9,
            rule: 'Production file modification',
            evidence: [`File matches production pattern: ${pattern.toString()}`],
            metadata: { filePath },
          };
        }
      }
      
      return null;
    },
    
    async evaluate(match: SemanticMatch): Promise<SemanticDecision> {
      return {
        action: 'deny',
        reason: 'Production configuration modification blocked',
        feedback: 'Direct modification of production configuration is not allowed. Use deployment pipeline instead.',
        suggestions: [
          'Modify staging/dev configuration first',
          'Use CI/CD pipeline for production deployment',
          'Contact DevOps for production changes',
        ],
      };
    },
  };
}

/**
 * Save generated hooks to file
 */
export function saveHooksToFile(hooks: SemanticHook[], outputPath: string): void {
  const hookData = hooks.map(hook => ({
    name: hook.name,
    description: hook.description,
    version: hook.version,
    source: hook.source,
  }));

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(hookData, null, 2));
}

// ─── ExtractedRule → SemanticRule ───────────────────────────────────
//
// Converts rules extracted from agent.md (via `scanProjectRules()`)
// into the canonical `SemanticRule` format.
//
// The heuristic inspects the rule text and places the extracted
// pattern into the most appropriate dimension:
//   • file-like patterns (contains '.' or '/')  → file_path
//   • back-ticked commands                       → command
//   • everything else                            → content

/**
 * Convert an `ExtractedRule` into a `SemanticRule`.
 */
export function generateSemanticRuleFromExtracted(rule: ExtractedRule): SemanticRule {
  const match: SemanticMatchDimensions = {};
  const pattern = rule.pattern.trim();

  // Heuristic: which dimension does this pattern belong to?
  if (pattern.includes('/') || /\.\w{1,5}$/.test(pattern)) {
    // Looks like a file path
    match.file_path = [pattern.includes('*') ? pattern : `**/${pattern}`];
  } else if (pattern.startsWith('`') && pattern.endsWith('`')) {
    // Back-ticked command
    match.command = [pattern.slice(1, -1)];
  } else {
    // General content match
    match.content = [pattern];
  }

  return {
    name: rule.name,
    description: rule.description,
    source: rule.source.file,
    line: rule.source.line,
    match,
    action: rule.action,
    feedback: rule.feedback,
    suggestions: generateSuggestions(rule),
  };
}

/**
 * Batch-convert extracted rules into semantic rules.
 */
export function generateSemanticRulesFromExtracted(rules: ExtractedRule[]): SemanticRule[] {
  return rules.map(generateSemanticRuleFromExtracted);
}
