/**
 * popup.js - Popup 界面逻辑
 * 用户交互界面：开关插件、配置签到间隔、查看即时日志
 */

// ==================== 状态管理 ====================
let currentConfig = null;
let currentGroups = [];
let currentLogs = [];
let editingGroupId = null;
let isCheckinRunning = false;

// ==================== DOM 元素缓存 ====================
const $ = (id) => document.getElementById(id);

const elements = {
  masterToggle: $('masterToggle'),
  statusDot: $('statusDot'),
  statusText: $('statusText'),
  tabButtons: document.querySelectorAll('.tab'),
  tabContents: document.querySelectorAll('.tab-content'),
  groupList: $('groupList'),
  groupModal: $('groupModal'),
  modalTitle: $('modalTitle'),
  groupName: $('groupName'),
  triggerMode: $('triggerMode'),
  commandGroup: $('commandGroup'),
  buttonGroup: $('buttonGroup'),
  checkinCommand: $('checkinCommand'),
  buttonSelector: $('buttonSelector'),
  checkinKeywords: $('checkinKeywords'),
  addGroupBtn: $('addGroupBtn'),
  checkinNowBtn: $('checkinNowBtn'),
  modalClose: $('modalClose'),
  modalCancel: $('modalCancel'),
  modalSave: $('modalSave'),
  globalBaseTime: $('globalBaseTime'),
  globalJitter: $('globalJitter'),
  delayMin: $('delayMin'),
  delayMax: $('delayMax'),
  maxRetry: $('maxRetry'),
  saveSettings: $('saveSettings'),
  resetAll: $('resetAll'),
  logList: $('logList'),
  clearLogsBtn: $('clearLogsBtn')
};

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  renderUI();
  bindEvents();
});

async function loadData() {
  const data = await chrome.storage.local.get(['config', 'groups', 'logs']);
  currentConfig = data.config || {
    enabled: false,
    globalBaseTime: '08:00',
    timeJitterMinutes: 20,
    checkinIntervalDays: 1,
    maxRetryAttempts: 2,
    operationDelayMin: 800,
    operationDelayMax: 3000
  };
  currentGroups = data.groups || [];
  currentLogs = data.logs || [];
}

function bindEvents() {
  // 主开关
  elements.masterToggle.addEventListener('change', handleMasterToggle);

  // 标签页切换
  elements.tabButtons.forEach(btn => {
    btn.addEventListener('click', handleTabSwitch);
  });

  // 添加群组
  elements.addGroupBtn.addEventListener('click', () => openGroupModal());

  // 立即签到
  elements.checkinNowBtn.addEventListener('click', handleCheckinNow);

  // 弹窗关闭
  elements.modalClose.addEventListener('click', closeGroupModal);
  elements.modalCancel.addEventListener('click', closeGroupModal);

  // 弹窗保存
  elements.modalSave.addEventListener('click', saveGroup);

  // 签到模式切换
  elements.triggerMode.addEventListener('change', handleTriggerModeChange);

  // 保存设置
  elements.saveSettings.addEventListener('click', saveSettings);

  // 重置所有
  elements.resetAll.addEventListener('click', resetAllData);

  // 清空日志
  elements.clearLogsBtn.addEventListener('click', clearLogs);
}

// ==================== UI 渲染 ====================
function renderUI() {
  // 主开关状态
  elements.masterToggle.checked = currentConfig.enabled;
  updateStatusBar();

  // 设置值
  elements.globalBaseTime.value = currentConfig.globalBaseTime;
  elements.globalJitter.value = currentConfig.timeJitterMinutes;
  elements.delayMin.value = currentConfig.operationDelayMin;
  elements.delayMax.value = currentConfig.operationDelayMax;
  elements.maxRetry.value = currentConfig.maxRetryAttempts;

  // 群组列表
  renderGroupList();

  // 日志列表
  renderLogList();
}

function updateStatusBar() {
  if (currentConfig.enabled) {
    elements.statusDot.classList.add('active');
    elements.statusText.textContent = '运行中';
  } else {
    elements.statusDot.classList.remove('active');
    elements.statusText.textContent = '已暂停';
  }
}

