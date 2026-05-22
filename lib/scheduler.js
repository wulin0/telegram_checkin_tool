/**
 * Scheduler — 任务调度器
 *
 * 使用 chrome.alarms API 进行非精确周期性调度。
 * 即使浏览器重启或休眠唤醒后也能被唤起并检查遗漏任务。
 */

// ⚠️ 此文件在两种上下文中运行：
// 1. Service Worker (background.js) — 处理 alarm 事件
// 2. Content Script  — 不处理 alarm，只提供辅助函数

const Scheduler = (() => {
  const ALARM_NAME = 'tg_checkin_daily';
  const ALARM_CHECK_NAME = 'tg_checkin_health';
  const HEARTBEAT_MINUTES = 15; // 每15分钟健康检查

  // ─── Alarm 管理（仅在 Service Worker 中有效）───

  /**
   * 创建每日签到闹钟
   * @param {object} settings - { baseTime, timeJitterMinutes, enabled }
   */
  function createDailyAlarm(settings) {
    if (typeof chrome?.alarms === 'undefined') {
      // 不在 Service Worker 上下文中
      Logger.warn('Scheduler', 'chrome.alarms 不可用，不在 SW 上下文中');
      return { success: false, reason: 'no-alarms-api' };
    }

    if (!settings.enabled) {
      Logger.info('Scheduler', '签到已禁用，不创建闹钟');
      return { success: false, reason: 'disabled' };
    }

    // 先清除已有闹钟
    chrome.alarms.clear(ALARM_NAME);
    chrome.alarms.clear(ALARM_CHECK_NAME);

    // 计算下次触发时间（带随机抖动）
    const jittered = AntiDetect.jitterTime(
      settings.baseTime,
      settings.timeJitterMinutes
    );

    const now = new Date();
    const next = new Date();

    // 如果计算出的时间已经过了今天，设置到明天
    next.setHours(jittered.hour, jittered.minute, 0, 0);
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }

    const delayMs = next.getTime() - now.getTime();
    const delayMin = Math.ceil(delayMs / 60000);

    Logger.info('Scheduler', `下次签到时间: ${next.toLocaleString('zh-CN')}`, {
      jitterHour: jittered.hour,
      jitterMin: jittered.minute,
      delayMinutes: delayMin
    });

    // 如果能精准设置 alarm，使用 when
    chrome.alarms.create(ALARM_NAME, {
      when: next.getTime(),
      periodInMinutes: 24 * 60 // 每天一次
    });

    // 健康检查闹钟（确保即使主闹钟丢失也能触发）
    chrome.alarms.create(ALARM_CHECK_NAME, {
      when: Date.now() + HEARTBEAT_MINUTES * 60000,
      periodInMinutes: HEARTBEAT_MINUTES
    });

    Storage.updateState({
      lastAlarmTime: now.toISOString(),
      nextAlarmTime: next.toISOString(),
    });

    // 通知 popup 刷新
    notifyPopup('alarm_created', { nextTime: next.toISOString() });

    return { success: true, nextTime: next.toISOString(), delayMinutes: delayMin };
  }

  /**
   * 取消所有闹钟
   */
  function cancelAllAlarms() {
    if (typeof chrome?.alarms !== 'undefined') {
      chrome.alarms.clear(ALARM_NAME);
      chrome.alarms.clear(ALARM_CHECK_NAME);
      Logger.info('Scheduler', '已取消所有签到闹钟');
    }
  }

  // ─── 与 Content Script 通信 ───

  /**
   * 向活动标签页发送签到指令
   */
  async function dispatchCheckinTask() {
    Logger.info('Scheduler', '开始派发签到任务');

    try {
      const [tab] = await chrome.tabs.query({
        url: 'https://web.telegram.org/a/*',
        active: true
      });

      if (!tab) {
        // 查找是否有已打开的 Telegram 标签页（不限于 active）
        const tabs = await chrome.tabs.query({
          url: 'https://web.telegram.org/a/*'
        });

        if (tabs.length > 0) {
          // 激活第一个找到的标签页
          await chrome.tabs.update(tabs[0].id, { active: true });
          await AntiDetect.sleep(2000); // 等待标签页激活
          await chrome.tabs.sendMessage(tabs[0].id, {
            action: 'runCheckin'
          });
        } else {
          // 没有打开的 Telegram 标签页，记录并跳过
          Logger.warn('Scheduler', '未找到 Telegram 标签页，创建新标签页');

          // 打开新的 Telegram 标签页
          const newTab = await chrome.tabs.create({
            url: 'https://web.telegram.org/a/',
            active: true
          });

          // 等待页面加载后再执行签到
          // 监听新标签页的加载完成
          chrome.tabs.onUpdated.addListener(function waitForLoad(tabId, info) {
            if (tabId === newTab.id && info.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(waitForLoad);
              setTimeout(() => {
                chrome.tabs.sendMessage(newTab.id, { action: 'runCheckin' });
              }, 5000); // 等待 content script 加载
            }
          });

          return { success: true, action: 'opened_new_tab' };
        }
      } else {
        await chrome.tabs.sendMessage(tab.id, { action: 'runCheckin' });
      }

      await Storage.updateState({ isRunning: false, currentTask: null });
      return { success: true, action: 'dispatched' };
    } catch (err) {
      Logger.error('Scheduler', '派发签到任务失败', err.message);
      await Storage.updateState({ isRunning: false, currentTask: null });
      return { success: false, error: err.message };
    }
  }

  // ─── 健康检查 ───

  /**
   * 检查是否有遗漏的签到任务
   * 在健康检查闹钟触发时调用
   */
  async function healthCheck() {
    const settings = await Storage.getSettings();
    if (!settings.enabled) return;

    const state = await Storage.getState();
    const groups = await Storage.getGroups();
    const enabledGroups = groups.filter(g => g.enabled && g.status !== 'error');

    if (enabledGroups.length === 0) {
      Logger.debug('Scheduler', '健康检查：无待签到群组');
      return;
    }

    // 检查今天是否已经有签到记录
    const today = new Date().toISOString().slice(0, 10);
    const todayCheckins = enabledGroups.filter(g => {
      return g.lastCheckin && g.lastCheckin.startsWith(today);
    });

    const uncheckedCount = enabledGroups.length - todayCheckins.length;

    if (uncheckedCount > 0) {
      Logger.info('Scheduler', `健康检查: ${uncheckedCount}/${enabledGroups.length} 个群组今日未签到`);

      // 检查当前时间是否在基准时间 + 抖动之后
      const now = new Date();
      const [h, m] = settings.baseTime.split(':').map(Number);
      const targetMin = h * 60 + m - settings.timeJitterMinutes; // 最早可能的时间

      if (now.getHours() * 60 + now.getMinutes() >= targetMin) {
        Logger.info('Scheduler', '健康检查触发补签');
        await dispatchCheckinTask();
      }
    }
  }

  // ─── Popup 通知 ───

  function notifyPopup(event, data = {}) {
    chrome.runtime.sendMessage({
      action: 'scheduler_event',
      event,
      data,
    }).catch(() => {
      // Popup 可能未打开，忽略错误
    });
  }

  return {
    createDailyAlarm,
    cancelAllAlarms,
    dispatchCheckinTask,
    healthCheck,
    ALARM_NAME,
    ALARM_CHECK_NAME,
    HEARTBEAT_MINUTES,
  };
})();