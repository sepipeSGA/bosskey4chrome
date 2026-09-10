/**
 * disguise-url.js —— 伪装页 URL 的生成与解析。
 *
 * 伪装页是扩展内置页面（chrome-extension://<id>/src/disguise/disguise.html），
 * 不跳外部站点，避免网络依赖与 X-Frame-Options 问题。
 * URL 上带少量查询参数，用于首屏兜底渲染（页面本身仍以 storage 中的设置为准）。
 */

/** 伪装页在扩展内的相对路径（service worker 与页面共用） */
export const DISGUISE_PAGE_PATH = 'src/disguise/disguise.html';

/**
 * 生成伪装页完整 URL。
 * @param {object} settings 设置对象
 * @param {{preview?:boolean}} [options] 额外选项，preview 会附加 preview=1（选项页缩略图用）
 * @returns {string} 伪装页 URL
 */
export function buildDisguiseUrl(settings, options) {
  const base = chrome.runtime.getURL(DISGUISE_PAGE_PATH);
  const safeSettings = settings || {};
  const params = new URLSearchParams();
  // 时间戳保证每次隐藏都是全新 URL，避免命中页面缓存
  params.set('ts', Date.now().toString(36));
  if (safeSettings.disguiseType) {
    params.set('t', String(safeSettings.disguiseType));
  }
  if (safeSettings.disguiseTitle) {
    params.set('title', String(safeSettings.disguiseTitle));
  }
  if (safeSettings.disguiseIcon) {
    params.set('icon', String(safeSettings.disguiseIcon));
  }
  if (options && options.preview) {
    params.set('preview', '1');
  }
  return `${base}?${params.toString()}`;
}

/**
 * 判断某个 URL 是否是本扩展的伪装页。
 * @param {string|undefined} url 待判断的 URL
 * @returns {boolean} 是伪装页返回 true
 */
export function isDisguiseUrl(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }
  try {
    const base = chrome.runtime.getURL(DISGUISE_PAGE_PATH).split('?')[0];
    return url === base || url.startsWith(`${base}?`) || url.startsWith(`${base}#`);
  } catch (error) {
    console.warn('[BossKey] 判断伪装页 URL 失败：', error);
    return false;
  }
}

/**
 * 解析伪装页 URL 上的查询参数，映射回设置字段名。
 * @param {string} url 伪装页 URL
 * @returns {Partial<object>} 解析出的设置片段（字段缺失时不返回该键）
 */
export function parseDisguiseUrl(url) {
  const result = {};
  if (!url || typeof url !== 'string') {
    return result;
  }
  try {
    const queryIndex = url.indexOf('?');
    if (queryIndex === -1) {
      return result;
    }
    const params = new URLSearchParams(url.slice(queryIndex + 1));
    const title = params.get('title');
    const type = params.get('t');
    const icon = params.get('icon');
    if (title) result.disguiseTitle = title;
    if (type) result.disguiseType = type;
    if (icon) result.disguiseIcon = icon;
    if (params.get('preview') === '1') result.preview = true;
  } catch (error) {
    console.warn('[BossKey] 解析伪装页 URL 失败：', error);
  }
  return result;
}