function renderGroupList() {
  if (currentGroups.length === 0) {
    elements.groupList.innerHTML = '<div class="empty-state">暂无群组，点击 + 添加</div>';
    return;
  }

  const todayStr = new Date().toISOString().split('T')[0];

  elements.groupList.innerHTML = currentGroups.map(group => {
    const checkedToday = group.lastCheckinDate === todayStr;
    return `
    <div class="group-item ${group._checking ? 'checking' : ''}" data-id="${group.id}">
      <div class="group-left">
        <input type="checkbox" class="group-checkbox" data-id="${group.id}"
          ${group.enabled ? 'checked' : ''} ${group.enabled ? '' : 'disabled'} title="${group.enabled ? '勾选后可立即签到' : '群组未启用'}">
        <div class="group-info">
          <div class="group-name">${escapeHtml(group.name)}</div>
          <div class="group-detail">
            ${group.triggerMode === 'button' ? '按钮签到' : escapeHtml(group.command || '/checkin')}
            ${checkedToday ? ' ✅今日已签' : ''}
          </div>
        </div>
      </div>
      <div class="group-actions">
        <label class="toggle-switch group-toggle">
          <input type="checkbox" ${group.enabled ? 'checked' : ''} data-id="${group.id}">
          <span class="toggle-slider"></span>
        </label>
        <button class="btn-icon edit-btn" data-id="${group.id}">✏</button>
        <button class="btn-icon delete-btn" data-id="${group.id}">×</button>
      </div>
    </div>
  `}).join('');

  // 绑定群组操作事件
  elements.groupList.querySelectorAll('.group-toggle input').forEach(toggle => {
    toggle.addEventListener('change', (e) => toggleGroupEnabled(e.target.dataset.id, e.target.checked));
  });

  elements.groupList.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => openGroupModal(e.target.dataset.id));
  });

  elements.groupList.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => deleteGroup(e.target.dataset.id));
  });
}

function renderLogList() {
  if (currentLogs.length === 0) {
    elements.logList.innerHTML = '<div class="empty-state">暂无日志</div>';
    return;
  }

  elements.logList.innerHTML = currentLogs.slice(0, 50).map(log => `
    <div class="log-item ${log.type}">
      <div class="log-header">
        <span class="log-group">${escapeHtml(log.groupName)}</span>
        <span class="log-time">${formatTime(log.timestamp)}</span>
      </div>
      <div class="log-message">${escapeHtml(log.message)}</div>
    </div>
  `).join('');
}

// ==================== 事件处理 ====================
async function handleMasterToggle(e) {
  currentConfig.enabled = e.target.checked;
  await chrome.storage.local.set({ config: currentConfig });
  updateStatusBar();

  if (currentConfig.enabled) {
    chrome.runtime.sendMessage({ action: 'startAutomation' });
  } else {
    chrome.runtime.sendMessage({ action: 'stopAutomation' });
  }
}

function handleTabSwitch(e) {
  const targetTab = e.target.dataset.tab;

  elements.tabButtons.forEach(btn => btn.classList.remove('active'));
  e.target.classList.add('active');

  elements.tabContents.forEach(content => {
    content.classList.remove('active');
    if (content.id === `tab-${targetTab}`) {
      content.classList.add('active');
    }
  });

  if (targetTab === 'logs') {
    refreshLogs();
  }
}

function handleTriggerModeChange(e) {
  const mode = e.target.value;
  elements.commandGroup.style.display = mode === 'command' || mode === 'keyword' ? 'block' : 'none';
  elements.buttonGroup.style.display = mode === 'button' ? 'block' : 'none';
}

