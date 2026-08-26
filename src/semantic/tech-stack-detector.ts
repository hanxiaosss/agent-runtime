/**
 * Tech Stack Detector
 * 
 * Detects project technology stack from package.json, file structure, etc.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TechStack } from './types.js';

/**
 * Detect technology stack from project root
 */
export async function detectTechStack(projectRoot: string): Promise<TechStack> {
  const technologies: string[] = [];
  let framework: string | undefined;
  let language = 'unknown';
  let packageManager: string | undefined;
  let database: string | undefined;
  let confidence = 0;

  // Check package.json
  const packageJsonPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };

      // Detect language
      language = 'javascript';
      confidence += 0.3;

      // Detect framework
      if (allDeps['next']) {
        framework = 'nextjs';
        technologies.push('nextjs');
        confidence += 0.2;
      } else if (allDeps['react']) {
        framework = 'react';
        technologies.push('react');
        confidence += 0.2;
      } else if (allDeps['vue']) {
        framework = 'vue';
        technologies.push('vue');
        confidence += 0.2;
      } else if (allDeps['@angular/core']) {
        framework = 'angular';
        technologies.push('angular');
        confidence += 0.2;
      } else if (allDeps['svelte']) {
        framework = 'svelte';
        technologies.push('svelte');
        confidence += 0.2;
      }

      // Detect database
      if (allDeps['prisma'] || allDeps['@prisma/client']) {
        database = 'prisma';
        technologies.push('prisma');
        confidence += 0.1;
      } else if (allDeps['mongoose']) {
        database = 'mongodb';
        technologies.push('mongodb');
        confidence += 0.1;
      } else if (allDeps['typeorm']) {
        database = 'typeorm';
        technologies.push('typeorm');
        confidence += 0.1;
      } else if (allDeps['sequelize']) {
        database = 'sequelize';
        technologies.push('sequelize');
        confidence += 0.1;
      }

      // Detect other technologies
      if (allDeps['typescript']) {
        technologies.push('typescript');
        confidence += 0.1;
      }
      if (allDeps['express']) {
        technologies.push('express');
      }
      if (allDeps['fastify']) {
        technologies.push('fastify');
      }
      if (allDeps['nest']) {
        technologies.push('nestjs');
      }

      // Detect package manager
      if (fs.existsSync(path.join(projectRoot, 'pnpm-lock.yaml'))) {
        packageManager = 'pnpm';
      } else if (fs.existsSync(path.join(projectRoot, 'yarn.lock'))) {
        packageManager = 'yarn';
      } else if (fs.existsSync(path.join(projectRoot, 'package-lock.json'))) {
        packageManager = 'npm';
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Check for Python
  if (fs.existsSync(path.join(projectRoot, 'requirements.txt')) ||
      fs.existsSync(path.join(projectRoot, 'pyproject.toml')) ||
      fs.existsSync(path.join(projectRoot, 'setup.py'))) {
    language = 'python';
    technologies.push('python');
    confidence += 0.3;

    // Detect Python frameworks
    if (fs.existsSync(path.join(projectRoot, 'manage.py'))) {
      framework = 'django';
      technologies.push('django');
      confidence += 0.2;
    }
  }

  // Check for Go
  if (fs.existsSync(path.join(projectRoot, 'go.mod'))) {
    language = 'go';
    technologies.push('go');
    confidence += 0.3;
  }

  // Check for Rust
  if (fs.existsSync(path.join(projectRoot, 'Cargo.toml'))) {
    language = 'rust';
    technologies.push('rust');
    confidence += 0.3;
  }

  // Check for Docker
  if (fs.existsSync(path.join(projectRoot, 'Dockerfile'))) {
    technologies.push('docker');
    confidence += 0.1;
  }

  // Check for database files
  const dbFiles = ['*.db', '*.sqlite', '*.sqlite3'];
  for (const pattern of dbFiles) {
    // Simple check - in production would use glob
    if (fs.existsSync(path.join(projectRoot, 'database.sqlite')) ||
        fs.existsSync(path.join(projectRoot, 'db.sqlite'))) {
      database = database || 'sqlite';
      technologies.push('sqlite');
      confidence += 0.1;
      break;
    }
  }

  // Check for migration directories
  const migrationDirs = ['migrations', 'migrate', 'prisma/migrations'];
  for (const dir of migrationDirs) {
    if (fs.existsSync(path.join(projectRoot, dir))) {
      technologies.push('database-migrations');
      confidence += 0.1;
      break;
    }
  }

  return {
    technologies,
    framework,
    language,
    packageManager,
    database,
    confidence: Math.min(confidence, 1),
  };
}

/**
 * Get preset semantic hooks based on tech stack
 */
export function getPresetHooks(techStack: TechStack): string[] {
  const hooks: string[] = [];

  // Database protection
  if (techStack.database || techStack.technologies.includes('database-migrations')) {
    hooks.push('database-protection');
  }

  // React/Vue security
  if (techStack.framework === 'react' || techStack.framework === 'nextjs') {
    hooks.push('react-security');
  }
  if (techStack.framework === 'vue') {
    hooks.push('vue-security');
  }

  // Environment protection
  hooks.push('environment-protection');

  // Secret detection
  hooks.push('secret-detection');

  // Production protection
  hooks.push('production-protection');

  return hooks;
}
