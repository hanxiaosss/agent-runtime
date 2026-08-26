# Hannah Agent Runtime - Architecture Design v2

> **Version**: 2.0  
> **Last Updated**: 2026-08-26  
> **Status**: Design Phase  
> **Author**: Hannah Team

---

## 1. Executive Summary

Hannah Agent Runtime 是一个**多 Agent Hook 对齐和可插拔底座**，为 AI 编码 Agent 提供统一的事件拦截、策略执行和可观测性基础设施。

### 1.1 核心定位

```
┌─────────────────────────────────────────────────────────────┐
│                    Hannah Agent Runtime                      │
│                                                              │
│  "多 Agent 的统一控制平面"                                    │
│                                                              │
│  • 标准化：统一不同 Agent 的事件模型                          │
│  • 可插拔：预留充分的扩展点                                   │
│  • 可观测：实时追踪 Agent 行为                                │
│  • 可控制：声明式策略引擎                                     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 设计原则

1. **最小侵入**：不修改 Agent 本身，通过 Hook 机制介入
2. **协议优先**：定义标准协议，各 Agent 按需适配
3. **分层解耦**：核心层稳定，扩展层可插拔
4. **会话隔离**：每个会话独立，避免数据污染
5. **面向未来**：预留 WebUI、自学习、红线规范等扩展点

---

## 2. Architecture Overview

### 2.1 四层架构

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 4: Applications (应用层)                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ WebUI    │  │ CLI      │  │ CI/CD    │  │ IDE      │   │
│  │ Dashboard│  │ Commands │  │ Integration│ │ Plugin   │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: Extensions (扩展层)                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ Plugins  │  │ Notifiers│  │ Analyzers│  │ Learners │   │
│  │ (自定义) │  │ (通知)   │  │ (分析)   │  │ (学习)   │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 2: Core Services (核心服务层)                         │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Event Bus  │  Policy Engine  │  Trace Store         │  │
│  │  (事件总线) │  (策略引擎)     │  (追踪存储)          │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Adapters (适配层)                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ Claude   │  │ Copilot  │  │ Qoder    │  │ Codex    │   │
│  │ Code     │  │          │  │          │  │          │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│  ┌──────────┐                                               │
│  │ Trae     │  ... (更多 Agent)                             │
│  └──────────┘                                               │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
                    ┌───────────────┐
                    │  AI Agents    │
                    │  (运行时)     │
                    └───────────────┘
```

### 2.2 核心组件关系

```
┌─────────────────────────────────────────────────────────────┐
│                      Hannah Runtime                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐         ┌──────────────┐                │
│  │   Adapter    │────────▶│  Event Bus   │                │
│  │   Manager    │         │              │                │
│  └──────────────┘         └──────┬───────┘                │
│                                   │                         │
│                    ┌──────────────┼──────────────┐         │
│                    │              │              │         │
│                    ▼              ▼              ▼         │
│            ┌──────────┐   ┌──────────┐   ┌──────────┐    │
│            │ Policy   │   │ Trace    │   │ Extension│    │
│            │ Engine   │   │ Store    │   │ Manager  │    │
│            └──────────┘   └──────────┘   └──────────┘    │
│                    │              │              │         │
│                    └──────────────┼──────────────┘         │
│                                   │                         │
│                                   ▼                         │
│                            ┌──────────┐                    │
│                            │ Feedback │                    │
│                            │ Loop     │                    │
│                            └──────────┘                    │
│                                   │                         │
│                                   ▼                         │
│                            ┌──────────┐                    │
│                            │  Agent   │                    │
│                            │ (外部)   │                    │
│                            └──────────┘                    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Layer 1: Adapters (适配层)

### 3.1 职责

- **协议翻译**：将各 Agent 的 Hook 协议转换为统一事件
- **能力声明**：声明支持的事件类型和特性
- **生命周期管理**：管理 Agent 会话的创建和销毁

### 3.2 适配器接口

```typescript
interface AgentAdapter {
  // 元信息
  readonly name: string;
  readonly version: string;
  readonly capabilities: Capability[];
  
  // 生命周期
  initialize(config: AdapterConfig): Promise<void>;
  shutdown(): Promise<void>;
  
