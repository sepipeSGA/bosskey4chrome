/**
 * popup.js —— 工具栏弹窗逻辑。
 *
 * 只负责读状态 + 下发指令，真正的隐藏/恢复逻辑统一在 service worker 中实现，
 * 通过 chrome.runtime.sendMessage 复用，避免两处重复实现。
 */

import { getStatus } from '../shared/storage.js';

/** 元素引用 */
const el = {
  statusText: document.getElementById('statusText'),
  statusDetail: document.getElementById('statusDetail'),
  statusDot: document.getElementById('statusDot'),
  btnHide: document.getElementById('btnHide'),
  btnRestore: document.getElementById('btnRestore'),
  kbdHide: document.getElementById('kbdHide'),
  kbdRestore: document.getElementById('kbdRestore'),
  openOptions: document.getElementById('openOptions'),
  openShortcuts: document.getElementById('openShortcuts'),
};

/**
 * 向 service worker 下发 hide/restore 指令，完成后关闭弹窗。
 * @param {'bosskey-hide'|'bosskey-restore'} command 命令名（与 manifest.commands 一致）
 * @returns {Promise<void>}
 */
async function runCommand(command) {
  el.btnHide.disabled = true;
  el.btnRestore.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'bosskey:run', command });
    if (!response || !response.ok) {
      console.error('[BossKey] 执行失败：', response && response.error);
    }
  } catch (error) {
    console.error('[BossKey] 与后台通信失败：', error);
  } finally {
    window.close();
  }
}

/**
 * 读取并展示当前状态：是否隐藏、隐藏了多少个标签页。
 * @returns {Promise<void>}
 */
async function refreshStatus() {
  let status = { hidden: false, count: 0 };
  try {
    status = await getStatus();
  } catch (error) {
    console.warn('[BossKey] 读取状态失败：', error);
  }

  // 隐藏键任何时候都可用：再次隐藏会把快照覆盖成"当前窗口的标签页"
  el.btnHide.disabled = false;

  if (status.hidden) {
    el.statusText.textContent = '已隐藏';
    el.statusDetail.textContent = `已保存 ${status.count} 个标签页，可随时恢复；再按隐藏键会覆盖为当前窗口的标签页`;
    el.statusDot.className = 'dot hidden';
    el.btnHide.textContent = '再隐藏一次';
    el.btnRestore.disabled = false;
  } else {
    el.statusText.textContent = '正常';
    el.statusDetail.textContent = '当前没有保存的标签页快照';
    el.statusDot.className = 'dot normal';
    el.btnHide.textContent = '立即隐藏';
    el.btnRestore.disabled = true;
  }
}

/**
 * 展示当前实际生效的快捷键（只读取，MV3 不允许代码修改）。
 * @returns {Promise<void>}
 */
async function loadShortcuts() {
  try {
    const commands = await chrome.commands.getAll();
    const hide = commands.find((command) => command.name === 'bosskey-hide');
    const restore = commands.find((command) => command.name === 'bosskey-restore');
    el.kbdHide.textContent = (hide && hide.shortcut) || '未设置';
    el.kbdRestore.textContent = (restore && restore.shortcut) || '未设置';
  } catch (error) {
    console.warn('[BossKey] 读取快捷键失败：', error);
    el.kbdHide.textContent = '未设置';
    el.kbdRestore.textContent = '未设置';
  }
}

/* -------------------------------- 事件绑定 -------------------------------- */

el.btnHide.addEventListener('click', () => {
  runCommand('bosskey-hide');
});

el.btnRestore.addEventListener('click', () => {
  runCommand('bosskey-restore');
});

el.openOptions.addEventListener('click', async (event) => {
  event.preventDefault();
  await chrome.runtime.openOptionsPage();
  window.close();
});

el.openShortcuts.addEventListener('click', async (event) => {
  event.preventDefault();
  await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  window.close();
});

/* --------------------------------- 初始化 --------------------------------- */

refreshStatus()
  .then(loadShortcuts)
  .catch((error) => console.error('[BossKey] 弹窗初始化失败：', error));
