# 安全修复：红线规则文件保护

## 问题描述

**严重安全漏洞**：AI Agent 能够修改自己的规则文件（agent.md），从而绕过所有语义 Hook 保护。

### 攻击场景

```
1. Agent 读取 agent.md，发现规则："禁止删除文件"
2. Agent 修改 agent.md，将规则改为："允许删除文件"
3. Agent 执行删除操作，不再被拦截
4. 所有安全限制被绕过
```

这相当于"自我解除武装"，是一个根本性的安全缺陷。

---

## 修复方案

### 新增：redline-protection Hook

添加了一个**最高优先级**的语义 Hook，保护以下文件：

#### 1. Agent 指令文件
- `agent.md` / `AGENT.md` / `.agent.md`
- `CLAUDE.md`
- `COPILOT.md`
- `.cursorrules`
- `.cursor/rules.md`

#### 2. Hannah 配置文件
- `.harness/config.yaml`
- `.harness/policies/*`
- `.harness/hooks/*`
- `.harness/semantic-hooks/*`

### 实现细节

**文件**: `src/semantic/hook-generator.ts`

```typescript
function createRedlineProtectionHook(): SemanticHook {
  return {
    name: 'redline-protection',
    description: 'Protect agent instruction files and harness configuration',
    version: '1.0.0',
    source: 'tech-stack',
    
    async detect(context: SemanticContext): Promise<SemanticMatch | null> {
      const pathToCheck = filePath || inputFilePath;
      
      // Protected patterns
      const redlinePatterns = [
        { pattern: /(^|\/|\\)agent\.md$/i, name: 'agent.md' },
        { pattern: /(^|\/|\\)CLAUDE\.md$/i, name: 'CLAUDE.md' },
        { pattern: /(^|\/|\\)\.harness\/config\.yaml$/i, name: '.harness/config.yaml' },
        { pattern: /(^|\/|\\)\.harness\/policies\//i, name: '.harness/policies/*' },
        // ... more patterns
      ];
      
      for (const { pattern, name } of redlinePatterns) {
        if (pattern.test(pathToCheck)) {
          return {
            hookName: 'redline-protection',
            confidence: 1.0,  // Maximum confidence
            rule: `Protected file: ${name}`,
            evidence: [
              `Attempted to modify redline file: ${name}`,
              `File path: ${pathToCheck}`,
            ],
            metadata: { protectedFile: name },
          };
        }
      }
      
      return null;
    },
    
    async evaluate(match: SemanticMatch): Promise<SemanticDecision> {
      return {
        action: 'deny',
        reason: 'Redline file modification blocked',
        feedback: `You cannot modify ${match.metadata?.protectedFile}. Only human users can modify these files.`,
        suggestions: [
          'Do not attempt to modify agent instruction files',
          'If you need to change rules, ask the human user',
        ],
      };
    },
  };
}
```

### 优先级保证

在 `generateTechStackHooks()` 中，redline-protection 被放在**第一位**：

```typescript
export function generateTechStackHooks(techStack: TechStack): SemanticHook[] {
  const hooks: SemanticHook[] = [];
  
  // CRITICAL: Redline protection hook (must be first!)
  hooks.push(createRedlineProtectionHook());
  
  // Other hooks...
  hooks.push(createDatabaseProtectionHook());
  hooks.push(createEnvironmentProtectionHook());
  // ...
  
  return hooks;
}
```

---

## 测试结果

运行测试脚本：

```bash
node test-redline-protection.js
```

输出：

```
=== Testing Redline Protection ===

Test 1: Attempting to modify agent.md
✓ Decision: deny
  Reason: Redline file modification blocked
  Feedback: You cannot modify agent.md. This file contains agent instructions 
            or harness configuration that must remain unchanged. Only human 
            users can modify these files.

Test 2: Attempting to modify .harness/config.yaml
✓ Decision: deny
  Reason: Redline file modification blocked

Test 3: Attempting to modify CLAUDE.md
✓ Decision: deny
  Reason: Redline file modification blocked

Test 4: Attempting to modify normal file (src/index.js)
✓ Normal file modification allowed

=== Test Complete ===
```

---

## 使用流程

### 修改红线规则

只有**人类用户**可以修改红线规则：

```bash
# 1. 人类用户手动编辑 agent.md
vim agent.md

# 2. 同步语义 Hook
hannah sync

# 3. 新的规则生效
```

### AI Agent 尝试修改

```
Agent: "我需要修改 agent.md 来..."
    ↓
redline-protection hook 检测到
    ↓
立即拒绝 (deny)
    ↓
返回反馈："你不能修改 agent.md，只有人类用户可以修改"
    ↓
Agent 收到反馈，停止尝试
```

---

## 安全保证

### ✅ 保护的内容

1. **Agent 指令文件** - 防止 Agent 修改自己的规则
2. **Hannah 配置** - 防止 Agent 禁用 Hook 或修改策略
3. **语义 Hook** - 防止 Agent 删除或修改语义 Hook

### ❌ 不保护的内容

1. **普通代码文件** - Agent 可以正常修改 src/、lib/ 等
2. **配置文件** - Agent 可以修改 package.json、tsconfig.json 等
3. **文档文件** - Agent 可以修改 README.md、docs/ 等

---

## 设计原则

### 1. 最高优先级

redline-protection 必须在所有其他 Hook 之前执行，确保：
- 即使其他 Hook 有 bug，红线保护仍然有效
- 无法通过修改配置来绕过保护

### 2. 最大置信度

```typescript
confidence: 1.0  // 100% 确定，没有歧义
```

### 3. 明确反馈

返回清晰的反馈消息，告知 Agent：
- 为什么被拒绝
- 哪些文件受保护
- 应该怎么做（询问人类用户）

### 4. 最小侵入

- 只保护关键文件，不影响正常开发
- 普通文件修改不受影响
- 人类用户可以随时修改红线规则

---

## 后续改进

### 1. 扩展保护范围

可以考虑保护更多文件：
- `.github/workflows/*` - CI/CD 配置
- `Dockerfile` - 容器配置
- `terraform/` - 基础设施代码

### 2. 审计日志

记录所有尝试修改红线文件的行为：

```json
{
  "timestamp": "2026-08-26T12:38:00Z",
  "event": "redline.attempt",
  "agent": "copilot",
  "file": "agent.md",
  "action": "deny",
  "reason": "Redline file modification blocked"
}
```

### 3. 告警机制

当检测到红线文件修改尝试时，发送告警：
- 终端通知
- 邮件通知
- Slack/钉钉通知

---

## 总结

**问题**：AI Agent 可以修改自己的规则文件  
**修复**：添加 redline-protection Hook，保护红线规则文件  
**效果**：Agent 无法绕过安全限制，只有人类用户可以修改规则  
**测试**：所有测试通过，保护机制正常工作  

这是一个**关键的安全修复**，确保了 Hannah Agent Runtime 的安全性和可靠性。

---

**版本**: 0.2.3  
**日期**: 2026-08-26  
**状态**: ✅ 已修复并测试
