/**
 * Background Service Worker — 后台大脑
 *
 * 职责：
 * 1. chrome.alarms 事件处理
 * 2. 任务调度与派发
 * 3. 浏览器通知
 * 4. 消息中转
 */

// 导入全局变量（content script 中已有，SW 中也需要 Logger 和 Storage 的独立实现）

// ─── Service Worker 中的精简 Logger ───
const SWLogger = {
  _log(level, module, message, data) {
    const prefix = `[TG-Checkin][${level}][${module}]`;
    if (data) console[level](prefix, message, data);
    else console[level](prefix, message);

    // 存入 chrome.storage
    const entry = {
      id: Date.now() + Math.random().toString(36).slice(2, 6),
      timestamp: new Date().toISOString(),
      level, module, message, data
    };
    chrome.storage.local.get('checkin_logs', (result) => {
      const logs = result.checkin_logs || [];
      logs.push(entry);
      while (logs.length > 500) logs.shift();
      chrome.storage.local.set({ checkin_logs: logs });
    });
  },
  info(m, msg, d) { this._log('info', m, msg, d); },
  warn(m, msg, d) { this._log('warn', m, msg, d); },
  error(m, msg, d) { this._log('error', m, msg, d); },
  debug(m, msg, d) { this._log('debug', m, msg, d); },
};

// ─── Alarm 事件处理 ───

chrome.alarms.onAlarm.addListener(async (alarm) => {
  SWLogger.info('Background', `闹钟触发: ${alarm.name}`);

  if (alarm.name === 'tg_checkin_daily') {
    SWLogger.info('Background', '===== 每日签到闹钟触发 =====');
    await handleDailyCheckin();
  }

  if (alarm.name === 'tg_checkin_health') {
    SWLogger.debug('Background', '健康检查闹钟触发');
    await handleHealthCheck();
  }

  if (alarm.name === 'tg_water_chat') {
    SWLogger.info('Background', '===== 水群闹钟触发 =====');
    await handleWaterChat();
  }
});

// ─── 每日签到处理 ───

async function handleDailyCheckin() {
  const settings = await getSettings();
  if (!settings.enabled) {
    SWLogger.info('Background', '签到已禁用，跳过');
    return;
  }

  SWLogger.info('Background', '开始派发签到任务');
  await dispatchCheckinToTab();

  // 重新设置明天的闹钟（带新的随机抖动）
  setupDailyAlarm(settings);
}

// ─── 健康检查处理 ───

async function handleHealthCheck() {
  const settings = await getSettings();
  if (!settings.enabled) return;

  // 检查主闹钟是否还存在
  chrome.alarms.get('tg_checkin_daily', (alarm) => {
    if (!alarm) {
      SWLogger.warn('Background', '主闹钟丢失，重新创建');
      setupDailyAlarm(settings);
    }
  });
}

// ─── 设置每日闹钟 ───

function setupDailyAlarm(settings) {
  // 计算带随机抖动的明天时间
  const [h, m] = settings.baseTime.split(':').map(Number);
  const jitterMinutes = settings.timeJitterMinutes || 20;
  const jitterMs = (Math.random() * 2 - 1) * jitterMinutes * 60000; // [-jitter, +jitter]

  const now = new Date();
  const target = new Date();
  target.setHours(h, m, 0, 0);
  target.setTime(target.getTime() + jitterMs);

  // 如果已过今天的时间，设到明天
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }

  chrome.alarms.clear('tg_checkin_daily', () => {
    chrome.alarms.create('tg_checkin_daily', {
      when: target.getTime(),
      periodInMinutes: 24 * 60,
    });

    SWLogger.info('Background', `下次签到闹钟: ${target.toLocaleString('zh-CN')}`);

    // 更新状态
    chrome.storage.local.set({
      checkin_state: {
        lastAlarmTime: now.toISOString(),
        nextAlarmTime: target.toISOString(),
      }
    });
  });

  // 健康检查闹钟
  chrome.alarms.create('tg_checkin_health', {
    periodInMinutes: 15,
  });
}

// ══════════════════════════════════════
// ─── 水群模块 ───
// ══════════════════════════════════════

/** 读取水群运行时状态（含每日计数） */
function getWaterState() {
  return new Promise((resolve) => {
    chrome.storage.local.get('water_state', (r) => {
      const s = r.water_state || {};
      const today = new Date().toDateString();
      if (s.todayDate !== today) {
        s.todayDate = today;
        s.todayCount = 0;
        s.everSentToday = false;
      }
      resolve(s);
    });
  });
}

