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


## 13. Phase 4: Intelligence 实现

### 13.1 概述

Phase 4 实现了基于 trace 数据的智能分析能力，包括行为模式分析、异常检测、策略推荐和多级反馈系统。

### 13.2 行为模式分析（Pattern Analyzer）

**文件**: `src/intelligence/pattern-analyzer.ts`

分析 agent 行为模式：
- 工具使用频率和分布
- 时间维度的活动模式（高峰时段）
- 会话行为画像
- 错误率趋势
- 常见操作序列

**控制台验证**：

```bash
# 完整分析（包含模式分析）
hannah learn

# 仅行为模式分析
hannah learn patterns

# 分析最近 30 天数据
hannah learn patterns --days=30
```

### 13.3 异常检测（Anomaly Detector）

**文件**: `src/intelligence/anomaly-detector.ts`

检测 5 类异常行为：

| 类型 | 说明 | 严重级别 |
|------|------|----------|
| `error_spike` | 错误率突然飙升 | medium/critical |
| `unusual_tool` | 异常工具使用模式 | medium/high |
| `long_session` | 超长会话（>4小时） | medium/high |
| `sensitive_access` | 敏感文件访问 | high |
| `rate_violation` | 频率超限（>100次/5分钟） | high |

**控制台验证**：

```bash
# 仅异常检测
hannah learn anomalies

# 分析最近 14 天
hannah learn anomalies --days=14
```

### 13.4 策略推荐（Policy Recommender）

**文件**: `src/intelligence/policy-recommender.ts`

基于 trace 分析生成策略建议：

- **new_policy**: 建议创建新策略（基于重复违规）
- **adjust_policy**: 建议调整现有策略（基于高错误率）
- **remove_policy**: 建议移除未使用策略
- **refine_rule**: 建议优化规则（基于操作序列）

每条建议包含：
- 优先级（high/medium/low）
- 置信度（0-100%）
- 证据列表
- 可选的策略模板

**控制台验证**：

```bash
# 仅策略推荐
hannah learn recommend

# 分析最近 30 天
hannah learn recommend --days=30
```

### 13.5 多级反馈（Feedback Escalation）

**文件**: `src/intelligence/feedback-escalation.ts`

实现渐进式升级机制：

| 级别 | 动作 | 触发条件 |
|------|------|----------|
| 0 | allow | 首次违规 |
| 1 | warn | 第 1 次违规 |
| 2 | deny | 第 3 次违规 |
| 3 | block + notify | 第 5 次违规 |

特性：
- 按 agent + rule 维度跟踪违规
- 支持冷却期（默认 30 分钟）
- 违规状态持久化到 `.harness/escalation-state.json`
- 支持管理员重置

**控制台验证**：

```bash
# 查看升级统计
hannah learn escalation

# 重置特定 agent 的违规记录
hannah learn escalation reset --agent=codex

# 重置所有违规记录
hannah learn escalation reset
```

### 13.6 自学习命令（learn）

**文件**: `src/cli/learn.ts`

统一入口，整合所有智能分析功能：

```bash
# 完整分析报告（模式 + 异常 + 推荐 + 升级）
hannah learn

# 子命令
hannah learn patterns      # 行为模式
hannah learn anomalies     # 异常检测
hannah learn recommend     # 策略推荐
hannah learn escalation    # 升级管理

# 选项
--days=N                   # 分析周期（默认 7 天）
```

### 13.7 Phase 4 命令汇总

| 命令 | 功能 | 文件 |
|------|------|------|
| `hannah learn` | 完整智能分析 | `src/cli/learn.ts` |
| `hannah learn patterns` | 行为模式分析 | `src/intelligence/pattern-analyzer.ts` |
| `hannah learn anomalies` | 异常检测 | `src/intelligence/anomaly-detector.ts` |
| `hannah learn recommend` | 策略推荐 | `src/intelligence/policy-recommender.ts` |
| `hannah learn escalation` | 多级反馈管理 | `src/intelligence/feedback-escalation.ts` |

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


---

## 12. 高级拦截能力 (Advanced Interception Capabilities)

> **版本**: 2.1  
> **更新日期**: 2026-09-02  
> **状态**: ✅ 已实现并验证

### 12.1 概述

为了提供更精细的 Agent 行为控制，Hannah Agent Runtime 实现了 5 项高级拦截能力，形成了完整的"意图识别 → 架构感知 → 文件保护 → 审计分析"闭环。

