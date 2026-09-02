/**
 * Architecture Matcher
 *
 * Detects architectural layers from file paths and enforces
 * layer dependency rules.
 * Configuration: .harness/architecture.yaml
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface ArchitectureLayer {
  name: string;
  patterns: string[];
  description?: string;
}

export interface LayerDependencyRule {
  from: string;
  to: string;
  allowed: boolean;
  feedback?: string;
  suggestions?: string[];
}

export interface ArchitectureConfig {
  layers: ArchitectureLayer[];
  rules: LayerDependencyRule[];
}

export interface ArchitectureViolation {
  rule: LayerDependencyRule;
  fromLayer: string;
  toLayer: string;
  feedback: string;
  suggestions: string[];
}

export function loadArchitectureConfig(harnessDir: string): ArchitectureConfig | null {
  const configPath = path.join(harnessDir, "architecture.yaml");
  if (!fs.existsSync(configPath)) return null;
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    return parseArchitectureYaml(raw);
  } catch {
    return null;
  }
}

export function detectLayer(filePath: string, config: ArchitectureConfig): string | null {
  const normalized = filePath.replace(/\\/g, "/");
  for (const layer of config.layers) {
    for (const pattern of layer.patterns) {
      if (matchLayerPattern(normalized, pattern)) {
        return layer.name;
      }
    }
  }
  return null;
}

function matchLayerPattern(filePath: string, pattern: string): boolean {
  const regexStr = "^" + pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*") + "$";
  const regex = new RegExp(regexStr, "i");
  return regex.test(filePath);
}

export function checkArchitectureViolation(
  fromFile: string,
  toFile: string,
  config: ArchitectureConfig,
): ArchitectureViolation | null {
  const fromLayer = detectLayer(fromFile, config);
  const toLayer = detectLayer(toFile, config);
  if (!fromLayer || !toLayer) return null;
  if (fromLayer === toLayer) return null;

  for (const rule of config.rules) {
    const fromMatch = matchLayerName(fromLayer, rule.from);
    const toMatch = matchLayerName(toLayer, rule.to);
    if (fromMatch && toMatch && !rule.allowed) {
      return {
        rule,
        fromLayer,
        toLayer,
        feedback: rule.feedback || "Layer " + fromLayer + " cannot directly access " + toLayer,
        suggestions: rule.suggestions || [
          "Use the proper abstraction layer between " + fromLayer + " and " + toLayer,
        ],
      };
    }
  }
  return null;
}

function matchLayerName(layerName: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.includes("*")) {
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$", "i");
    return regex.test(layerName);
  }
  return layerName === pattern;
}

export function checkToolArchitecture(
  toolInput: Record<string, unknown>,
  config: ArchitectureConfig,
): ArchitectureViolation | null {
  const command = String(toolInput.command || "");
  const filePath = String(toolInput.file_path || toolInput.path || toolInput.file || "");
  const content = String(toolInput.content || toolInput.text || "");

  if (command) {
    const importRegex = /(?:import|require|from)\s+['"]([^'"]+)['"]/g;
    let m;
    while ((m = importRegex.exec(command)) !== null) {
      const importPath = m[1];
      if (filePath) {
        const violation = checkArchitectureViolation(filePath, importPath, config);
        if (violation) return violation;
      }
    }
  }

  if (content && filePath) {
    const importLines = content.split("\n").filter(
      (line) => /(?:import|require|from)\s+['"]/.test(line),
    );
    for (const line of importLines) {
      const pathMatch = line.match(/['"]([^'"]+)['"]/);
      if (pathMatch) {
        const violation = checkArchitectureViolation(filePath, pathMatch[1], config);
        if (violation) return violation;
      }
    }
  }

  return null;
}

function parseArchitectureYaml(content: string): ArchitectureConfig {
  const config: ArchitectureConfig = { layers: [], rules: [] };
  const lines = content.split("\n");

  let section = "";
  let currentLayer: ArchitectureLayer | null = null;
  let currentRule: Partial<LayerDependencyRule> | null = null;
  let inPatterns = false;
  let inSuggestions = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (trimmed === "layers:") { section = "layers"; continue; }
    if (trimmed === "rules:") { section = "rules"; continue; }

    if (section === "layers") {
      if (trimmed.startsWith("- name:")) {
        if (currentLayer) config.layers.push(currentLayer);
        currentLayer = { name: trimmed.replace("- name:", "").trim(), patterns: [] };
        inPatterns = false;
        continue;
      }
      if (currentLayer && trimmed.startsWith("patterns:")) {
        inPatterns = true;
        continue;
      }
      if (currentLayer && inPatterns && trimmed.startsWith("- ")) {
        currentLayer.patterns.push(trimmed.slice(2).trim());
        continue;
      }
      if (currentLayer && trimmed.startsWith("description:")) {
        currentLayer.description = trimmed.replace("description:", "").trim();
        inPatterns = false;
        continue;
      }
    }

    if (section === "rules") {
      if (trimmed.startsWith("- from:")) {
        if (currentRule && currentRule.from && currentRule.to) {
          config.rules.push(currentRule as LayerDependencyRule);
        }
        currentRule = { from: trimmed.replace("- from:", "").trim(), allowed: true };
        inSuggestions = false;
        continue;
      }
      if (currentRule) {
        if (trimmed.startsWith("to:")) {
          currentRule.to = trimmed.replace("to:", "").trim();
          continue;
        }
        if (trimmed.startsWith("allowed:")) {
          currentRule.allowed = trimmed.replace("allowed:", "").trim() === "true";
          continue;
        }
        if (trimmed.startsWith("feedback:")) {
          currentRule.feedback = trimmed.replace("feedback:", "").trim().replace(/^['"]|['"]$/g, "");
          continue;
        }
        if (trimmed.startsWith("suggestions:")) {
          inSuggestions = true;
          currentRule.suggestions = [];
          continue;
        }
        if (inSuggestions && trimmed.startsWith("- ")) {
          if (!currentRule.suggestions) currentRule.suggestions = [];
          currentRule.suggestions.push(trimmed.slice(2).trim().replace(/^['"]|['"]$/g, ""));
          continue;
        }
      }
    }
  }

  if (currentLayer) config.layers.push(currentLayer);
  if (currentRule && currentRule.from && currentRule.to) {
    config.rules.push(currentRule as LayerDependencyRule);
  }

  return config;
}
