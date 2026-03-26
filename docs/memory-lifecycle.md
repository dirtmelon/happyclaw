# 记忆系统生命周期

## 记忆文件总览

| 记忆类型 | 磁盘路径 | 容器路径 | 谁能写 |
|---------|---------|---------|--------|
| 用户全局记忆 | `data/groups/user-global/{userId}/CLAUDE.md` | `/workspace/global/CLAUDE.md` | 仅主容器 |
| 每日心跳摘要 | `data/groups/user-global/{userId}/HEARTBEAT.md` | `/workspace/global/HEARTBEAT.md` | 后端自动生成 |
| 会话私有记忆 | `data/groups/{folder}/CLAUDE.md` | `/workspace/group/CLAUDE.md` | 所有容器 |
| 日期记忆 | `data/memory/{folder}/YYYY-MM-DD.md` | `/workspace/memory/YYYY-MM-DD.md` | 仅主容器 |
| 对话归档 | `data/groups/{folder}/conversations/` | `/workspace/group/conversations/` | PreCompact Hook |

---

## 1. 用户全局记忆（CLAUDE.md）

**路径**: `data/groups/user-global/{userId}/CLAUDE.md`

### 生成时机

- **首次创建**: 用户注册后首次启动主容器时，由 Agent 根据全局模板 (`config/global-claude-md.template.md`) 自动创建
- **持续更新**: Agent 对话中发现用户身份、偏好等永久信息时，通过 `Read` + `Edit` 工具原地更新
- **压缩时刷新**: 上下文压缩触发 memory flush，Agent 被提示检查并填写「待记录」字段（`agent-runner/index.ts:1770-1782`）

### 加载时机

- **启动时注入 prompt**: 主容器启动时读取内容，截断到 8000 字符，包裹在 `<user-profile>` 标签注入系统提示词（`agent-runner/index.ts:1085-1088`）
- **运行时文件访问**: 通过 `additionalDirectories` 注册到 Claude Code CLI，Agent 可随时 `Read`/`Edit`（`agent-runner/index.ts:1208-1209`）
- **MCP 搜索**: `memory_search` 工具会搜索此文件内容（`agent-runner/mcp-tools.ts:1076`）

### 代码路径

| 阶段 | 文件 | 行号 |
|------|------|------|
| 挂载 | `src/container-runner.ts` | 213-218（容器），983-985（宿主机） |
| 注入 prompt | `container/agent-runner/src/index.ts` | 1085-1088 |
| additionalDirectories | `container/agent-runner/src/index.ts` | 1208-1209 |

---

## 2. 每日心跳摘要（HEARTBEAT.md）

**路径**: `data/groups/user-global/{userId}/HEARTBEAT.md`

### 生成时机

- **后端定时任务**: 每天凌晨 2-3 点，`src/daily-summary.ts` 遍历所有用户，汇总近期对话写入
- **非 Agent 产生**: 后端进程直接写入，Agent 不参与生成

### 加载时机

- **启动时注入 prompt**: 仅主容器，读取后截断到 2048 字符，包裹在 `<recent-work>` 标签注入系统提示词（`agent-runner/index.ts:1117-1135`）
- 带有明确警告：「不要主动继续这些工作，除非用户明确要求」

### 代码路径

| 阶段 | 文件 | 行号 |
|------|------|------|
| 生成 | `src/daily-summary.ts` | 整个文件 |
| 挂载 | 同全局记忆（同一目录） | — |
| 注入 prompt | `container/agent-runner/src/index.ts` | 1117-1135 |

---

## 3. 会话私有记忆（会话 CLAUDE.md）

**路径**: `data/groups/{folder}/CLAUDE.md`

### 生成时机

- **Claude Code 自动维护**: Claude SDK 内置机制，在对话中自动创建和更新工作目录下的 `CLAUDE.md`
- **Agent 主动写入**: Agent 可通过 `Edit` 工具直接修改

### 加载时机

- **Claude Code CLI 自动加载**: SDK 启动时自动扫描并加载工作目录中的 `CLAUDE.md` 作为项目指令（这是 Claude Code 的标准行为，不需要额外代码）
- **MCP 搜索**: `memory_search` 会搜索此文件

### 代码路径

| 阶段 | 文件 | 行号 |
|------|------|------|
| 挂载 | `src/container-runner.ts` | 241-242（admin），246-249（其他） |
| 加载 | Claude SDK 内部机制 | — |

---

## 4. 日期记忆

