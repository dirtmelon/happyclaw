---
name: excalidraw
description: >
  生成 Excalidraw 手绘风格图表，支持中文。流程图、架构图、思维导图、时序图、类图、ER图、
  状态图、组织架构图、甘特图、看板、网络拓扑、饼图/柱状图/折线图、SWOT、线框图等 20+ 种图表类型。
  当用户请求"excalidraw"、"画图"、"画个图"、"流程图"、"架构图"、"思维导图"、"时序图"、
  "类图"、"ER图"、"状态图"、"diagram"、"画板"、"示意图"、"拓扑图"、"组织架构"、
  "看板"、"甘特图"、"线框图"、"SWOT"时使用。即使用户没有明确提到 Excalidraw，
  只要需要生成可视化图表或示意图，都应优先使用此 skill。
---

# Excalidraw 图表生成器

将自然语言描述转换为 Excalidraw 手绘风格图表，完整支持中文文本布局。

## 执行流程

收到画图请求后，按以下步骤执行（不要询问确认）：

1. **分析需求** — 确定图表类型、节点、关系、布局方向
2. **计算布局** — 使用 CJK 感知的文本宽度估算，计算每个元素的坐标和尺寸
3. **生成 JSON** — 按渐进式绘制顺序组装完整的 Excalidraw JSON
4. **输出** — 根据用户需求选择输出方式（见下方）

### 输出方式

根据用户意图自动选择输出方式，优先级从上到下：

**A. 用户要求图片/PNG/保存图片** → 直接导出图片：
```bash
# 1. Write tool 写入 .excalidraw JSON
# 2. 一条命令完成导出
bash ~/.claude/skills/excalidraw/scripts/export.sh /tmp/excalidraw-output/{name}.excalidraw {输出目录} png
```

**B. 用户要求 SVG** → 导出 SVG：
```bash
bash ~/.claude/skills/excalidraw/scripts/export.sh /tmp/excalidraw-output/{name}.excalidraw {输出目录} svg
```

**C. 用户要求在 Excalidraw 中编辑 / 没有指定格式** → 剪贴板 + 浏览器：
```bash
cat /tmp/excalidraw-output/{name}.excalidraw | pbcopy && open "https://excalidraw.com"
```
告诉用户："已复制到剪贴板，在 Excalidraw 页面按 Cmd+V 粘贴即可。"

**D. 用户指定了输出路径**（如"保存到 Downloads"）→ 同时输出 .excalidraw + 图片到该路径：
```bash
cp /tmp/excalidraw-output/{name}.excalidraw {输出目录}/
bash ~/.claude/skills/excalidraw/scripts/export.sh /tmp/excalidraw-output/{name}.excalidraw {输出目录} png
```

### 导出脚本说明

`scripts/export.sh` 封装了完整的导出管线，无需手动操作：
- `.excalidraw → SVG`：通过 Kroki.io API（deflate + base64url 编码 GET 请求）
- `SVG → PNG`：通过 Node.js sharp 库（300 DPI 高清输出，首次自动安装）
- 用法：`bash export.sh <input.excalidraw> [output_dir] [svg|png|both]`

