# Hannah 套件系统设计方案

> **状态**：规划中（Hook 底座已完成，待后续扩展）  
> **创建时间**：2026-08-27  
> **优先级**：Phase 2（在核心功能稳定后实施）

---

## 1. 架构设计

### 分层架构

```
┌─────────────────────────────────────────┐
│         hannah-agent-runtime            │  ← 核心引擎（已完成）
│  ┌─────────────────────────────────┐   │
│  │  Hook Adapters (5 agents)       │   │
│  │  Semantic Engine                │   │
│  │  Policy Engine                  │   │
│  │  Trace System                   │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│         Function Kits (功能套件)         │  ← 第二层
│  ┌──────────┐ ┌──────────┐ ┌────────┐ │
│  │ Security │ │ Database │ │Frontend│ │
│  │   Kit    │ │   Kit    │ │  Kit   │ │
│  └──────────┘ └──────────┘ └────────┘ │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│         Presets (预设组合)               │  ← 第三层
│  ┌──────────────┐ ┌──────────────────┐ │
│  │ React Stack  │ │ Node.js Backend  │ │
│  │   Preset     │ │     Preset       │ │
│  └──────────────┘ └──────────────────┘ │
└─────────────────────────────────────────┘
```

---

## 2. 套件分类

### 2.1 功能套件（Kits）

每个套件是独立的 npm 包，包含：
- 语义 hooks（规则定义）
- 策略文件（YAML）
- 配置文件
- 文档

#### 计划中的套件

| 套件名称 | 功能描述 | 优先级 |
|---------|---------|-------|
| `@hannah/kit-security` | 密钥检测、环境变量保护、敏感文件保护、红线规则保护 | P0 |
| `@hannah/kit-database` | 生产环境迁移保护、SQL 注入防护、备份策略 | P0 |
| `@hannah/kit-react` | 组件安全规则、状态管理保护、API 调用规范 | P1 |
| `@hannah/kit-vue` | Vue 特定安全规则、组件保护 | P1 |
| `@hannah/kit-nextjs` | Next.js 特定规则、SSR 保护 | P1 |
| `@hannah/kit-devops` | CI/CD 配置保护、Docker 检查、K8s 资源保护 | P2 |
| `@hannah/kit-api` | API 安全、速率限制、认证保护 | P2 |

### 2.2 预设组合（Presets）

预设是多个套件的组合，一键启用完整保护。

| 预设名称 | 包含套件 | 适用场景 |
|---------|---------|---------|
| `@hannah/preset-react-fullstack` | security + database + react + devops | React 全栈项目 |
| `@hannah/preset-node-backend` | security + database + devops | Node.js 后端项目 |
| `@hannah/preset-frontend-lite` | security + react | 前端轻量项目 |
| `@hannah/preset-minimal` | security | 最小化保护 |

---

## 3. 套件结构规范

### 3.1 目录结构

```
@hannah/kit-security/
├── package.json
├── README.md
├── CHANGELOG.md
├── hooks/
│   ├── secret-detection.ts
│   ├── env-protection.ts
│   ├── redline-protection.ts
│   └── index.ts
├── policies/
│   ├── security.yaml
│   └── secrets.yaml
├── config/
│   └── default.yaml
├── templates/
│   └── .env.example
└── docs/
    ├── usage.md
    └── examples.md
```

### 3.2 套件接口定义

```typescript
// hooks/index.ts
import { SemanticHook } from 'hannah-agent-runtime';

export const hooks: SemanticHook[] = [
  {
    name: 'secret-detection',
    description: 'Detect hardcoded secrets',
    match: (context) => {
      // 匹配逻辑
    },
    evaluate: async (context) => {
      // 评估逻辑
      return {
        action: 'deny',
        reason: 'Hardcoded secret detected',
        feedback: 'Use environment variables instead'
      };
    }
  },
  // ... more hooks
];

export default hooks;
```

### 3.3 package.json 规范

```json
{
  "name": "@hannah/kit-security",
  "version": "1.0.0",
  "description": "Security kit for Hannah Agent Runtime",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "keywords": [
    "hannah",
    "agent-runtime",
    "security",
    "kit"
  ],
  "peerDependencies": {
    "hannah-agent-runtime": "^0.2.3"
  },
  "hannah": {
    "type": "kit",
    "category": "security",
    "hooks": [
      "secret-detection",
      "env-protection",
      "redline-protection"
    ]
  }
}
```

---

## 4. CLI 扩展设计

### 4.1 套件管理命令

```bash
# 安装套件
hannah install @hannah/kit-security

# 列出已安装套件
hannah kits list

# 移除套件
hannah uninstall @hannah/kit-security

# 更新套件
hannah kits update

# 查看可用套件
hannah kits search

# 查看套件详情
hannah kits info @hannah/kit-security

# 使用预设初始化
hannah init --preset=react-fullstack

# 交互式选择套件
hannah init --custom
```

### 4.2 实现示例

```typescript
// src/cli/install.ts
import { installKit } from '../core/kit-manager.js';

export async function runInstall(args: string[]) {
  const kitName = args[0];
  
  console.log(`Installing ${kitName}...`);
  
  // 1. 下载套件
  await downloadKit(kitName);
  
  // 2. 注册到 .harness/kits/
  await registerKit(kitName);
  
  // 3. 合并 hooks 和 policies
  await mergeKitConfig(kitName);
  
  console.log(`✓ ${kitName} installed successfully`);
}
```

---

## 5. 开发计划

### Phase 1：核心套件（1-2 周）

#### Week 1
- [ ] 设计套件规范和接口
- [ ] 实现 `@hannah/kit-security`
  - 提取现有的 redline-protection
  - 提取 secret-detection
  - 添加 env-protection