  // 事件处理
  handlePreToolUse(input: ToolInput): Promise<HookResult>;
  handlePostToolUse(input: ToolInput, output: ToolOutput): Promise<void>;
  handleStop(input: StopInput): Promise<HookResult>;
  
  // 能力查询
  supports(event: EventType): boolean;
  getSupportLevel(event: EventType): 'native' | 'emulated' | 'unsupported';
}
```

### 3.3 当前支持的适配器

| Adapter | Status | PreToolUse | PostToolUse | Stop | Notes |
|---------|--------|------------|-------------|------|-------|
| Claude Code | ✅ Full | ✅ Native | ✅ Native | ✅ Native | 最完整的 Hook 支持 |
| Copilot | ✅ Full | ✅ Native | ✅ Native | ❌ N/A | 无 Stop 事件 |
| Qoder | ✅ Full | ✅ Native | ✅ Native | ✅ Emulated | Stop 通过 confirm 模拟 |
| Codex CLI | ✅ Full | ✅ Native | ✅ Native | ❌ N/A | 异步 Hook |
| Trae | ✅ Basic | ✅ Native | ✅ Native | ❌ N/A | 最小事件集 |

### 3.4 扩展点

- **新增适配器**：实现 `AgentAdapter` 接口
- **自定义协议**：支持私有 Agent 的 Hook 协议
- **协议版本管理**：支持多版本协议共存

---

## 4. Layer 2: Core Services (核心服务层)

### 4.1 Event Bus (事件总线)

#### 职责
- 事件的发布/订阅
- 事件路由和过滤
- 事件生命周期管理

#### 设计

```typescript
interface EventBus {
  // 发布事件
  publish(event: UnifiedEvent): Promise<void>;
  
  // 订阅事件
  subscribe(filter: EventFilter, handler: EventHandler): Subscription;
  
  // 事件流
  stream(filter?: EventFilter): AsyncIterable<UnifiedEvent>;
}

interface UnifiedEvent {
  id: string;
  sessionId: string;
  timestamp: number;
  type: EventType;
  source: string;
  payload: Record<string, any>;
  metadata: EventMetadata;
}
```

#### 扩展点
- **事件拦截器**：在事件发布前拦截和修改
- **事件转换器**：将事件转换为其他格式
- **事件路由规则**：基于事件类型的路由

### 4.2 Policy Engine (策略引擎)

#### 职责
- 加载和解析策略
- 评估事件是否匹配策略
- 执行策略动作

#### 设计

```typescript
interface PolicyEngine {
  // 加载策略
  loadPolicy(policy: Policy): void;
  loadPolicies(policies: Policy[]): void;
  
  // 评估事件
  evaluate(event: UnifiedEvent): Promise<PolicyResult>;
  
  // 策略管理
  getPolicies(): Policy[];
  removePolicy(policyId: string): void;
}

interface Policy {
  id: string;
  name: string;
  description?: string;
  rules: PolicyRule[];
  priority: number;
}

interface PolicyRule {
  name: string;
  when: EventType | EventType[];
  match: MatchCondition[];
  action: 'allow' | 'deny' | 'warn' | 'modify' | 'retry';
  feedback?: string;
  metadata?: Record<string, any>;
}
```

#### 扩展点
- **自定义匹配器**：实现自定义的匹配逻辑
- **自定义动作**：实现自定义的策略动作
- **策略热更新**：运行时动态更新策略
- **策略版本控制**：支持策略的版本管理

### 4.3 Trace Store (追踪存储)

#### 职责
- 存储事件追踪数据
- 提供查询接口
- 管理数据生命周期

#### 设计

```typescript
interface TraceStore {
  // 写入追踪
  write(trace: TraceEntry): Promise<void>;
  
  // 查询追踪
  query(filter: TraceFilter): Promise<TraceEntry[]>;
  
  // 流式查询
  stream(filter?: TraceFilter): AsyncIterable<TraceEntry>;
  
  // 聚合查询
  aggregate(query: AggregateQuery): Promise<AggregateResult>;
  
  // 生命周期管理
  cleanup(before: Date): Promise<void>;
  archive(before: Date, target: string): Promise<void>;
}

