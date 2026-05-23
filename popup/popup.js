/**
 * Popup UI — 扩展弹窗交互逻辑
 */

(async function () {
  'use strict';

  // ─── DOM 引用缓存 ───
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // 标签页
  const tabs = $$('.tab');
  const tabContents = $$('.tab-content');

  // 群组列表
  const groupList = $('#groupList');
  const btnManualCheckin = $('#btnManualCheckin');
  const btnClearHistory = $('#btnClearHistory');

  // 添加群组
  const addGroupForm = $('#addGroupForm');
  const inputKeyword = $('#keyword');
  const inputGroupNames = $('#groupNames');
  const addPreview = $('#addPreview');
  const previewList = $('#previewList');
  const addResult = $('#addResult');

  // 设置
  const settingsForm = $('#settingsForm');
  const globalToggle = $('#globalToggle');
  const timeJitter = $('#timeJitter');

  // 日志
  const logList = $('#logList');
  const logLevelFilter = $('#logLevelFilter');
  const btnRefreshLogs = $('#btnRefreshLogs');
  const btnClearLogs = $('#btnClearLogs');

  // 状态
  const statusIndicator = $('#statusIndicator');

  // ═════════════════════════════════════
  // ─── 水群模块 ───
  // ═════════════════════════════════════

  const waterToggle = $('#waterToggle');
  const waterStatus = $('#waterStatus');
  const waterMsgList = $('#waterMsgList');
  const waterMsgInput = $('#waterMsgInput');
  const btnAddWaterMsg = $('#btnAddWaterMsg');
  const waterTargetGroups = $('#waterTargetGroups');
  const waterIntervalMin = $('#waterIntervalMin');
  const waterIntervalMax = $('#waterIntervalMax');
  const waterActiveStart = $('#waterActiveStart');
  const waterActiveEnd = $('#waterActiveEnd');
  const btnSaveWater = $('#btnSaveWater');
  const btnWaterTest = $('#btnWaterTest');
  const waterHistoryList = $('#waterHistoryList');

  /** 渲染水群消息列表 */
  async function renderWaterMessages() {
    const ws = await Storage.getWaterSettings();
    const msgs = ws.messages || [];

    if (msgs.length === 0) {
      waterMsgList.innerHTML = '<div class="empty-state"><p>暂无水群消息</p></div>';
      return;
    }

    waterMsgList.innerHTML = msgs.map(m => `
      <div class="water-msg-card" data-id="${m.id}">
        <div class="water-msg-text">${escapeHtml(m.text)}</div>
        <div class="water-msg-actions">
          <button class="btn-icon btn-edit-msg" title="编辑" data-id="${m.id}">✏️</button>
          <button class="btn-icon btn-delete-msg" title="删除" data-id="${m.id}">🗑️</button>
        </div>
      </div>
    `).join('');

    // 绑定删除按钮
    waterMsgList.querySelectorAll('.btn-delete-msg').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if (confirm('确定删除这条水群消息吗？')) {
          await Storage.removeWaterMessage(id);
          renderWaterMessages();
          updateWaterStatus('消息已删除');
        }
      });
    });

    // 绑定编辑按钮
    waterMsgList.querySelectorAll('.btn-edit-msg').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const ws = await Storage.getWaterSettings();
        const msg = ws.messages.find(m => m.id === id);
        if (!msg) return;
        const newText = prompt('编辑水群消息：', msg.text);
        if (newText && newText.trim()) {
          await Storage.updateWaterMessage(id, newText.trim());
          renderWaterMessages();
          updateWaterStatus('消息已更新');
        }
      });
    });
  }

  /** 渲染水群历史 */
  async function renderWaterHistory() {
    try {
      const history = await Storage.getWaterHistory(50);
      if (history.length === 0) {
        waterHistoryList.innerHTML = '<div class="empty-state"><p>暂无记录</p></div>';
        return;
      }
      waterHistoryList.innerHTML = history.map(h => {
        const time = new Date(h.timestamp).toLocaleTimeString('zh-CN', {
          hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
        const cls = h.success ? 'success' : 'fail';
        const icon = h.success ? '✅' : '❌';
        return `
          <div class="water-history-item ${cls}">
            <span class="water-hist-time">${time}</span>
            <span class="water-hist-group">${escapeHtml(h.groupName || '—')}</span>
            <span class="water-hist-msg">${escapeHtml((h.message || '').slice(0, 20))}</span>
            <span class="water-hist-result">${icon} ${escapeHtml((h.result || '').slice(0, 15))}</span>
          </div>
        `;
      }).join('');
    } catch (e) {
      waterHistoryList.innerHTML = '<div class="empty-state"><p>加载失败</p></div>';
    }
  }

  /** 更新水群状态显示 */
  function updateWaterStatus(message) {
    if (message) {
      waterStatus.textContent = '● ' + message;
      clearTimeout(waterStatus._timeout);
      waterStatus._timeout = setTimeout(() => {
        refreshWaterStatus();
      }, 5000);
    } else {
      refreshWaterStatus();
    }
  }

  async function refreshWaterStatus() {
    const ws = await Storage.getWaterSettings();
    const state = await Storage.getWaterState();
    if (ws.enabled) {
      const next = state.nextRunTime ? new Date(state.nextRunTime).toLocaleTimeString('zh-CN') : '等待中';
      waterStatus.textContent = '● 已启用 | 下次发送: ' + next + ' | 今日: ' + (state.todayCount || 0) + ' 条';
      waterStatus.style.color = 'var(--success)';
    } else {
      waterStatus.textContent = '● 未启用';
      waterStatus.style.color = 'var(--text-muted)';
    }
  }

  // 水群开关
  waterToggle.addEventListener('change', async () => {
    const enabled = waterToggle.checked;
    await Storage.updateWaterSettings({ enabled });
    updateWaterStatus(enabled ? '水群已启用' : '水群已禁用');

    if (enabled) {
      chrome.runtime.sendMessage({ action: 'toggle_water_chat' }, (resp) => {
        if (resp?.ok) updateWaterStatus('水群闹钟已设置');
      });
    } else {
      chrome.runtime.sendMessage({ action: 'toggle_water_chat' }, (resp) => {
        if (resp?.ok) updateWaterStatus('水群已禁用');
      });
    }
  });

  // 添加水群消息
  btnAddWaterMsg.addEventListener('click', async () => {
    const text = waterMsgInput.value.trim();
    if (!text) {
      updateWaterStatus('请输入水群消息内容');
      return;
    }
    await Storage.addWaterMessage(text);
    waterMsgInput.value = '';
    await renderWaterMessages();
    updateWaterStatus('消息已添加');
  });

  // 回车添加消息
  waterMsgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      btnAddWaterMsg.click();
    }
  });

  // 保存水群设置
  btnSaveWater.addEventListener('click', async () => {
    const targetGroupsRaw = waterTargetGroups.value.trim();
    const targetGroups = targetGroupsRaw
      ? targetGroupsRaw.split('\n').map(g => g.trim()).filter(Boolean)
      : [];

    const settings = {
      intervalMin: parseInt(waterIntervalMin.value) || 30,
      intervalMax: parseInt(waterIntervalMax.value) || 60,
      targetGroups: targetGroups,
      activeHoursStart: waterActiveStart.value || '08:00',
      activeHoursEnd: waterActiveEnd.value || '23:00',
    };

    if (settings.intervalMin > settings.intervalMax) {
      updateWaterStatus('最短间隔不能大于最长间隔');
      return;
    }
    if (settings.intervalMin < 1) {
      updateWaterStatus('最短间隔至少为 1 分钟');
      return;
    }

    await Storage.updateWaterSettings(settings);
    updateWaterStatus('✅ 水群设置已保存');

    const ws = await Storage.getWaterSettings();
    if (ws.enabled) {
      chrome.runtime.sendMessage({ action: 'toggle_water_chat' }, () => {});
    }
  });

  // 单次发送水群消息测试
  btnWaterTest.addEventListener('click', async () => {
    // 先保存当前设置
    const targetGroupsRaw = waterTargetGroups.value.trim();
    const targetGroups = targetGroupsRaw
      ? targetGroupsRaw.split('\n').map(g => g.trim()).filter(Boolean)
      : [];

    await Storage.updateWaterSettings({
      intervalMin: parseInt(waterIntervalMin.value) || 30,
      intervalMax: parseInt(waterIntervalMax.value) || 60,
      targetGroups: targetGroups,
      activeHoursStart: waterActiveStart.value || '08:00',
      activeHoursEnd: waterActiveEnd.value || '23:00',
    });

    const ws = await Storage.getWaterSettings();
    const msgs = ws.messages || [];
    if (msgs.length === 0) {
      updateWaterStatus('❌ 请先添加水群消息');
      return;
    }

    btnWaterTest.disabled = true;
    btnWaterTest.textContent = '⏳ 发送中...';
    updateWaterStatus('🚀 正在执行水群发送...');

    // 通知 background 触发一次水群
    chrome.runtime.sendMessage({ action: 'manual_water_chat' }, (response) => {
      btnWaterTest.disabled = false;
      btnWaterTest.textContent = '▶ 单次发送';
      if (response && response.ok) {
        updateWaterStatus('✅ 单次水群已触发，请查看发送记录');
        setTimeout(() => renderWaterHistory(), 5000);
        setTimeout(() => renderWaterHistory(), 10000);
      } else {
        const err = response ? response.error : 'response 为空';
        updateWaterStatus('❌ 触发失败: ' + err);
      }
    });
  });

  // ─── 标签页切换 ───

  tabs.forEach(tab => {
    tab.addEventListener('click', async () => {
      const target = tab.dataset.tab;
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      tabContents.forEach(c => c.classList.remove('active'));
      $(`#tab-${target}`).classList.add('active');

      // 切换时加载对应数据
      if (target === 'groups') renderGroups();
      if (target === 'logs') renderLogs();
      if (target === 'settings') loadSettings();
      if (target === 'water') {
        await loadWaterSettings();
        await renderWaterMessages();
        await renderWaterHistory();
        await refreshWaterStatus();
      }
    });
  });

  // ─── 群组列表渲染 ───

  async function renderGroups() {
    const groups = await Storage.getGroups();

    if (groups.length === 0) {
      groupList.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">📭</span>
          <p>还没有添加任何群组</p>
          <p class="empty-hint">切换到"添加"标签页来添加群组</p>
        </div>`;
      return;
    }

    groupList.innerHTML = groups.map(g => `
      <div class="group-card ${g.status === 'error' ? 'error' : ''}" data-id="${g.id}">
        <div class="group-info">
          <div class="group-name">${g.enabled ? '🟢' : '⚪'} ${escapeHtml(g.name)}</div>
          <div class="group-keyword">
            <span class="badge">${escapeHtml(g.keyword)}</span>
          </div>
          <div class="group-meta">
            ${g.lastCheckin
              ? `<span class="meta-item">上次签到: ${formatTime(g.lastCheckin)}</span>`
              : '<span class="meta-item">尚未签到</span>'}
            ${g.lastResult
              ? `<span class="meta-item ${g.lastResult.success ? 'success' : 'fail'}">${escapeHtml(g.lastResult.message || '')}</span>`
              : ''}
            ${g.status === 'error'
              ? '<span class="meta-item error-tag">⚠️ 异常</span>'
              : ''}
          </div>
        </div>
        <div class="group-actions">
          <button class="btn-icon" title="测试签到" data-action="test" data-id="${g.id}">🧪</button>
          <button class="btn-icon" title="${g.enabled ? '禁用' : '启用'}" data-action="toggle" data-id="${g.id}">${g.enabled ? '🔓' : '🔒'}</button>
          <button class="btn-icon btn-delete" title="删除" data-action="delete" data-id="${g.id}">🗑️</button>
        </div>
      </div>
    `).join('');

    // 绑定群组操作按钮
    groupList.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        const group = groups.find(g => g.id === id);

        if (action === 'delete') {
          if (confirm(`确定删除群组 "${group?.name}" 吗？`)) {
            await Storage.removeGroup(id);
            renderGroups();
            updateStatus('群组已删除');
          }
        } else if (action === 'toggle') {
          await Storage.updateGroup(id, { enabled: !group?.enabled });
          renderGroups();
          updateStatus(`群组已${group?.enabled ? '禁用' : '启用'}`);
        } else if (action === 'test') {
          // 测试签到 — 向当前标签页发送指令
          updateStatus('正在测试签到...');
          chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
            if (tabs[0]?.url?.includes('web.telegram.org')) {
              chrome.tabs.sendMessage(tabs[0].id, {
                action: 'testCheckin',
                groupName: group.name,
                keyword: group.keyword,
              }, (response) => {
                if (chrome.runtime.lastError) {
                  updateStatus('测试失败: 请确认 Telegram 页面已打开');
                  return;
                }
                if (response?.success) {
                  updateStatus(`✅ 测试成功: ${response.message}`);
                  // 更新群组状态
                  Storage.updateCheckinResult(id, response);
                  renderGroups();
                } else {
                  updateStatus(`❌ 测试失败: ${response?.message || '未知错误'}`);
                }
              });
            } else {
              updateStatus('请先在标签页中打开 Telegram Web A');
            }
          });
        }
      });
    });
  }

  // ─── 添加群组 ───

  addGroupForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const keyword = inputKeyword.value.trim();
    const namesText = inputGroupNames.value.trim();

    if (!keyword || !namesText) {
      showAddResult('error', '请填写签到关键词和群组名称');
      return;
    }

    const names = namesText
      .split('\n')
      .map(n => n.trim())
      .filter(n => n.length > 0);

    if (names.length === 0) {
      showAddResult('error', '请填写至少一个群组名称');
      return;
    }

    const result = await Storage.addGroupsBatch(names, keyword);

    if (result.added.length === 0 && result.skipped.length === names.length) {
      showAddResult('warn', '所有群组已存在，未添加新群组');
    } else {
      let msg = `✅ 成功添加 ${result.added.length} 个群组`;
      if (result.skipped.length > 0) {
        msg += `，${result.skipped.length} 个已存在被跳过`;
      }
      showAddResult('success', msg);

      // 清空表单
      inputGroupNames.value = '';
    }

    // 刷新群组列表
    renderGroups();
  });

  // 预览输入
  inputGroupNames.addEventListener('input', () => {
    const names = inputGroupNames.value
      .split('\n')
      .map(n => n.trim())
      .filter(n => n.length > 0);

    if (names.length > 0) {
      addPreview.style.display = 'block';
      previewList.innerHTML = names.map(n => `<li>📎 ${escapeHtml(n)}</li>`).join('');
    } else {
      addPreview.style.display = 'none';
    }
  });

  function showAddResult(type, message) {
    addResult.style.display = 'block';
    addResult.className = `add-result add-result-${type}`;
    addResult.textContent = message;
    setTimeout(() => { addResult.style.display = 'none'; }, 5000);
  }

  // ─── 手动签到 ───

  btnManualCheckin.addEventListener('click', async () => {
    const groups = await Storage.getGroups();
    const enabledGroups = groups.filter(g => g.enabled);

    if (enabledGroups.length === 0) {
      updateStatus('没有启用的群组可以签到');
      return;
    }

    updateStatus('正在派发签到任务...');

    // 检查是否有 Telegram 标签页打开
    const tabs = await chrome.tabs.query({ url: 'https://web.telegram.org/a/*' });
    if (tabs.length > 0) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'runCheckin' }, (response) => {
        if (chrome.runtime.lastError) {
          updateStatus('签到失败: Content Script 未就绪，请刷新 Telegram 页面');
          return;
        }
        updateStatus('签到任务已派发，正在执行...');
      });
    } else {
      updateStatus('请先打开 Telegram Web A 页面');

      // 通过 background 打开新标签页
      chrome.runtime.sendMessage({ action: 'manual_checkin' }, (response) => {
        if (response?.ok) {
          updateStatus('已打开 Telegram 页面，签到任务已派发');
        }
      });
    }
  });

  // ─── 清空历史 ───

  btnClearHistory.addEventListener('click', async () => {
    if (confirm('确定清空所有签到历史记录吗？')) {
      await Storage.clearHistory();
      // 同时清除所有群组的签到记录
      const groups = await Storage.getGroups();
      for (const g of groups) {
        await Storage.updateGroup(g.id, {
          lastCheckin: null,
          lastResult: null,
        });
      }
      renderGroups();
      updateStatus('签到历史已清空');
    }
  });

  // ─── 设置 ───

  async function loadSettings() {
    const settings = await Storage.getSettings();
    globalToggle.checked = settings.enabled;
    $('#baseTime').value = settings.baseTime;
    timeJitter.value = settings.timeJitterMinutes;
    $('#timeJitterVal').textContent = `±${settings.timeJitterMinutes} 分钟`;
    $('#actionDelayMin').value = settings.actionDelayMin;
    $('#actionDelayMax').value = settings.actionDelayMax;
    $('#typingSpeedMin').value = settings.typingSpeedMin;
    $('#typingSpeedMax').value = settings.typingSpeedMax;
    $('#checkAlreadySigned').checked = settings.checkAlreadySigned;
    $('#stopOnVerification').checked = settings.stopOnVerification;
    $('#notificationEnabled').checked = settings.notificationEnabled;
  }

  /** 加载水群设置到 UI */
  async function loadWaterSettings() {
    const ws = await Storage.getWaterSettings();
    waterToggle.checked = !!ws.enabled;
    waterIntervalMin.value = ws.intervalMin || 30;
    waterIntervalMax.value = ws.intervalMax || 60;
    waterActiveStart.value = ws.activeHoursStart || '08:00';
    waterActiveEnd.value = ws.activeHoursEnd || '23:00';
    waterTargetGroups.value = (ws.targetGroups || []).join('\n');
  }

  // 时间抖动滑块
  timeJitter.addEventListener('input', () => {
    $('#timeJitterVal').textContent = `±${timeJitter.value} 分钟`;
  });

  // 全局开关
  globalToggle.addEventListener('change', async () => {
    const enabled = globalToggle.checked;
    await Storage.updateSettings({ enabled });
    updateStatus(enabled ? '签到已启用' : '签到已禁用');

    // 通知 Background 更新闹钟
    if (enabled) {
      chrome.runtime.sendMessage({ action: 'reset_alarm' }, (resp) => {
        if (resp?.ok) updateStatus('签到已启用，闹钟已设置');
      });
    } else {
      // 取消所有闹钟
      chrome.runtime.sendMessage({ action: 'cancel_alarms' }, () => {});
    }
  });

  // 保存设置
  settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const settings = {
      baseTime: $('#baseTime').value,
      timeJitterMinutes: parseInt(timeJitter.value),
      actionDelayMin: parseInt($('#actionDelayMin').value),
      actionDelayMax: parseInt($('#actionDelayMax').value),
      typingSpeedMin: parseInt($('#typingSpeedMin').value),
      typingSpeedMax: parseInt($('#typingSpeedMax').value),
      checkAlreadySigned: $('#checkAlreadySigned').checked,
      stopOnVerification: $('#stopOnVerification').checked,
      notificationEnabled: $('#notificationEnabled').checked,
    };

    // 验证延迟范围
    if (settings.actionDelayMin > settings.actionDelayMax) {
      updateStatus('最短延迟不能大于最长延迟');
      return;
    }
    if (settings.typingSpeedMin > settings.typingSpeedMax) {
      updateStatus('最快速度不能大于最慢速度');
      return;
    }

    await Storage.updateSettings(settings);
    updateStatus('✅ 设置已保存');

    // 如果已启用，重新设置闹钟
    if (globalToggle.checked) {
      chrome.runtime.sendMessage({ action: 'reset_alarm' }, () => {});
    }
  });

  // ─── 日志 ───

  async function renderLogs() {
    const level = logLevelFilter.value;
    const filter = { limit: 100 };
    if (level !== 'all') filter.level = level;

    try {
      const logs = await Logger.getLogs(filter); // Logger 来自 lib/logger.js

      if (logs.length === 0) {
        logList.innerHTML = '<div class="empty-state"><p>暂无日志</p></div>';
        return;
      }

      logList.innerHTML = logs.map(l => {
        const time = new Date(l.timestamp).toLocaleTimeString('zh-CN', {
          hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
        return `
          <div class="log-entry ${l.level}">
            <span class="log-time">${time}</span>
            <span class="log-level">[${l.level.toUpperCase()}]</span>
            <span class="log-module">${escapeHtml(l.module)}</span>
            <span class="log-message">${escapeHtml(l.message)}</span>
            ${l.data ? `<span class="log-data">${escapeHtml(JSON.stringify(l.data).slice(0, 100))}</span>` : ''}
          </div>`;
      }).join('');
    } catch(e) {
      logList.innerHTML = `<div class="empty-state"><p>日志加载失败: ${escapeHtml(e.message)}</p></div>`;
    }
  }

  logLevelFilter.addEventListener('change', renderLogs);
  btnRefreshLogs.addEventListener('click', renderLogs);

  btnClearLogs.addEventListener('click', async () => {
    if (confirm('确定清空所有日志吗？')) {
      await Logger.clearLogs();
      renderLogs();
    }
  });

  // ─── 实时状态监听 ───

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'checkin_complete') {
      renderGroups();
      const success = msg.results.filter(r => r.result?.success).length;
      const total = msg.results.length;
      updateStatus(`签到完成: ${success}/${total} 成功`);
    }
    if (msg.action === 'scheduler_event') {
      if (msg.event === 'alarm_created') {
        updateStatus(`闹钟已设置: ${formatTime(msg.data.nextTime)}`);
      }
    }
  });

  // ─── 工具函数 ───

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatTime(isoString) {
    try {
      return new Date(isoString).toLocaleString('zh-CN', {
        month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  }

  function updateStatus(message) {
    statusIndicator.textContent = `● ${message}`;
    // 3秒后恢复默认
    clearTimeout(statusIndicator._timeout);
    statusIndicator._timeout = setTimeout(() => {
      statusIndicator.textContent = '● 就绪';
    }, 5000);
  }

  // ─── 初始化 ───

  async function init() {
    // 加载设置
    const settings = await Storage.getSettings();
    globalToggle.checked = settings.enabled;

    // 加载群组列表
    await renderGroups();

    // 加载水群状态
    await loadWaterSettings();
    await refreshWaterStatus();
  }

  init();
})();