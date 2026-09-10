/**
 * service_worker.js —— BossKey 后台服务（MV3，ES Module）。
 *
 * 职责：
 *   1. 响应快捷键命令（bosskey-hide / bosskey-restore）
 *   2. 响应 popup 发来的消息（复用同一套逻辑，避免重复实现）
 *   3. 维护工具栏 badge 状态
 */

import {
  getSettings,
  getSnapshot,
  saveSnapshot,
  clearSnapshot,
  getStatus,
} from '../shared/storage.js';
import { buildDisguiseUrl, isDisguiseUrl } from '../shared/disguise-url.js';

/** 隐藏状态下 badge 上的文字 */
const BADGE_HIDDEN_TEXT = 'H';
/** 隐藏状态下 badge 的背景色（深色） */
const BADGE_HIDDEN_COLOR = '#1f2937';
/** 提示型 badge（空快照 / 重复隐藏）的显示时长 */
const FLASH_DURATION_MS = 1400;

/* ------------------------------ 全局兜底日志 ------------------------------ */

self.addEventListener('unhandledrejection', (event) => {
  console.error('[BossKey] 未处理的 Promise 拒绝：', event.reason);
  event.preventDefault();
});

self.addEventListener('error', (event) => {
  console.error('[BossKey] 未捕获错误：', event.message, event.filename, event.lineno);
});

/* -------------------------------- 工具函数 -------------------------------- */

/**
 * 短暂显示一个 badge 文案后自动清空（用于"无快照"等软提示）。
 * @param {string} text 文案
 * @returns {Promise<void>}
 */
async function flashBadge(text) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_HIDDEN_COLOR });
    await chrome.action.setBadgeText({ text });
    setTimeout(() => {
      chrome.action.setBadgeText({ text: '' }).catch(() => {
        /* 忽略：worker 可能已休眠 */
      });
    }, FLASH_DURATION_MS);
  } catch (error) {
    console.warn('[BossKey] 设置 badge 失败：', error);
  }
}

/**
 * 根据当前快照状态刷新 badge。
 * @returns {Promise<void>}
 */
async function refreshBadge() {
  try {
    const status = await getStatus();
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_HIDDEN_COLOR });
    await chrome.action.setBadgeText({ text: status.hidden ? BADGE_HIDDEN_TEXT : '' });
  } catch (error) {
    console.warn('[BossKey] 刷新 badge 失败：', error);
  }
}

/**
 * 获取当前（最近聚焦的）窗口 id。
 * @returns {Promise<number>} 窗口 id
 */
async function getCurrentWindowId() {
  try {
    const current = await chrome.windows.getCurrent();
    if (current && typeof current.id === 'number') {
      return current.id;
    }
  } catch (error) {
    console.warn('[BossKey] 获取当前窗口失败，尝试最近聚焦窗口：', error);
  }
  const lastFocused = await chrome.windows.getLastFocused();
  return lastFocused.id;
}

/**
 * 判断某个标签是否可被收纳进快照。
 * 过滤规则：跳过伪装页本身；跳过 chrome:// 等受限页面（恢复时无法创建）。
 * @param {chrome.tabs.Tab} tab 标签对象
 * @param {object} settings 设置
 * @returns {boolean} 可收纳返回 true
 */
function isRestorableTab(tab, settings) {
  if (!tab || typeof tab.id !== 'number') {
    return false;
  }
  const url = tab.url || '';
  // 跳过伪装页自身，避免把伪装页也存进快照
  if (isDisguiseUrl(url)) {
    return false;
  }
  // 受限页面（chrome://、edge://、devtools://、扩展商店安装页等）无法用 tabs.create 恢复
  if (/^(chrome|edge|brave|opera|devtools|view-source|chrome-extension|moz-extension):/i.test(url)) {
    return false;
  }
  // 设置里关闭了"连固定标签一起隐藏"时，保留固定标签页不动
  if (!settings.restorePinned && tab.pinned) {
    return false;
  }
  return true;
}

/* ------------------------------- 隐藏（hide） ------------------------------ */

/**
 * 隐藏当前窗口的标签页：保存快照 → 打开伪装页 → 关闭原标签页。
 * @returns {Promise<void>}
 */
