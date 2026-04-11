---
name: research-card
description: >
  生成"大聪明"风格的深度调研报告卡片图片。当用户要求总结文章、分析项目、
  制作调研报告、生成信息卡片时触发。支持从 URL（推特、公众号、GitHub）或
  文本内容生成结构化的可视化研究报告。
---

# 深度调研报告卡片生成 Skill

## 何时触发

用户使用以下表达时应触发本 Skill：

- "帮我做一个调研报告/卡片"
- "总结一下这篇文章"
- "分析一下这个项目/仓库"
- "生成信息卡片/研究卡片"
- 用户发来一个 URL（推特、公众号、GitHub 等）并要求总结或分析
- 用户发来一段文字并要求制作可视化摘要

## 输入输出

- **输入**：URL（推特/公众号/GitHub/一般文章）或文本内容
- **输出**：一张 PNG 图片（800px 宽，高度自适应），保存到工作区

## 完整工作流程

### Step 1：获取原始内容

根据输入类型选择获取方式：

**URL 输入**：使用 `agent-browser` 或 `playwright` 访问 URL，提取页面文本内容。

```bash
# 使用 agent-browser（如果可用）
timeout 120 agent-browser --url "URL" --action extract_text

# 或使用 playwright
timeout 120 python3 -c "
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto('URL', wait_until='networkidle', timeout=60000)
    print(page.inner_text('body'))
    browser.close()
"
```

**文本输入**：直接使用用户提供的文本。

### Step 2：分析内容并提取结构化信息

从原始内容中提取以下结构化信息（不是所有字段都必需，根据内容类型灵活取舍）：

| 字段 | 说明 | 是否必需 |
|------|------|---------|
| `LOGO_EMOJI` | 头部 emoji，根据主题选择 | 是 |
| `AUTHOR_NAME` | 品牌/作者名 | 是 |
| `DATE` | 日期（YYYY-MM-DD 或描述性） | 是 |
| `MAIN_TITLE` | 格式："深度调研：[主题]" | 是 |
| `SUBTITLE` | 来源/作者信息 | 是 |
| `CORE_SUMMARY` | 2-3 句核心摘要 | 是 |
| `BASIC_INFO_TABLE` | 基本信息表格 HTML | 推荐 |
| `DESCRIPTION` | "这是什么"一段描述 | 推荐 |
| `FEATURES_TABLE` | 核心功能表格 HTML | 可选 |
| `ARCHITECTURE_DIAGRAM` | 架构流程图 HTML | 可选 |
| `TECH_DETAILS` | 关键技术细节列表项 | 可选 |
| `STRATEGIC_ANALYSIS` | 战略意义分析 HTML | 可选 |
| `IMPACT_TABLE` | 影响评估表格 HTML | 可选 |
| `VALUE_TABLE` | 实际价值评估表格 HTML | 可选 |
| `LIMITATIONS` | 局限性列表项 | 推荐 |
| `ONE_LINE_SUMMARY` | 一句话总结 | 是 |
| `FOOTER_URL` | 来源 URL | 可选 |

### Step 3：不同输入类型的处理策略

**GitHub 项目**：
- `LOGO_EMOJI`：用 `🔧` 或与项目领域相关的 emoji
- `BASIC_INFO_TABLE`：Stars、Forks、语言、协议、最近更新、作者
- `FEATURES_TABLE`：核心命令/功能/API，含名称、作用、使用场景
- `ARCHITECTURE_DIAGRAM`：项目架构或数据流
- `TECH_DETAILS`：技术栈、设计模式、性能特点
- `VALUE_TABLE`：使用场景及推荐度

**推特/X 帖子**：
- `LOGO_EMOJI`：用 `🐦` 或与话题相关的 emoji
- 重点放在 `CORE_SUMMARY` 和 `STRATEGIC_ANALYSIS`
- 通常不需要 `FEATURES_TABLE` 和 `ARCHITECTURE_DIAGRAM`
- `ONE_LINE_SUMMARY` 提炼推文核心观点

**公众号/博客文章**：
- `LOGO_EMOJI`：与文章主题相关
- 完整使用所有 section
- 强调 `STRATEGIC_ANALYSIS` 和 `IMPACT_TABLE`