```
┌─────────────────────────────────────────────────────────────┐
│                    Pre-Hook 拦截链                            │
├─────────────────────────────────────────────────────────────┤
│  1. 意图分析层 (Intent Extractor)                            │
│     ↓ 识别 Agent 操作意图（git_push, file_modify 等）         │
│  2. 架构感知匹配 (Architecture Matcher)                      │
│     ↓ 检测跨层依赖违规（controller → repository）            │
│  3. 文件扫描器 (File Scanner)                                │
│     ↓ 识别敏感文件（.env, package-lock.json）                │
│  4. 策略引擎 (Policy Engine)                                 │
│     ↓ 执行声明式规则                                          │
│  5. 语义规则引擎 (Semantic Rule Engine)                      │
│     ↓ 执行语义级规则                                          │
└─────────────────────────────────────────────────────────────┘
                            ↓
                    ┌──────────────┐
                    │  Post-Hook   │
                    │  完整日志    │
                    └──────────────┘
                            ↓
                    ┌──────────────┐
                    │  Trace 存储  │
                    │  (JSONL)     │
                    └──────────────┘
                            ↓
                    ┌──────────────┐
                    │  Analyze CLI │
                    │  规则优化    │
                    └──────────────┘
```

### 12.2 意图分析层 (Intent Extractor)

**模块**: `src/intent/intent-extractor.ts`

#### 功能
从 Agent 的工具调用中提取操作意图，支持跨平台工具名归一化。

#### 支持的意图类型
- `git_push` / `git_force_push` / `git_commit`
- `file_create` / `file_modify` / `file_delete`
- `dependency_install`
- `code_execute`
- `mcp_call`

#### 配置示例
```yaml
# .harness/intent-rules/git-safety.yaml
name: git-safety-intent
rules:
  - name: block-force-push
    intent: git_force_push
    minConfidence: 0.7
    action: deny
    feedback: "Force push is prohibited. Use regular push instead."
    suggestions:
      - "Use git push without --force"
      - "Consider git push --force-with-lease"
```

#### 控制台验证
```bash
# 构建项目
npm run build

# 测试: 拦截 git force push
echo '{"tool_name":"Bash","tool_input":{"command":"git push --force origin main"}}' | node dist/hooks/codex-handler.js pre-tool-use
# 预期: exit code 2, 输出 DENY + 规则反馈
# 实际输出: [GIT-001] Force push is not allowed. Use regular push or push with lease.

# 测试: 允许普通 git push
echo '{"tool_name":"Bash","tool_input":{"command":"git push origin main"}}' | node dist/hooks/codex-handler.js pre-tool-use
# 预期: exit code 0, 输出 ALLOW

# 测试: 拦截 rm -rf
echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf /"}}' | node dist/hooks/codex-handler.js pre-tool-use
# 预期: exit code 2, 识别为 dangerous_command
```

### 12.3 架构感知匹配 (Architecture Matcher)

**模块**: `src/architecture/architecture-matcher.ts`

#### 功能
检测代码层级依赖违规，防止跨层直接访问。

#### 层级定义
```yaml
# .harness/architecture.yaml
layers:
  - name: controller
    patterns:
      - "**/controllers/**"
      - "**/handlers/**"
      - "**/routes/**"
  
  - name: service
    patterns:
      - "**/services/**"
      - "**/use-cases/**"
  
  - name: repository
    patterns:
      - "**/repositories/**"
      - "**/dao/**"
      - "**/models/**"

rules:
  - from: controller
    to: repository
    allowed: false
    feedback: "Controllers must not directly access the repository layer."
    suggestions:
      - "Route the call through a service layer"
```

#### 控制台验证
```bash
# 测试: controller 直接访问 repository（违规）
echo '{"tool_name":"Write","tool_input":{"file_path":"src/controllers/user.ts","content":"import { UserRepo } from \"../repositories/user\";"}}' | node dist/hooks/codex-handler.js pre-tool-use
# 预期: exit code 2, architecture-layer-violation
# 实际输出: [ARCH-001] Controllers must not directly access the repository layer

# 测试: controller 访问 service（合规）
echo '{"tool_name":"Write","tool_input":{"file_path":"src/controllers/user.ts","content":"import { UserService } from \"../services/user\";"}}' | node dist/hooks/codex-handler.js pre-tool-use
# 预期: exit code 0, ALLOW

# 测试: service 访问 repository（合规）
echo '{"tool_name":"Write","tool_input":{"file_path":"src/services/user.ts","content":"import { UserRepo } from \"../repositories/user\";"}}' | node dist/hooks/codex-handler.js pre-tool-use
# 预期: exit code 0, ALLOW
```


