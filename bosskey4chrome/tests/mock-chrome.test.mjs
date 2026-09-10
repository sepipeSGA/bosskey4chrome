/**
 * tests/mock-chrome.test.mjs —— BossKey 扩展行为验证（Node 环境，零依赖）
 *
 * 思路：
 *   1. 手写一个内存版 mock chrome API，挂到 globalThis.chrome；
 *   2. 用 cache-busting query 动态 import service_worker.js，让它跑顶层副作用并注册监听器；
 *   3. 通过两条真实入口驱动它：
 *        - commands.onCommand（等价于用户按快捷键，验证命令名接线）
 *        - runtime.onMessage（popup 路径，sendResponse 可 await，用于确定性断言）
 *
 * 运行：node tests/mock-chrome.test.mjs
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SW_FILE = path.join(PROJECT_ROOT, 'src', 'background', 'service_worker.js');
const SW_URL = pathToFileURL(SW_FILE).href;

const DISGUISE_PATH = 'src/disguise/disguise.html';
const EXT_BASE = 'chrome-extension://mockbosskeyextensionid';

/* ================================ 断言框架 ================================ */

const results = [];
let currentCase = null;

function assert(condition, message) {
  if (condition) {
    results.push({ case: currentCase, ok: true, message });
  } else {
    results.push({ case: currentCase, ok: false, message });
  }
}

function eq(actual, expected, message) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, `${message}（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）`);
  return ok;
}

/* ============================== mock chrome API ============================= */

function makeEvent() {
  const listeners = [];
  return {
    listeners,
    addListener(fn) {
      listeners.push(fn);
    },
    removeListener(fn) {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    hasListener(fn) {
      return listeners.includes(fn);
    },
    /** 同步派发，返回每个监听器的返回值 */
    dispatch(...args) {
      return listeners.map((fn) => fn(...args));
    },
  };
}

function makeStorageArea(store) {
  const clone = (v) => (v === undefined ? v : structuredClone(v));
  return {
    async get(keys) {
      const out = {};
      let list;
      if (keys == null) list = Object.keys(store);
      else if (Array.isArray(keys)) list = keys;
      else if (typeof keys === 'object') {
        // chrome 支持 {key: defaultValue} 形式
        for (const [k, d] of Object.entries(keys)) out[k] = k in store ? clone(store[k]) : d;
        return out;
      } else list = [keys];
      for (const k of list) if (k in store) out[k] = clone(store[k]);
      return out;
    },
    async set(obj) {
      for (const [k, v] of Object.entries(obj)) store[k] = clone(v);
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) delete store[k];
    },
    async clear() {
      for (const k of Object.keys(store)) delete store[k];
    },
    _store: store,
  };
}

/**
 * 构造一个全新的 mock chrome 环境。
 * @param {{tabs?:Array<object>, settings?:object|null, snapshot?:object|null, windowId?:number}} opts
 */