**一般文本/新闻**：
- 灵活选择 section，不需要的留空即可
- 至少包含：标题、核心摘要、一句话总结

### Step 4：填充 HTML 模板

模板文件位于同目录 `template.html`。使用 Python 读取模板并替换占位符。

**关键规则**：对于不需要的 section，删除整个 `<!-- SECTION:XXX -->...<!-- /SECTION:XXX -->` 块（包括注释标记），不要留空白区域。

以下是各占位符的 HTML 格式要求：

#### `{{BASIC_INFO_TABLE}}` — 基本信息表格

```html
<table>
  <thead><tr><th>项目</th><th>详情</th></tr></thead>
  <tbody>
    <tr><td>发布方</td><td>Anthropic</td></tr>
    <tr><td>时间</td><td>2025-01-15</td></tr>
    <tr><td>Stars</td><td>12.5K</td></tr>
    <tr><td>语言</td><td>TypeScript / Python</td></tr>
    <tr><td>协议</td><td>MIT</td></tr>
    <tr><td>状态</td><td><span class="badge badge-green">✅ 稳定</span></td></tr>
  </tbody>
</table>
```

#### `{{FEATURES_TABLE}}` — 核心功能表格

```html
<table>
  <thead><tr><th>功能</th><th>作用</th><th>模式</th></tr></thead>
  <tbody>
    <tr><td><strong>init</strong></td><td>初始化项目配置</td><td><span class="badge badge-blue">CLI</span></td></tr>
    <tr><td><strong>run</strong></td><td>执行主任务</td><td><span class="badge badge-green">自动</span></td></tr>
  </tbody>
</table>
```

#### `{{ARCHITECTURE_DIAGRAM}}` — 流程图

使用 CSS flexbox 绘制，不用 mermaid。支持纵向和横向布局：

**纵向流程**：

```html
<div class="flow-chart">
  <div class="flow-row">
    <div class="flow-node blue">用户输入</div>
  </div>
  <div class="flow-arrow down"></div>
  <div class="flow-row">
    <div class="flow-node orange">解析处理</div>
  </div>
  <div class="flow-arrow down"></div>
  <div class="flow-row">
    <div class="flow-node green">模型推理</div>
    <div class="flow-node green">工具调用</div>
  </div>
  <div class="flow-arrow down"></div>
  <div class="flow-row">
    <div class="flow-node red">输出结果</div>
  </div>
</div>
<p class="text-muted text-sm mt-8">
  图：系统核心数据流，从用户输入到最终输出的完整路径。
</p>
```

**可用节点颜色**：`blue`、`orange`、`green`、`red`、`purple`、`teal`、`gray`

#### `{{TECH_DETAILS}}` — 技术细节列表项

直接填入 `<li>` 元素（外层 `<ol class="detail-list">` 已在模板中）：

```html
<li><strong>零拷贝数据管道</strong>：使用 mmap 直接映射文件到内存，避免数据复制开销。</li>
<li><strong>增量编译缓存</strong>：基于文件哈希的缓存机制，仅重编译变更的模块。</li>
<li><strong>WASM 沙箱</strong>：插件在 WebAssembly 沙箱中执行，确保安全隔离。</li>
```

#### `{{STRATEGIC_ANALYSIS}}` — 战略分析

```html
<div class="analysis-point">
  <div class="analysis-point-title">1. 对开发者生态的影响</div>
  <div class="analysis-point-body">
    该项目重新定义了 CLI 工具的开发范式。传统的命令行工具需要手动编排复杂的管道操作，
    而新框架通过声明式配置将复杂度降低了一个数量级。
  </div>
</div>
<div class="analysis-point">
  <div class="analysis-point-title">2. 商业化前景</div>
  <div class="analysis-point-body">
    开源核心 + 云服务的组合模式已被验证可行。预计 12 个月内将出现企业版。
  </div>
</div>
```

#### `{{IMPACT_TABLE}}` — 影响评估表格