### 12.4 文件扫描器 (File Scanner)

**模块**: `src/scanner/file-scanner.ts`

#### 功能
识别敏感文件，防止 Agent 直接修改关键配置或锁定文件。

#### 敏感度分级
- **critical**: `.env`, `.env.local`, `*.pem`, `*.key`
- **high**: `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`
- **medium**: `tsconfig.json`, `.eslintrc`, `.prettierrc`
- **low**: 普通源码文件

#### 配置示例
```yaml
# .harness/policies/protected-files.yaml
name: protected-files
rules:
  - name: block-env-modification
    when: tool.before
    match:
      - field: toolName
        pattern: ["Write", "Edit"]
      - field: input.file_path
        pattern: ["*.env*", "*.pem", "*.key"]
    action: deny
    feedback: "Cannot modify critical-sensitivity file"
    severity: critical
```

#### 控制台验证
```bash
# 测试: 写入 .env 文件（敏感文件）
echo '{"tool_name":"Write","tool_input":{"file_path":".env","content":"DB_PASSWORD=secret"}}' | node dist/hooks/codex-handler.js pre-tool-use
# 预期: exit code 2, file-sensitivity-critical
# 实际输出: [FILE-001] Cannot modify critical-sensitivity file: .env

# 测试: 写入 package-lock.json（锁定文件）
echo '{"tool_name":"Write","tool_input":{"file_path":"package-lock.json","content":"{}"}}' | node dist/hooks/codex-handler.js pre-tool-use
# 预期: exit code 2, file-sensitivity-high

# 测试: 写入普通源码文件
echo '{"tool_name":"Write","tool_input":{"file_path":"src/utils/helper.ts","content":"export function help() {}"}}' | node dist/hooks/codex-handler.js pre-tool-use
# 预期: exit code 0, ALLOW
```

### 12.5 Post-Hook 完整日志

**模块**: `src/hooks/codex-handler.ts` (Post-Hook 处理)

#### 功能
在工具执行完成后记录完整日志，包括执行时长、修改文件列表、退出码等扩展字段。

#### 扩展字段
```typescript
interface TraceEntry {
  // 基础字段
  timestamp: string;
  event: string;  // "tool.before" | "tool.after"
  toolName: string;
  decision: string;  // "allow" | "deny" | "warn"
  reason: string;
  input: any;
  output?: any;
  
  // 扩展字段（Post-Hook 新增）
  duration?: number;        // 执行时长（毫秒）
  modifiedFiles?: string[]; // 修改的文件列表
  exitCode?: number;        // 退出码
}
```

#### 日志示例
```json
{
  "timestamp": "2026-09-02T00:31:13.018Z",
  "event": "tool.after",
  "toolName": "Write",
  "decision": "allow",
  "reason": "",
  "input": {"file_path": "test.js"},
  "output": "file written",
  "duration": 150,
  "modifiedFiles": ["test.js"],
  "exitCode": 0
}
```

#### 控制台验证
```bash
# 执行一个允许的操作
echo '{"tool_name":"Write","tool_input":{"file_path":"test.js","content":"console.log(1)"}}' | node dist/hooks/codex-handler.js pre-tool-use

# 查看 trace 日志
cat .harness/traces/$(date +%Y-%m-%d).jsonl
# 预期: 包含 duration、modifiedFiles、exitCode 字段的完整日志

# Windows PowerShell
Get-Content .harness\traces\$(Get-Date -Format yyyy-MM-dd).jsonl
```

### 12.6 Analyze 命令

**模块**: `src/cli/analyze.ts`

#### 功能
分析 trace 数据，生成规则优化建议。

#### 使用方式
```bash
# 分析最近 7 天的 trace
hannah analyze

# 分析今天的 trace
hannah analyze --today

# 分析最近 N 天
hannah analyze --days 30
```

#### 控制台验证
```bash
# 先执行几次 hook 产生 trace 数据
echo '{"tool_name":"Write","tool_input":{"file_path":"test.js","content":"console.log(1)"}}' | node dist/hooks/codex-handler.js pre-tool-use
echo '{"tool_name":"Bash","tool_input":{"command":"git push --force origin main"}}' | node dist/hooks/codex-handler.js pre-tool-use

# 运行分析命令
node dist/bin.js analyze
# 预期: 输出规则统计 + 优化建议报告

# 分析今天的 trace
node dist/bin.js analyze --today

# 分析最近 30 天
node dist/bin.js analyze --days 30
```