export function createMockChrome(opts = {}) {
  const windowId = opts.windowId ?? 1;
  const state = {
    windowId,
    /** 操作日志：记录每一次标签页写操作，用于验证调用次序 */
    log: [],
    badge: { text: '', color: '' },
    local: {},
    sync: {},
    // 初始标签 id 从 500 起，新建标签 id 从 9000 起：两段区间严格不重叠，
    // 避免 remove() 时误删刚创建的伪装页（否则会伪造出"窗口被清空"的假 bug）
    nextTabId: 9000,
    tabs: (opts.tabs || []).map((t, i) => ({
      id: 500 + i,
      index: i,
      windowId,
      active: false,
      pinned: false,
      groupId: -1,
      mutedInfo: { muted: false },
      favIconUrl: '',
      title: '',
      ...t,
    })),
  };
  if (opts.settings) state.sync['bosskey.settings.v1'] = opts.settings;
  if (opts.snapshot) state.local['bosskey.snapshot.v1'] = opts.snapshot;

  const chrome = {
    __state: state,
    action: {
      async setBadgeText({ text }) {
        state.badge.text = text;
        state.log.push({ op: 'badgeText', text });
      },
      async setBadgeBackgroundColor({ color }) {
        state.badge.color = color;
      },
      async setTitle() {},
    },
    tabs: {
      async query(queryInfo = {}) {
        const wid = queryInfo.windowId ?? windowId;
        return state.tabs
          .filter((t) => t.windowId === wid)
          .map((t) => structuredClone(t));
      },
      async create({ windowId: wid, url, active, pinned, index }) {
        const tab = {
          id: state.nextTabId++,
          windowId: wid ?? windowId,
          url: url || '',
          title: '',
          favIconUrl: '',
          index: index ?? state.tabs.length,
          active: Boolean(active),
          pinned: Boolean(pinned),
          groupId: -1,
          mutedInfo: { muted: false },
        };
        state.tabs.push(tab);
        state.log.push({ op: 'create', id: tab.id, url });
        return structuredClone(tab);
      },
      async remove(ids) {
        const list = (Array.isArray(ids) ? ids : [ids]).filter((id) => typeof id === 'number');
        state.log.push({ op: 'remove', ids: list.slice() });
        state.tabs = state.tabs.filter((t) => !list.includes(t.id));
      },
      async update(id, props) {
        const tab = state.tabs.find((t) => t.id === id);
        if (tab) {
          if (props.active !== undefined) tab.active = Boolean(props.active);
          if (props.pinned !== undefined) tab.pinned = Boolean(props.pinned);
          if (props.muted !== undefined) tab.mutedInfo = { muted: Boolean(props.muted) };
          if (props.url !== undefined) tab.url = props.url;
        }
        state.log.push({ op: 'update', id, props: { ...props } });
        return tab ? structuredClone(tab) : undefined;
      },
      async get(id) {
        return state.tabs.find((t) => t.id === id);
      },
    },
    windows: {
      async getCurrent() {
        return { id: windowId, focused: true };
      },
      async getLastFocused() {
        return { id: windowId, focused: true };
      },
      async get(id) {
        if (id !== windowId) throw new Error(`No window with id: ${id}`);
        return { id };
      },
    },
    storage: {
      local: makeStorageArea(state.local),
      sync: makeStorageArea(state.sync),
    },
    runtime: {
      id: 'mockbosskeyextensionid',
      getURL(p) {
        return `${EXT_BASE}/${p}`;
      },
      onInstalled: makeEvent(),
      onStartup: makeEvent(),
      onMessage: makeEvent(),
      async sendMessage() {},
      async openOptionsPage() {},
    },
    commands: {
      onCommand: makeEvent(),
      async getAll() {
        return [
          { name: 'bosskey-hide', shortcut: 'Alt+Shift+Q' },
          { name: 'bosskey-restore', shortcut: 'Alt+Shift+E' },
        ];
      },
    },
    i18n: { getMessage: () => '' },
  };

  return chrome;
}

/* ============================ 加载 service_worker ========================= */

let importSeq = 0;

/** 安装 mock 并加载一份全新的 service_worker 模块实例 */
async function loadWorker(chromeMock) {
  globalThis.chrome = chromeMock;
  // service_worker 顶层用了 self.addEventListener
  globalThis.self = globalThis.self || {
    addEventListener() {},
    removeEventListener() {},
  };
  importSeq += 1;
  await import(`${SW_URL}?case=${importSeq}`);
  // 让顶层 refreshBadge() 等副作用跑完
  await settle(20);
}

function settle(ms = 30) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 通过 runtime.onMessage 触发（可 await 完成，用于确定性断言） */
function runViaMessage(chromeMock, command) {
  return new Promise((resolve, reject) => {
    let handled = false;
    for (const fn of chromeMock.runtime.onMessage.listeners) {
      const wantsAsync = fn({ type: 'bosskey:run', command }, {}, (resp) => {
        handled = true;
        resolve(resp);
      });
      if (wantsAsync === true) break;
    }
    setTimeout(() => {
      if (!handled) reject(new Error('没有 onMessage 监听器处理 bosskey:run'));
    }, 3000);
  });
}

/** 通过 commands.onCommand 触发（等价用户按快捷键，不可 await） */
function fireCommand(chromeMock, command) {
  chromeMock.commands.onCommand.dispatch(command);
}

/* ================================= 用例 ================================= */

const NORMAL_TABS = [
  { url: 'https://example.com/a', title: 'A', active: false },
  { url: 'https://example.com/b', title: 'B', active: false },
  { url: 'https://example.com/c', title: 'C', active: true },
  { url: 'https://news.ycombinator.com/', title: 'D', active: false },
  { url: 'https://example.com/e', title: 'E', active: false },
];