async function handleWaterChat() {
  const waterSettings = await getWaterSettings();
  if (!waterSettings.enabled) {
    SWLogger.info('Background', '水群已禁用，跳过');
    return;
  }

  // ── 防御1: 每日发送上限 ──
  const today = new Date().toDateString();
  const todayState = await getWaterState();
  const todayCount = todayState.todayDate === today ? (todayState.todayCount || 0) : 0;
  const maxDaily = waterSettings.maxDaily || 50;
  if (todayCount >= maxDaily) {
    SWLogger.info('Background', `水群: 今日已发送 ${todayCount} 条，达到上限 ${maxDaily}，跳过`);
    scheduleNextWaterChat(waterSettings);
    return;
  }

  // ── 防御2: 活跃时段检查 ──
  if (!isWithinActiveHours(waterSettings)) {
    SWLogger.info('Background', '水群: 当前不在活跃时段，跳过');
    scheduleNextWaterChat(waterSettings);
    return;
  }

  SWLogger.info('Background', '开始派发水群任务');
  await dispatchWaterChatToTab();
  scheduleNextWaterChat(waterSettings);
}

function isWithinActiveHours(waterSettings) {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [startH, startM] = (waterSettings.activeHoursStart || '08:00').split(':').map(Number);
  const [endH, endM] = (waterSettings.activeHoursEnd || '23:00').split(':').map(Number);
  const startMin = startH * 60 + startM;
  const endMin = endH * 60 + endM;
  return currentMinutes >= startMin && currentMinutes <= endMin;
}

function scheduleNextWaterChat(waterSettings) {
  const intervalMin = waterSettings.intervalMin || 30;
  const intervalMax = waterSettings.intervalMax || 60;

  // ── 防御3: 首次启用时强制等待间隔，避免立即触发 ──
  const minDelay = intervalMin;
  const range = intervalMax - minDelay;
  const delayMs = (Math.random() * range + minDelay) * 60000;
  const nextTime = Date.now() + delayMs;

  chrome.alarms.clear('tg_water_chat', () => {
    chrome.alarms.create('tg_water_chat', { when: nextTime });
    const waitMin = Math.round(delayMs / 60000);
    SWLogger.info('Background', `下次水群: ${new Date(nextTime).toLocaleString('zh-CN')} (${waitMin}分钟后)`);

    // 更新下次执行时间到状态
    chrome.storage.local.get('water_state', (r) => {
      const current = r.water_state || {};
      chrome.storage.local.set({
        water_state: { ...current, nextRunTime: new Date(nextTime).toISOString() }
      });
    });
  });
}

async function dispatchWaterChatToTab() {
  try {
    const tabs = await chrome.tabs.query({
      url: 'https://web.telegram.org/a/*'
    });

    if (tabs.length > 0) {
      const tab = tabs[0];
      SWLogger.info('Background', `向标签页 #${tab.id} 发送水群指令`);
      await chrome.tabs.sendMessage(tab.id, { action: 'runWaterChat' });
    } else {
      SWLogger.info('Background', '水群: 未找到 Telegram 标签页');
    }
  } catch (err) {
    SWLogger.error('Background', '水群派发失败', err.message);
  }
}

function getWaterSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get('water_settings', (result) => {
      const defaults = {
        enabled: false,
        intervalMin: 30,
        intervalMax: 60,
        maxDaily: 50,
        messages: [],
        targetGroups: [],
        activeHoursStart: '08:00',
        activeHoursEnd: '23:00',
        stopOnVerification: true,
      };
      resolve({ ...defaults, ...result.water_settings });
    });
  });
}

// ─── 派发签到到标签页 ───

async function dispatchCheckinToTab() {
  try {
    // 查找 Telegram 标签页
    const tabs = await chrome.tabs.query({
      url: 'https://web.telegram.org/a/*'
    });

    if (tabs.length > 0) {
      // 优先使用已打开的标签页
      const tab = tabs[0];
      SWLogger.info('Background', `向标签页 #${tab.id} 发送签到指令`);
      await chrome.tabs.sendMessage(tab.id, { action: 'runCheckin' });
    } else {
      // 打开新标签页
      SWLogger.info('Background', '未找到 Telegram 标签页，创建新标签页');
      const newTab = await chrome.tabs.create({
        url: 'https://web.telegram.org/a/',
      });

      // 等待加载完成后发送指令
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === newTab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(async () => {
            try {
              await chrome.tabs.sendMessage(newTab.id, { action: 'runCheckin' });
            } catch (e) {
              SWLogger.error('Background', '向新标签页发送签到指令失败', e.message);
            }
          }, 5000);
        }
      });
    }
  } catch (err) {
    SWLogger.error('Background', '派发签到任务失败', err.message);
  }
}

// ─── 获取设置 ───

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get('checkin_settings', (result) => {
      const defaults = {
        enabled: false,
        baseTime: '08:00',
        timeJitterMinutes: 20,
        actionDelayMin: 800,
        actionDelayMax: 3000,
        typingSpeedMin: 50,
        typingSpeedMax: 150,
        retryCount: 2,
        retryDelay: 60000,
        checkAlreadySigned: true,
        stopOnVerification: true,
        notificationEnabled: true,
      };
      resolve({ ...defaults, ...result.checkin_settings });
    });
  });
}

