---
name: playwright-browser
description: 使用 Playwright MCP 进行浏览器自动化操作：网页导航、点击、填表、截图、执行 JavaScript、抓取页面内容等。当用户请求"打开网页"、"浏览器操作"、"截图网页"、"自动化浏览"、"playwright"、"网页自动化"、"填写表单"、"点击按钮"、"爬取页面"、"网页交互"、"登录网站"、"提交表单"时使用。即使用户没有明确提到 Playwright，只要涉及浏览器中的页面操作，都应优先使用此 skill。
---

# Playwright Browser Automation

通过 Playwright MCP 工具实现浏览器自动化。当前环境已通过 MCP 插件集成，可直接使用 `mcp__plugin_playwright_playwright__browser_*` 系列工具。

## 核心工具清单

| 工具 | 用途 |
|------|------|
| `browser_navigate` | 导航到指定 URL |
| `browser_snapshot` | 获取页面无障碍快照（推荐用于理解页面结构） |
| `browser_take_screenshot` | 截取页面截图（fullPage=true 可截全页） |
| `browser_click` | 点击页面元素 |
| `browser_type` | 在元素中输入文本 |
| `browser_fill_form` | 批量填写表单 |
| `browser_select_option` | 选择下拉框选项 |
| `browser_hover` | 悬停在元素上 |
| `browser_press_key` | 按下键盘按键 |
| `browser_evaluate` | 在页面中执行 JavaScript |
| `browser_run_code` | 运行 Playwright 脚本代码（最强大的工具） |
| `browser_wait_for` | 等待特定条件满足 |
| `browser_network_requests` | 查看网络请求 |
| `browser_console_messages` | 查看控制台消息 |
| `browser_tabs` | 管理浏览器标签页（list/new/close/select） |
| `browser_file_upload` | 上传文件 |
| `browser_handle_dialog` | 处理弹窗对话框 |
| `browser_drag` | 拖拽元素 |
| `browser_resize` | 调整浏览器窗口大小 |
| `browser_close` | 关闭浏览器 |

## 标准操作流程

### 1. 导航到目标页面

```
browser_navigate → 目标 URL
```

### 2. 等待 SPA 页面加载

很多现代网站（React/Vue/Angular SPA）导航后需要额外加载时间。如果 `browser_snapshot` 返回内容很少或为空，**必须先等待再重试**：

```
browser_wait_for → time: 3-5 秒
browser_snapshot → 重新获取
```

典型 SPA 站点：Workday、WorldQuant BRAIN、SurveyMonkey 等。

### 3. 理解页面结构

导航后，**始终先用 `browser_snapshot`** 获取页面的无障碍树快照。snapshot 返回的元素格式如 `[ref=e12] button "登录"`，后续操作用 `ref` 值定位元素。

**当 snapshot 内容过大或为空时的替代方案：**
- 用 `browser_take_screenshot` (fullPage=true) 截图查看视觉布局
- 用 `browser_evaluate` 提取特定文本内容：
  ```js
  () => document.body.innerText.substring(0, 5000)
  ```
- 搜索特定关键词附近的内容：
  ```js
  () => {
    const text = document.body.innerText;
    const idx = text.indexOf('关键词');
    return text.substring(Math.max(0, idx - 200), idx + 1000);
  }
  ```

### 4. 执行交互操作

根据 snapshot 中的 ref 值进行操作：

- **点击**: `browser_click` with element ref
- **输入**: `browser_type` with element ref and text
- **表单**: `browser_fill_form` 批量填充多个字段
- **选择**: `browser_select_option` for dropdowns

### 5. 验证结果

操作后再次 `browser_snapshot` 或 `browser_take_screenshot` 确认操作是否成功。

## 关键经验：用 `browser_run_code` 处理批量操作

当需要一次性完成多个操作（如填写大型表单、批量读取字段值）时，**强烈推荐用 `browser_run_code`** 而非逐个调用工具。这可以避免页面在多次操作间刷新或会话丢失。

