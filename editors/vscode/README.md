# Agent Runtime VSCode Extension

在 VSCode Secondary Sidebar 中实时展示 AI Agent 的工具调用链。

![VSCode Extension](https://img.shields.io/badge/VSCode-1.79+-blue)

## 功能特性

- 📊 **实时追踪**: 自动监听 `.harness/traces/*.jsonl` 文件变化，实时刷新
- 🌳 **树形视图**: 分层展示 Session → Tool → Event 调用链
- 🎨 **视觉指示**: 
  - ✅ 绿色对勾 - 允许的操作
  - ❌ 红色叉号 - 拒绝的操作
  - ⚠️ 黄色警告 - 警告的操作
- 🔍 **过滤功能**: 一键切换只显示被拒绝的事件
- 📋 **详细信息**: 悬停查看完整的 payload 和 feedback

## 安装

### 方式 1: 从源码构建（开发模式）

```bash
cd editors/vscode
npm install
npm run compile
```

然后在 VSCode 中：
1. 按 `F5` 启动扩展开发宿主
2. 或打包后安装：`npx vsce package` → `code --install-extension *.vsix`

### 方式 2: 一键装载（推荐）

在项目根目录执行：

```bash
hannah init --with-vscode
```

这会自动：
- 生成 `.vscode/settings.json` 配置
- 创建 `.vscode/README.md` 安装指引
- 检测 VSCode 是否已安装

### 方式 3: 手动安装

1. 打开 VSCode
2. 按 `Ctrl+Shift+P` (Mac: `Cmd+Shift+P`)
3. 输入 "Extensions: Install from VSIX..."
4. 选择 `editors/vscode/agent-runtime-trace-0.1.0.vsix`

## 使用方法

### 1. 打开 Secondary Sidebar

按 `Ctrl+Shift+P` → 输入 "View: Show Secondary Sidebar"

或按快捷键：
- Windows/Linux: `Ctrl+Alt+B`
- Mac: `Cmd+Option+B`

### 2. 查看调用链

在 Secondary Sidebar 中找到 "Agent Runtime" 面板，工具调用链会自动显示。

### 3. 交互操作

- **展开/折叠**: 点击节点左侧的箭头
- **刷新**: 点击标题栏的刷新图标
- **过滤**: 点击漏斗图标只显示被拒绝的事件
- **清空**: 右键菜单 → "Clear Trace"

## 配置

在 `.vscode/settings.json` 中配置：

```json
{
  "agentRuntime.traceDir": ".harness/traces",
  "agentRuntime.autoRefresh": true,
  "agentRuntime.maxEntries": 100
}
```

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `traceDir` | string | `.harness/traces` | Trace 文件目录（相对于工作区根目录） |
| `autoRefresh` | boolean | `true` | 文件变化时自动刷新 |
| `maxEntries` | number | `100` | 最大显示条目数 |

## 命令

在命令面板 (`Ctrl+Shift+P`) 中可用：

- `Agent Runtime: Refresh Trace` - 手动刷新
- `Agent Runtime: Clear Trace` - 清空视图
- `Agent Runtime: Show Denied Only` - 切换过滤

## 视图结构

```
📅 2026-08-26 (12 events)
├── 11:02:33 Write ✅ ALLOW
│   ├── ℹ️ Tool: Write
│   └── ℹ️ File: src/App.tsx
├── 11:02:34 Bash ❌ DENY
│   ├── ℹ️ Tool: Bash
│   ├── ℹ️ Command: git push --force
│   └── 💬 Force push is not allowed
└── 11:02:35 mcp__database__write ❌ DENY
    ├── ℹ️ Server: database
    ├── ℹ️ Operation: write
    └── 💬 Database writes are not allowed
```

## 故障排查

### 扩展不显示？

1. 确保 `.harness/traces/` 目录存在
2. 检查 VSCode Output 面板：View → Output → "Agent Runtime Trace"
3. 尝试重载窗口：`Ctrl+Shift+P` → "Developer: Reload Window"

### 没有 Trace 显示？

1. 运行 Agent 并确保 hooks 已启用
2. 检查 trace 是否写入 `.harness/traces/*.jsonl`
3. 验证 `agentRuntime.traceDir` 设置指向正确目录

### 实时刷新不工作？

1. 检查 `agentRuntime.autoRefresh` 是否为 `true`
2. 确认文件监听权限（某些系统可能需要重启 VSCode）
3. 手动点击刷新按钮

## 开发

```bash
cd editors/vscode

# 安装依赖
npm install

# 编译（监听模式）
npm run watch

# 打包
npx vsce package

# 调试
# 按 F5 启动扩展开发宿主
```

## 架构

```
src/
├── extension.ts          # 扩展入口
├── traceWatcher.ts       # 文件监听器（fs.watch）
└── traceTreeProvider.ts  # TreeView 数据提供者
```

### 数据流

```
.harness/traces/*.jsonl
    ↓ (fs.watch)
TraceWatcher
    ↓ (onChange callback)
TraceTreeProvider.refresh()
    ↓ (read & parse JSONL)
TreeView.render()
```

## 相关链接

- [Agent Runtime 文档](../../README.md)
- [Hook Adaptation Table](../../doc/guidelines/hook-adaptation-table.md)
- [CLI 使用指南](../../QUICKSTART.md)

## License

MIT