// ==================== 立即签到 ====================
async function handleCheckinNow() {
  if (isCheckinRunning) return;

  // 收集勾选的群组
  const checkboxes = elements.groupList.querySelectorAll('.group-checkbox:checked');
  const selectedIds = Array.from(checkboxes).map(cb => cb.dataset.id);

  if (selectedIds.length === 0) {
    alert('请先勾选要签到的群组');
    return;
  }

  const selectedGroups = currentGroups.filter(g => selectedIds.includes(g.id) && g.enabled);
  if (selectedGroups.length === 0) {
    alert('勾选的群组均未启用');
    return;
  }

  isCheckinRunning = true;
  elements.checkinNowBtn.disabled = true;
  elements.checkinNowBtn.textContent = '⏳ 签到中...';

  // 标记正在签到的群组
  for (const group of selectedGroups) {
    const item = elements.groupList.querySelector(`.group-item[data-id="${group.id}"]`);
    if (item) item.classList.add('checking');
  }

  try {
    // 查找 Telegram Web 标签页（支持多个域名）
    let tabs = await chrome.tabs.query({ url: 'https://web.telegram.org/*' });
    if (tabs.length === 0) {
      tabs = await chrome.tabs.query({ url: 'https://webk.telegram.org/*' });
    }
    if (tabs.length === 0) {
      alert('未检测到 Telegram Web 页面，请先打开 https://web.telegram.org 或 https://webk.telegram.org');
      return;
    }

    const tabId = tabs[0].id;
    const tabUrl = tabs[0].url;

    // 确保已注入 content script
    try {
      await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    } catch (pingErr) {
      // content script 未注入，尝试 programmatic injection
      console.log('[TG签到助手] Content script 未就绪，正在注入...', pingErr.message);
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.js']
        });
        console.log('[TG签到助手] Content script 注入成功');
        // 等待初始化
        await sleep(500);
      } catch (injectErr) {
        console.error('[TG签到助手] 注入失败:', injectErr.message);
        alert(`无法注入签到脚本到页面。\n请确认：\n1. 已在 Telegram Web 聊天界面\n2. 页面已完全加载\n3. 已刷新扩展并刷新页面\n\n错误: ${injectErr.message}`);
        return;
      }
    }

    for (const group of selectedGroups) {
      try {
        const response = await chrome.tabs.sendMessage(tabId, {
          action: 'executeCheckin',
          group: group,
          config: currentConfig
        });

        const todayStr = new Date().toISOString().split('T')[0];

        if (response && response.success) {
          // 更新群组签到状态
          const idx = currentGroups.findIndex(g => g.id === group.id);
          if (idx >= 0) {
            currentGroups[idx].lastCheckinDate = todayStr;
            currentGroups[idx].lastCheckinTime = new Date().toISOString();
          }
          addLogLocal(group.id, group.name, 'success', response.message || '签到成功');
        } else {
          addLogLocal(group.id, group.name, 'error', response?.message || '签到失败');
          if (response?.fengkong) {
            alert('⚠️ 检测到风控验证，已停止签到操作，请人工处理！');
            break; // 风控时停止后续签到
          }
        }
      } catch (err) {
        addLogLocal(group.id, group.name, 'error', `执行异常: ${err.message}`);
      }

      // 群组间随机延迟
      if (selectedGroups.indexOf(group) < selectedGroups.length - 1) {
        await sleep(2000 + Math.random() * 3000);
      }
    }

    await chrome.storage.local.set({ groups: currentGroups, logs: currentLogs });
    renderGroupList();

  } catch (err) {
    console.error('[TG签到助手] 立即签到异常:', err);
    alert('签到异常: ' + err.message);
  } finally {
    isCheckinRunning = false;
    elements.checkinNowBtn.disabled = false;
    elements.checkinNowBtn.textContent = '⚡ 立即签到';
  }
}

function addLogLocal(groupId, groupName, type, message) {
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    groupId,
    groupName,
    type,
    message,
    timestamp: new Date().toISOString()
  };
  currentLogs = [entry, ...currentLogs].slice(0, 500);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==================== 群组管理 ====================
