/**
 * storage.js —— 设置与快照的统一读写封装。
 *
 * 存储分区约定（全局唯一，三处共用：service worker / options / popup）：
 *   - chrome.storage.sync : bosskey.settings.v1  —— 用户配置（跨设备同步）
 *   - chrome.storage.local: bosskey.snapshot.v1  —— 隐藏时的标签页快照
 *     （MV3 service worker 会休眠，快照必须落在 local 持久化存储里）
 */

/** 设置存储键（sync） */
export const SETTINGS_KEY = 'bosskey.settings.v1';

/** 快照存储键（local） */
export const SNAPSHOT_KEY = 'bosskey.snapshot.v1';

/** 快照结构版本号，便于后续升级迁移 */
export const SNAPSHOT_VERSION = 1;

/** 默认设置 */
export const DEFAULT_SETTINGS = Object.freeze({
  /** 伪装页模板：google | chatgpt */
  disguiseType: 'google',
  /** 伪装页标题（同时作为页面内大标题/侧栏标题） */
  disguiseTitle: 'Google',
  /** 伪装页图标 URL（data URI），留空时按模板自动选用内置默认 */
  disguiseIcon: '',
  /** 是否显示"按快捷键恢复"的隐晦提示条 */
  hideToolbarHint: true,
  /** 是否连固定（pinned）标签页一起隐藏 */
  restorePinned: true,
});

/** 允许出现的所有模板类型 */
export const DISGUISE_TYPES = Object.freeze(['google', 'chatgpt']);

/**
 * 读取设置，缺失字段用默认值补齐。
 * @returns {Promise<typeof DEFAULT_SETTINGS>} 完整设置对象
 */
export async function getSettings() {
  try {
    const stored = await chrome.storage.sync.get(SETTINGS_KEY);
    const merged = { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) };
    return merged;
  } catch (error) {
    console.warn('[BossKey] 读取设置失败，回退默认值：', error);
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * 写入设置（增量合并，未提供的字段保持原值）。
 * @param {Partial<typeof DEFAULT_SETTINGS>} patch 增量设置
 * @returns {Promise<typeof DEFAULT_SETTINGS>} 合并后的完整设置
 */
export async function saveSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...(patch || {}) };
  await chrome.storage.sync.set({ [SETTINGS_KEY]: next });
  return next;
}

/**
 * 恢复默认设置。
 * @returns {Promise<typeof DEFAULT_SETTINGS>} 默认设置
 */
export async function resetSettings() {
  const defaults = { ...DEFAULT_SETTINGS };
  await chrome.storage.sync.set({ [SETTINGS_KEY]: defaults });
  return defaults;
}

/**
 * 读取当前快照；不存在时返回 null。
 * @returns {Promise<object|null>} 快照对象
 */
export async function getSnapshot() {
  try {
    const stored = await chrome.storage.local.get(SNAPSHOT_KEY);
    const snapshot = stored[SNAPSHOT_KEY];
    if (!snapshot || !Array.isArray(snapshot.tabs)) {
      return null;
    }
    return snapshot;
  } catch (error) {
    console.warn('[BossKey] 读取快照失败：', error);
    return null;
  }
}

/**
 * 写入快照。
 * @param {{createdAt:number, windowId:number, tabs:Array<object>, activeIndex:number}} snapshot 快照
 * @returns {Promise<void>}
 */
export async function saveSnapshot(snapshot) {
  const payload = { ...snapshot, version: SNAPSHOT_VERSION };
  await chrome.storage.local.set({ [SNAPSHOT_KEY]: payload });
}

/**
 * 删除快照。
 * @returns {Promise<void>}
 */
export async function clearSnapshot() {
  await chrome.storage.local.remove(SNAPSHOT_KEY);
}

/**
 * 获取简明状态，供 popup / badge 使用。
 * @returns {Promise<{hidden:boolean, count:number, createdAt:number}>} 状态
 */
export async function getStatus() {
  const snapshot = await getSnapshot();
  return {
    hidden: Boolean(snapshot),
    count: snapshot ? snapshot.tabs.length : 0,
    createdAt: snapshot ? snapshot.createdAt : 0,
  };
}
