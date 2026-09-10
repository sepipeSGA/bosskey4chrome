/**
 * disguise.js —— 伪装页渲染逻辑。
 *
 * 页面数据来源优先级：chrome.storage.sync 中的设置 > URL 查询参数（首屏兜底）。
 * 内置两种模板：google（仿 Google 中文首页） / chatgpt（仿 ChatGPT 对话页）。
 */

import { getSettings, SETTINGS_KEY } from '../shared/storage.js';
import { parseDisguiseUrl } from '../shared/disguise-url.js';

/* ------------------------------- 模板常量 ------------------------------- */

/** 各模板内置的默认标题（用户在选项页可改） */
const TEMPLATE_DEFAULT_TITLE = Object.freeze({
  google: 'Google',
  chatgpt: 'ChatGPT',
});

/** 各模板的内置默认 favicon（SVG data URI，不发起任何网络请求） */
function googleFavicon() {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<path fill="#4285F4" d="M58 32c0-1.6-.1-3.1-.4-4.5H32v8.6h14.6c-.6 3.4-2.6 6.3-5.4 8.2v6.8h8.7c5.1-4.7 8.1-11.6 8.1-19.1z"/>` +
    `<path fill="#34A853" d="M32 60c7.3 0 13.4-2.4 17.9-6.5l-8.7-6.8c-2.4 1.6-5.5 2.6-9.2 2.6-7.1 0-13.1-4.8-15.2-11.2H7.8v7C12.2 53.6 21.4 60 32 60z"/>` +
    `<path fill="#FBBC05" d="M16.8 38.1c-.5-1.6-.8-3.3-.8-5.1s.3-3.5.8-5.1v-7H7.8C5.7 25.4 4.5 30.2 4.5 33s1.2 7.6 3.3 12.1l9-7z"/>` +
    `<path fill="#EA4335" d="M32 11.5c4 0 7.5 1.4 10.3 4l7.7-7.7C45.4 3.5 39.2 1 32 1 21.4 1 12.2 7.4 7.8 16.9l9 7c2.1-6.4 8.1-11.2 15.2-11.2z"/>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function chatgptFavicon() {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<circle cx="32" cy="32" r="28" fill="#10a37f"/>` +
    `<path fill="#fff" d="M32 14c-7 0-12.9 4.6-14.9 10.9C11.4 26 7 31 7 37c0 6.6 5.4 12 12 12 .8 0 1.6-.1 2.4-.2C23.4 52.7 27.4 56 32 56c5 0 9.2-3.8 10.9-9.1C49 45.5 54 39.5 54 33.5 54 26.9 48.6 20 42 20c-.4 0-.8 0-1.2.1C39.4 16.4 35.9 14 32 14z"/>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const TEMPLATE_DEFAULT_ICON = Object.freeze({
  google: googleFavicon(),
  chatgpt: chatgptFavicon(),
});

/* ------------------------------- DOM 引用 ------------------------------- */

/** 根元素 */
const appEl = document.getElementById('app');
/** 提示条 */
const hintEl = document.getElementById('hint');
/** 轻提示 */
const toastEl = document.getElementById('toast');

/** 当前生效的设置（storage + URL 参数合并后的结果） */
let activeSettings = null;
/** URL 上解析出的参数（含 preview 标记） */
const urlParams = parseDisguiseUrl(window.location.href);

/* -------------------------------- 工具函数 -------------------------------- */

/**
 * HTML 转义，防止标题/URL 中的特殊字符破坏结构。
 * @param {string} value 原始字符串
 * @returns {string} 转义后的字符串
 */
function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** toast 计时器 */
let toastTimer = null;

/**
 * 显示一条轻提示。
 * @param {string} message 文案
 * @returns {void}
 */
function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('show');
  }, 2600);
}

/**
 * 设置页面 favicon（用户配置 > 模板内置默认）。
 * @param {object} settings 设置
 * @returns {void}
 */
function setFavicon(settings) {
  const tpl = settings.disguiseType in TEMPLATE_DEFAULT_ICON ? settings.disguiseType : 'google';
  const href = settings.disguiseIcon || TEMPLATE_DEFAULT_ICON[tpl];
  const old = document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]');
  old.forEach((node) => node.remove());
  const link = document.createElement('link');
  link.rel = 'icon';
  link.href = href;
  document.head.appendChild(link);
}

/* ============================ 模板：Google 首页 ============================ */