## JSON 外层结构

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "claude-skill",
  "elements": [],
  "appState": {
    "viewBackgroundColor": "#ffffff",
    "gridSize": null
  },
  "files": {}
}
```

## CJK 文本宽度估算

中文字符比英文宽，必须正确估算以避免文本溢出容器。对每个字符按 Unicode 范围计算宽度：

| 字符类型 | 宽度公式 | fontSize=20 时 |
|---------|----------|---------------|
| CJK 汉字 (U+4E00-U+9FFF)、全角符号 (U+FF00-U+FFEF) | `fontSize × 1.1` | 22px |
| ASCII 字母/数字 | `fontSize × 0.62` | 12.4px |
| 空格 | `fontSize × 0.35` | 7px |
| 其他字符 | `fontSize × 0.65` | 13px |

**容器自动调整**：
- 容器宽度 = `max(textWidth + 60, 200)`（60px 为左右各 30px 内边距）
- 容器高度 = `max(lineCount × fontSize × 1.25 + 40, 70)`（40px 为上下内边距）
- 文本居中：`text_x = box_x + (box_width - textWidth) / 2`

多行文本：按 `\n` 拆分，取最宽行计算容器宽度。

## 布局规则

### 间距常量
| 常量 | 值 | 用途 |
|------|-----|------|
| SIBLING_GAP | 60px | 同层节点间距 |
| LAYER_GAP | 100px | 层级间距 |
| BOX_HEIGHT | 70px | 默认节点高度 |
| MIN_BOX_WIDTH | 200px | 最小节点宽度 |

### 布局方向
- **TB**（上到下）：默认，适合流程图、组织架构
- **LR**（左到右）：适合时间线、流水线
- **BT/RL**：较少使用

### 坐标系
- 原点 (0, 0) 在左上角
- X 轴向右增长，Y 轴向下增长
- 所有坐标使用 20 的倍数（方便对齐网格）

### 布局反模式
- 不要在背景区域矩形上放标签文本（用独立 text 元素代替）
- 避免箭头跨越背景区域
- 不要让节点重叠
- 箭头标签要简短（3-5 个字）

## 渐进式绘制顺序

按以下顺序添加元素到 `elements` 数组（这很重要，因为后面的元素会绘制在前面的元素之上）：

1. **背景区域** — 大矩形，浅色填充，作为分组容器
2. **节点形状** — rectangle / ellipse / diamond
3. **节点内文本** — 通过 containerId 绑定到形状
4. **连线箭头** — 通过 startBinding / endBinding 连接节点
5. **箭头标签** — 独立 text 元素，放在箭头中点附近
6. **标注文本** — 独立 text 元素，补充说明

## 箭头绑定（fixedPoint + orbit 模式）

箭头连接两个形状时，使用现代绑定格式：

```json
{
  "startBinding": {
    "elementId": "source-id",
    "fixedPoint": [1.0, 0.5],
    "mode": "orbit"
  },
  "endBinding": {
    "elementId": "target-id",
    "fixedPoint": [0.0, 0.5],
    "mode": "orbit"
  }
}
```

**fixedPoint 坐标**（相对于形状的归一化坐标）：
| 位置 | fixedPoint |
|------|-----------|
| 上中 | [0.5, 0.0] |
| 下中 | [0.5, 1.0] |
| 左中 | [0.0, 0.5] |
| 右中 | [1.0, 0.5] |

**自动选边规则**：比较两个形状中心的 dx 和 dy，选择最合理的连接边：
- 如果 `|dx| > |dy|`：水平连接（源右边 → 目标左边，或反向）
- 如果 `|dy| >= |dx|`：垂直连接（源下边 → 目标上边，或反向）

同时，被连接的形状需要在 `boundElements` 中记录箭头：
```json
"boundElements": [{"id": "arrow-id", "type": "arrow"}]
```

## 文本容器绑定

要将文本放在形状内部：

1. 形状的 `boundElements` 添加 `{"id": "text-id", "type": "text"}`
2. 文本元素设置 `containerId: "shape-id"`
3. 文本的 `x, y` 设为形状中心减去文本宽高的一半
4. 文本设置 `textAlign: "center"`, `verticalAlign: "middle"`

## 配色方案

### 亮色模式（默认）
| 语义 | 填充色 | 描边色 | 用途 |
|------|--------|--------|------|
| 主要 | #a5d8ff | #1971c2 | 核心节点、主流程 |
| 成功 | #b2f2bb | #2f9e44 | 完成、通过、正常状态 |
| 警告 | #ffec99 | #e67700 | 注意、条件分支 |
| 错误 | #ffc9c9 | #e03131 | 异常、失败、终止 |
| 中性 | #e9ecef | #495057 | 辅助节点、注释 |
| 紫色 | #d0bfff | #7048e8 | 特殊节点、外部系统 |
| 背景区域 | #f8f9fa | #dee2e6 | 分组背景 |

### 暗色模式
当用户要求暗色模式时：
- `appState.viewBackgroundColor`: `"#1e1e1e"`
- 描边色用亮色（如 `#a5d8ff`, `#b2f2bb`）
- 填充色用半透明深色（如 `#1971c220`）
- 文本颜色用 `#e9ecef`

## 字体规则

| 用途 | fontSize | fontFamily |
|------|----------|------------|
| 标题 | 28 | 1 (Excalifont) |
| 副标题 | 20 | 1 |
| 正文/节点 | 18 | 1 |
| 注释/标签 | 16 | 1 |
| 最小值 | 14 | — |

## 支持的图表类型

参考 `references/design-guide.md` 获取每种图表的详细布局模式：

| 类型 | 触发词 | 核心元素 |
|------|--------|---------|
| 流程图 | 流程图, flowchart | 矩形+菱形+箭头 |
| 架构图 | 架构图, architecture | 分层矩形+连线 |
| 思维导图 | 思维导图, mindmap | 中心节点+分支 |
| 时序图 | 时序图, sequence | 生命线+消息箭头 |
| 类图 | 类图, class diagram | 分栏矩形+关系线 |
| ER 图 | ER图, entity relationship | 实体+关系菱形 |
| 状态图 | 状态图, state diagram | 圆角矩形+转换 |
| 组织架构 | 组织架构, org chart | 层级矩形+连线 |
| 甘特图/时间线 | 时间线, timeline | 横向条形+里程碑 |
| 看板 | 看板, kanban | 列容器+卡片 |
| 网络拓扑 | 拓扑图, network | 节点+连线 |
| 饼图 | 饼图, pie chart | 扇形模拟 |
| 柱状图 | 柱状图, bar chart | 矩形柱+坐标轴 |
| 折线图 | 折线图, line chart | 折线+数据点 |
| SWOT | SWOT | 2×2 矩阵 |
| 决策树 | 决策树, decision tree | 菱形+分支 |
| 线框图 | 线框图, wireframe | 设备框+UI 组件 |

## 元素模板

完整的元素 JSON 模板在 `references/elements.md` 中。生成元素时必须包含所有必填字段，
否则 Excalidraw 会拒绝导入。每个元素必须有唯一的 `id`（使用描述性字符串如 `"node-login"`）
和随机的 `seed`（用 1-99999 的整数）。

## 质量检查清单

生成 JSON 后，在脑中逐项检查：

1. **文本溢出** — 每个容器的宽度是否足够容纳其文本（用 CJK 宽度公式验证）？
2. **节点重叠** — 相邻节点的边界框是否有交集？
3. **箭头穿越** — 箭头是否穿过了不相关的节点？
4. **对齐一致** — 同层节点的 y 坐标（TB 布局）或 x 坐标（LR 布局）是否一致？
5. **绑定完整** — 每个箭头的 startBinding/endBinding 是否有对应的形状 boundElements？
6. **ID 唯一** — 所有元素 id 是否唯一？
7. **配色统一** — 相同语义的节点是否使用相同颜色？
