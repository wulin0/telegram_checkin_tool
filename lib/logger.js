/**
 * Logger — 结构化日志工具
 * 日志存储在 chrome.storage.local 中，支持分级、分页查询
 */
const Logger = (() => {
  const MAX_LOG_ENTRIES = 500;
  const STORAGE_KEY = 'checkin_logs';

  /**
   * @param {'info'|'warn'|'error'|'debug'} level
   * @param {string} module - 模块名
   * @param {string} message
   * @param {object} [data]
   */
  async function log(level, module, message, data = null) {
    const entry = {
      id: Date.now() + Math.random().toString(36).slice(2, 6),
      timestamp: new Date().toISOString(),
      level,
      module,
      message,
      data
    };

    // 控制台输出（开发阶段）
    const prefix = `[TG-Checkin][${level.toUpperCase()}][${module}]`;
    if (data) {
      console[level === 'debug' ? 'log' : level](prefix, message, data);
    } else {
      console[level === 'debug' ? 'log' : level](prefix, message);
    }

    try {
      const stored = await chromeStorageGet(STORAGE_KEY);
      const logs = stored[STORAGE_KEY] || [];
      logs.push(entry);
      // 保留最近 MAX_LOG_ENTRIES 条
      while (logs.length > MAX_LOG_ENTRIES) {
        logs.shift();
      }
      await chromeStorageSet({ [STORAGE_KEY]: logs });
    } catch (e) {
      console.error('[TG-Checkin] 日志写入失败:', e);
    }

    return entry;
  }

  function info(module, message, data) { return log('info', module, message, data); }
  function warn(module, message, data) { return log('warn', module, message, data); }
  function error(module, message, data) { return log('error', module, message, data); }
  function debug(module, message, data) { return log('debug', module, message, data); }

  /**
   * 获取日志
   * @param {object} [filter]
   * @param {string} [filter.level]
   * @param {string} [filter.module]
   * @param {number} [filter.limit=100]
   * @param {number} [filter.since] - ISO timestamp
   */
  async function getLogs(filter = {}) {
    const stored = await chromeStorageGet(STORAGE_KEY);
    let logs = stored[STORAGE_KEY] || [];

    if (filter.level) {
      logs = logs.filter(l => l.level === filter.level);
    }
    if (filter.module) {
      logs = logs.filter(l => l.module === filter.module);
    }
    if (filter.since) {
      logs = logs.filter(l => l.timestamp >= filter.since);
    }

    // 最新在前
    logs.reverse();
    if (filter.limit) {
      logs = logs.slice(0, filter.limit);
    }

    return logs;
  }

  /** 清空日志 */
  async function clearLogs() {
    await chromeStorageSet({ [STORAGE_KEY]: [] });
  }

  return { info, warn, error, debug, getLogs, clearLogs };
})();

// 兼容 content script 和 service worker 中不同的 chrome.storage API
function chromeStorageGet(key) {
  return new Promise((resolve) => {
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(key, resolve);
    } else {
      resolve({});
    }
  });
}

function chromeStorageSet(items) {
  return new Promise((resolve) => {
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set(items, resolve);
    } else {
      resolve();
    }
  });
}