interface TraceEntry {
  id: string;
  sessionId: string;
  timestamp: number;
  event: EventType;
  source: string;
  action: 'allow' | 'deny' | 'warn' | 'modify';
  payload: Record<string, any>;
  feedback?: string[];
  metadata?: Record<string, any>;
}
```

#### 存储后端

| Backend | Status | Use Case | Notes |
|---------|--------|----------|-------|
| File (JSONL) | ✅ Current | 单项目 | 按日期分文件 |
| SQLite | 🔄 Planned | 单项目增强 | 支持复杂查询 |
| PostgreSQL | 📋 Future | 多项目聚合 | 分布式部署 |
| Elasticsearch | 📋 Future | 大规模分析 | 全文搜索 |

#### 扩展点
- **自定义存储后端**：实现 `TraceStore` 接口
- **数据导出**：支持导出为多种格式
- **数据压缩**：自动压缩历史数据

---

## 5. Layer 3: Extensions (扩展层)

### 5.1 插件系统

#### 设计

```typescript
interface Plugin {
  // 元信息
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  
  // 生命周期
  initialize(context: PluginContext): Promise<void>;
  shutdown(): Promise<void>;
  
  // 钩子
  hooks?: PluginHooks;
}

interface PluginHooks {
  // 事件钩子
  onEvent?: (event: UnifiedEvent) => Promise<void>;
  
  // 策略钩子
  beforePolicyEval?: (event: UnifiedEvent) => Promise<PolicyModification>;
  afterPolicyEval?: (event: UnifiedEvent, result: PolicyResult) => Promise<void>;
  
  // 追踪钩子
  beforeTraceWrite?: (trace: TraceEntry) => Promise<TraceModification>;
  afterTraceWrite?: (trace: TraceEntry) => Promise<void>;
}

interface PluginContext {
  // 访问核心服务
  eventBus: EventBus;
  policyEngine: PolicyEngine;
  traceStore: TraceStore;
  
  // 插件配置
  config: Record<string, any>;
  
  // 日志
  logger: Logger;
}
```

#### 插件类型

| Type | Description | Example |
|------|-------------|---------|
| **Observer** | 观察事件，不干预 | 日志记录、指标收集 |
| **Enforcer** | 执行额外策略 | 红线规范、合规检查 |
| **Notifier** | 发送通知 | Slack、钉钉、邮件 |
| **Analyzer** | 分析行为模式 | 异常检测、趋势分析 |
| **Learner** | 自学习优化 | 策略推荐、行为预测 |

### 5.2 内置插件

#### 5.2.1 Trace Logger (追踪记录器)

```yaml
# 配置
plugins:
  trace-logger:
    enabled: true
    config:
      output: file  # file | console | custom
      format: jsonl
      path: .harness/traces
```

#### 5.2.2 Metrics Collector (指标收集器)

```yaml
plugins:
  metrics-collector:
    enabled: true
    config:
      interval: 60s
      output: prometheus  # prometheus | statsd | custom
```

#### 5.2.3 Slack Notifier (Slack 通知器)

```yaml
plugins:
  slack-notifier:
    enabled: false
    config:
      webhook: https://hooks.slack.com/...
      events:
        - tool.before
      conditions:
        - action == 'deny'
```

### 5.3 扩展点

- **自定义插件**：实现 `Plugin` 接口
- **插件市场**：第三方插件分发
- **插件组合**：多个插件的编排和依赖管理

---

## 6. Layer 4: Applications (应用层)

### 6.1 CLI (命令行工具)

#### 当前命令

```bash
hannah init          # 初始化项目
hannah trace         # 查看追踪
hannah summary       # 查看统计
hannah session       # 会话管理
```

#### 未来命令

```bash
hannah plugin list   # 列出插件
hannah plugin install <name>  # 安装插件
hannah policy validate <file> # 验证策略
hannah web           # 启动 WebUI
```

### 6.2 WebUI (可观测面板)

#### 设计

```
┌─────────────────────────────────────────────────────────────┐
│  Hannah Dashboard                              [Settings]   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Overview                                                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ Active   │  │ Total    │  │ Denied   │  │ Plugins  │   │
│  │ Sessions │  │ Events   │  │ Events   │  │ Active   │   │
│  │    3     │  │   1,234  │  │    42    │  │    5     │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│                                                              │
│  Active Sessions                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Session ID    │ Agent    │ Duration │ Events │ Status │  │
│  ├──────────────────────────────────────────────────────┤  │
│  │ abc123        │ Copilot  │ 15m      │ 45     │ Active │  │
│  │ def456        │ Claude   │ 32m      │ 89     │ Active │  │
│  │ ghi789        │ Qoder    │ 5m       │ 12     │ Idle   │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  Recent Events                                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 14:32:15 │ DENY │ tool.before │ rm -rf /tmp          │  │
│  │ 14:31:42 │ ALLOW│ tool.before │ Write file.ts        │  │
│  │ 14:31:15 │ WARN │ code.modify │ Large file change    │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### 功能

