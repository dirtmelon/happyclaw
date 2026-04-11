# Excalidraw 元素模板参考

生成元素时，必须包含下列所有字段。缺少任何字段都可能导致 Excalidraw 拒绝导入。

## 目录

1. [矩形 Rectangle](#矩形-rectangle)
2. [椭圆 Ellipse](#椭圆-ellipse)
3. [菱形 Diamond](#菱形-diamond)
4. [文本 Text（独立）](#文本-text独立)
5. [文本 Text（容器内）](#文本-text容器内)
6. [箭头 Arrow（绑定）](#箭头-arrow绑定)
7. [箭头 Arrow（自由）](#箭头-arrow自由)
8. [直线 Line](#直线-line)
9. [自由绘制 Freedraw](#自由绘制-freedraw)
10. [容器+文本绑定示例](#容器文本绑定示例)
11. [完整流程图示例](#完整流程图示例)

---

## 矩形 Rectangle

```json
{
  "id": "rect-1",
  "type": "rectangle",
  "x": 100,
  "y": 100,
  "width": 200,
  "height": 70,
  "angle": 0,
  "strokeColor": "#1971c2",
  "backgroundColor": "#a5d8ff",
  "fillStyle": "solid",
  "strokeWidth": 2,
  "strokeStyle": "solid",
  "roughness": 1,
  "opacity": 100,
  "seed": 12345,
  "version": 1,
  "versionNonce": 1,
  "isDeleted": false,
  "groupIds": [],
  "frameId": null,
  "index": "a0",
  "roundness": { "type": 3 },
  "boundElements": [],
  "updated": 1,
  "link": null,
  "locked": false
}
```

**关键字段说明**：
- `roundness: { "type": 3 }` — 圆角矩形（type 2 为直角）
- `fillStyle` — `"solid"` / `"hachure"` / `"cross-hatch"` / `"dots"`
- `roughness` — 0=精确, 1=手绘（推荐）, 2=更粗糙
- `boundElements` — 当矩形包含文本或连接箭头时填充

## 椭圆 Ellipse

```json
{
  "id": "ellipse-1",
  "type": "ellipse",
  "x": 100,
  "y": 100,
  "width": 120,
  "height": 80,
  "angle": 0,
  "strokeColor": "#495057",
  "backgroundColor": "#e9ecef",
  "fillStyle": "solid",
  "strokeWidth": 2,
  "strokeStyle": "solid",
  "roughness": 1,
  "opacity": 100,
  "seed": 23456,
  "version": 1,
  "versionNonce": 2,
  "isDeleted": false,
  "groupIds": [],
  "frameId": null,
  "index": "a1",
  "roundness": { "type": 2 },
  "boundElements": [],
  "updated": 1,
  "link": null,
  "locked": false
}
```

**用途**：开始/结束节点、状态图中的初始/终止状态。

## 菱形 Diamond

```json
{
  "id": "diamond-1",
  "type": "diamond",
  "x": 100,
  "y": 100,
  "width": 160,
  "height": 120,
  "angle": 0,
  "strokeColor": "#e67700",
  "backgroundColor": "#ffec99",
  "fillStyle": "solid",
  "strokeWidth": 2,
  "strokeStyle": "solid",
  "roughness": 1,
  "opacity": 100,
  "seed": 34567,
  "version": 1,
  "versionNonce": 3,
  "isDeleted": false,
  "groupIds": [],
  "frameId": null,
  "index": "a2",
  "roundness": { "type": 2 },
  "boundElements": [],
  "updated": 1,
  "link": null,
  "locked": false
}
```

**用途**：条件判断、决策节点。菱形内文本的可用宽度约为 `width × 0.6`，需要据此调整菱形尺寸。

## 文本 Text（独立）

```json
{
  "id": "text-1",
  "type": "text",
  "x": 100,
  "y": 100,
  "width": 80,
  "height": 25,
  "angle": 0,
  "strokeColor": "#1e1e1e",
  "backgroundColor": "transparent",
  "fillStyle": "solid",
  "strokeWidth": 2,
  "strokeStyle": "solid",
  "roughness": 1,
  "opacity": 100,
  "seed": 45678,
  "version": 1,
  "versionNonce": 4,
  "isDeleted": false,
  "groupIds": [],
  "frameId": null,
  "index": "a3",
  "roundness": null,
  "boundElements": null,
  "updated": 1,
  "link": null,
  "locked": false,
  "text": "标签文本",
  "fontSize": 18,
  "fontFamily": 1,
  "textAlign": "center",
  "verticalAlign": "top",
  "containerId": null,
  "originalText": "标签文本",
  "autoResize": true,
  "lineHeight": 1.25
}
```

**注意**：
- `text` 和 `originalText` 的值必须相同
- `width` 需要根据 CJK 宽度公式计算
- `height` = `行数 × fontSize × lineHeight`
- `fontFamily`: 1=Excalifont（手绘）, 2=Nunito（无衬线）, 3=Comic Shanns（等宽）

## 文本 Text（容器内）

```json
{
  "id": "text-in-rect",
  "type": "text",
  "x": 130,
  "y": 122,
  "width": 140,
  "height": 25,
  "angle": 0,
  "strokeColor": "#1e1e1e",
  "backgroundColor": "transparent",
  "fillStyle": "solid",
  "strokeWidth": 2,
  "strokeStyle": "solid",
  "roughness": 1,
  "opacity": 100,
  "seed": 56789,
  "version": 1,
  "versionNonce": 5,
  "isDeleted": false,
  "groupIds": [],
  "frameId": null,
  "index": "a4",
  "roundness": null,
  "boundElements": null,
  "updated": 1,
  "link": null,
  "locked": false,
  "text": "节点文本",
  "fontSize": 18,
  "fontFamily": 1,
  "textAlign": "center",
  "verticalAlign": "middle",
  "containerId": "rect-1",
  "originalText": "节点文本",
  "autoResize": true,
  "lineHeight": 1.25
}
```

**与独立文本的区别**：
- `containerId` 指向宿主形状的 id
- `verticalAlign` 设为 `"middle"`
- 宿主形状的 `boundElements` 必须包含 `{"id": "text-in-rect", "type": "text"}`
- `x, y` 计算为形状中心 - 文本宽高/2

## 箭头 Arrow（绑定）

连接两个形状的箭头：

```json
{
  "id": "arrow-1",
  "type": "arrow",
  "x": 300,
  "y": 135,
  "width": 100,
  "height": 0,
  "angle": 0,
  "strokeColor": "#1e1e1e",
  "backgroundColor": "transparent",
  "fillStyle": "solid",
  "strokeWidth": 2,
  "strokeStyle": "solid",
  "roughness": 1,
  "opacity": 100,
  "seed": 67890,
  "version": 1,
  "versionNonce": 6,
  "isDeleted": false,
  "groupIds": [],
  "frameId": null,
  "index": "a5",
  "roundness": { "type": 2 },
  "boundElements": null,
  "updated": 1,
  "link": null,
  "locked": false,
  "points": [[0, 0], [100, 0]],
  "lastCommittedPoint": null,
  "startBinding": {
    "elementId": "rect-1",
    "fixedPoint": [1.0, 0.5],
    "mode": "orbit"
  },
  "endBinding": {
    "elementId": "rect-2",
    "fixedPoint": [0.0, 0.5],
    "mode": "orbit"
  },
  "startArrowhead": null,
  "endArrowhead": "arrow",
  "elbowed": false
}
```

**关键字段**：
- `x, y` — 箭头起点的全局坐标（源形状边缘上的点）
- `points` — 相对于 (x, y) 的路径点。`[[0,0], [dx, dy]]` 表示从起点到终点的偏移
- `startBinding` / `endBinding` — fixedPoint + orbit 格式（见 SKILL.md）
- `startArrowhead` — `null`（无）/ `"arrow"` / `"bar"` / `"dot"` / `"triangle"`
- `endArrowhead` — 同上，默认 `"arrow"`
- `elbowed` — `true` 时使用直角折线路由

**箭头坐标计算**：
1. 根据 fixedPoint 和源形状的 x/y/width/height 计算起点全局坐标
2. 同理计算终点全局坐标
3. `x, y` = 起点坐标
4. `points[1]` = [终点x - 起点x, 终点y - 起点y]
5. `width` = |points[1][0]|, `height` = |points[1][1]|

**同时更新形状**：源形状和目标形状的 `boundElements` 都要添加 `{"id": "arrow-1", "type": "arrow"}`

## 箭头 Arrow（自由）

不连接任何形状的箭头：

```json
{
  "id": "free-arrow-1",
  "type": "arrow",
  "x": 100,
  "y": 200,
  "width": 150,
  "height": 80,
  "angle": 0,
  "strokeColor": "#1e1e1e",
  "backgroundColor": "transparent",
  "fillStyle": "solid",
  "strokeWidth": 2,
  "strokeStyle": "solid",
  "roughness": 1,
  "opacity": 100,
  "seed": 78901,
  "version": 1,
  "versionNonce": 7,
  "isDeleted": false,
  "groupIds": [],
  "frameId": null,
  "index": "a6",
  "roundness": { "type": 2 },
  "boundElements": null,
  "updated": 1,
  "link": null,
  "locked": false,
  "points": [[0, 0], [150, 80]],
  "lastCommittedPoint": null,
  "startBinding": null,
  "endBinding": null,
  "startArrowhead": null,
  "endArrowhead": "arrow",
  "elbowed": false
}
```

## 直线 Line

```json
{
  "id": "line-1",
  "type": "line",
  "x": 100,
  "y": 300,
  "width": 200,
  "height": 0,
  "angle": 0,
  "strokeColor": "#495057",
  "backgroundColor": "transparent",
  "fillStyle": "solid",
  "strokeWidth": 2,
  "strokeStyle": "solid",
  "roughness": 1,
  "opacity": 100,
  "seed": 89012,
  "version": 1,
  "versionNonce": 8,
  "isDeleted": false,
  "groupIds": [],
  "frameId": null,
  "index": "a7",
  "roundness": { "type": 2 },
  "boundElements": null,
  "updated": 1,
  "link": null,
  "locked": false,
  "points": [[0, 0], [200, 0]],
  "lastCommittedPoint": null,
  "startBinding": null,
  "endBinding": null,
  "startArrowhead": null,
  "endArrowhead": null
}
```

**与箭头的区别**：没有箭头末端 (`endArrowhead: null`)。可以有多个点形成折线。

## 自由绘制 Freedraw

```json
{
  "id": "freedraw-1",
  "type": "freedraw",
  "x": 100,
  "y": 400,
  "width": 100,
  "height": 50,
  "angle": 0,
  "strokeColor": "#e03131",
  "backgroundColor": "transparent",
  "fillStyle": "solid",
  "strokeWidth": 2,
  "strokeStyle": "solid",
  "roughness": 0,
  "opacity": 100,
  "seed": 90123,
  "version": 1,
  "versionNonce": 9,
  "isDeleted": false,
  "groupIds": [],
  "frameId": null,
  "index": "a8",
  "roundness": null,
  "boundElements": null,
  "updated": 1,
  "link": null,
  "locked": false,
  "points": [[0, 0], [10, 5], [20, 3], [50, 25], [100, 50]],
  "lastCommittedPoint": [100, 50],
  "pressures": [0.5, 0.6, 0.7, 0.6, 0.5],
  "simulatePressure": false
}
```

## 容器+文本绑定示例

一个包含中文文本的蓝色矩形节点的完整写法：

```json
[
  {
    "id": "node-login",
    "type": "rectangle",
    "x": 100,
    "y": 100,
    "width": 200,
    "height": 70,
    "strokeColor": "#1971c2",
    "backgroundColor": "#a5d8ff",
    "fillStyle": "solid",
    "strokeWidth": 2,
    "strokeStyle": "solid",
    "roughness": 1,
    "opacity": 100,
    "angle": 0,
    "seed": 11111,
    "version": 1,
    "versionNonce": 101,
    "isDeleted": false,
    "groupIds": [],
    "frameId": null,
    "index": "a0",
    "roundness": { "type": 3 },
    "boundElements": [
      { "id": "text-login", "type": "text" }
    ],
    "updated": 1,
    "link": null,
    "locked": false
  },
  {
    "id": "text-login",
    "type": "text",
    "x": 136,
    "y": 122,
    "width": 128,
    "height": 25,
    "strokeColor": "#1e1e1e",
    "backgroundColor": "transparent",
    "fillStyle": "solid",
    "strokeWidth": 2,
    "strokeStyle": "solid",
    "roughness": 1,
    "opacity": 100,
    "angle": 0,
    "seed": 11112,
    "version": 1,
    "versionNonce": 102,
    "isDeleted": false,
    "groupIds": [],
    "frameId": null,
    "index": "a1",
    "roundness": null,
    "boundElements": null,
    "updated": 1,
    "link": null,
    "locked": false,
    "text": "用户登录",
    "fontSize": 18,
    "fontFamily": 1,
    "textAlign": "center",
    "verticalAlign": "middle",
    "containerId": "node-login",
    "originalText": "用户登录",
    "autoResize": true,
    "lineHeight": 1.25
  }
]
```

**计算过程**：
- "用户登录" = 4 个 CJK 字符 → 宽度 = 4 × 18 × 1.1 = 79.2px
- 容器宽度 = max(79.2 + 60, 200) = 200px
- 文本 x = 100 + (200 - 79.2) / 2 ≈ 160（但容器文本的坐标由 Excalidraw 自动居中，给近似值即可）
- 文本 y = 100 + (70 - 22.5) / 2 ≈ 124

## 完整流程图示例

一个简单的「用户登录 → 验证密码 → 成功/失败」流程图：

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "claude-skill",
  "elements": [
    {
      "id": "node-start",
      "type": "ellipse",
      "x": 140,
      "y": 0,
      "width": 120,
      "height": 60,
      "strokeColor": "#495057",
      "backgroundColor": "#e9ecef",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "angle": 0,
      "seed": 1001,
      "version": 1,
      "versionNonce": 201,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "index": "a0",
      "roundness": { "type": 2 },
      "boundElements": [
        { "id": "text-start", "type": "text" },
        { "id": "arrow-1", "type": "arrow" }
      ],
      "updated": 1,
      "link": null,
      "locked": false
    },
    {
      "id": "text-start",
      "type": "text",
      "x": 172,
      "y": 17,
      "width": 56,
      "height": 25,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "angle": 0,
      "seed": 1002,
      "version": 1,
      "versionNonce": 202,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "index": "a1",
      "roundness": null,
      "boundElements": null,
      "updated": 1,
      "link": null,
      "locked": false,
      "text": "开始",
      "fontSize": 18,
      "fontFamily": 1,
      "textAlign": "center",
      "verticalAlign": "middle",
      "containerId": "node-start",
      "originalText": "开始",
      "autoResize": true,
      "lineHeight": 1.25
    },
    {
      "id": "node-login",
      "type": "rectangle",
      "x": 100,
      "y": 120,
      "width": 200,
      "height": 70,
      "strokeColor": "#1971c2",
      "backgroundColor": "#a5d8ff",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "angle": 0,
      "seed": 1003,
      "version": 1,
      "versionNonce": 203,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "index": "a2",
      "roundness": { "type": 3 },
      "boundElements": [
        { "id": "text-login", "type": "text" },
        { "id": "arrow-1", "type": "arrow" },
        { "id": "arrow-2", "type": "arrow" }
      ],
      "updated": 1,
      "link": null,
      "locked": false
    },
    {
      "id": "text-login",
      "type": "text",
      "x": 136,
      "y": 142,
      "width": 128,
      "height": 25,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "angle": 0,
      "seed": 1004,
      "version": 1,
      "versionNonce": 204,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "index": "a3",
      "roundness": null,
      "boundElements": null,
      "updated": 1,
      "link": null,
      "locked": false,
      "text": "用户输入密码",
      "fontSize": 18,
      "fontFamily": 1,
      "textAlign": "center",
      "verticalAlign": "middle",
      "containerId": "node-login",
      "originalText": "用户输入密码",
      "autoResize": true,
      "lineHeight": 1.25
    },
    {
      "id": "node-check",
      "type": "diamond",
      "x": 100,
      "y": 260,
      "width": 200,
      "height": 140,
      "strokeColor": "#e67700",
      "backgroundColor": "#ffec99",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "angle": 0,
      "seed": 1005,
      "version": 1,
      "versionNonce": 205,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "index": "a4",
      "roundness": { "type": 2 },
      "boundElements": [
        { "id": "text-check", "type": "text" },
        { "id": "arrow-2", "type": "arrow" },
        { "id": "arrow-3", "type": "arrow" },
        { "id": "arrow-4", "type": "arrow" }
      ],
      "updated": 1,
      "link": null,
      "locked": false
    },
    {
      "id": "text-check",
      "type": "text",
      "x": 152,
      "y": 317,
      "width": 96,
      "height": 25,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "angle": 0,
      "seed": 1006,
      "version": 1,
      "versionNonce": 206,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "index": "a5",
      "roundness": null,
      "boundElements": null,
      "updated": 1,
      "link": null,
      "locked": false,
      "text": "密码正确？",
      "fontSize": 18,
      "fontFamily": 1,
      "textAlign": "center",
      "verticalAlign": "middle",
      "containerId": "node-check",
      "originalText": "密码正确？",
      "autoResize": true,
      "lineHeight": 1.25
    },
    {
      "id": "node-success",
      "type": "rectangle",
      "x": 100,
      "y": 480,
      "width": 200,
      "height": 70,
      "strokeColor": "#2f9e44",
      "backgroundColor": "#b2f2bb",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "angle": 0,
      "seed": 1007,
      "version": 1,
      "versionNonce": 207,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "index": "a6",
      "roundness": { "type": 3 },
      "boundElements": [
        { "id": "text-success", "type": "text" },
        { "id": "arrow-3", "type": "arrow" }
      ],
      "updated": 1,
      "link": null,
      "locked": false
    },
    {
      "id": "text-success",
      "type": "text",
      "x": 136,
      "y": 502,
      "width": 128,
      "height": 25,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "angle": 0,
      "seed": 1008,
      "version": 1,
      "versionNonce": 208,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "index": "a7",
      "roundness": null,
      "boundElements": null,
      "updated": 1,
      "link": null,
      "locked": false,
      "text": "登录成功",
      "fontSize": 18,
      "fontFamily": 1,
      "textAlign": "center",
      "verticalAlign": "middle",
      "containerId": "node-success",
      "originalText": "登录成功",
      "autoResize": true,
      "lineHeight": 1.25
    },
    {
      "id": "node-fail",
      "type": "rectangle",
      "x": 400,
      "y": 295,
      "width": 200,
      "height": 70,
      "strokeColor": "#e03131",
      "backgroundColor": "#ffc9c9",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "angle": 0,
      "seed": 1009,
      "version": 1,
      "versionNonce": 209,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "index": "a8",
      "roundness": { "type": 3 },
      "boundElements": [
        { "id": "text-fail", "type": "text" },
        { "id": "arrow-4", "type": "arrow" }
      ],
      "updated": 1,
      "link": null,
      "locked": false
    },
    {
      "id": "text-fail",
      "type": "text",
      "x": 436,
      "y": 317,
      "width": 128,
      "height": 25,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "angle": 0,
      "seed": 1010,
      "version": 1,
      "versionNonce": 210,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "index": "a9",
      "roundness": null,
      "boundElements": null,
      "updated": 1,
      "link": null,
      "locked": false,
      "text": "提示错误",
      "fontSize": 18,
      "fontFamily": 1,
      "textAlign": "center",
      "verticalAlign": "middle",
      "containerId": "node-fail",
      "originalText": "提示错误",
      "autoResize": true,
      "lineHeight": 1.25
    },
    {
      "id": "arrow-1",
      "type": "arrow",
      "x": 200,
      "y": 60,
      "width": 0,
      "height": 60,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "angle": 0,
      "seed": 1011,
      "version": 1,
      "versionNonce": 211,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "index": "aA",
      "roundness": { "type": 2 },
      "boundElements": null,
      "updated": 1,
      "link": null,
      "locked": false,
      "points": [[0, 0], [0, 60]],
      "lastCommittedPoint": null,
      "startBinding": {
        "elementId": "node-start",
        "fixedPoint": [0.5, 1.0],
        "mode": "orbit"
      },
      "endBinding": {
        "elementId": "node-login",
        "fixedPoint": [0.5, 0.0],
        "mode": "orbit"
      },
      "startArrowhead": null,
      "endArrowhead": "arrow",
      "elbowed": false
    },
    {
      "id": "arrow-2",
      "type": "arrow",
      "x": 200,
      "y": 190,
      "width": 0,
      "height": 70,
      "strokeColor": "#1e1e1e",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "angle": 0,
      "seed": 1012,
      "version": 1,
      "versionNonce": 212,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "index": "aB",
      "roundness": { "type": 2 },
      "boundElements": null,
      "updated": 1,
      "link": null,
      "locked": false,
      "points": [[0, 0], [0, 70]],
      "lastCommittedPoint": null,
      "startBinding": {
        "elementId": "node-login",
        "fixedPoint": [0.5, 1.0],
        "mode": "orbit"
      },
      "endBinding": {
        "elementId": "node-check",
        "fixedPoint": [0.5, 0.0],
        "mode": "orbit"
      },
      "startArrowhead": null,
      "endArrowhead": "arrow",
      "elbowed": false
    },
    {
      "id": "arrow-3",
      "type": "arrow",
      "x": 200,
      "y": 400,
      "width": 0,
      "height": 80,
      "strokeColor": "#2f9e44",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "angle": 0,
      "seed": 1013,
      "version": 1,
      "versionNonce": 213,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "index": "aC",
      "roundness": { "type": 2 },
      "boundElements": null,
      "updated": 1,
      "link": null,
      "locked": false,
      "points": [[0, 0], [0, 80]],
      "lastCommittedPoint": null,
      "startBinding": {
        "elementId": "node-check",
        "fixedPoint": [0.5, 1.0],
        "mode": "orbit"
      },
      "endBinding": {
        "elementId": "node-success",
        "fixedPoint": [0.5, 0.0],
        "mode": "orbit"
      },
      "startArrowhead": null,
      "endArrowhead": "arrow",
      "elbowed": false
    },
    {
      "id": "arrow-4",
      "type": "arrow",
      "x": 300,
      "y": 330,
      "width": 100,
      "height": 0,
      "strokeColor": "#e03131",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "angle": 0,
      "seed": 1014,
      "version": 1,
      "versionNonce": 214,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "index": "aD",
      "roundness": { "type": 2 },
      "boundElements": null,
      "updated": 1,
      "link": null,
      "locked": false,
      "points": [[0, 0], [100, 0]],
      "lastCommittedPoint": null,
      "startBinding": {
        "elementId": "node-check",
        "fixedPoint": [1.0, 0.5],
        "mode": "orbit"
      },
      "endBinding": {
        "elementId": "node-fail",
        "fixedPoint": [0.0, 0.5],
        "mode": "orbit"
      },
      "startArrowhead": null,
      "endArrowhead": "arrow",
      "elbowed": false
    },
    {
      "id": "label-yes",
      "type": "text",
      "x": 210,
      "y": 430,
      "width": 20,
      "height": 20,
      "strokeColor": "#2f9e44",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "angle": 0,
      "seed": 1015,
      "version": 1,
      "versionNonce": 215,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "index": "aE",
      "roundness": null,
      "boundElements": null,
      "updated": 1,
      "link": null,
      "locked": false,
      "text": "是",
      "fontSize": 16,
      "fontFamily": 1,
      "textAlign": "left",
      "verticalAlign": "top",
      "containerId": null,
      "originalText": "是",
      "autoResize": true,
      "lineHeight": 1.25
    },
    {
      "id": "label-no",
      "type": "text",
      "x": 340,
      "y": 310,
      "width": 20,
      "height": 20,
      "strokeColor": "#e03131",
      "backgroundColor": "transparent",
      "fillStyle": "solid",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "angle": 0,
      "seed": 1016,
      "version": 1,
      "versionNonce": 216,
      "isDeleted": false,
      "groupIds": [],
      "frameId": null,
      "index": "aF",
      "roundness": null,
      "boundElements": null,
      "updated": 1,
      "link": null,
      "locked": false,
      "text": "否",
      "fontSize": 16,
      "fontFamily": 1,
      "textAlign": "left",
      "verticalAlign": "top",
      "containerId": null,
      "originalText": "否",
      "autoResize": true,
      "lineHeight": 1.25
    }
  ],
  "appState": {
    "viewBackgroundColor": "#ffffff",
    "gridSize": null
  },
  "files": {}
}
```