/**
 * 渲染仿 Google 中文首页。
 * 视觉要点：右上角 Gmail/图片/应用网格/头像；中央彩色 Google logo；
 * 胶囊搜索框内含 + 号 / 输入区 / 麦克风 / 镜头 / AI 模式按钮；
 * 两个圆角按钮「Google 搜索」「手气不错」；底部灰条。
 * @param {object} settings 设置
 * @returns {string} HTML
 */
function renderGoogle(settings) {
  const title = escapeHtml(settings.disguiseTitle || 'Google');

  return `
    <div class="g-page">
      <!-- 顶部导航 -->
      <header class="g-nav">
        <div class="g-nav-links">
          <a class="g-link">Gmail</a>
          <a class="g-link">图片</a>
        </div>
        <div class="g-nav-right">
          <button class="g-icon-btn" type="button" aria-label="Google 应用">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="5" cy="5" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="19" cy="5" r="2"/>
              <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
              <circle cx="5" cy="19" r="2"/><circle cx="12" cy="19" r="2"/><circle cx="19" cy="19" r="2"/>
            </svg>
          </button>
          <div class="g-avatar" aria-label="账号头像"></div>
        </div>
      </header>

      <!-- 主体 -->
      <main class="g-main">
        <div class="g-logo" aria-label="${title}">
          <span class="g-letter" style="color:#4285F4">G</span>
          <span class="g-letter" style="color:#EA4335">o</span>
          <span class="g-letter" style="color:#FBBC05">o</span>
          <span class="g-letter" style="color:#4285F4">g</span>
          <span class="g-letter" style="color:#34A853">l</span>
          <span class="g-letter" style="color:#EA4335">e</span>
        </div>

        <div class="g-search" role="search">
          <button class="g-search-plus" type="button" aria-label="更多">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>
          </button>
          <input class="g-input" type="text" aria-label="搜索" spellcheck="false" />
          <div class="g-search-right">
            <button class="g-mic" type="button" aria-label="语音搜索">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 1 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/>
              </svg>
            </button>
            <button class="g-lens" type="button" aria-label="按图片搜索">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/>
                <path d="M14 14l4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
                <circle cx="11" cy="11" r="2.5" fill="none" stroke="currentColor" stroke-width="1.4"/>
                <path d="M9 9l-1-2M14 9l1-2M11 7V5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" fill="none"/>
              </svg>
            </button>
            <button class="g-ai" type="button">
              <svg viewBox="0 0 24 24" aria-hidden="true" class="g-ai-spark">
                <path d="M12 2l1.8 4.5L18 8l-4.2 1.5L12 14l-1.8-4.5L6 8l4.2-1.5L12 2z" fill="currentColor"/>
              </svg>
              <span>AI 模式</span>
            </button>
          </div>
        </div>

        <div class="g-buttons">
          <button class="g-btn" type="button">Google 搜索</button>
          <button class="g-btn" type="button">手气不错</button>
        </div>

        <div class="g-lang">
          Google 提供：
          <a class="g-lang-link">English</a>
        </div>
      </main>

      <!-- 底部灰条 -->
      <footer class="g-foot">
        <div class="g-foot-row">
          <div class="g-foot-left">
            <a>关于 Google</a><a>广告</a><a>商务</a><a>Google 搜索的运作方式</a>
          </div>
          <div class="g-foot-right">
            <a>隐私权</a><a>条款</a><a>设置</a>
          </div>
        </div>
      </footer>
    </div>
  `;
}

/* ============================ 模板：ChatGPT 对话页 ============================ */

/**
 * 渲染仿 ChatGPT 对话页（未登录态）。
 * 视觉要点：左侧深色边框侧栏（New chat 高亮 + 几个入口 + 底部 Log in）；
 * 顶部 ChatGPT 下拉 + 右上 Log in / Sign up for free；
 * 居中 "Where should we begin?"；
 * 胶囊输入框内含 + 号 / 占位符 / 麦克风 / 灰色上箭头；
 * "What can you do?" 椭圆按钮；底部合规小字。
 * @param {object} settings 设置
 * @returns {string} HTML
 */