- **实时监控**：WebSocket 推送实时事件
- **多会话管理**：同时查看多个 Agent 会话
- **事件过滤**：按类型、时间、状态过滤
- **策略管理**：在线编辑和验证策略
- **插件管理**：启用/禁用插件

### 6.3 CI/CD Integration

#### 设计

```yaml
# .github/workflows/agent-check.yml
name: Agent Runtime Check

on: [push, pull_request]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Install Hannah
        run: npm install -g hannah-agent-runtime
      
      - name: Validate Policies
        run: hannah policy validate .harness/policies/
      
      - name: Run Agent Simulation
        run: hannah simulate --input test-cases/
      
      - name: Check Compliance
        run: hannah check --threshold 95
```

### 6.4 IDE Plugin

#### VS Code Extension

```typescript
// 功能
- 实时显示 Agent 活动
- 快速查看追踪
- 策略编辑和验证
- 会话管理
```

---

## 7. Data Flow

### 7.1 事件处理流程

```
┌─────────────────────────────────────────────────────────────┐
│  1. Agent 触发 Hook                                          │
│     └─ Copilot: PreToolUse                                  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  2. Adapter 转换事件                                         │
│     └─ CopilotAdapter.handlePreToolUse()                    │
│     └─ 转换为: UnifiedEvent { type: 'tool.before', ... }    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  3. Event Bus 发布事件                                       │
│     └─ eventBus.publish(event)                              │
│     └─ 通知所有订阅者                                        │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  4. Policy Engine 评估                                       │
│     └─ policyEngine.evaluate(event)                         │
│     └─ 返回: PolicyResult { action: 'deny', reason: ... }   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  5. Trace Store 记录                                         │
│     └─ traceStore.write({ event, result, timestamp })       │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  6. Plugins 处理                                             │
│     └─ slack-notifier: 发送通知                             │
│     └─ metrics-collector: 更新指标                          │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  7. Feedback Loop                                            │
│     └─ 返回决策给 Adapter                                   │
│     └─ Adapter 转换为 Agent 协议                            │
│     └─ Agent 收到反馈并调整行为                             │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 会话生命周期

```
┌─────────────────────────────────────────────────────────────┐
│  Session Start                                               │
│  ├─ 生成 session_id                                          │
│  ├─ 创建会话元数据                                           │
│  └─ 初始化会话存储                                           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Session Active                                              │
│  ├─ 实时写入 trace                                           │
│  ├─ 实时更新统计                                             │
│  └─ 实时推送事件 (WebSocket)                                 │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Session End                                                 │
│  ├─ 生成会话摘要                                             │
│  ├─ 清理详细 trace (可选)                                    │
│  └─ 归档会话数据                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 8. Extension Points

### 8.1 可扩展性矩阵

| Component | Extension Point | Interface | Example |
|-----------|----------------|-----------|---------|
| **Adapters** | 新增 Agent 支持 | `AgentAdapter` | 自定义 Agent |
| **Event Bus** | 事件拦截器 | `EventInterceptor` | 事件过滤、转换 |
| **Policy Engine** | 自定义匹配器 | `Matcher` | 正则、AST、ML |
| **Policy Engine** | 自定义动作 | `Action` | 通知、修改、重试 |
| **Trace Store** | 存储后端 | `TraceStore` | SQLite、PostgreSQL |
| **Plugins** | 自定义插件 | `Plugin` | 通知、分析、学习 |
| **Applications** | 应用层 | REST API、WebSocket | WebUI、IDE |

### 8.2 未来扩展场景

#### 场景 1: 项目红线规范