```html
<table class="impact-table">
  <thead><tr><th>时间维度</th><th>影响领域</th><th>影响描述</th></tr></thead>
  <tbody>
    <tr><td><strong>短期</strong></td><td>开发效率</td><td>降低 CLI 工具开发门槛，预计节省 40% 开发时间</td></tr>
    <tr><td><strong>中期</strong></td><td>工具生态</td><td>可能成为新一代 CLI 框架的事实标准</td></tr>
    <tr><td><strong>长期</strong></td><td>行业格局</td><td>推动 AI-native 开发工具的普及</td></tr>
  </tbody>
</table>
```

#### `{{VALUE_TABLE}}` — 实际价值评估表格

使用星级评分（复制粘贴 ⭐ 即可）：

```html
<table class="value-table">
  <thead><tr><th>使用场景</th><th>价值描述</th><th>推荐度</th></tr></thead>
  <tbody>
    <tr><td>个人项目</td><td>快速搭建 CLI 工具原型</td><td><span class="stars">⭐⭐⭐⭐⭐</span></td></tr>
    <tr><td>企业内部工具</td><td>标准化团队 CLI 开发流程</td><td><span class="stars">⭐⭐⭐⭐</span></td></tr>
    <tr><td>开源项目</td><td>提升项目的可维护性</td><td><span class="stars">⭐⭐⭐⭐</span></td></tr>
  </tbody>
</table>
```

#### `{{LIMITATIONS}}` — 局限性列表项

直接填入 `<li>` 元素（外层 `<ul class="limitation-list">` 已在模板中）：

```html
<li><strong>文档不完善</strong>：当前版本文档覆盖率约 60%，高级特性缺少示例。</li>
<li><strong>生态尚未成熟</strong>：第三方插件数量有限，社区仍在早期阶段。</li>
<li><strong>性能瓶颈</strong>：超大规模项目（>10000 文件）下的增量编译仍需优化。</li>
```

#### 徽章颜色选择指南

| 类 | 用法 | 示例 |
|------|------|------|
| `badge-green` | 正面状态 | `✅ 稳定`、`✅ 生产就绪` |
| `badge-yellow` | 中性/警告 | `⚠️ 实验性`、`⚠️ Beta` |
| `badge-red` | 风险/问题 | `❌ 已废弃`、`🚨 高风险` |
| `badge-blue` | 信息/分类 | `CLI`、`API`、`SDK` |
| `badge-gray` | 次要信息 | `可选`、`内部` |

### Step 5：渲染为图片

使用 Playwright 将 HTML 渲染为 PNG 图片：

```python
import os
import re
from playwright.sync_api import sync_playwright

# ---- Configuration ----
template_path = os.path.expanduser("/workspace/project-skills/research-card/template.html")
html_path = "/tmp/research_card.html"
output_path = "/tmp/research_card.png"

# ---- Read template ----
with open(template_path, "r", encoding="utf-8") as f:
    html = f.read()

# ---- Define replacements ----
# Fill in the actual values extracted from source content
replacements = {
    "{{LOGO_EMOJI}}": "🔍",
    "{{AUTHOR_NAME}}": "Deep Research",
    "{{DATE}}": "2025-01-15",
    "{{MAIN_TITLE}}": "深度调研：项目名称",
    "{{SUBTITLE}}": "作者 / 来源信息",
    "{{CORE_SUMMARY}}": "这里是 2-3 句核心摘要。",
    "{{BASIC_INFO_TABLE}}": "<table>...</table>",
    "{{DESCRIPTION}}": "这里是描述文字。",
    "{{FEATURES_TABLE}}": "<table>...</table>",
    "{{ARCHITECTURE_DIAGRAM}}": "<div class='flow-chart'>...</div>",
    "{{TECH_DETAILS}}": "<li>...</li>",
    "{{STRATEGIC_ANALYSIS}}": "<div class='analysis-point'>...</div>",
    "{{IMPACT_TABLE}}": "<table>...</table>",
    "{{VALUE_TABLE}}": "<table>...</table>",
    "{{LIMITATIONS}}": "<li>...</li>",
    "{{ONE_LINE_SUMMARY}}": "一句话总结。",
    "{{FOOTER_URL}}": "https://example.com",
}

# ---- Remove empty sections ----
# For any section whose placeholder is empty or not needed,
# remove the entire SECTION block
for key, value in replacements.items():
    if not value or value.strip() == "":
        # Extract section name from placeholder: {{SECTION_NAME}} -> SECTION_NAME
        section_name = key.strip("{}")
        # Remove the entire section block
        pattern = rf'<!-- SECTION:{section_name} -->.*?<!-- /SECTION:{section_name} -->'
        html = re.sub(pattern, '', html, flags=re.DOTALL)

# ---- Apply replacements ----
for key, value in replacements.items():
    html = html.replace(key, value)

# ---- Write filled HTML ----
with open(html_path, "w", encoding="utf-8") as f:
    f.write(html)

# ---- Render to PNG ----
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 860, "height": 800})
    page.goto(f"file://{html_path}", wait_until="networkidle")
    # Get actual content height for full-page capture
    height = page.evaluate("document.body.scrollHeight")
    page.set_viewport_size({"width": 860, "height": height + 40})
    page.screenshot(path=output_path, full_page=True)
    browser.close()

print(f"Card generated: {output_path}")
```

