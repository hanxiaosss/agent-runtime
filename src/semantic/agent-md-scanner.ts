/**
 * Agent.md Scanner
 * 
 * Scans agent.md (or similar files) to extract red-line rules
 * and convert them to semantic hooks
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ExtractedRule } from './types.js';

/**
 * Common agent instruction file names
 */
const AGENT_FILES = [
  'agent.md',
  'AGENT.md',
  '.agent.md',
  'CLAUDE.md',
  '.claude/CLAUDE.md',
  'COPILOT.md',
  '.github/COPILOT.md',
  '.cursorrules',
  '.cursor/rules.md',
];

/**
 * Rule patterns to detect in agent.md
 */
const RULE_PATTERNS = [
  // Direct prohibitions
  {
    pattern: /(?:don'?t|do not|never|avoid|禁止|不要|不允许)\s+(.+?)(?:\.|$)/gim,
    category: 'custom' as const,
    action: 'deny' as const,
  },
  // Must/should requirements
  {
    pattern: /(?:must|should|always|确保|必须|应该)\s+(.+?)(?:\.|$)/gim,
    category: 'quality' as const,
    action: 'warn' as const,
  },
  // Security rules
  {
    pattern: /(?:security|安全|敏感|secret|密码|密钥)\s*[:：]\s*(.+?)(?:\.|$)/gim,
    category: 'security' as const,
    action: 'deny' as const,
  },
  // Architecture rules
  {
    pattern: /(?:architecture|架构|结构|设计)\s*[:：]\s*(.+?)(?:\.|$)/gim,
    category: 'architecture' as const,
    action: 'warn' as const,
  },
];

/**
 * Scan project for agent instruction files (recursively)
 */
export function findAgentFiles(projectRoot: string): string[] {
  const found: string[] = [];
  
  // File names to match (lowercase for case-insensitive comparison)
  const targetFiles = new Set([
    'agent.md',
    'agents.md',
    '.agent.md',
    '.agents.md',
    'claude.md',
    'copilot.md',
    '.cursorrules',
  ]);
  
  // Directories to skip
  const skipDirs = new Set([
    'node_modules',
    '.git',
    '.harness',
    '.vscode',
    'dist',
    'build',
    '.next',
    '.nuxt',
    'coverage',
    '.cache',
  ]);
  
  function scanDirectory(dir: string): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          // Skip common non-essential directories
          if (!skipDirs.has(entry.name.toLowerCase())) {
            scanDirectory(fullPath);
          }
        } else if (entry.isFile()) {
          // Check if file name matches (case-insensitive)
          const lowerName = entry.name.toLowerCase();
          if (targetFiles.has(lowerName)) {
            found.push(fullPath);
          }
        }
      }
    } catch {
      // Ignore permission errors or other read errors
    }
  }
  
  // Start recursive scan from project root
  scanDirectory(projectRoot);
  
  return found;
}

/**
 * Extract rules from agent.md content
 */
export function extractRules(content: string, sourceFile: string): ExtractedRule[] {
  const rules: ExtractedRule[] = [];
  const lines = content.split('\n');
  
  // Track current section
  let currentSection = '';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Detect section headers
    if (line.startsWith('#')) {
      currentSection = line.replace(/^#+\s*/, '').trim().toLowerCase();
      continue;
    }
    
    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith('//') || line.trim().startsWith('<!--')) {
      continue;
    }
    
    // Try to match rule patterns
    for (const { pattern, category, action } of RULE_PATTERNS) {
      pattern.lastIndex = 0; // Reset regex
      let match;
      
      while ((match = pattern.exec(line)) !== null) {
        const ruleText = match[1].trim();
        
        // Skip very short or generic matches
        if (ruleText.length < 5) continue;
        
        // Generate rule name from text
        const name = generateRuleName(ruleText);
        
        // Determine if it's a file pattern, command pattern, or general rule
        const extractedRule = classifyRule(ruleText, {
          name,
          description: ruleText,
          category,
          pattern: extractPattern(ruleText),
          action,
          feedback: generateFeedback(ruleText, action),
          source: {
            file: sourceFile,
            line: i + 1,
          },
        });
        
        rules.push(extractedRule);
      }
    }
    
    // Also check for bullet points with rules
    if (line.match(/^[\s]*[-*•]\s+/)) {
      const ruleText = line.replace(/^[\s]*[-*•]\s+/, '').trim();
      
      if (isRuleLike(ruleText)) {
        const name = generateRuleName(ruleText);
        const category = categorizeRule(ruleText, currentSection);
        const action = determineAction(ruleText);
        
        rules.push({
          name,
          description: ruleText,
          category,
          pattern: extractPattern(ruleText),
          action,
          feedback: generateFeedback(ruleText, action),
          source: {
            file: sourceFile,
            line: i + 1,
          },
        });
      }
    }
  }
  
  // Remove duplicates
  return deduplicateRules(rules);
}

