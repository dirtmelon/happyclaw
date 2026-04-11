---
name: chrome-devtools
description: 使用 Chrome DevTools MCP 进行深度调试、性能分析和网络抓包。连接到用户真实的 Chrome 浏览器会话，提供完整的 DevTools 能力。当用户请求"抓包"、"网络请求分析"、"devtools"、"chrome 调试"、"性能分析"、"network 监控"、"debug chrome"、"CDP"、"远程调试"、"页面性能"、"接口调试"、"请求拦截"、"查看 cookies"、"分析加载时间"时使用。当用户需要调试真实浏览器会话中的网络请求或性能问题时，此 skill 是首选。
---

# Chrome DevTools MCP - 深度调试与抓包

通过 Chrome DevTools Protocol (CDP) 连接到用户的真实 Chrome 浏览器会话，提供完整的开发者工具能力，包括网络抓包、性能分析、DOM 检查、JavaScript 调试等。

官方博客: https://developer.chrome.com/blog/chrome-devtools-mcp-debug-your-browser-session

## 前置条件

### 1. Chrome 开启远程调试

有两种方式启用：

**方式 A: 通过 Chrome 内置设置（推荐，Chrome M144+）**

1. 打开 `chrome://inspect/#remote-debugging`
2. 在页面中开启远程调试连接端口
3. 记住分配的端口号（默认 9222）

**方式 B: 通过命令行启动参数**

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

# Linux
google-chrome --remote-debugging-port=9222

# 如果 Chrome 已经在运行，需要先关闭所有 Chrome 实例再重新启动
```

### 2. 安装 Chrome DevTools MCP Server

```bash
# 检查是否已安装
npm list -g @anthropic-ai/chrome-devtools-mcp 2>/dev/null

# 安装
npm install -g @anthropic-ai/chrome-devtools-mcp

# 或直接用 npx 运行
npx @anthropic-ai/chrome-devtools-mcp
```

### 3. 配置 Claude Code MCP

如果尚未配置，需要在 Claude Code 的 MCP 设置中添加 Chrome DevTools MCP Server：

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["@anthropic-ai/chrome-devtools-mcp"],
      "env": {
        "CDP_URL": "http://localhost:9222"
      }
    }
  }
}
```

## 核心能力

### 网络抓包（最常用）

这是此 skill 最强大的功能 — 实时监控和分析浏览器的所有网络请求。

**典型用法：**
1. 连接到 Chrome 调试端口
2. 开启 Network 域的事件监听
3. 用户在浏览器中操作
4. 分析捕获到的请求/响应数据

**可以捕获的信息：**
- 请求 URL、方法、Headers
- 请求体（POST data）
- 响应状态码、Headers
- 响应体（JSON、HTML 等）
- 请求耗时和大小
- WebSocket 消息
- 资源加载时序

### 性能分析

- **页面加载性能** — 首次绘制、DOM 就绪、完全加载时间
- **运行时性能** — JavaScript 执行时间、长任务检测
- **内存分析** — 堆快照、内存泄漏检测
- **渲染性能** — 布局抖动、重绘频率

### DOM 检查与操作

- 查询和修改 DOM 节点
- 获取计算样式
- 监听 DOM 变化事件
- 截取指定节点的截图

### JavaScript 调试

- 在页面上下文中执行 JavaScript
- 设置断点（概念上的 — 通过 CDP 协议）
- 获取调用栈信息
- 监听控制台输出

### Cookie 和存储

- 查看/修改/删除 Cookies
- 访问 localStorage 和 sessionStorage
- 查看 IndexedDB 数据

## 常见工作流

### 抓包分析 API 接口

```
1. 确认 Chrome 远程调试已开启
2. 连接 CDP: http://localhost:9222
3. 启用 Network 域事件监听
4. 用户在浏览器中执行操作
5. 收集所有网络请求
6. 过滤并分析目标 API 的请求/响应
7. 输出结构化的接口文档或数据
```

### 性能诊断

```
1. 连接到 Chrome
2. 启用 Performance 域
3. 开始录制性能数据
4. 用户执行需要分析的操作
5. 停止录制
6. 分析火焰图数据，找出性能瓶颈
```

### 调试页面问题

```
1. 连接到 Chrome
2. 获取页面 DOM 树
3. 查看控制台错误信息
4. 检查网络请求是否有失败
5. 在页面上下文中执行诊断 JS
6. 定位并报告问题原因
```

## 与 Playwright MCP 的区别

| 特性 | Chrome DevTools MCP | Playwright MCP |
|------|-------------------|----------------|
| 连接方式 | 连接到已有 Chrome 会话 | 启动新的浏览器实例 |
| 适用场景 | 调试、分析真实用户会话 | 自动化操作新页面 |
| 网络抓包 | 完整的 Network 域支持 | 基础网络请求查看 |
| 性能分析 | 完整的 Performance 域 | 不支持 |
| 用户状态 | 保留用户登录态、Cookies | 全新的浏览器上下文 |
| 扩展插件 | 保留用户安装的扩展 | 无扩展 |

**选择原则：** 需要在用户真实浏览器环境中调试 → Chrome DevTools；需要从零开始自动化操作 → Playwright。

## 注意事项

- 远程调试端口暴露了完整的浏览器控制权限，不要在公网环境开放
- 某些网站可能检测 DevTools 连接并改变行为
- 大量网络请求的抓包可能消耗较多内存，注意及时清理
- Chrome M144+ 的内置远程调试功能更安全，推荐优先使用