async function case1_normalHide() {
  currentCase = 'C1 正常隐藏（5 个普通标签）';
  const mock = createMockChrome({ tabs: NORMAL_TABS });
  await loadWorker(mock);
  const res = await runViaMessage(mock, 'bosskey-hide');

  const st = mock.__state;
  eq(res, { ok: true }, 'hide 执行返回 ok');
  const snap = st.local['bosskey.snapshot.v1'];
  assert(Array.isArray(snap && snap.tabs), '快照已写入 chrome.storage.local');
  eq(snap.tabs.length, 5, '快照保存了 5 个标签页');
  eq(
    snap.tabs.map((t) => t.url),
    NORMAL_TABS.map((t) => t.url),
    '快照 URL 与相对顺序一致'
  );
  eq(snap.tabs.findIndex((t) => t.active), 2, '快照记录了原 active 位置(index=2)');

  const removes = st.log.filter((l) => l.op === 'remove');
  const creates = st.log.filter((l) => l.op === 'create');
  eq(removes.reduce((n, r) => n + r.ids.length, 0), 5, '5 个原标签被 remove');
  eq(creates.length, 1, '新开了 1 个伪装页');
  assert(creates[0].url.startsWith(`${EXT_BASE}/${DISGUISE_PATH}?`), '伪装页 URL 指向 disguise.html');
  assert(
    creates[0].url.includes('t=google') && creates[0].url.includes('title='),
    '伪装页 URL 携带模板与标题参数（v1.2 默认 google）'
  );
  eq(st.tabs.length, 1, '窗口最终只剩伪装页');
  eq(st.badge.text, 'H', 'badge 显示 H');
}

async function case2_createBeforeRemove() {
  currentCase = 'C2 顺序：先 create 后 remove';
  const mock = createMockChrome({ tabs: NORMAL_TABS });
  await loadWorker(mock);
  await runViaMessage(mock, 'bosskey-hide');
  const ops = mock.__state.log.filter((l) => l.op === 'create' || l.op === 'remove');
  eq(ops.map((l) => l.op), ['create', 'remove'], '操作次序为 create → remove（防止窗口被关闭）');
}

async function case3_restore() {
  currentCase = 'C3 恢复：顺序 / active / 清快照 / 清 badge';
  const mock = createMockChrome({ tabs: NORMAL_TABS });
  await loadWorker(mock);
  await runViaMessage(mock, 'bosskey-hide');
  await runViaMessage(mock, 'bosskey-restore');

  const st = mock.__state;
  eq(
    st.tabs.map((t) => t.url),
    NORMAL_TABS.map((t) => t.url),
    '5 个标签按原 URL 与相对顺序重建'
  );
  const activeTabs = st.tabs.filter((t) => t.active);
  eq(activeTabs.length, 1, '恰好一个标签处于 active');
  eq(activeTabs[0] && activeTabs[0].url, 'https://example.com/c', '原 active 页(c)被重新激活');
  assert(
    !st.tabs.some((t) => (t.url || '').includes(DISGUISE_PATH)),
    '伪装页已被关闭'
  );
  eq(st.local['bosskey.snapshot.v1'], undefined, '快照已清空');
  eq(st.badge.text, '', 'badge 已清空');
}

async function case4_restoreWithEmptySnapshot() {
  currentCase = 'C4 快照为空时 restore 不崩溃';
  const mock = createMockChrome({ tabs: NORMAL_TABS });
  await loadWorker(mock);
  let threw = null;
  try {
    const res = await runViaMessage(mock, 'bosskey-restore');
    eq(res, { ok: true }, '空快照 restore 正常返回 ok');
  } catch (e) {
    threw = e;
  }
  assert(threw === null, `未抛出异常（${threw ? threw.message : 'none'}）`);
  eq(
    mock.__state.log.filter((l) => l.op === 'create').length,
    0,
    '没有任何 create 操作'
  );
  eq(mock.__state.tabs.length, 5, '原标签页未被改动');
}