/**
 * Check if text looks like a rule
 */
function isRuleLike(text: string): boolean {
  const ruleIndicators = [
    /don'?t/i,
    /do not/i,
    /never/i,
    /avoid/i,
    /must/i,
    /should/i,
    /always/i,
    /禁止/i,
    /不要/i,
    /必须/i,
    /不允许/i,
    /不能/i,
    /protect/i,
    /ensure/i,
  ];
  
  return ruleIndicators.some(pattern => pattern.test(text));
}

/**
 * Generate a rule name from text
 */
function generateRuleName(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

/**
 * Extract pattern from rule text
 */
function extractPattern(text: string): string {
  // Try to extract specific patterns
  const patterns = [
    // File patterns
    /([^\s]+\.[a-z]+)/i,
    // Command patterns
    /`([^`]+)`/,
    // Path patterns
    /(\/[^\s]+)/,
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1];
    }
  }
  
  // Return the whole text as pattern
  return text;
}

/**
 * Classify rule based on content
 */
function classifyRule(text: string, baseRule: ExtractedRule): ExtractedRule {
  // Check for file-related rules
  if (/\.(ts|js|tsx|jsx|vue|py|go|rs)$/.test(text) || /file|文件/.test(text)) {
    baseRule.category = 'quality';
  }
  
  // Check for security-related rules
  if (/secret|password|key|token|密码|密钥|敏感/.test(text)) {
    baseRule.category = 'security';
    baseRule.action = 'deny';
  }
  
  // Check for database-related rules
  if (/database|db|sql|migration|数据库/.test(text)) {
    baseRule.category = 'architecture';
  }
  
  // Check for environment-related rules
  if (/production|prod|staging|env|环境|生产/.test(text)) {
    baseRule.category = 'security';
    baseRule.action = 'deny';
  }
  
  return baseRule;
}

/**
 * Categorize rule based on text and section
 */
function categorizeRule(text: string, section: string): ExtractedRule['category'] {
  if (/security|安全|secret|密码/.test(text) || section.includes('security')) {
    return 'security';
  }
  if (/architecture|架构|结构/.test(text) || section.includes('architecture')) {
    return 'architecture';
  }
  if (/performance|性能|optimize/.test(text) || section.includes('performance')) {
    return 'performance';
  }
  if (/quality|code|代码|style/.test(text) || section.includes('quality')) {
    return 'quality';
  }
  return 'custom';
}

/**
 * Determine action based on rule text
 */
function determineAction(text: string): ExtractedRule['action'] {
  if (/don'?t|do not|never|禁止|不要|不允许|不能/.test(text)) {
    return 'deny';
  }
  if (/must|always|必须|应该/.test(text)) {
    return 'warn';
  }
  return 'warn';
}

/**
 * Generate feedback message
 */
function generateFeedback(text: string, action: ExtractedRule['action']): string {
  const prefix = action === 'deny' ? 'Blocked: ' : 'Warning: ';
  return prefix + text;
}

/**
 * Remove duplicate rules
 */
function deduplicateRules(rules: ExtractedRule[]): ExtractedRule[] {
  const seen = new Set<string>();
  return rules.filter(rule => {
    const key = rule.name;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * Scan project and extract all rules
 */
export async function scanProjectRules(projectRoot: string): Promise<ExtractedRule[]> {
  const agentFiles = findAgentFiles(projectRoot);
  const allRules: ExtractedRule[] = [];
  
  for (const file of agentFiles) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const rules = extractRules(content, file);
      allRules.push(...rules);
    } catch {
      // Ignore read errors
    }
  }
  
  return deduplicateRules(allRules);
}