function renderChatgpt(settings) {
  const title = escapeHtml(settings.disguiseTitle || 'ChatGPT');

  return `
    <div class="c-page">
      <!-- 左侧栏 -->
      <aside class="c-side">
        <div class="c-side-top">
          <div class="c-brand" aria-label="${title}">
            <svg viewBox="0 0 24 24" class="c-brand-mark" aria-hidden="true">
              <path d="M22 12c0-2.4-1.4-4.5-3.5-5.5.4-2.3-.7-4.6-2.8-5.6-1.7-.8-3.7-.5-5.1.7C8.8.6 6.5.4 4.8 1.5 2.8 2.8 2 5.4 2.7 7.7.9 9.3.1 11.6.9 13.6c.5 1.4 1.6 2.5 2.9 3.2-.4 2.3.7 4.6 2.8 5.6 1.7.8 3.7.5 5.1-.7 1.8 1 4.1 1.2 5.8.1 2-1.3 2.8-3.9 2.1-6.2 1.8-1.6 2.6-3.9 1.8-5.9-.2-.7-.6-1.3-1-1.8z" fill="currentColor"/>
            </svg>
          </div>
          <button class="c-side-toggle" type="button" aria-label="收起侧栏">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 5h6v14H5zM13 5h6v14h-6z" fill="none" stroke="currentColor" stroke-width="1.4"/>
            </svg>
          </button>
        </div>

        <nav class="c-nav">
          <a class="c-nav-item c-nav-active">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.5V21h3.5L17 10.5 13.5 7 3 17.5zM20.7 6.3a1 1 0 0 0 0-1.4l-2.6-2.6a1 1 0 0 0-1.4 0L15 4l4 4 1.7-1.7z" fill="currentColor"/></svg>
            <span>New chat</span>
          </a>
          <a class="c-nav-item">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 14h-.8l-.3-.3a6.5 6.5 0 1 0-.7.7l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z" fill="currentColor"/></svg>
            <span>Search chats</span>
          </a>
          <a class="c-nav-item">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5l2.5 3 3.5-4.5L19 18H5l3.5-4.5z" fill="currentColor"/></svg>
            <span>Images</span>
          </a>
          <a class="c-nav-item">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3V4H9zm2 0h2v3h-2V4z" fill="currentColor"/></svg>
            <span>Plugins</span>
          </a>
          <a class="c-nav-item">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2L4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3zm0 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6z" fill="currentColor"/></svg>
            <span>Deep research</span>
          </a>
        </nav>

        <div class="c-side-spacer"></div>

        <nav class="c-nav c-nav-bottom">
          <a class="c-nav-item">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm.9-13h-1.8v6l5.1 3 .9-1.5-4.2-2.5V7z" fill="currentColor"/></svg>
            <span>See plans and pricing</span>
            <svg class="c-ext" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6h-2V7.4l-7.3 7.3-1.4-1.4L16.6 6H14V4zM5 6h6v2H7v10h10v-4h2v6H5V6z" fill="currentColor"/></svg>
          </a>
          <a class="c-nav-item">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.3 2.6a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1c.5.4 1.1.7 1.7 1L11 21h4l.3-2.6c.6-.3 1.2-.6 1.7-1l2.4 1 2-3.4-2-1.6zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" fill="currentColor"/></svg>
            <span>Settings</span>
          </a>
          <a class="c-nav-item">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 17h-2v-2h2v2zm2.1-7.7l-.9 1.2c-.7.9-1.2 1.6-1.2 2.7h-2v-.5c0-1.2.5-2.1 1.2-3l1.3-1.7c.3-.4.5-.8.5-1.2 0-1.1-.9-2-2-2s-2 .9-2 2H8a4 4 0 1 1 8 0c0 .9-.4 1.7-.9 2.5z" fill="currentColor"/></svg>
            <span>Help</span>
            <svg class="c-ext" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6h-2V7.4l-7.3 7.3-1.4-1.4L16.6 6H14V4zM5 6h6v2H7v10h10v-4h2v6H5V6z" fill="currentColor"/></svg>
          </a>
        </nav>

        <div class="c-promo">
          <div class="c-promo-title">Get responses tailored to you</div>
          <div class="c-promo-desc">Log in to get answers based on saved chats, plus create images and upload files.</div>
          <button class="c-login-full" type="button">Log in</button>
        </div>
      </aside>

      <!-- 右侧主区 -->
      <section class="c-main">
        <header class="c-topbar">
          <div class="c-title">
            <span>${title}</span>
            <svg viewBox="0 0 24 24" aria-hidden="true" class="c-caret"><path d="M7 10l5 5 5-5z" fill="currentColor"/></svg>
          </div>
          <div class="c-topbar-right">
            <button class="c-btn-dark" type="button">Log in</button>
            <button class="c-btn-light" type="button">Sign up for free</button>
          </div>
        </header>

        <div class="c-content">
          <h1 class="c-hello">Where should<br/>we begin?</h1>

          <div class="c-composer">
            <div class="c-composer-row">
              <button class="c-plus" type="button" aria-label="附件">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>
              </button>
              <input class="c-input" type="text" placeholder="Ask ChatGPT" />
              <button class="c-mic" type="button" aria-label="语音">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 1 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" fill="currentColor"/>
                </svg>
              </button>
              <button class="c-send" type="button" aria-label="发送">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l16-8L4 4l3 8-3 8z" fill="currentColor"/></svg>
              </button>
            </div>
          </div>

          <div class="c-suggest-wrap">
            <button class="c-suggest" type="button">What can you do?</button>
          </div>
        </div>

        <footer class="c-legal">
          ChatGPT is AI. By using it, you agree to our
          <a>Terms</a> &amp; <a>Privacy Policy</a>. Chats may be reviewed and used to improve our AI models.
          <a>Learn more</a>
        </footer>
      </section>
    </div>
  `;
}