### 批量填写表单
```js
async (page) => {
  await page.getByRole('radio', { name: '选项A' }).click();
  await page.getByRole('textbox', { name: '姓名' }).fill('张三');
  await page.getByRole('textbox', { name: '邮箱' }).fill('test@example.com');
  await page.getByRole('button', { name: 'Submit' }).click();
  await page.waitForTimeout(3000);
  return await page.title();
}
```

### 批量读取表单当前值
```js
async (page) => {
  const fields = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('textarea').forEach((el, i) => {
      results.push({ index: i, value: el.value });
    });
    return results;
  });
  return JSON.stringify(fields, null, 2);
}
```

### React/Workday 等复杂框架的表单值设置

React 等框架会拦截直接赋值，必须使用原生 setter 并触发事件：

```js
async (page) => {
  await page.evaluate(({idx, val}) => {
    const ta = document.querySelectorAll('textarea')[idx];
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    ).set;
    setter.call(ta, val);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));
  }, {idx: 7, val: 'new value'});
}
```

### 清除日期字段（Workday 等）

```js
async (page) => {
  const dateInputs = page.locator('input[data-automation-id*="date"]');
  const field = dateInputs.nth(index);
  await field.click({ clickCount: 3 });  // 全选
  await page.keyboard.press('Backspace'); // 删除
}
```

## 多标签页管理

当操作触发新标签页（如 Workday 从 BRAIN 打开）时：

```
browser_tabs → action: "list"     // 查看所有标签页
browser_tabs → action: "select", index: 1  // 切换到新标签页
```

## 会话管理与登录

### 会话过期处理
浏览器会话可能过期（特别是 SPA 网站），表现为：
- 页面重定向到登录页
- snapshot 内容突然变少
- URL 变为 sign-in 页面

**处理方式：** 检测到过期后重新登录，可以从 memory 中获取用户保存的登录凭据。

### 扫码登录
部分网站（如 QQ 邮箱）需要扫码登录，无法自动化。这种情况下：
1. 导航到登录页
2. 告知用户需要扫码
3. 等待用户确认后继续操作

### Cookie 持久化
Playwright MCP 的 Cookie 仅在当前浏览器会话中有效，会话关闭后丢失。重要的登录信息应保存到 memory 中。

## 常见场景

### 登录网站
```
1. browser_navigate → 登录页 URL
2. browser_wait_for → 等待 3 秒（SPA 加载）
3. browser_snapshot → 找到用户名/密码输入框的 ref
4. browser_type → 输入用户名
5. browser_type → 输入密码
6. browser_click → 点击登录按钮
7. browser_wait_for → 等待跳转
8. browser_snapshot → 确认登录成功
```

### 填写多页表单
```
1. browser_navigate → 表单页面
2. browser_wait_for → 等待加载
3. browser_run_code → 一次性填写当前页所有字段
4. browser_take_screenshot → 截图让用户确认
5. browser_click → 点击 Next/Submit
6. browser_wait_for → 等待下一页
7. 重复 3-6 直到完成
```

### 提取大量页面数据
```
1. browser_navigate → 目标页面
2. browser_evaluate → 用 JS 提取所需数据
   例: () => document.body.innerText.substring(0, 5000)
3. 如需翻页，用 browser_click 点击下一页，重复提取
```

## 最佳实践

- **SPA 必须等待** — 导航后 snapshot 为空是因为页面还在加载，用 `browser_wait_for` 等 3-5 秒
- **优先用 snapshot** — 比 screenshot 更高效，但内容过大时用 `browser_evaluate` 提取文本
- **批量操作用 run_code** — 避免多次单独调用导致的页面状态变化和会话丢失
- **Ref 会失效** — 页面更新后 ref 值会变化，操作前先重新 snapshot
- **截图给用户确认** — 重要操作（提交表单、付款等）前截图让用户审核
- **browser_run_code 中没有 setTimeout** — 用 `page.waitForTimeout(ms)` 代替
- **处理弹窗和对话框** — Cookie 同意、引导弹窗等要先关闭再操作主内容
- **新标签页** — 注意 `browser_tabs` 切换，操作完记得切回
