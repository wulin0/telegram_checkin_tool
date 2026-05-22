/**
 * Storage — chrome.storage.local 封装
 * 管理群组配置、签到历史和全局设置
 */
const Storage = (() => {
  const KEYS = {
    GROUPS: 'checkin_groups',        // 群组列表
    HISTORY: 'checkin_history',      // 签到历史
    SETTINGS: 'checkin_settings',    // 全局设置
    STATE: 'checkin_state',          // 运行时状态
  };

  // ─── 默认设置 ───
  const DEFAULT_SETTINGS = {
    enabled: false,                   // 全局开关
    baseTime: '08:00',               // 基准签到时间
    timeJitterMinutes: 20,           // 时间抖动范围（分钟）
    actionDelayMin: 800,             // 操作间最短延迟 ms
    actionDelayMax: 3000,            // 操作间最长延迟 ms
    typingSpeedMin: 50,              // 打字速度 ms/字符（最小）
    typingSpeedMax: 150,             // 打字速度 ms/字符（最大）
    retryCount: 2,                   // 失败重试次数
    retryDelay: 60000,               // 重试间隔 ms
    checkAlreadySigned: true,        // 智能判断是否已签到
    stopOnVerification: true,        // 遇到验证码停止
    notificationEnabled: true,       // 桌面通知
  };

  // ─── 通用读写 ───
  async function get(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get(key, (result) => {
        resolve(result[key]);
      });
    });
  }

  async function set(key, value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, resolve);
    });
  }

  // ─── 群组管理 ───

  /**
   * 获取所有群组
   * @returns {Array<{id: string, name: string, keyword: string, enabled: boolean, lastCheckin: string|null, status: 'normal'|'error'|'disabled'}>}
   */
  async function getGroups() {
    const groups = await get(KEYS.GROUPS);
    return groups || [];
  }

  async function setGroups(groups) {
    await set(KEYS.GROUPS, groups);
  }

  /** 添加单个群组 */
  async function addGroup(name, keyword) {
    const groups = await getGroups();
    // 去重：同名+同关键词视为重复
    const exists = groups.some(g => g.name === name && g.keyword === keyword);
    if (exists) {
      return { success: false, message: '该群组已存在' };
    }
    const group = {
      id: 'grp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      name,
      keyword,
      enabled: true,
      lastCheckin: null,
      lastResult: null,
      status: 'normal',
      createdAt: new Date().toISOString()
    };
    groups.push(group);
    await setGroups(groups);
    return { success: true, group };
  }

  /** 批量添加（相同关键词的多个群组） */
  async function addGroupsBatch(names, keyword) {
    const groups = await getGroups();
    const added = [];
    const skipped = [];

    for (const name of names) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      const exists = groups.some(g => g.name === trimmed && g.keyword === keyword);
      if (exists) {
        skipped.push(trimmed);
        continue;
      }
      const group = {
        id: 'grp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        name: trimmed,
        keyword,
        enabled: true,
        lastCheckin: null,
        lastResult: null,
        status: 'normal',
        createdAt: new Date().toISOString()
      };
      groups.push(group);
      added.push(group);
    }

    await setGroups(groups);
    return { added, skipped };
  }

  /** 删除群组 */
  async function removeGroup(id) {
    const groups = await getGroups();
    const filtered = groups.filter(g => g.id !== id);
    await setGroups(filtered);
  }

  /** 更新群组 */
  async function updateGroup(id, updates) {
    const groups = await getGroups();
    const idx = groups.findIndex(g => g.id === id);
    if (idx === -1) return null;
    groups[idx] = { ...groups[idx], ...updates };
    await setGroups(groups);
    return groups[idx];
  }

  /** 更新签到结果 */
  async function updateCheckinResult(id, result) {
    const groups = await getGroups();
    const idx = groups.findIndex(g => g.id === id);
    if (idx === -1) return;
    groups[idx].lastCheckin = new Date().toISOString();
    groups[idx].lastResult = result;
    if (result.success) {
      groups[idx].status = 'normal';
    } else if (result.reason === 'verification') {
      groups[idx].status = 'error';
    }
    await setGroups(groups);

    // 同时记录历史
    const history = await get(KEYS.HISTORY) || [];
    history.push({
      groupId: id,
      groupName: groups[idx].name,
      keyword: groups[idx].keyword,
      timestamp: new Date().toISOString(),
      result
    });
    // 只保留最近 1000 条历史
    while (history.length > 1000) history.shift();
    await set(KEYS.HISTORY, history);
  }

  // ─── 设置管理 ───

  async function getSettings() {
    const settings = await get(KEYS.SETTINGS);
    return { ...DEFAULT_SETTINGS, ...settings };
  }

  async function updateSettings(updates) {
    const current = await getSettings();
    const merged = { ...current, ...updates };
    await set(KEYS.SETTINGS, merged);
    return merged;
  }

  // ─── 运行时状态 ───

  async function getState() {
    const state = await get(KEYS.STATE);
    return state || {
      isRunning: false,
      currentTask: null,
      loginStatus: 'unknown',
      lastAlarmTime: null,
      nextAlarmTime: null,
    };
  }

  async function updateState(updates) {
    const current = await getState();
    const merged = { ...current, ...updates };
    await set(KEYS.STATE, merged);
    return merged;
  }

  // ─── 历史记录 ───

  async function getHistory(limit = 100) {
    const history = await get(KEYS.HISTORY) || [];
    return history.reverse().slice(0, limit);
  }

  async function clearHistory() {
    await set(KEYS.HISTORY, []);
  }

  return {
    get, set,
    getGroups, setGroups, addGroup, addGroupsBatch, removeGroup, updateGroup, updateCheckinResult,
    getSettings, updateSettings,
    getState, updateState,
    getHistory, clearHistory,
    KEYS, DEFAULT_SETTINGS
  };
})();
