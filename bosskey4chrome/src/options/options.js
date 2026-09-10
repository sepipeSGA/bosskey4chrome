/**
 * options.js —— 选项页逻辑。
 *
 * 所有改动 debounce 300ms 后写入 chrome.storage.sync；
 * 选项页不直接操作标签页，隐藏/恢复一律由 popup 或快捷键触发。
 */

import {
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings,
  resetSettings,
  getStatus,
  clearSnapshot,
} from '../shared/storage.js';
import { buildDisguiseUrl } from '../shared/disguise-url.js';

/** 防抖间隔（毫秒） */
const SAVE_DEBOUNCE_MS = 300;

/** 当前表单对应的设置对象（内存中的"真值"，与表单保持同步） */
let currentSettings = { ...DEFAULT_SETTINGS };

/** 防抖计时器 */
let saveTimer = null;

/* -------------------------------- 预设配置 -------------------------------- */

/**
 * 内置的两个预设。每个预设是一份完整的设置补丁，点击后会同步切换。
 * 字段值必须与 DEFAULT_SETTINGS 字段集对齐。
 */
const PRESETS = Object.freeze([
  {
    id: 'google',
    name: 'Google 首页',
    description: '仿 Google 中文搜索首页：彩色 logo、胶囊搜索框、AI 模式按钮',
    patch: {
      disguiseType: 'google',
      disguiseTitle: 'Google',
    },
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT 对话页',
    description: '仿 ChatGPT 未登录态对话页：左侧栏、居中提示、胶囊输入框',
    patch: {
      disguiseType: 'chatgpt',
      disguiseTitle: 'ChatGPT',
    },
  },
]);

/* -------------------------------- 元素引用 -------------------------------- */

const el = {
  shortcutHide: document.getElementById('shortcutHide'),
  shortcutRestore: document.getElementById('shortcutRestore'),
  openShortcuts: document.getElementById('openShortcuts'),
  presetList: document.getElementById('presetList'),
  disguiseType: document.getElementById('disguiseType'),
  disguiseTitle: document.getElementById('disguiseTitle'),
  disguiseIcon: document.getElementById('disguiseIcon'),
  restorePinned: document.getElementById('restorePinned'),
  hideToolbarHint: document.getElementById('hideToolbarHint'),
  clearSnapshot: document.getElementById('clearSnapshot'),
  resetSettings: document.getElementById('resetSettings'),
  snapshotInfo: document.getElementById('snapshotInfo'),
  previewFrame: document.getElementById('previewFrame'),
  toast: document.getElementById('toast'),
};

/* -------------------------------- 工具函数 -------------------------------- */

/** 提示计时器 */
let toastTimer = null;

/**
 * 显示一条轻量行内提示（不用 alert）。
 * @param {string} message 提示文案
 * @returns {void}
 */
function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.classList.remove('show');
  }, 1600);
}

/**
 * 读取表单当前值，组装成设置补丁。
 * @returns {object} 设置补丁
 */
function readForm() {
  return {
    disguiseType: el.disguiseType.value,
    disguiseTitle: el.disguiseTitle.value.trim() || DEFAULT_SETTINGS.disguiseTitle,
    disguiseIcon: el.disguiseIcon.value.trim(),
    restorePinned: el.restorePinned.checked,
    hideToolbarHint: el.hideToolbarHint.checked,
  };
}

/**
 * 用设置对象填充表单。
 * @param {object} settings 设置对象
 * @returns {void}
 */
function fillForm(settings) {
  el.disguiseType.value = settings.disguiseType === 'chatgpt' ? 'chatgpt' : 'google';
  el.disguiseTitle.value = settings.disguiseTitle || '';
  el.disguiseIcon.value = settings.disguiseIcon || '';
  el.restorePinned.checked = Boolean(settings.restorePinned);
  el.hideToolbarHint.checked = Boolean(settings.hideToolbarHint);
  highlightActivePreset();
}

/* --------------------------------- 预设 --------------------------------- */

/**
 * 渲染预设卡片列表。
 * @returns {void}
 */
function renderPresets() {
  el.presetList.innerHTML = '';
  PRESETS.forEach((preset) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'preset-card';
    card.dataset.presetId = preset.id;

    const name = document.createElement('div');
    name.className = 'preset-name';
    name.textContent = preset.name;

    const desc = document.createElement('div');
    desc.className = 'preset-desc';
    desc.textContent = preset.description;

    // 小预览：用一个简化色块示意（避免嵌入实际模板页面拉高开销）
    const sample = document.createElement('div');
    sample.className = 'preset-sample';
    if (preset.id === 'google') {
      sample.innerHTML =
        '<div class="preset-google"><div class="pg-letters">' +
        '<span style="color:#4285F4">G</span><span style="color:#EA4335">o</span>' +
        '<span style="color:#FBBC05">o</span><span style="color:#4285F4">g</span>' +
        '<span style="color:#34A853">l</span><span style="color:#EA4335">e</span>' +
        '</div><div class="pg-bar"></div><div class="pg-btns"><i></i><i></i></div></div>';
    } else {
      sample.innerHTML =
        '<div class="preset-chatgpt"><div class="pc-side"></div>' +
        '<div class="pc-body"><div class="pc-hello"></div><div class="pc-input"></div><div class="pc-btn"></div></div></div>';
    }

    card.appendChild(sample);
    card.appendChild(name);
    card.appendChild(desc);
    card.addEventListener('click', () => applyPreset(preset));
    el.presetList.appendChild(card);
  });
  highlightActivePreset();
}