async function case5a_rehideOverwritesSnapshot() {
  currentCase = 'C5a 隐藏态下再次隐藏：快照覆盖为当前窗口标签页';
  const mock = createMockChrome({ tabs: NORMAL_TABS });
  await loadWorker(mock);
  await runViaMessage(mock, 'bosskey-hide');

  // 模拟用户隐藏后又打开了 2 个新网页（真实场景：没恢复就继续干活）
  await mock.tabs.create({ url: 'https://new.example/1', active: true });
  await mock.tabs.create({ url: 'https://new.example/2' });
  await runViaMessage(mock, 'bosskey-hide');

  const st = mock.__state;
  const snap = st.local['bosskey.snapshot.v1'];
  assert(snap !== undefined, '再次隐藏后快照仍然存在');
  eq(
    snap.tabs.map((t) => t.url),
    ['https://new.example/1', 'https://new.example/2'],
    '快照被覆盖为最新隐藏的 2 个标签页（不再是第一次的 5 个）'
  );
  const leftover = st.tabs.filter((t) => !(t.url || '').includes(DISGUISE_PATH));
  eq(leftover.length, 0, '窗口里除伪装页外没有残留');
  eq(st.badge.text, 'H', '仍处于隐藏态（badge H）');
}

async function case5b_restoreOnlyLastBatch() {
  currentCase = 'C5b 恢复只恢复最后一次隐藏的那批标签页';
  const mock = createMockChrome({ tabs: NORMAL_TABS });
  await loadWorker(mock);
  await runViaMessage(mock, 'bosskey-hide');
  await mock.tabs.create({ url: 'https://new.example/1', active: true });
  await mock.tabs.create({ url: 'https://new.example/2' });
  await runViaMessage(mock, 'bosskey-hide');
  await runViaMessage(mock, 'bosskey-restore');

  const st = mock.__state;
  eq(
    st.tabs.map((t) => t.url),
    ['https://new.example/1', 'https://new.example/2'],
    '恢复的是最后一次隐藏的 2 个标签页'
  );
  eq(st.local['bosskey.snapshot.v1'], undefined, '恢复后快照清空');
  eq(st.badge.text, '', '恢复后 badge 清空');
}

async function case6_privilegedTabs() {
  currentCase = 'C6 过滤特权页：2 普通 + 1 chrome://settings';
  const mix = [
    { url: 'https://example.com/a', title: 'A', active: true },
    { url: 'https://example.com/b', title: 'B', active: false },
    { url: 'chrome://settings', title: 'Settings', active: false },
  ];
  const mock = createMockChrome({ tabs: mix });
  await loadWorker(mock);
  await runViaMessage(mock, 'bosskey-hide');

  const st = mock.__state;
  const snap = st.local['bosskey.snapshot.v1'];
  eq(snap.tabs.length, 2, '快照只保存 2 条（chrome:// 被过滤）');
  assert(
    !snap.tabs.some((t) => t.url.startsWith('chrome://')),
    '快照中不含 chrome:// 条目'
  );
  const leftover = st.tabs.filter((t) => !(t.url || '').includes(DISGUISE_PATH));
  eq(
    leftover.map((t) => t.url),
    [],
    '除伪装页外不应残留其他标签页（chrome://settings 也必须关掉，否则伪装失效）'
  );
}

async function case7a_singleTab() {
  currentCase = 'C7a 单标签窗口';
  const mock = createMockChrome({
    tabs: [{ url: 'https://example.com/only', title: 'only', active: true }],
  });
  await loadWorker(mock);
  let threw = null;
  try {
    await runViaMessage(mock, 'bosskey-hide');
  } catch (e) {
    threw = e;
  }
  assert(threw === null, '单标签窗口 hide 不抛异常');
  const st = mock.__state;
  eq(st.local['bosskey.snapshot.v1'].tabs.length, 1, '快照 1 条');
  eq(st.tabs.length, 1, '窗口剩 1 个伪装页');
  await runViaMessage(mock, 'bosskey-restore');
  eq(st.tabs.map((t) => t.url), ['https://example.com/only'], '单标签可正常恢复');
}