**注意**：
- 模板路径在容器中为 `/workspace/project-skills/research-card/template.html`
- 在宿主机模式下，使用实际的项目路径
- 输出图片保存到 `/tmp/research_card.png`，之后可以复制到工作区目录或发送给用户

### Step 6：输出

将生成的图片保存到合适位置并告知用户：

```bash
# Copy to workspace
cp /tmp/research_card.png /workspace/group/research_card_$(date +%Y%m%d_%H%M%S).png
```

## 完整示例

以下是一个 GitHub 项目调研的完整 Python 脚本示例（可直接复制修改使用）：

```python
import os
import re
from playwright.sync_api import sync_playwright

template_path = os.path.expanduser("/workspace/project-skills/research-card/template.html")
html_path = "/tmp/research_card.html"
output_path = "/tmp/research_card.png"

with open(template_path, "r", encoding="utf-8") as f:
    html = f.read()

# ---- Fill content (example: GitHub project) ----
replacements = {
    "{{LOGO_EMOJI}}": "🔧",
    "{{AUTHOR_NAME}}": "Deep Research",
    "{{DATE}}": "2025-01-15",
    "{{MAIN_TITLE}}": "深度调研：Ruff — 下一代 Python Linter",
    "{{SUBTITLE}}": "来源：github.com/astral-sh/ruff",
    "{{CORE_SUMMARY}}": "Ruff 是用 Rust 编写的极速 Python linter 和 formatter，速度比 Flake8 快 10-100 倍，已被 FastAPI、Pandas 等知名项目采用。它支持 800+ 条 lint 规则，涵盖 Flake8、isort、pyupgrade 等工具的功能，目标是成为 Python 生态的统一代码质量工具。",
    "{{BASIC_INFO_TABLE}}": """<table>
  <thead><tr><th>项目</th><th>详情</th></tr></thead>
  <tbody>
    <tr><td>发布方</td><td>Astral (Charlie Marsh)</td></tr>
    <tr><td>首次发布</td><td>2022-08</td></tr>
    <tr><td>Stars</td><td>35.2K</td></tr>
    <tr><td>语言</td><td>Rust</td></tr>
    <tr><td>协议</td><td>MIT</td></tr>
    <tr><td>状态</td><td><span class="badge badge-green">✅ 生产就绪</span></td></tr>
  </tbody>
</table>""",
    "{{DESCRIPTION}}": "Ruff 是一个用 Rust 重写的 Python 代码检查和格式化工具。它将 Flake8、isort、pyupgrade、autoflake 等多个工具的功能统一到一个二进制文件中，通过 Rust 的并发能力实现了数量级的性能提升。Ruff 的设计哲学是：开发者不应该为了代码质量而等待。",
    "{{FEATURES_TABLE}}": """<table>
  <thead><tr><th>功能</th><th>作用</th><th>模式</th></tr></thead>
  <tbody>
    <tr><td><strong>ruff check</strong></td><td>运行 800+ 条 lint 规则</td><td><span class="badge badge-blue">CLI</span></td></tr>
    <tr><td><strong>ruff format</strong></td><td>Black 兼容的代码格式化</td><td><span class="badge badge-blue">CLI</span></td></tr>
    <tr><td><strong>--fix</strong></td><td>自动修复可安全修复的问题</td><td><span class="badge badge-green">自动</span></td></tr>
    <tr><td><strong>--watch</strong></td><td>文件变更时自动检查</td><td><span class="badge badge-yellow">⚠️ 实验性</span></td></tr>
  </tbody>
</table>""",
    "{{ARCHITECTURE_DIAGRAM}}": """<div class="flow-chart">
  <div class="flow-row">
    <div class="flow-node blue">Python 源文件</div>
  </div>
  <div class="flow-arrow down"></div>
  <div class="flow-row">
    <div class="flow-node orange">Rust 解析器 (CST)</div>
  </div>
  <div class="flow-arrow down"></div>
  <div class="flow-row">
    <div class="flow-node green">规则引擎 (800+ rules)</div>
    <div class="flow-node green">格式化引擎</div>
  </div>
  <div class="flow-arrow down"></div>
  <div class="flow-row">
    <div class="flow-node purple">Auto-fix 生成器</div>
  </div>
  <div class="flow-arrow down"></div>
  <div class="flow-row">
    <div class="flow-node red">诊断输出 / 修复后文件</div>
  </div>
</div>
<p class="text-muted text-sm mt-8">图：Ruff 核心处理流程 — 从源文件解析到诊断输出的完整数据流。</p>""",
    "{{TECH_DETAILS}}": """<li><strong>Rust 并发解析</strong>：使用 rayon 实现文件级并行，充分利用多核 CPU，大型项目扫描速度提升 10-100x。</li>
<li><strong>CST 而非 AST</strong>：保留完整的语法树（含空白和注释），使 auto-fix 可以精确修改源代码而不破坏格式。</li>
<li><strong>增量缓存</strong>：基于文件内容哈希的缓存机制，仅重新检查变更的文件。</li>
<li><strong>零配置兼容</strong>：开箱即用支持 pyproject.toml、setup.cfg、ruff.toml 配置格式。</li>
<li><strong>规则插件化</strong>：每条规则是独立的 Rust 模块，易于社区贡献新规则。</li>""",
    "{{STRATEGIC_ANALYSIS}}": """<div class="analysis-point">
  <div class="analysis-point-title">1. Python 工具链统一化</div>
  <div class="analysis-point-body">
    Ruff + uv 的组合正在重塑 Python 工具链格局。Astral 公司的战略是用 Rust 重写 Python 生态中所有性能敏感的工具，从 linter 到包管理器，形成统一的高性能工具链。
  </div>
</div>
<div class="analysis-point">
  <div class="analysis-point-title">2. "Rust 重写一切"趋势的标杆</div>
  <div class="analysis-point-body">
    Ruff 是 "rewrite it in Rust" 运动中最成功的案例之一，证明了用系统语言重写脚本语言工具可以带来质的飞跃，而不仅仅是量的提升。
  </div>
</div>""",
    "{{IMPACT_TABLE}}": """<table class="impact-table">
  <thead><tr><th>时间维度</th><th>影响领域</th><th>影响描述</th></tr></thead>
  <tbody>
    <tr><td><strong>短期</strong></td><td>开发体验</td><td>CI 流水线中 lint 阶段耗时从分钟级降至秒级</td></tr>
    <tr><td><strong>中期</strong></td><td>工具生态</td><td>Flake8 插件生态逐步迁移到 Ruff 原生规则</td></tr>
    <tr><td><strong>长期</strong></td><td>语言生态</td><td>推动 Python 社区采纳更严格的代码标准</td></tr>
  </tbody>
</table>""",
    "{{VALUE_TABLE}}": """<table class="value-table">
  <thead><tr><th>使用场景</th><th>价值描述</th><th>推荐度</th></tr></thead>
  <tbody>
    <tr><td>个人项目</td><td>零配置上手，替代 flake8+isort+black 三件套</td><td><span class="stars">⭐⭐⭐⭐⭐</span></td></tr>
    <tr><td>企业级 CI/CD</td><td>大幅缩短 CI 时间，降低基础设施成本</td><td><span class="stars">⭐⭐⭐⭐⭐</span></td></tr>
    <tr><td>遗留代码迁移</td><td>--fix 自动修复大部分风格问题</td><td><span class="stars">⭐⭐⭐⭐</span></td></tr>
    <tr><td>Flake8 插件重度用户</td><td>部分冷门插件尚未移植</td><td><span class="stars">⭐⭐⭐</span></td></tr>
  </tbody>
</table>""",
    "{{LIMITATIONS}}": """<li><strong>部分 Flake8 插件未覆盖</strong>：虽然已支持 800+ 规则，但某些领域特定的冷门插件仍需等待移植。</li>
<li><strong>Type checking 尚未内置</strong>：Ruff 目前不做类型检查（Red-knot 项目正在开发中），仍需 mypy/pyright。</li>
<li><strong>Formatter 与 Black 的微小差异</strong>：极少数边界情况下格式化结果与 Black 不同。</li>""",
    "{{ONE_LINE_SUMMARY}}": "Ruff 不只是一个更快的 linter，它是 Python 工具链 Rust 化浪潮的排头兵，正在重新定义「代码质量工具应该有多快」。",
    "{{FOOTER_URL}}": "https://github.com/astral-sh/ruff",
}

# ---- Remove empty sections ----
for key, value in replacements.items():
    if not value or value.strip() == "":
        section_name = key.strip("{}")
        pattern = rf'<!-- SECTION:{section_name} -->.*?<!-- /SECTION:{section_name} -->'
        html = re.sub(pattern, '', html, flags=re.DOTALL)

# ---- Apply replacements ----
for key, value in replacements.items():
    html = html.replace(key, value)

# ---- Write and render ----
with open(html_path, "w", encoding="utf-8") as f:
    f.write(html)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 860, "height": 800})
    page.goto(f"file://{html_path}", wait_until="networkidle")
    height = page.evaluate("document.body.scrollHeight")
    page.set_viewport_size({"width": 860, "height": height + 40})
    page.screenshot(path=output_path, full_page=True)
    browser.close()

print(f"Card generated: {output_path}")
```