/**
 * 把当前设置与预设对比，给当前选中的预设加高亮。
 * @returns {void}
 */
function highlightActivePreset() {
  el.presetList.querySelectorAll('.preset-card').forEach((card) => {
    const id = card.dataset.presetId;
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) {
      return;
    }
    const patch = preset.patch;
    const isMatch = currentSettings.disguiseType === patch.disguiseType;
    card.classList.toggle('preset-active', isMatch);
  });
}

/**
 * 应用一个预设：立刻填充表单 + 立即写入 storage，不走 debounce。
 * @param {object} preset 预设对象
 * @returns {Promise<void>}
 */
async function applyPreset(preset) {
  try {
    // 同步更新 currentSettings 与表单，让用户立刻看到外观变化
    currentSettings = { ...currentSettings, ...preset.patch };
    fillForm(currentSettings);
    refreshPreview();
    // 真正落盘：直接 saveSettings，不经 debounce，按下立即生效
    clearTimeout(saveTimer);
    currentSettings = await saveSettings(preset.patch);
    highlightActivePreset();
    showToast(`已应用预设：${preset.name}`);
  } catch (error) {
    console.error('[BossKey] 应用预设失败：', error);
    showToast('应用失败，请重试');
  }
}

/* --------------------------------- 预览 --------------------------------- */

/**
 * 刷新预览（单页模式预览 1 个伪装页）。
 * @returns {void}
 */
function refreshPreview() {
  el.previewFrame.src = buildDisguiseUrl(currentSettings, { preview: true });
}

/* --------------------------------- 保存 --------------------------------- */

/**
 * 防抖保存设置。
 * @returns {void}
 */
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      currentSettings = await saveSettings(readForm());
      highlightActivePreset();
      refreshPreview();
      showToast('已保存');
    } catch (error) {
      console.error('[BossKey] 保存设置失败：', error);
      showToast('保存失败，请重试');
    }
  }, SAVE_DEBOUNCE_MS);
}

/* ------------------------------ 快捷键展示 ------------------------------- */

/**
 * 读取并展示当前实际生效的快捷键。
 * MV3 不支持用代码修改快捷键，只能在 chrome://extensions/shortcuts 中修改。
 * @returns {Promise<void>}
 */
async function loadShortcuts() {
  try {
    const commands = await chrome.commands.getAll();
    const hide = commands.find((command) => command.name === 'bosskey-hide');
    const restore = commands.find((command) => command.name === 'bosskey-restore');
    el.shortcutHide.textContent = (hide && hide.shortcut) || '未设置';
    el.shortcutRestore.textContent = (restore && restore.shortcut) || '未设置';
  } catch (error) {
    console.warn('[BossKey] 读取快捷键失败：', error);
    el.shortcutHide.textContent = '读取失败';
    el.shortcutRestore.textContent = '读取失败';
  }
}

/* ------------------------------- 快照信息 -------------------------------- */

/**
 * 刷新"已保存快照"信息区。
 * @returns {Promise<void>}
 */
async function refreshSnapshotInfo() {
  try {
    const status = await getStatus();
    if (status.hidden) {
      const time = new Date(status.createdAt).toLocaleString('zh-CN');
      el.snapshotInfo.textContent = `已保存 ${status.count} 个标签页（${time} 隐藏）。清除后这些标签页将无法恢复。`;
      el.clearSnapshot.disabled = false;
    } else {
      el.snapshotInfo.textContent = '当前没有已保存的快照。';
      el.clearSnapshot.disabled = true;
    }
  } catch (error) {
    console.warn('[BossKey] 读取快照状态失败：', error);
    el.snapshotInfo.textContent = '读取快照状态失败。';
    el.clearSnapshot.disabled = true;
  }
}

/* -------------------------------- 事件绑定 ------------------------------- */

/**
 * 绑定所有表单与按钮事件。
 * @returns {void}
 */
function bindEvents() {
  const textInputs = [
    el.disguiseTitle,
    el.disguiseIcon,
  ];
  textInputs.forEach((input) => {
    input.addEventListener('input', scheduleSave);
  });

  el.disguiseType.addEventListener('change', scheduleSave);

  [el.restorePinned, el.hideToolbarHint].forEach((checkbox) => {
    checkbox.addEventListener('change', scheduleSave);
  });

  el.openShortcuts.addEventListener('click', async () => {
    try {
      await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    } catch (error) {
      console.error('[BossKey] 打开快捷键设置页失败：', error);
      showToast('打开失败，请手动访问 chrome://extensions/shortcuts');
    }
  });

  el.clearSnapshot.addEventListener('click', async () => {
    try {
      await clearSnapshot();
      await refreshSnapshotInfo();
      showToast('快照已清除');
    } catch (error) {
      console.error('[BossKey] 清除快照失败：', error);
      showToast('清除快照失败');
    }
  });

  el.resetSettings.addEventListener('click', async () => {
    try {
      currentSettings = await resetSettings();
      fillForm(currentSettings);
      refreshPreview();
      showToast('已恢复默认设置');
    } catch (error) {
      console.error('[BossKey] 恢复默认设置失败：', error);
      showToast('恢复默认设置失败');
    }
  });
}

/* --------------------------------- 初始化 -------------------------------- */

/**
 * 选项页入口。
 * @returns {Promise<void>}
 */
async function init() {
  currentSettings = await getSettings();
  renderPresets();
  fillForm(currentSettings);
  bindEvents();
  refreshPreview();
  await loadShortcuts();
  await refreshSnapshotInfo();
}

init().catch((error) => {
  console.error('[BossKey] 选项页初始化失败：', error);
});