```yaml
# .harness/policies/red-lines.yaml
name: project-red-lines
rules:
  - name: no-destructive-commands
    when: tool.before
    match:
      - field: toolName
        pattern: ["Bash", "terminal"]
      - field: input.command
        pattern: ["*rm -rf*", "*DROP TABLE*"]
    action: deny
    feedback: "Destructive commands are not allowed"
    severity: critical
  
  - name: protect-production-config
    when: code.before_modify
    match:
      - field: filePath
        pattern: ["**/prod/**", "**/production/**"]
    action: deny
    feedback: "Production configuration is protected"
    severity: critical
```

#### 场景 2: 自学习优化

```typescript
// 学习插件
class LearningPlugin implements Plugin {
  async onEvent(event: UnifiedEvent) {
    // 收集行为数据
    await this.collector.record(event);
    
    // 定期分析模式
    if (this.shouldAnalyze()) {
      const patterns = await this.analyzer.analyze();
      
      // 生成策略建议
      const suggestions = await this.recommender.recommend(patterns);
      
      // 通知用户
      await this.notifier.notify(suggestions);
    }
  }
}
```

#### 场景 3: 多级反馈

```typescript
// 多级反馈
interface FeedbackLevel {
  level: 1 | 2 | 3;
  action: 'warn' | 'deny' | 'block';
  escalation: 'notify' | 'require_approval';
}

// 第一次：警告
if (violation.count === 1) {
  return { level: 1, action: 'warn', feedback: '...' };
}

// 第二次：拒绝
if (violation.count === 2) {
  return { level: 2, action: 'deny', feedback: '...' };
}

// 第三次：阻止并通知
if (violation.count >= 3) {
  return { level: 3, action: 'block', escalation: 'notify' };
}
```

---

## 9. Technology Stack

### 9.1 当前技术栈

| Component | Technology | Notes |
|-----------|-----------|-------|
| **Language** | TypeScript | 类型安全 |
| **Runtime** | Node.js | 跨平台 |
| **Package** | npm | 分发 |
| **Config** | YAML | 人类可读 |
| **Storage** | JSONL | 简单高效 |
| **CLI** | Commander.js | 命令行框架 |

### 9.2 未来技术栈

| Component | Technology | Notes |
|-----------|-----------|-------|
| **WebUI** | React + TypeScript | 组件化 |
| **Real-time** | WebSocket | 实时推送 |
| **API** | REST + GraphQL | 灵活查询 |
| **Database** | SQLite / PostgreSQL | 可选 |
| **Search** | Elasticsearch | 大规模分析 |
| **Metrics** | Prometheus | 监控 |

---

## 10. Roadmap

### Phase 1: Foundation (Current) ✅

- [x] 统一事件模型
- [x] 5 个 Agent 适配器
- [x] 策略引擎
- [x] CLI 工具
- [x] JSONL 追踪存储
- [x] 会话管理

### Phase 2: Enhancement (Next)

- [ ] 插件系统
- [ ] 内置插件（通知、指标）
- [ ] SQLite 存储后端
- [ ] 策略热更新
- [ ] 会话归档和清理

### Phase 3: Observability

- [ ] WebUI Dashboard
- [ ] 实时监控
- [ ] 多会话管理
- [ ] 策略在线编辑
- [ ] 数据导出

### Phase 4: Intelligence

- [ ] 自学习插件
- [ ] 行为模式分析
- [ ] 策略推荐
- [ ] 异常检测
- [ ] 多级反馈

### Phase 5: Ecosystem

- [ ] 插件市场
- [ ] IDE 集成
- [ ] CI/CD 集成
- [ ] 团队协作
- [ ] 企业版

---

## 11. Appendix

### 11.1 术语表

| Term | Definition |
|------|-----------|
| **Agent** | AI 编码助手（如 Claude Code、Copilot） |
| **Adapter** | Agent 协议的适配器 |
| **Event** | 统一的事件模型 |
| **Hook** | Agent 的拦截点 |
| **Policy** | 声明式的规则 |
| **Trace** | 事件的追踪记录 |
| **Session** | 一次 Agent 会话 |
| **Plugin** | 可插拔的扩展 |

### 11.2 参考资料

- [Hook Adaptation Table](../guidelines/hook-adaptation-table.md)
- [Claude Code Hooks](https://docs.anthropic.com/claude-code/hooks)
- [Copilot Extensions](https://docs.github.com/copilot)

---

**Document Version**: 2.0  
**Last Updated**: 2026-08-26  
**Next Review**: Phase 2 Implementation