- [ ] 实现套件加载机制

#### Week 2
- [ ] 实现 `@hannah/kit-database`
  - 生产环境迁移保护
  - SQL 注入防护
- [ ] 实现 `hannah install` 命令
- [ ] 编写套件开发指南

### Phase 2：框架套件（2-3 周）

- [ ] 实现 `@hannah/kit-react`
- [ ] 实现 `@hannah/kit-vue`
- [ ] 实现 `@hannah/kit-nextjs`
- [ ] 实现 `hannah kits list` 命令

### Phase 3：预设组合（1 周）

- [ ] 实现 `@hannah/preset-react-fullstack`
- [ ] 实现 `@hannah/preset-node-backend`
- [ ] 实现 `@hannah/preset-frontend-lite`
- [ ] 实现 `hannah init --preset` 命令

### Phase 4：生态建设（持续）

- [ ] 套件开发指南完善
- [ ] 套件市场（可选）
- [ ] 社区贡献机制
- [ ] 套件测试框架

---

## 6. 用户使用示例

### 6.1 使用预设（推荐）

```bash
# 初始化 React 全栈项目
cd my-react-app
hannah init --preset=react-fullstack

# 自动安装：
# - @hannah/kit-security
# - @hannah/kit-database
# - @hannah/kit-react
# - @hannah/kit-devops
```

### 6.2 手动选择套件

```bash
# 初始化项目
hannah init --agent=copilot

# 安装需要的套件
hannah install @hannah/kit-security
hannah install @hannah/kit-database

# 查看已安装套件
hannah kits list
```

### 6.3 自定义配置

```bash
# 交互式选择
hannah init --custom

# 输出：
# ? Select your AI coding agent: (use arrow keys)
#   > Claude Code
#     GitHub Copilot
#     Qoder
#     Codex CLI
#     Trae
#
# ? Select kits to install: (use space to select)
#   > ✓ Security Kit
#     ✓ Database Kit
#     ○ React Kit
#     ○ Vue Kit
#     ○ DevOps Kit
```

---

## 7. 套件开发指南

### 7.1 创建新套件

```bash
# 1. 创建套件目录
mkdir hannah-kit-mykit
cd hannah-kit-mykit

# 2. 初始化 package.json
npm init -y

# 3. 安装依赖
npm install --save-dev typescript @types/node
npm install --save-peer hannah-agent-runtime

# 4. 创建目录结构
mkdir -p hooks policies config docs

# 5. 实现 hooks
cat > hooks/index.ts << 'EOF'
import { SemanticHook } from 'hannah-agent-runtime';

export const hooks: SemanticHook[] = [
  {
    name: 'my-hook',
    description: 'My custom hook',
    match: (context) => true,
    evaluate: async (context) => {
      return { action: 'allow' };
    }
  }
];

export default hooks;
EOF

# 6. 编译
npx tsc

# 7. 发布
npm publish --access public
```

### 7.2 套件测试

```typescript
// test/hooks.test.ts
import { hooks } from '../hooks/index.js';
import { SemanticHookEngine } from 'hannah-agent-runtime';

describe('My Kit', () => {
  it('should detect violations', async () => {
    const engine = new SemanticHookEngine({ hooks });
    
    const context = {
      event: { name: 'tool.before', payload: { toolName: 'write' } },
      code: { filePath: 'test.js', content: 'const secret = "password123"' }
    };
    
    const result = await engine.evaluate(context);
    expect(result[0].action).toBe('deny');
  });
});
```

---

## 8. 优势分析

### 8.1 可扩展性

- ✅ 社区可以开发自己的套件
- ✅ 每个套件独立版本管理
- ✅ 可以按需安装，不臃肿

### 8.2 可组合性

- ✅ 用户可以灵活组合不同套件
- ✅ 预设提供开箱即用的组合
- ✅ 可以针对不同场景定制

### 8.3 易维护性

- ✅ 每个套件独立维护
- ✅ 可以单独更新和修复
- ✅ 降低核心引擎复杂度

### 8.4 易推广性

- ✅ 可以针对特定场景推广（如 "React 安全套件"）
- ✅ 降低用户学习成本
- ✅ 提供清晰的價值主张

---

## 9. 替代方案对比

| 方案 | 优点 | 缺点 | 适用场景 |
|------|------|------|---------|
| **分层套件**（推荐） | 灵活、可扩展、易维护 | 需要设计套件规范 | 长期发展 |
| 单体 CLI | 简单、直接 | 难以扩展、臃肿 | 快速原型 |
| 插件系统 | 高度可扩展 | 复杂度高、学习成本 | 大型平台 |
| 配置驱动 | 灵活 | 学习成本高 | 高级用户 |

---

## 10. 下一步行动

### 立即可做（当前阶段）

1. **完善核心引擎**
   - 稳定 hook 底座
   - 完善文档
   - 收集用户反馈

2. **准备套件规范**
   - 设计套件接口
   - 编写开发指南
   - 创建示例套件

### 后续扩展（1-2 个月后）

1. **实现第一个套件**
   - `@hannah/kit-security`
   - 验证套件系统可行性

2. **实现套件管理**
   - `hannah install` 命令
   - 套件加载机制

3. **推广套件生态**
   - 文档完善
   - 社区建设
   - 套件市场（可选）

---

## 11. 参考资源

- [npm 包开发指南](https://docs.npmjs.com/packages-and-modules/contributing-packages-to-the-registry)
- [TypeScript 库发布](https://www.typescriptlang.org/docs/handbook/declaration-files/publishing.html)
- [Semantic Versioning](https://semver.org/)

---

**文档维护者**：Hannah Team  
**最后更新**：2026-08-27  
**版本**：v1.0（规划阶段）