## 设计规范速查

### 颜色方案

| 用途 | 色值 | 说明 |
|------|------|------|
| 主色调 | `#FF6B35` | Logo 背景、section 侧边线、编号圆圈 |
| 正文 | `#1f2937` | 主要文字 |
| 次要文字 | `#6b7280` | 副标题、页脚 |
| 表格边框 | `#e5e7eb` | 浅灰线条 |
| 表头背景 | `#f9fafb` | 极浅灰 |
| 核心摘要背景 | `#FFF7ED` | 暖橙底 |
| 核心摘要文字 | `#9A3412` | 深橙 |

### 流程图节点颜色

| 类名 | 色值 | 用途 |
|------|------|------|
| `blue` | `#3B82F6` | 输入、起点 |
| `orange` | `#F97316` | 处理、转换 |
| `green` | `#10B981` | 核心逻辑、成功 |
| `red` | `#EF4444` | 输出、终点 |
| `purple` | `#8B5CF6` | 中间处理 |
| `teal` | `#14B8A6` | 辅助模块 |
| `gray` | `#6B7280` | 可选、跳过 |

### Section 编号对应

在模板中 section 标题使用中文数字编号（一、二、三...），实际使用时根据保留的 section 数量连续编号，不要出现跳号。如果跳过了某些 section，需要修改保留 section 的编号使其连续。

## 注意事项

1. **不要遗漏 section 清理**：如果某个 section 不需要，务必整个删除（包括 section-title 和外层 div），而不是留一个空白区域
2. **中文编号连续性**：删除 section 后，重新编号剩余的 section
3. **表格列数**：控制在 2-4 列，避免过多列导致挤压
4. **流程图节点数**：控制在 3-8 个，过多时考虑分层展示
5. **图片宽度固定 860px**：viewport 设为 860，body 内容区 800px + 左右 padding
6. **字体依赖**：模板仅使用系统字体栈，不依赖任何外部字体或 CDN
