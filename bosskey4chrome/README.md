# BossKey 老板键（Chrome 扩展）

一键隐藏当前窗口所有标签页并显示伪装页，再按快捷键原样恢复。Manifest V3，原生 HTML/CSS/JS，无构建工具、无第三方依赖。

## 安装（加载已解压的扩展）

1. 打开 `chrome://extensions/`，右上角开启 **开发者模式**；
2. 点击 **加载已解压的扩展程序**，选择本目录（包含 `manifest.json` 的那一层）；
3. 打开 `chrome://extensions/shortcuts` 确认或修改快捷键。

## 快捷键

| 功能 | 命令名 | 默认 |
| --- | --- | --- |
| 隐藏当前窗口所有标签页并显示伪装页 | `bosskey-hide` | `Alt+Shift+Q` |
| 恢复上次隐藏的标签页 | `bosskey-restore` | `Alt+Shift+E` |

> Chrome 的 MV3 **不允许扩展用代码修改快捷键**，只能在 `chrome://extensions/shortcuts` 中由用户手动修改。
> 选项页与弹窗都会读取并展示当前实际生效的快捷键，并提供直达该页面的按钮。

## 功能

- **隐藏**：抓取当前窗口全部标签页 → 保存快照（`chrome.storage.local`）→ 先打开伪装页再关闭原标签页 → 工具栏图标显示 `H` 角标。
- **随时可再隐藏**：隐藏键任何时候都有效，不需要先恢复。每次隐藏都会覆盖快照，**恢复的永远是最后一次隐藏的那批标签页**。
- **恢复**：先重建标签页再清理伪装页（避免窗口被一起关掉）→ 按原顺序重建（含固定状态 / 静音状态）→ 激活原本正在看的那个 → 清除快照与角标。
- **伪装页**：扩展内置页面，提供两种模板：
  - **Google 首页**（默认）：仿 Google 中文搜索首页，彩色 logo、胶囊搜索框（含语音 / 图片 / AI 模式按钮）、"Google 搜索 / 手气不错" 圆角按钮、底部灰条。
  - **ChatGPT 对话页**：仿 ChatGPT 未登录态对话页，左侧 New chat / Search chats / Images / Plugins / Deep research、居中 "Where should we begin?"、胶囊输入框 + "What can you do?" 按钮、底部合规小字。
- **预设**：选项页"预设"区只有 Google / ChatGPT 两个一键套用按钮，点击会同步切换伪装页类型与标题，并实时预览。
- **行为开关**：是否连固定标签一起隐藏、是否显示恢复提示条。

## 目录结构

```
manifest.json
icons/                              图标（由 tools/gen-icons.mjs 生成）
tools/gen-icons.mjs                 一次性图标生成脚本（Node 内置 zlib，无依赖）
src/background/service_worker.js    后台：命令分发、快照、badge
src/shared/storage.js               设置 / 快照读写封装
src/shared/disguise-url.js          伪装页 URL 生成与解析
src/options/                        选项页（含 2 个预设）
src/popup/                          工具栏弹窗
src/disguise/                       伪装页（Google + ChatGPT 两个模板）
```

## 权限

仅 `tabs` 与 `storage`，不申请 `host_permissions`，不劫持新标签页。

## 已知限制

- `chrome://`、扩展商店等受限页面不会被写入快照（浏览器不允许用 `tabs.create` 重建它们），但隐藏时仍会被关掉，不会让伪装漏馅。
- 每次隐藏会覆盖上一次的快照，更早的那批标签页不再保留（可用 Chrome 自带的 `Ctrl+Shift+T` 逐个找回）。
- 标签页分组（tab groups）在关闭时即被销毁，恢复后按普通标签重建，分组不还原。
- 伪装页地址栏仍会显示 `chrome-extension://...`，标签标题与图标可以伪装，地址栏无法隐藏。

## 重新生成图标

```bash
node tools/gen-icons.mjs
```