**路径**: `data/memory/{folder}/YYYY-MM-DD.md`

### 生成时机

- **Agent 调用 `memory_append`**: 对话中发现时效性信息（今日进展、临时决策、待办等）时主动调用（`agent-runner/mcp-tools.ts:955-1074`）
- **压缩时刷新**: 上下文压缩后 memory flush 提示 Agent 保存时效性记忆（`agent-runner/index.ts:1779`）
- **写入格式**: 追加模式，每条带 ISO 时间戳 + `---` 分隔符
- **限制**: 单次追加最大 16KB，单文件最大 512KB
- **仅主容器可写**: `isHome=true` 时才注册此 MCP 工具

### 加载时机

- **运行时文件访问**: 通过 `additionalDirectories` 注册，Agent 可 `Read`/`Glob` 浏览（`agent-runner/index.ts:1208-1210`）
- **MCP 搜索/读取**: `memory_search` 搜索 + `memory_get` 精确读取（`agent-runner/mcp-tools.ts:1076-1282`）
- **不注入 prompt**: 日期记忆不会被注入系统提示词，只能通过工具按需访问

### 代码路径

| 阶段 | 文件 | 行号 |
|------|------|------|
| 目录创建 | `src/container-runner.ts` | 842-844 |
| 挂载 | `src/container-runner.ts` | 容器模式 buildVolumeMounts, 宿主机 994-996 |
| 写入 (memory_append) | `container/agent-runner/src/mcp-tools.ts` | 955-1074 |
| 搜索 (memory_search) | `container/agent-runner/src/mcp-tools.ts` | 1076-1179 |
| 读取 (memory_get) | `container/agent-runner/src/mcp-tools.ts` | 1181-1282 |
| 压缩时刷新提示 | `container/agent-runner/src/index.ts` | 1770-1782 |

---

## 5. 对话归档

**路径**: `data/groups/{folder}/conversations/YYYY-MM-DD-conversation-HHMM.md`

### 生成时机

- **PreCompact Hook**: 上下文压缩前，Hook 将当前对话导出为 Markdown 归档到 `conversations/` 目录
- **非 Agent 主动产生**: 由 SDK 的 PreCompact 钩子自动触发

### 加载时机

- **MCP 搜索**: `memory_search` 会递归搜索 `conversations/` 目录内容
- **Agent 文件访问**: Agent 可通过 `Read` 工具直接读取
- **不注入 prompt**: 不会被注入系统提示词

---

## 非记忆的运行时数据

以下文件**不属于记忆系统**，是 SDK 运行时基础设施：

| 路径 | 容器路径 | 用途 |
|------|---------|------|
| `data/sessions/{folder}/.claude/settings.json` | `/home/node/.claude/settings.json` | SDK 配置（MCP servers、权限） |
| `data/sessions/{folder}/.claude/*.jsonl` | `/home/node/.claude/*.jsonl` | 对话转录（SDK 会话持久化） |
| `data/sessions/{folder}/.claude/todos/` | `/home/node/.claude/todos/` | 任务状态 |
| `data/sessions/{folder}/.claude/debug/` | `/home/node/.claude/debug/` | 调试日志 |

挂载代码: `src/container-runner.ts:277-287`（容器），`:1000`（宿主机 `CLAUDE_CONFIG_DIR`）

---

## 记忆流转图

```
对话进行中
  │
  ├─ Agent 发现永久信息 ──→ Edit /workspace/global/CLAUDE.md     (全局记忆)
  ├─ Agent 发现时效信息 ──→ memory_append → memory/YYYY-MM-DD.md (日期记忆)
  ├─ Claude SDK 自动维护 ──→ /workspace/group/CLAUDE.md           (会话记忆)
  │
  ▼
上下文压缩触发
  │
  ├─ PreCompact Hook ────→ conversations/YYYY-MM-DD-*.md          (对话归档)
  ├─ Memory Flush ───────→ Agent 被提示保存全局记忆 + 日期记忆
  │
  ▼
每日凌晨 2-3 点
  │
  └─ daily-summary.ts ──→ HEARTBEAT.md                            (心跳摘要)

下次对话启动
  │
  ├─ 注入 prompt: 全局 CLAUDE.md (8000 字符) + HEARTBEAT.md (2048 字符)
  ├─ SDK 自动加载: 会话 CLAUDE.md
  └─ 按需访问: memory_search/memory_get → 日期记忆 + 对话归档
```