async function hideSession() {
  const settings = await getSettings();

  const windowId = await getCurrentWindowId();
  const tabs = await chrome.tabs.query({ windowId });
  const sorted = tabs.slice().sort((a, b) => a.index - b.index);
  // 快照里只存"用户的网页"：跳过伪装页自身、跳过 chrome:// 等不可恢复的页面
  const restorable = sorted.filter((tab) => isRestorableTab(tab, settings));

  const snapshotTabs = restorable.map((tab, i) => ({
    url: tab.url || 'about:blank',
    title: tab.title || '',
    favIconUrl: tab.favIconUrl || '',
    pinned: Boolean(tab.pinned),
    index: i,
    active: Boolean(tab.active),
    muted: Boolean(tab.mutedInfo && tab.mutedInfo.muted),
    // groupId 记录仅作存档：MV3 不申请 tabGroups 权限，原分组在关闭时已被销毁，
    // 恢复时按普通标签重建（详见 restoreSession 注释）。
    groupId: typeof tab.groupId === 'number' ? tab.groupId : -1,
    windowId: tab.windowId,
  }));

  const activePosition = snapshotTabs.findIndex((tab) => tab.active);
  const disguiseUrl = buildDisguiseUrl(settings);

  if (snapshotTabs.length === 0) {
    // 关键：没有可恢复的页时只做伪装、不写快照。
    // 否则会留下"空隐藏态"，用户会被卡住且取不回上一次的标签页。
    console.warn('[BossKey] 当前窗口没有可恢复的标签页，仅打开伪装页，不写入快照。');
  } else {
    // 先写快照，保证"先开后关"：即使后续步骤出错，用户的标签页列表也不会丢。
    // 每次隐藏都覆盖上一次的快照 —— 恢复的永远是最后一次隐藏的那批标签页。
    await saveSnapshot({
      createdAt: Date.now(),
      windowId,
      tabs: snapshotTabs,
      activeIndex: activePosition >= 0 ? activePosition : 0,
      disguiseTabIds: [],
      disguiseUrl,
    });
  }

  // 先开后关，避免窗口因为最后一个标签被移除而被关闭
  let createdDisguiseId = null;
  try {
    const created = await chrome.tabs.create({
      windowId,
      url: disguiseUrl,
      active: true,
    });
    if (created && typeof created.id === 'number') {
      createdDisguiseId = created.id;
    }
  } catch (error) {
    console.warn('[BossKey] 创建伪装页失败：', error);
  }

  // 关闭范围 ≠ 快照范围：
  //   - 快照只存"能恢复"的页（chrome:// 等无法用 tabs.create 重建，不进快照）；
  //   - 关闭要关掉"全部非伪装页"，chrome:// 等特权页也必须关掉，否则伪装会漏馅。
  // restorePinned=false 时，固定标签页既不进快照也不关闭，保持原样。
  const idsToRemove = sorted
    .filter(
      (tab) =>
        typeof tab.id === 'number' &&
        tab.id !== createdDisguiseId &&
        !isDisguiseUrl(tab.url) &&
        !(tab.pinned && !settings.restorePinned)
    )
    .map((tab) => tab.id);
  if (idsToRemove.length > 0) {
    await chrome.tabs.remove(idsToRemove);
  }

  // 把伪装页 id 记进快照，供恢复时精确识别（避免把同窗口的伪装页误当作用户网页）
  if (snapshotTabs.length > 0 && createdDisguiseId !== null) {
    const saved = await getSnapshot();
    if (saved) {
      await saveSnapshot({ ...saved, disguiseTabIds: [createdDisguiseId] });
    }
  }

  await refreshBadge();
  console.info(
    `[BossKey] 已隐藏 ${idsToRemove.length} 个标签页（可恢复 ${snapshotTabs.length} 个）。`
  );
}

/* ------------------------------ 恢复（restore） ---------------------------- */

/**
 * 恢复上次隐藏的标签页。
 * @returns {Promise<void>}
 */