/* --------------------------------- 渲染入口 -------------------------------- */

/**
 * 根据设置渲染整个伪装页。
 * @param {object} settings 设置
 * @returns {void}
 */
function render(settings) {
  activeSettings = settings;
  // 标题未填时按模板使用默认
  const tpl = settings.disguiseType in TEMPLATE_DEFAULT_TITLE ? settings.disguiseType : 'google';
  const finalSettings = {
    ...settings,
    disguiseTitle: settings.disguiseTitle || TEMPLATE_DEFAULT_TITLE[tpl],
  };
  document.title = finalSettings.disguiseTitle;
  setFavicon(finalSettings);

  if (tpl === 'chatgpt') {
    appEl.innerHTML = renderChatgpt(finalSettings);
  } else {
    appEl.innerHTML = renderGoogle(finalSettings);
  }

  // 提示条：预览模式与关闭状态下都不显示
  const shouldShowHint = Boolean(settings.hideToolbarHint) && !urlParams.preview;
  if (shouldShowHint) {
    updateHint();
    hintEl.hidden = false;
  } else {
    hintEl.hidden = true;
  }
}

/**
 * 更新提示条文案（展示真实的恢复快捷键）。
 * @returns {Promise<void>}
 */
async function updateHint() {
  let shortcut = 'Alt+Shift+E';
  try {
    const commands = await chrome.commands.getAll();
    const restore = commands.find((command) => command.name === 'bosskey-restore');
    if (restore && restore.shortcut) {
      shortcut = restore.shortcut;
    }
  } catch (error) {
    console.warn('[BossKey] 读取快捷键失败，使用默认文案：', error);
  }
  hintEl.textContent = `按 ${shortcut} 恢复标签页`;
}

/**
 * 合并 storage 设置与 URL 参数（URL 参数仅作兜底）。
 * @returns {Promise<object>} 生效的设置
 */
async function resolveSettings() {
  let stored = null;
  try {
    stored = await getSettings();
  } catch (error) {
    console.warn('[BossKey] 读取设置失败，仅使用 URL 参数：', error);
  }
  const merged = { ...(stored || {}), ...urlParams };
  // preview 只是 URL 上的展示标记，不属于设置字段，单独保留
  merged.preview = urlParams.preview === true;
  return merged;
}

/**
 * 伪装页入口。
 * @returns {Promise<void>}
 */
async function init() {
  const settings = await resolveSettings();
  render(settings);
}

// 设置变化时实时重渲染（例如在选项页调整伪装页外观）
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync' || !changes[SETTINGS_KEY]) {
    return;
  }
  resolveSettings()
    .then((next) => render(next))
    .catch((error) => console.error('[BossKey] 重新渲染失败：', error));
});

// 阻止输入框回车导致页面跳转
document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    if (event.target && (event.target.classList.contains('g-input') || event.target.classList.contains('c-input'))) {
      event.preventDefault();
    }
  }
});

init().catch((error) => {
  console.error('[BossKey] 伪装页初始化失败：', error);
  // 兜底：始终渲染 Google 模板，绝不显示空白
  const fallback = {
    disguiseType: 'google',
    disguiseTitle: 'Google',
    disguiseIcon: '',
    hideToolbarHint: true,
  };
  render(fallback);
});