#### 输出示例
```
=== Rule Optimization Report ===

Total traces analyzed: 6
Date range: 2026-09-02T00:31:13.018Z to 2026-09-02T00:35:21.500Z

--- Rule Statistics ---
Rule                                 Hits  Deny  Warn   FP%
-----------------------------------------------------------
unmatched                               4     1     0   75%
architecture-layer-violation            1     1     0    0%
file-sensitivity-critical               1     1     0    0%

--- Optimization Suggestions ---
[REVIEW]  architecture-layer-violation
         Rule triggered only 1 time(s). Consider consolidating or removing.
         Confidence: 40%

[REVIEW]  file-sensitivity-critical
         Rule triggered only 1 time(s). Consider consolidating or removing.
         Confidence: 40%
```

#### 分析维度
- **规则命中率**: 统计每条规则的触发次数
- **误报率**: 计算规则的 false positive 比例
- **冲突检测**: 识别相似规则的潜在冲突
- **优化建议**: 生成规则调整建议（禁用、放宽、审查）


### 12.7 评估链完整流程

```typescript
// src/hooks/codex-handler.ts - evaluatePreToolUse()

function evaluatePreToolUse(input: CodexHookInput): HookDecision {
  // 1. 意图提取
  const intent = extractIntent(input);
  
  // 2. 声明式策略评估
  const policyResult = evaluatePolicies(input);
  if (policyResult.decision === "deny") return policyResult;
  
  // 3. 意图规则匹配
  const intentResult = evaluateIntentRules(intent);
  if (intentResult.decision === "deny") return intentResult;
  
  // 4. 语义规则评估
  const semanticResult = evaluateSemanticRules(input);
  if (semanticResult.decision === "deny") return semanticResult;
  
  // 5. 架构层级检查
  const archResult = evaluateArchitecture(input);
  if (archResult.decision === "deny") return archResult;
  
  // 6. 文件敏感度扫描
  const fileResult = evaluateFileSensitivity(input);
  if (fileResult.decision === "deny") return fileResult;
  
  // 返回最严格的结果
  return mostRestrictive([policyResult, intentResult, semanticResult, archResult, fileResult]);
}
```

### 12.8 跨平台适配

所有高级拦截能力均支持以下 Agent 平台：
- ✅ Codex CLI
- ✅ Claude Code
- ✅ GitHub Copilot
- ✅ Qoder
- ✅ Trae
- ✅ Cursor

通过 `src/adapters/` 中的适配器实现工具名和输入字段的归一化。

### 12.9 配置目录结构

```
.harness/
├── architecture.yaml          # 架构层级定义
├── intent-rules/              # 意图规则
│   └── git-safety.yaml
├── policies/                  # 声明式策略
│   ├── git-safety.yaml
│   ├── mcp-safety.yaml
│   └── protected-files.yaml
├── semantic-rules/            # 语义规则
│   └── custom.yaml
└── traces/                    # Trace 日志
    └── 2026-09-02.jsonl
```

### 12.10 性能指标

| 功能 | 延迟 | 内存占用 |
|------|------|----------|
| 意图分析 | < 5ms | < 1MB |
| 架构感知 | < 10ms | < 2MB |
| 文件扫描 | < 20ms | < 5MB |
| Post-Hook 日志 | < 1ms | < 1MB |
| Analyze 命令 | < 100ms | < 10MB |

### 12.11 完整端到端验证脚本

```bash
# ============================================
# Hannah Agent Runtime - 端到端验证
# ============================================

# Step 0: 构建
npm run build

# Step 1: 意图分析层验证
echo "--- Intent Extraction ---"
echo '{"tool_name":"Bash","tool_input":{"command":"git push --force origin main"}}' | node dist/hooks/codex-handler.js pre-tool-use
echo "Exit code: $?"

# Step 2: 架构感知验证
echo "--- Architecture Matching ---"
echo '{"tool_name":"Write","tool_input":{"file_path":"src/controllers/user.ts","content":"import { UserRepo } from \"../repositories/user\";"}}' | node dist/hooks/codex-handler.js pre-tool-use
echo "Exit code: $?"

# Step 3: 文件扫描验证
echo "--- File Scanner ---"
echo '{"tool_name":"Write","tool_input":{"file_path":".env","content":"DB_PASSWORD=secret"}}' | node dist/hooks/codex-handler.js pre-tool-use
echo "Exit code: $?"

# Step 4: Post-Hook 日志验证
echo "--- Post-Hook Logging ---"
echo '{"tool_name":"Write","tool_input":{"file_path":"test.js","content":"ok"}}' | node dist/hooks/codex-handler.js post-tool-use
cat .harness/traces/$(date +%Y-%m-%d).jsonl

# Step 5: Analyze 命令验证
echo "--- Analyze ---"
node dist/bin.js analyze
```