async function restoreSession() {
  const snapshot = await getSnapshot();
  if (!snapshot || !Array.isArray(snapshot.tabs) || snapshot.tabs.length === 0) {
    console.warn('[BossKey] 没有可恢复的快照，忽略恢复命令。');
    // 兜底：无论是否存在历史空快照，都强制清快照 + 清 badge，
    // 保证任何情况下都能退出隐藏态，不会卡死。
    await clearSnapshot();
    await refreshBadge();
    await flashBadge('?');
    return;
  }

  // 优先恢复到原窗口；原窗口已关闭则恢复到当前窗口
  let targetWindowId = await getCurrentWindowId();
  if (typeof snapshot.windowId === 'number') {
    try {
      await chrome.windows.get(snapshot.windowId);
      targetWindowId = snapshot.windowId;
    } catch (error) {
      console.warn('[BossKey] 原窗口已关闭，恢复到当前窗口。', error);
    }
  }

  // 记录需要清理的伪装页：优先用隐藏时记下的 id（能准确覆盖"标签页组"里的真实网页），
  // 再用 isDisguiseUrl 兜底（id 丢失时仍能清掉内置伪装页）。
  const disguiseIds = new Set(
    Array.isArray(snapshot.disguiseTabIds) ? snapshot.disguiseTabIds : []
  );

  const createdIds = [];
  const activePosition = Number.isInteger(snapshot.activeIndex) ? snapshot.activeIndex : 0;

  // 按原顺序逐个创建（顺序即相对顺序）；单个失败不中断整体恢复。
  // 注意顺序：先创建再清理伪装页 —— 否则窗口里最后一个标签被移除时，Chrome 会连窗口一起关掉。
  for (let i = 0; i < snapshot.tabs.length; i += 1) {
    const item = snapshot.tabs[i];
    try {
      const created = await chrome.tabs.create({
        windowId: targetWindowId,
        url: item.url || 'about:blank',
        pinned: Boolean(item.pinned),
        active: false,
      });
      if (created && typeof created.id === 'number') {
        createdIds.push(created.id);
        if (item.muted) {
          await chrome.tabs.update(created.id, { muted: true }).catch(() => {
            /* 静音状态恢复失败不影响主流程 */
          });
        }
      }
    } catch (error) {
      console.warn(`[BossKey] 恢复标签页失败，已跳过：${item.url}`, error);
      createdIds.push(null);
    }
  }

  // 恢复的标签已经就位，此时再清理伪装页就不会把窗口关掉
  try {
    const currentTabs = await chrome.tabs.query({ windowId: targetWindowId });
    const idsToClose = currentTabs
      .filter(
        (tab) =>
          typeof tab.id === 'number' &&
          !createdIds.includes(tab.id) &&
          (disguiseIds.has(tab.id) || isDisguiseUrl(tab.url))
      )
      .map((tab) => tab.id);
    if (idsToClose.length > 0) {
      await chrome.tabs.remove(idsToClose);
    }
  } catch (error) {
    console.warn('[BossKey] 清理伪装页失败（不影响恢复）：', error);
  }

  // 把原本激活的那个标签页重新设为激活
  const activeTabId = createdIds[activePosition] || createdIds.find((id) => id !== null);
  if (typeof activeTabId === 'number') {
    await chrome.tabs.update(activeTabId, { active: true }).catch((error) => {
      console.warn('[BossKey] 激活原标签页失败：', error);
    });
  }

  await clearSnapshot();
  await refreshBadge();
  console.info(`[BossKey] 已恢复 ${createdIds.filter((id) => id !== null).length} 个标签页。`);
}

/* ------------------------------ 事件注册与分发 ----------------------------- */

chrome.runtime.onInstalled.addListener(() => {
  console.info('[BossKey] 安装完成。请在 chrome://extensions/shortcuts 中确认快捷键。');
  refreshBadge();
});

chrome.runtime.onStartup.addListener(() => {
  refreshBadge();
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'bosskey-hide') {
    hideSession().catch((error) => console.error('[BossKey] 隐藏失败：', error));
    return;
  }
  if (command === 'bosskey-restore') {
    restoreSession().catch((error) => console.error('[BossKey] 恢复失败：', error));
    return;
  }
  console.warn('[BossKey] 未知命令：', command);
});

/**
 * popup 通过 runtime.sendMessage 复用同一套逻辑。
 * @type {(message:any, sender:chrome.runtime.MessageSender, sendResponse:(r:any)=>void)=>boolean}
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') {
    return false;
  }
  if (message.type === 'bosskey:run') {
    const task = message.command === 'bosskey-restore' ? restoreSession() : hideSession();
    task
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String((error && error.message) || error) }));
    return true;
  }
  if (message.type === 'bosskey:status') {
    getStatus()
      .then((status) => sendResponse({ ok: true, status }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  return false;
});

// worker 每次唤醒都同步一次 badge 状态
refreshBadge();
