# BossKey 老板键 · v1.3.0 交付说明

## 一、本版本（v1.3.0）改了什么

### 主题色（disguiseAccent）功能已彻底删除
用户要求删除"主题色"功能——即伪装页原本可单独设置主题色（如 Google 蓝 `#1a73e8`）并通过 `--accent` CSS 变量 / `tint` 文本着色注入伪装页。

- `storage.js` 移除默认设置 `disguiseAccent`
- `disguise-url.js` 移除 `buildDisguiseUrl` 的 `accent` 参数写入与 `parseDisguiseUrl` 的 `accent` 解析
- `disguise.js` 移除 `tintText()` 辅助函数、`--accent` 变量注入与 fallback accent；Google 模板的"语言链接"改回默认色
- `disguise.css` 的 `:root` 移除 `--accent` 变量（伪装页不再依赖主题色）
- `options.html` / `options.js` 移除主题色取色行、`readForm` / `fillForm` / `highlightActivePreset` / `bindEvents` 中相关逻辑；预设只切换类型与标题
- `tests/mock-chrome.test.mjs` 删除 C8 的 `disguiseAccent` round-trip 断言、C9 的 `disguiseAccent` 字段与默认主题色断言

> 注：选项页 / 弹窗自身 UI 仍使用独立的 `--accent: #4c8bf5`（按钮、预设卡高亮边框），这与伪装页主题色是两回事，保留不动。

## 二、之前版本（v1.2.0）改了什么

### 1. 标签页组功能已彻底删除
用户上一轮要求"隐藏可重复触发"后引入的"伪装成一组 3 个标签页"功能被砍掉，原因：操作复杂、与"一键隐藏"定位冲突。

- `storage.js` 移除 `GROUP_SIZE` / `GROUP_TEMPLATES` / `normalizeGroupTabs` / `disguiseMode` / `groupTabs` 字段
- `disguise-url.js` 移除 `buildDisguiseTargets`（永远只生成 1 个伪装页）
- `service_worker.js` 移除"组模式创建 N 个标签页"逻辑，恢复时只关掉本次新建的 1 个伪装页（用 `disguiseTabIds` 精确定位）
- `options.html` / `options.js` / `options.css` 移除"伪装模式"下拉、标签页组编辑器、整组预览
- `tests/mock-chrome.test.mjs` 删除 C11/C12，新增 C13（验证组相关导出与字段都消失）

### 2. 伪装页模板只保留 Google / ChatGPT 两套
按用户上传的两张参考图重做：

- **Google 首页**（默认，v1.2 起默认伪装页）：
  - 顶部右上角：Gmail、链接、9 宫格应用图标、圆形头像
  - 中央彩色 Google 字母 logo（蓝/红/黄/蓝/绿/红）
  - 胶囊搜索框：左侧 + 号、中间光标、右侧依次是麦克风、镜头（按图搜索）、紫色星标的「AI 模式」按钮
  - 两个圆角按钮：「Google 搜索」「手气不错」
  - "Google 提供： English" 链接
  - 底部灰条：左 4 项（关于 Google / 广告 / 商务 / Google 搜索的运作方式），右 3 项（隐私权 / 条款 / 设置）

- **ChatGPT 对话页**（未登录态）：
  - 左侧栏：花瓣 logo + 收起按钮；New chat（高亮浅灰）/ Search chats / Images / Plugins / Deep research；底部 See plans and pricing（外链图标）/ Settings / Help
  - 左下：标题 "Get responses tailored to you" + 描述 + Log in 圆角按钮
  - 顶部栏：左 "ChatGPT ▾"、右深色 "Log in" + 描边 "Sign up for free"
  - 中央：分两行 "Where should we begin?" 标题
  - 胶囊输入框：左侧 + 号、"Ask ChatGPT" 占位符、麦克风、灰色上箭头（旋转 90° 模拟发送）
  - 输入框下方：右侧 "What can you do?" 椭圆按钮
  - 底部居中：合规小字（Terms / Privacy Policy / Learn more）

旧的 5 个模板（搜索/文档/表格/空白/嵌入）连同 `embedUrl` 字段全部删除；`disguiseType` 只剩 `google` / `chatgpt` 两个值。

### 3. 选项页"预设"区
新增独立卡片区，只放 2 个一键套用按钮：
- **Google 首页** → 切到 google 模板、标题 "Google"
- **ChatGPT 对话页** → 切到 chatgpt 模板、标题 "ChatGPT"

每个卡片左侧有手绘缩略图（Google 缩略：彩色 G-o-o-g-l-e + 搜索条 + 两按钮；ChatGPT 缩略：左侧栏 + 居中 "Where should we begin?" + 胶囊输入 + 按钮）。点按后会立即保存（不走 debounce），并给当前生效的预设加 2px 高亮边框。

## 三、文件清单

```
manifest.json                                  → v1.1.0 → v1.2.0 → v1.3.0
README.md                                      → 更新预设说明
overview.md                                    → 改写（含 v1.3.0 主题色删除）
icons/icon{16,32,48,128}.png                   → 未变
tools/gen-icons.mjs                            → 未变
src/background/service_worker.js               → 删 group 相关；hide 只创 1 个伪装页（v1.2）
src/shared/storage.js                          → 删 group/disguiseMode/embedUrl（v1.2）；删 disguiseAccent（v1.3）
src/shared/disguise-url.js                     → 删 buildDisguiseTargets（v1.2）；删 accent 参数/解析（v1.3）
src/disguise/disguise.html                     → 未变
src/disguise/disguise.css                      → 重写：仅 google / chatgpt 样式（v1.2）；删 --accent（v1.3）
src/disguise/disguise.js                       → 重写：仅 renderGoogle / renderChatgpt（v1.2）；删 tintText/accent（v1.3）
src/options/options.html                       → 删 group 编辑；加预设区（v1.2）；删主题色取色行（v1.3）
src/options/options.js                         → 加 PRESETS / renderPresets / applyPreset（v1.2）；删主题色逻辑（v1.3）
src/options/options.css                        → 加 .preset-card / .preset-google / .preset-chatgpt（v1.2）
src/popup/popup.html / .js / .css             → 未变
tests/mock-chrome.test.mjs                     → 删 C11/C12，加 C13，更新 C9（v1.2）；删 disguiseAccent 断言（v1.3）
```

## 四、验证

`node tests/mock-chrome.test.mjs` → **15 用例 / 96 断言 / 全绿，退出码 0**

新增/变更用例：
- C13：标签页组彻底移除（导出 + 字段 + 类型枚举都对得上）
- C1：伪装页 URL 默认带 `t=google`（不再是 `t=search`）
- C9：默认设置只含 `disguiseTitle / disguiseIcon / disguiseType / hideToolbarHint / restorePinned` 5 个字段
- C8：URL 编解码不再带 `embedUrl` 参数

## 五、用户必试

1. **chrome://extensions/** 点刷新（manifest 变了，需要重载）
2. 选项页 → 「预设」区，切换 Google / ChatGPT，看实时预览立刻变化
3. 按 `Alt+Shift+Q` 试一次：
   - 标签上看到的是 "Google" 或 "ChatGPT"（取决于当前预设）
   - 按 `Alt+Shift+E` 恢复
4. 切到 ChatGPT 模板后观察：左侧栏、顶部 "Log in / Sign up for free"、居中 "Where should we begin?"、底部合规小字是否都按参考图出现

## 五、已知限制（同 v1.1.0）

- 伪装页地址栏仍显示 `chrome-extension://…`，Chrome 平台限制，扩展无法隐藏
- 标签分组恢复后按普通标签重建（未申请 tabGroups 权限）