// ─── 消息监听 ───

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Content Script 通知需要发送桌面通知
  if (msg.action === 'send_notification') {
    if (chrome.notifications) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: msg.title || 'Telegram 签到助手',
        message: msg.message || '',
        priority: 2,
      });
    }
    sendResponse({ ok: true });
    return;
  }

  // Content Script 报告需要登录
  if (msg.action === 'login_required') {
    SWLogger.warn('Background', 'Content Script 报告需要登录');
    // 可以在这里实现更复杂的处理逻辑
    sendResponse({ ok: true });
    return;
  }

  // Popup 请求重新设置闹钟
  if (msg.action === 'reset_alarm') {
    getSettings().then(settings => {
      setupDailyAlarm(settings);
      sendResponse({ ok: true });
    });
    return true;
  }

  // Popup 请求获取状态
  if (msg.action === 'get_status') {
    chrome.alarms.get('tg_checkin_daily', (alarm) => {
      chrome.storage.local.get(['checkin_state', 'checkin_settings'], (result) => {
        sendResponse({
          alarm: alarm ? { scheduledTime: alarm.scheduledTime } : null,
          state: result.checkin_state || {},
          settings: result.checkin_settings || {},
        });
      });
    });
    return true;
  }

  // 手动触发签到
  if (msg.action === 'manual_checkin') {
    SWLogger.info('Background', '手动触发签到');
    dispatchCheckinToTab()
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // ── 水群消息 ──

  // Popup 请求开启/关闭水群
  if (msg.action === 'toggle_water_chat') {
    getWaterSettings().then(ws => {
      if (ws.enabled) {
        scheduleNextWaterChat(ws);
        sendResponse({ ok: true });
      } else {
        chrome.alarms.clear('tg_water_chat', () => {
          sendResponse({ ok: true });
        });
      }
    });
    return true;
  }

  // Content Script 报告水群完成
  if (msg.action === 'water_chat_complete') {
    SWLogger.info('Background', `水群任务完成`, msg.results);

    // ── 更新每日发送计数 ──
    chrome.storage.local.get('water_state', (r) => {
      const ws = r.water_state || {};
      const today = new Date().toDateString();
      if (ws.todayDate !== today) {
        ws.todayDate = today;
        ws.todayCount = 0;
      }
      ws.todayCount = (ws.todayCount || 0) + 1;
      ws.everSentToday = true;
      ws.lastSentAt = new Date().toISOString();
      chrome.storage.local.set({ water_state: ws });
    });

    sendResponse({ ok: true });
    return;
  }

  // Popup 请求获取水群状态
  if (msg.action === 'get_water_status') {
    chrome.alarms.get('tg_water_chat', (alarm) => {
      chrome.storage.local.get(['water_state', 'water_settings'], (result) => {
        sendResponse({
          alarm: alarm ? { scheduledTime: alarm.scheduledTime } : null,
          state: result.water_state || {},
          settings: result.water_settings || {},
        });
      });
    });
    return true;
  }

  // Popup 请求手动触发一次水群
  if (msg.action === 'manual_water_chat') {
    SWLogger.info('Background', '手动触发单次水群');
    dispatchWaterChatToTab()
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

// ─── 安装/更新事件 ───

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    SWLogger.info('Background', '扩展首次安装');

    // 设置默认闹钟（但默认不启用，等用户配置后启用）
    getSettings().then(settings => {
      if (settings.enabled) {
        setupDailyAlarm(settings);
      }
    });
  } else if (details.reason === 'update') {
    SWLogger.info('Background', `扩展更新: ${details.previousVersion} → ${chrome.runtime.getManifest().version}`);
    // 重新设置闹钟
    getSettings().then(settings => {
      if (settings.enabled) {
        setupDailyAlarm(settings);
      }
    });
    // 恢复水群闹钟
    getWaterSettings().then(ws => {
      if (ws.enabled) {
        scheduleNextWaterChat(ws);
      }
    });
  }
});

// ─── 启动事件 ───

chrome.runtime.onStartup.addListener(() => {
  SWLogger.info('Background', '浏览器启动，检查签到状态');
  getSettings().then(settings => {
    if (settings.enabled) {
      // 恢复闹钟
      chrome.alarms.get('tg_checkin_daily', (alarm) => {
        if (!alarm) {
          SWLogger.info('Background', '闹钟丢失，重新创建');
          setupDailyAlarm(settings);
        }
      });

      // 检查是否有遗漏的签到
      // 延迟30秒后执行，等待浏览器和标签页完全就绪
      setTimeout(() => {
        dispatchCheckinToTab();
      }, 30000);
    }

    // 恢复水群闹钟
    getWaterSettings().then(ws => {
      if (ws.enabled) {
        scheduleNextWaterChat(ws);
      }
    });
  });
});

SWLogger.info('Background', 'Service Worker 已启动');