function openGroupModal(groupId = null) {
  editingGroupId = groupId;
  elements.modalTitle.textContent = groupId ? '编辑群组' : '添加群组';
  elements.groupModal.style.display = 'flex';

  if (groupId) {
    const group = currentGroups.find(g => g.id === groupId);
    if (group) {
      elements.groupName.value = group.name;
      elements.triggerMode.value = group.triggerMode || 'command';
      elements.checkinCommand.value = group.command || '/checkin';
      elements.buttonSelector.value = group.buttonSelector || '';
      elements.checkinKeywords.value = (group.checkinKeywords || []).join(', ');
      handleTriggerModeChange({ target: elements.triggerMode });
    }
  } else {
    // 清空表单
    elements.groupName.value = '';
    elements.triggerMode.value = 'command';
    elements.checkinCommand.value = '/checkin';
    elements.buttonSelector.value = '';
    elements.checkinKeywords.value = '';
    handleTriggerModeChange({ target: elements.triggerMode });
  }
}

function closeGroupModal() {
  elements.groupModal.style.display = 'none';
  editingGroupId = null;
}

async function saveGroup() {
  const nameText = elements.groupName.value.trim();
  if (!nameText) {
    alert('请输入群组名称');
    return;
  }

  // 支持换行分隔批量添加
  const names = nameText.split('\n').map(n => n.trim()).filter(n => n.length > 0);
  const triggerMode = elements.triggerMode.value;
  const command = elements.checkinCommand.value.trim();
  const buttonSelector = elements.buttonSelector.value.trim();
  const checkinKeywords = elements.checkinKeywords.value.split(',').map(item => item.trim()).filter(Boolean);

  if (editingGroupId) {
    // 编辑单个群组
    const idx = currentGroups.findIndex(g => g.id === editingGroupId);
    if (idx >= 0) {
      currentGroups[idx] = {
        ...currentGroups[idx],
        name: names[0],
        triggerMode,
        command,
        buttonSelector,
        checkinKeywords
      };
    }
  } else {
    // 批量添加：多个群组共享相同签到配置
    for (const name of names) {
      currentGroups.push({
        id: generateId(),
        name,
        enabled: true,
        triggerMode,
        command,
        buttonSelector,
        checkinKeywords,
        lastCheckinDate: null,
        lastCheckinTime: null
      });
    }
  }

  await chrome.storage.local.set({ groups: currentGroups });
  renderGroupList();
  closeGroupModal();
}

async function toggleGroupEnabled(groupId, enabled) {
  const idx = currentGroups.findIndex(g => g.id === groupId);
  if (idx >= 0) {
    currentGroups[idx].enabled = enabled;
    await chrome.storage.local.set({ groups: currentGroups });
    renderGroupList();
  }
}

async function deleteGroup(groupId) {
  if (!confirm('确定要删除这个群组吗？')) return;
  currentGroups = currentGroups.filter(g => g.id !== groupId);
  await chrome.storage.local.set({ groups: currentGroups });
  renderGroupList();
}

// ==================== 设置管理 ====================
async function saveSettings() {
  currentConfig.globalBaseTime = elements.globalBaseTime.value;
  currentConfig.timeJitterMinutes = parseInt(elements.globalJitter.value) || 20;
  currentConfig.operationDelayMin = parseInt(elements.delayMin.value) || 800;
  currentConfig.operationDelayMax = parseInt(elements.delayMax.value) || 3000;
  currentConfig.maxRetryAttempts = parseInt(elements.maxRetry.value) || 2;

  await chrome.storage.local.set({ config: currentConfig });
  alert('设置已保存');
}

async function resetAllData() {
  if (!confirm('确定要重置所有数据吗？这将删除所有群组配置和日志记录。')) return;
  await chrome.storage.local.clear();
  await loadData();
  renderUI();
}

// ==================== 日志管理 ====================
async function refreshLogs() {
  const data = await chrome.storage.local.get('logs');
  currentLogs = data.logs || [];
  renderLogList();
}

async function clearLogs() {
  if (!confirm('确定要清空所有日志吗？')) return;
  currentLogs = [];
  await chrome.storage.local.set({ logs: [] });
  renderLogList();
}

// ==================== 工具函数 ====================
function generateId() {
  return 'g_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const timeStr = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  if (isToday) return timeStr;
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) + ' ' + timeStr;
}