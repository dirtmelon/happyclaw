---
name: browser-use
description: 使用 Browser Use 2.0 进行浏览器自动化，基于 CDP 直连，成本更低、速度更快。当用户请求"browser use"、"browser-use"、"CDP 直连浏览器"、"低成本浏览器自动化"、"批量浏览操作"、"Python 浏览器自动化"、"浏览器代理"时使用。当用户偏好 Python 生态、需要成本敏感的大批量浏览器自动化任务时，优先推荐此 skill。
---

# Browser Use 2.0 - 低成本浏览器自动化

Browser Use 是一个基于 CDP（Chrome DevTools Protocol）直连的浏览器自动化框架，2.0 版本号称将成本降低 50%。它提供 Python API 和 CLI 两种使用方式，适合大批量、成本敏感的浏览器自动化任务。

GitHub: https://github.com/browser-use/browser-use

## 安装

首次使用时自动检测并安装：

```bash
# 检查是否已安装
pip show browser-use 2>/dev/null || python -m browser_use --version 2>/dev/null

# 安装方式 1: pip（推荐）
pip install browser-use

# 安装方式 2: pipx（隔离环境）
pipx install browser-use

# 安装方式 3: uv（更快）
uv pip install browser-use

# 安装浏览器（如果尚未安装 playwright 的 chromium）
python -m playwright install chromium
```

需要 Python 3.11+ 环境。

## CLI 使用

Browser Use 2.0 提供了命令行接口：

```bash
# 基本用法 — 用自然语言描述任务
browser-use "打开 GitHub 搜索 browser-use 并获取 star 数"

# 指定浏览器（默认 chromium）
browser-use --browser chrome "访问 example.com 并截图"

# headless 模式
browser-use --headless "抓取 example.com 的标题"

# 保存结果
browser-use --output result.json "获取 hacker news 前 10 条新闻"
```

## Python API 使用

```python
from browser_use import Agent
from langchain_openai import ChatOpenAI

# 创建 Agent（支持多种 LLM 后端）
agent = Agent(
    task="Go to example.com and extract the main heading",
    llm=ChatOpenAI(model="gpt-4o"),  # 或其他 LLM
)

# 运行
result = await agent.run()
print(result)
```

### 高级用法

```python
from browser_use import Agent, Browser, BrowserConfig

# 自定义浏览器配置
browser = Browser(
    config=BrowserConfig(
        headless=True,
        # 连接到已有的 Chrome 实例（CDP 直连）
        chrome_instance_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        # 或通过 CDP URL 连接
        # cdp_url="http://localhost:9222",
    )
)

agent = Agent(
    task="你的任务描述",
    llm=your_llm,
    browser=browser,
)

result = await agent.run()
```

### CDP 直连模式

Browser Use 的核心优势 — 直接通过 CDP 协议连接到 Chrome，跳过了 Playwright 的抽象层：

```python
from browser_use import Browser, BrowserConfig

# 连接到已运行的 Chrome（需要开启远程调试）
browser = Browser(
    config=BrowserConfig(
        cdp_url="http://localhost:9222"
    )
)
```

这样可以：
- 复用已有的 Chrome 会话（保留登录态）
- 减少浏览器启动开销
- 降低内存消耗

## 核心特性

### 成本优化
Browser Use 2.0 通过以下方式降低成本：
- **CDP 直连** — 减少中间层开销
- **智能视觉处理** — 只在必要时使用截图，大部分时候依赖 DOM 结构
- **操作合并** — 将多个小操作合并为批量操作
- **缓存机制** — 缓存页面结构避免重复解析

### 多 LLM 支持
支持多种大语言模型作为决策后端：
- OpenAI (GPT-4o, GPT-4)
- Anthropic (Claude)
- 本地模型（通过 Ollama 等）

### 自动错误恢复
- 元素找不到时自动重试
- 页面导航失败时自动回退
- 超时自动处理

## 适用场景

| 场景 | 说明 |
|------|------|
| 大批量数据抓取 | 成本低，适合爬取大量页面 |
| 重复性表单操作 | 批量录入数据 |
| 网站监控 | 定期检查页面状态变化 |
| 自动化测试 | Python 生态集成方便 |
| CDP 直连调试 | 连接已有 Chrome 实例 |

## 与其他工具的对比

| 特性 | Browser Use | Playwright MCP | Agent Browser |
|------|------------|----------------|---------------|
| 语言 | Python | Node.js (MCP) | Node.js |
| 底层 | CDP 直连 | Playwright | Playwright |
| 成本 | 最低 | 中等 | 中等 |
| AI 优化 | 是 | 否 | 是 |
| 安装复杂度 | 低 | 最低(已集成) | 中等 |
| 适合场景 | 批量任务 | 单次操作 | 复杂流程 |

## 注意事项

- 需要 Python 3.11+ 环境
- 使用 LLM 后端时需要配置对应的 API Key（如 `OPENAI_API_KEY`）
- CDP 直连模式需要 Chrome 开启远程调试（`--remote-debugging-port=9222`）
- headless 模式下某些网站可能检测并阻止自动化
- 大批量任务建议设置适当的请求间隔，避免被目标网站封禁