async function case7b_allPrivileged() {
  currentCase = 'C7b 全部是 chrome:// 的极端窗口';
  const mock = createMockChrome({
    tabs: [
      { url: 'chrome://settings', title: 'S', active: true },
      { url: 'chrome://extensions', title: 'E', active: false },
      { url: 'chrome://version', title: 'V', active: false },
    ],
  });
  await loadWorker(mock);
  let threw = null;
  try {
    await runViaMessage(mock, 'bosskey-hide');
  } catch (e) {
    threw = e;
  }
  assert(threw === null, '全 chrome:// 窗口 hide 不抛异常');
  const st = mock.__state;
  // 修复后语义：无可恢复页时「只伪装、不落盘空隐藏态」（与 C7c 一致，避免卡死）
  eq(st.local['bosskey.snapshot.v1'], undefined, '不写入 tabs:[] 空快照');
  // 修复 P1 后的新增预期：特权页同样必须被关掉，否则伪装漏馅
  eq(
    st.tabs.filter((t) => !(t.url || '').includes(DISGUISE_PATH)).length,
    0,
    '3 个 chrome:// 特权页全部被关闭'
  );
  eq(st.tabs.length, 1, '窗口只剩 1 个伪装页');
  eq(st.badge.text, '', '无可恢复页时 badge 不亮 H（未进入隐藏态）');

  // 反复触发不应崩溃、不应意外进入隐藏态
  try {
    await runViaMessage(mock, 'bosskey-restore');
    await runViaMessage(mock, 'bosskey-hide');
    await runViaMessage(mock, 'bosskey-hide');
  } catch (e) {
    threw = e;
  }
  assert(threw === null, '极端窗口下 restore/hide/hide 均不抛异常');
  eq(mock.__state.local['bosskey.snapshot.v1'], undefined, '多轮触发后仍未写入空快照');
}

async function case7c_emptySnapshotNotPersisted() {
  currentCase = 'C7c 无可恢复页时不应写入"空隐藏态"';
  const mock = createMockChrome({
    tabs: [{ url: 'chrome://settings', title: 'S', active: true }],
  });
  await loadWorker(mock);
  await runViaMessage(mock, 'bosskey-hide');
  const snap = mock.__state.local['bosskey.snapshot.v1'];
  assert(
    snap === undefined || (Array.isArray(snap.tabs) && snap.tabs.length === 0 && false),
    '无可恢复标签时不写入快照（否则会卡在 hidden 状态，toggle/restore 都无法退出）'
  );
  // 再按一次应能退出隐藏态
  await runViaMessage(mock, 'bosskey-hide');
  eq(mock.__state.local['bosskey.snapshot.v1'], undefined, '再次触发后能退出隐藏态');
}

async function case7d_legacyEmptySnapshot() {
  currentCase = 'C7d 历史残留 tabs:[] 空快照的兼容与自愈';
  // 模拟旧版本遗留的空快照：用户被卡在 hidden 态
  const legacy = { createdAt: Date.now() - 10000, windowId: 1, tabs: [], activeIndex: 0, version: 1 };
  const mock = createMockChrome({ tabs: NORMAL_TABS, snapshot: legacy });
  await loadWorker(mock);
  let status = await (await import(
    `${pathToFileURL(path.join(PROJECT_ROOT, 'src', 'shared', 'storage.js')).href}?lg=${importSeq}`
  )).getStatus();
  eq(status.hidden, true, '前置条件：遗留空快照被判定为 hidden');

  // 路径 1：restore 应能自愈退出
  await runViaMessage(mock, 'bosskey-restore');
  eq(mock.__state.local['bosskey.snapshot.v1'], undefined, 'restore 兜底清空遗留空快照');
  eq(mock.__state.badge.text, '?', 'restore 给出软提示 badge "?"');
  eq(mock.__state.tabs.length, 5, '原 5 个标签未被误改');

  // 路径 2：hide 应清掉残留空快照后正常走隐藏流程
  const mock2 = createMockChrome({ tabs: NORMAL_TABS, snapshot: legacy });
  await loadWorker(mock2);
  await runViaMessage(mock2, 'bosskey-hide');
  const snap2 = mock2.__state.local['bosskey.snapshot.v1'];
  eq(snap2.tabs.length, 5, 'hide 清掉残留空快照后正常写入 5 条新快照（不被旧空快照误判为已隐藏）');
  eq(mock2.__state.tabs.length, 1, '窗口只剩伪装页');
  // 用 storage 状态而非 badge 文本断言"已进入隐藏态"：
  // badge 会被 flashBadge 的 1.4s 定时器异步清空，直接断言存在时序抖动风险
  const storage2 = await import(
    `${pathToFileURL(path.join(PROJECT_ROOT, 'src', 'shared', 'storage.js')).href}?lg2=${importSeq}`
  );
  eq((await storage2.getStatus()).hidden, true, '正常进入隐藏态（status.hidden=true）');
}

