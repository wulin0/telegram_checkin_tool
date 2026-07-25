/**
 * Logger — 结构化日志工具（带写缓冲优化）
 * 日志存储在 chrome.storage.local 中，支持分级、分页查询
 */
const Logger = (() => {
  const MAX_LOG_ENTRIES = 500;
  const STORAGE_KEY = 'checkin_logs';

  // ─── 写缓冲区：减少 chrome.storage 写入频率 ───
  let _buffer = [];
  let _flushTimer = null;
  const FLUSH_INTERVAL = 2000;  // 最多2秒刷新一次到 storage
  const FLUSH_BATCH_SIZE = 20;  // 积攒20条时强制刷新

  async function _flush() {
    if (_flushTimer) {
      clearTimeout(_flushTimer);
      _flushTimer = null;
    }
    if (_buffer.length === 0) return;

    const pending = _buffer.splice(0);
    try {
      const stored = await chromeStorageGet(STORAGE_KEY);
      const logs = stored[STORAGE_KEY] || [];
      for (const entry of pending) {
        logs.push(entry);
      }
      while (logs.length > MAX_LOG_ENTRIES) {
        logs.shift();
      }
      await chromeStorageSet({ [STORAGE_KEY]: logs });
    } catch (e) {
      console.error('[TG-Checkin] 日志刷新失败:', e);
    }
  }

  function _scheduleFlush() {
    if (_buffer.length >= FLUSH_BATCH_SIZE) {
      _flush();
    } else if (!_flushTimer) {
      _flushTimer = setTimeout(_flush, FLUSH_INTERVAL);
    }
  }

  // 确保页面关闭前刷新缓冲
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => _flush());
  }

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

    // 控制台输出
    const prefix = `[TG-Checkin][${level.toUpperCase()}][${module}]`;
    if (data) {
      console[level === 'debug' ? 'log' : level](prefix, message, data);
    } else {
      console[level === 'debug' ? 'log' : level](prefix, message);
    }

    // 写入缓冲而非直接写 storage
    _buffer.push(entry);
    _scheduleFlush();

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
    _buffer = [];
    if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }
    await chromeStorageSet({ [STORAGE_KEY]: [] });
  }

  return { info, warn, error, debug, getLogs, clearLogs, _flush };
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