### 12.13 Phase 3: 可观测性实现

#### 12.13.1 数据导出（export）

```typescript
// src/cli/export.ts
```

支持将 trace 数据导出为 JSON / CSV / JSONL 格式，便于外部分析工具处理。

**控制台验证**：

```bash
# 导出为 JSON（默认）
hannah export

# 导出为 CSV
hannah export --format=csv --output=traces.csv

# 导出最近 30 天数据
hannah export --days=30

# 导出指定 session
hannah export --session=abc123 --format=jsonl
```

#### 12.13.2 会话管理（session）

```typescript
// src/cli/session.ts
```

提供会话维度的管理能力：列出活跃/全部会话、查看会话详情、归档会话、清理过期 trace 文件。

**控制台验证**：

```bash
# 列出活跃会话（30 分钟内有活动）
hannah session

# 列出所有会话
hannah session --all

# 查看指定会话详情（含事件时间线）
hannah session info <session-id>

# 归档会话到 .harness/archive/
hannah session archive <session-id>

# 清理 30 天前的 trace 文件
hannah session cleanup --days=30
```

#### 12.13.3 策略管理（policy）

```typescript
// src/cli/policy.ts
```

提供策略的查看、验证、详情展示能力。与 PolicyDefinition / PolicyRule 类型完全对齐。

**控制台验证**：

```bash
# 列出所有策略
hannah policy list

# 验证所有策略文件
hannah policy validate

# 查看策略详情（含规则列表）
hannah policy show git-safety

# 检查指定策略文件
hannah policy check .harness/policies/git-safety.yaml
```

#### 12.13.4 实时监控（monitor）

```typescript
// src/server/websocket.ts
```

基于 SSE（Server-Sent Events）的实时 trace 推送服务，无需额外依赖。提供 REST API 和 SSE 两种接口。

**端点**：

| 端点 | 说明 |
|------|------|
| `/events` | SSE 实时推送新 trace 事件 |
| `/api/traces` | 获取最近 trace 列表（支持 `?limit=N`） |
| `/api/stats` | 获取统计数据（总数、deny/warn/allow、会话数） |
| `/api/health` | 健康检查 |

**控制台验证**：

```bash
# 启动监控服务（默认端口 4848）
hannah monitor

# 自定义端口
hannah monitor --port=9090

# 测试 API
curl http://localhost:4848/api/stats
curl http://localhost:4848/api/traces?limit=10
```

#### 12.13.5 WebUI Dashboard（web）

```typescript
// src/server/dashboard.ts
```

内置单页 Dashboard，暗色主题，实时展示：

- **概览卡片**：总事件数、Denied 数、Warned 数、活跃会话数
- **事件列表**：最近 50 条事件，含时间、动作、来源、工具
- **会话列表**：所有会话的事件统计和最后活跃时间
- **SSE 实时更新**：新事件到达时自动刷新统计和事件列表

**控制台验证**：

```bash
# 启动 Dashboard（默认端口 4849）
hannah web

# 自定义端口并自动打开浏览器
hannah web --port=8080 --open

# 浏览器访问
# http://localhost:4849
```

#### 12.13.6 Phase 3 命令汇总

| 命令 | 功能 | 文件 |
|------|------|------|
| `hannah export` | 导出 trace 数据 | `src/cli/export.ts` |
| `hannah session` | 会话管理 | `src/cli/session.ts` |
| `hannah policy` | 策略管理 | `src/cli/policy.ts` |
| `hannah monitor` | 实时监控服务 | `src/server/websocket.ts` |
| `hannah web` | WebUI Dashboard | `src/server/dashboard.ts` |

### 12.12 未来扩展

- [ ] 机器学习意图识别（替代规则匹配）
- [ ] 动态架构层级检测（自动识别项目结构）
- [ ] 文件依赖图谱（可视化跨层调用）
- [ ] 实时规则优化（基于 trace 数据自动调整）
- [ ] 多租户支持（团队级规则隔离）

---

**Document Version**: 2.3  
**Last Updated**: 2026-09-02  
**Next Review**: Phase 5 - Ecosystem