async function case13_groupRemoved() {
  currentCase = 'C13 标签页组已彻底移除（导出 + 设置 + 类型）';
  const mod = await import(
    `${pathToFileURL(path.join(PROJECT_ROOT, 'src', 'shared', 'storage.js')).href}?gr=${importSeq}`
  );
  eq(typeof mod.GROUP_SIZE, 'undefined', 'storage.js 不再导出 GROUP_SIZE');
  eq(typeof mod.normalizeGroupTabs, 'undefined', 'storage.js 不再导出 normalizeGroupTabs');
  eq(typeof mod.GROUP_TEMPLATES, 'undefined', 'storage.js 不再导出 GROUP_TEMPLATES');
  const s = await mod.getSettings();
  assert(!('disguiseMode' in s), '默认设置不含 disguiseMode');
  assert(!('groupTabs' in s), '默认设置不含 groupTabs');
  assert(!('embedUrl' in s), '默认设置不含 embedUrl（旧 embed 模板已删除）');
  eq(mod.DISGUISE_TYPES, ['google', 'chatgpt'], 'DISGUISE_TYPES 只剩 google/chatgpt');
}

async function case8_disguiseUrlRoundTrip() {
  currentCase = 'C8 伪装页 URL 编解码 round-trip';
  const mock = createMockChrome();
  await loadWorker(mock);
  const mod = await import(
    `${pathToFileURL(path.join(PROJECT_ROOT, 'src', 'shared', 'disguise-url.js')).href}?rt=${importSeq}`
  );

  const settings = {
    disguiseTitle: '中文标题 · 季度复盘 & 测试?a=1#frag',
    disguiseType: 'chatgpt', // embed 模板已删除，改为 chatgpt
    disguiseAccent: '#ff6600',
    disguiseIcon: 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E?x=1&y=2',
  };
  const url = mod.buildDisguiseUrl(settings);
  assert(url.startsWith(`${EXT_BASE}/${DISGUISE_PATH}?`), 'URL 以 disguise.html 为前缀');
  eq(mod.isDisguiseUrl(url), true, 'isDisguiseUrl 识别自身伪装页');
  eq(mod.isDisguiseUrl('https://example.com/'), false, 'isDisguiseUrl 拒绝外部页');
  eq(mod.isDisguiseUrl(undefined), false, 'isDisguiseUrl 容错 undefined');

  const parsed = mod.parseDisguiseUrl(url);
  eq(parsed.disguiseTitle, settings.disguiseTitle, '中文+特殊字符标题 round-trip 一致');
  eq(parsed.disguiseType, settings.disguiseType, 'disguiseType round-trip 一致（chatgpt）');
  eq(parsed.disguiseIcon, settings.disguiseIcon, 'disguiseIcon(data URI,含?&) round-trip 一致');
  assert(!('embedUrl' in parsed), 'embedUrl 已随 embed 模板删除，不再写入查询串');

  // preview 参数
  const previewUrl = mod.buildDisguiseUrl(settings, { preview: true });
  eq(mod.parseDisguiseUrl(previewUrl).preview, true, 'preview=1 可被解析');
  eq(mod.parseDisguiseUrl(mod.buildDisguiseUrl(settings)).preview, undefined, '非 preview 不携带 preview');
  eq(mod.parseDisguiseUrl('not-a-url'), {}, '非法 URL 返回空对象不抛异常');
}

