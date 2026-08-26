# Semantic Hook System - Implementation Summary

## Overview

Implemented a **semantic-level hook system** that goes beyond simple event matching to understand project context, tech stack, and natural language rules from agent instruction files.

## What Was Implemented

### 1. Core Semantic Hook Engine (`src/semantic/`)

#### **types.ts** - Type Definitions
- `SemanticHook` interface for project-level hooks
- `SemanticContext` for passing event + project context
- `SemanticMatch` and `SemanticDecision` for hook results
- `ExtractedRule` for rules parsed from agent.md
- `TechStack` for detected technologies

#### **engine.ts** - Hook Orchestration
- `SemanticHookEngine` class to manage semantic hooks
- Automatic initialization from project context
- Sync functionality to update hooks when rules change
- Integration with policy engine

#### **tech-stack-detector.ts** - Technology Detection
- Detects frameworks: React, Vue, Next.js, Angular, Svelte
- Detects databases: Prisma, MongoDB, TypeORM, Sequelize, SQLite
- Detects languages: JavaScript, TypeScript, Python, Go, Rust
- Detects package managers: npm, yarn, pnpm
- Generates preset hooks based on detected stack

#### **agent-md-scanner.ts** - Rule Extraction
- Scans multiple agent instruction files:
  - `agent.md`, `AGENT.md`, `.agent.md`
  - `CLAUDE.md`, `.claude/CLAUDE.md`
  - `COPILOT.md`, `.github/COPILOT.md`
  - `.cursorrules`, `.cursor/rules.md`
- Extracts rules using pattern matching:
  - Prohibitions: "don't", "never", "avoid", "禁止", "不要"
  - Requirements: "must", "should", "always", "必须", "应该"
  - Security rules, architecture rules, quality rules
- Converts natural language to semantic hooks

#### **hook-generator.ts** - Hook Generation
- Generates semantic hooks from extracted rules
- Creates built-in hooks based on tech stack:
  - `database-protection` - Prevent dangerous DB operations
  - `react-security` - Prevent insecure React patterns
  - `vue-security` - Prevent insecure Vue patterns
  - `environment-protection` - Protect .env files
  - `secret-detection` - Detect hardcoded secrets
  - `production-protection` - Protect production configs

### 2. CLI Integration

#### **sync.ts** - New Command
```bash
hannah sync [dir]
```
- Re-scans agent.md for rule changes
- Re-detects tech stack
- Updates semantic hooks
- Saves hook metadata to `.harness/semantic-hooks/hooks.json`

#### **init.ts** - Enhanced Initialization
- Automatically runs semantic hook initialization after setup
- Displays detected tech stack and generated hooks
- Shows count of tech stack hooks vs agent.md hooks

### 3. Documentation

#### **USAGE.md** - Complete Usage Guide
- Quick start guide
- Core commands documentation
- Semantic hook system explanation
- Project structure overview
- Advanced usage examples
- Troubleshooting guide

#### **README.md** - Updated Main Documentation
- Added semantic hook system section
- Updated feature list
- Added sync command documentation
- Updated project structure
- Updated roadmap

#### **Architecture Docs** (previously created)
- `ARCHITECTURE-v2.md` - Detailed architecture design
- `PPT-SUMMARY.md` - Presentation outline
- `DIAGRAMS.md` - Architecture diagrams

## How It Works

### Workflow

1. **User runs `hannah init`**
   - Creates `.harness/` directory
   - Detects tech stack from package.json
   - Scans for agent instruction files
   - Generates semantic hooks
   - Saves hook metadata

2. **User defines rules in agent.md**
   ```markdown
   ## Security
   - Don't commit .env files or secrets
   - Never use eval() or innerHTML with user input
   
   ## Database
   - Don't drop tables or delete all records
   ```

3. **User runs `hannah sync`**
   - Re-scans agent.md
   - Extracts new rules
   - Generates semantic hooks
   - Updates hook metadata

4. **Agent executes with hooks active**
   - Semantic hooks intercept events
   - Evaluate context (file path, content, tech stack)
   - Apply project-specific rules
   - Return decisions with feedback

### Example: Detected Rules

From the test agent.md:
```
Total hooks: 21
├─ Tech stack hooks: 3
│  ├─ environment-protection
│  ├─ secret-detection
│  └─ production-protection
└─ Agent.md hooks: 18
   ├─ don-t-commit-env-files-or-secrets-to-version-contr
   ├─ never-use-eval-or-innerhtml-with-user-input
   ├─ don-t-drop-tables-or-delete-all-records-without-ba
   ├─ never-run-migrations-directly-on-production
   ├─ don-t-modify-production-configuration-directly
   └─ ... (13 more)
```

## Key Features

### 1. **Project-Level Intelligence**
- Understands your tech stack
- Generates relevant hooks automatically
- No manual configuration needed

### 2. **Natural Language Rules**
- Write rules in plain English/Chinese
- Automatically converted to semantic hooks
- Supports multiple instruction file formats

### 3. **Context-Aware**
- Checks file paths, content, tool names
- Understands project structure
- Makes intelligent decisions

### 4. **Extensible**
- Easy to add new semantic hooks
- Support for custom hook sources
- Plugin-friendly architecture

## Testing

Tested with sample project:
```bash
cd test-project
node ../dist/bin.js sync
```

Output:
```
✓ Semantic hooks synced successfully

  Total hooks: 21
  ├─ Tech stack hooks: 3
  └─ Agent.md hooks: 18

  Active hooks:
    ⚙ environment-protection - Prevent modification of environment files
    ⚙ secret-detection - Detect hardcoded secrets
    ⚙ production-protection - Prevent direct production modifications
    📄 don-t-commit-env-files-or-secrets-to-version-contr
    📄 never-use-eval-or-innerhtml-with-user-input
    ...
```

## Next Steps

### Phase 3: Project-Embedded Mode
- [ ] Policies in git (version control)
- [ ] CI integration
- [ ] Team collaboration features

### Phase 4: Observability
- [ ] WebUI dashboard
- [ ] Real-time monitoring
- [ ] Multi-session management

### Phase 5: Intelligence
- [ ] Self-learning hooks
- [ ] Behavior pattern analysis
- [ ] Anomaly detection

## Files Changed

- `src/semantic/` - New semantic hook system (6 files)
- `src/cli/sync.ts` - New sync command
- `src/cli/init.ts` - Enhanced initialization
- `src/bin.ts` - Added sync command
- `src/index.ts` - Exported semantic API
- `doc/USAGE.md` - New usage guide
- `README.md` - Updated documentation
- `test-project/agent.md` - Sample rules file

## Commit

```
feat: implement semantic hook system with tech stack detection and agent.md scanning

- Add semantic hook engine for project-level rules
- Implement tech stack detector (React, Vue, Node.js, databases)
- Implement agent.md scanner to extract rules from instruction files
- Generate semantic hooks automatically based on project context
- Add 'hannah sync' command to update semantic hooks
- Support multiple agent instruction files (agent.md, CLAUDE.md, COPILOT.md, .cursorrules)
- Built-in hooks: database-protection, react-security, vue-security, environment-protection, secret-detection, production-protection
- Update documentation with usage guide and architecture design
```

---

**Status**: ✅ Complete and tested  
**Version**: 0.2.3  
**Date**: 2026-08-26