async function case9_defaultSettings() {
  currentCase = 'C9 默认设置完整性与回退';
  const mock = createMockChrome(); // sync 为空
  await loadWorker(mock);
  const mod = await import(
    `${pathToFileURL(path.join(PROJECT_ROOT, 'src', 'shared', 'storage.js')).href}?ds=${importSeq}`
  );
  const required = [
    'disguiseTitle',
    'disguiseIcon',
    'disguiseType',
    'hideToolbarHint',
    'restorePinned',
  ];
  for (const key of required) {
    assert(Object.prototype.hasOwnProperty.call(mod.DEFAULT_SETTINGS, key), `DEFAULT_SETTINGS 含字段 ${key}`);
  }
  eq(mod.SETTINGS_KEY, 'bosskey.settings.v1', 'SETTINGS_KEY 正确');
  eq(mod.SNAPSHOT_KEY, 'bosskey.snapshot.v1', 'SNAPSHOT_KEY 正确');

  const s = await mod.getSettings();
  eq(Object.keys(s).sort(), required.slice().sort(), 'sync 为空时返回完整默认值');
  eq(s.disguiseType, 'google', '默认模板为 google（v1.2 默认伪装页）');
  eq(s.disguiseTitle, 'Google', '默认标题为 Google');
  eq(s.restorePinned, true, '默认 restorePinned=true');
  eq(s.hideToolbarHint, true, '默认 hideToolbarHint=true');
  // 已移除的字段不应再出现
  assert(!('toggleOnHide' in s), '设置中已移除 toggleOnHide');
  assert(!('disguiseMode' in s), '设置中已移除 disguiseMode（标签页组整体删除）');
  assert(!('groupTabs' in s), '设置中已移除 groupTabs');
  assert(!('embedUrl' in s), '设置中已移除 embedUrl（embed 模板整体删除）');
  eq(await mod.getSnapshot(), null, '无快照时 getSnapshot 返回 null');
  eq(await mod.getStatus(), { hidden: false, count: 0, createdAt: 0 }, '无快照时状态为未隐藏');

  // 增量保存
  const merged = await mod.saveSettings({ disguiseType: 'chatgpt' });
  eq(merged.disguiseType, 'chatgpt', 'saveSettings 增量生效（可切到 ChatGPT 模板）');
  eq(merged.disguiseTitle, mod.DEFAULT_SETTINGS.disguiseTitle, 'saveSettings 保留其他默认值');
  eq((await mod.getStatus()).hidden, false, '仍为未隐藏');
}

async function case10_commandWiring() {
  currentCase = 'C10 快捷键命令名接线（commands.onCommand）';
  const mock = createMockChrome({ tabs: NORMAL_TABS });
  await loadWorker(mock);
  eq(mock.commands.onCommand.listeners.length, 1, 'service_worker 注册了 1 个 onCommand 监听器');

  fireCommand(mock, 'bosskey-hide');
  await settle(60);
  eq(mock.__state.tabs.length, 1, 'bosskey-hide 生效：窗口只剩伪装页');
  eq(mock.__state.local['bosskey.snapshot.v1'].tabs.length, 5, 'bosskey-hide 写入 5 条快照');

  fireCommand(mock, 'bosskey-restore');
  await settle(60);
  eq(mock.__state.tabs.length, 5, 'bosskey-restore 生效：5 个标签恢复');

  // 未知命令不应有副作用
  fireCommand(mock, 'bosskey-nope');
  await settle(30);
  eq(mock.__state.tabs.length, 5, '未知命令被忽略');
}

/* ================================= 执行 ================================= */

const CASES = [
  case1_normalHide,
  case2_createBeforeRemove,
  case3_restore,
  case4_restoreWithEmptySnapshot,
  case5a_rehideOverwritesSnapshot,
  case5b_restoreOnlyLastBatch,
  case6_privilegedTabs,
  case7a_singleTab,
  case7b_allPrivileged,
  case7c_emptySnapshotNotPersisted,
  case7d_legacyEmptySnapshot,
  case8_disguiseUrlRoundTrip,
  case9_defaultSettings,
  case10_commandWiring,
  case13_groupRemoved,
];

const caseSummary = [];
for (const fn of CASES) {
  const before = results.length;
  try {
    await fn();
  } catch (error) {
    assert(false, `用例抛出异常：${error && error.stack ? error.stack.split('\n')[0] : error}`);
  }
  const items = results.slice(before);
  const name = items.length ? items[0].case : fn.name;
  const passed = items.every((i) => i.ok);
  caseSummary.push({ name, passed, items });
}

console.log('\n==================== BossKey 行为验证结果 ====================\n');
for (const c of caseSummary) {
  const flag = c.passed ? 'PASS' : 'FAIL';
  console.log(`[${flag}] ${c.name}`);
  for (const i of c.items) {
    console.log(`        ${i.ok ? '✓' : '✗'} ${i.message}`);
  }
}

const total = results.length;
const failed = results.filter((r) => !r.ok).length;
console.log('\n--------------------------------------------------------------');
console.log(`用例: ${caseSummary.length} | 断言: ${total} | 通过: ${total - failed} | 失败: ${failed}`);
console.log('--------------------------------------------------------------\n');
process.exit(failed > 0 ? 1 : 0);
