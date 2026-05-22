# 调试指南 — Telegram 智能签到助手

## 快速诊断流程

当签到不工作时，按以下步骤排查：

### 1. 确认扩展是否正确加载

打开 `chrome://extensions/`，确认：
- "Telegram 智能签到助手" 已启用
- 无错误提示（红色按钮）
- 点击"service worker"查看 background.js 是否正常运行

### 2. 查看实时日志

打开 `https://web.telegram.org/a/`，按 F12 打开 DevTools：
- 过滤 Console 标签页中的 `[TG-Checkin]` 前缀
- 所有 Content Script 的日志都有此前缀

常见日志解读：
```
[TG-Checkin][INFO][ContentScript] ========== 开始签到 ==========
[TG-Checkin][DEBUG][ContentScript] 搜索群聊: 群名称
[TG-Checkin][INFO][ContentScript] 找到搜索框: tag=INPUT, type=text
[TG-Checkin][INFO][ContentScript] 已直接填入搜索关键词: "群名称"
[TG-Checkin][DEBUG][ContentScript] 等待搜索结果 DOM 出现...
[TG-Checkin][DEBUG][ContentScript] 搜索结果: 5 个聊天项
[TG-Checkin][INFO][ContentScript] 精确匹配到群: 群名称
[TG-Checkin][INFO][ContentScript] 已打开群聊: 群名称
[TG-Checkin][INFO][ContentScript] 发送签到命令: 签到
[TG-Checkin][INFO][ContentScript] 签到成功
```

### 3. 使用 Popup 测试功能

点击扩展图标 → 在群组卡片右侧点击 🧪 按钮进行单群组测试。

### 4. 常见问题排查

#### 问题：找不到搜索框

**日志**：`[ERROR] 未找到搜索输入框`

**排查**：
1. Telegram Web A 页面是否已完全加载？
2. 执行诊断脚本（DevTools Console）：
```js
// 列出页面上所有可能的搜索框
document.querySelectorAll('input[placeholder*="搜索"], input[placeholder*="Search"], #telegram-search-input, .search-input')
```
3. 手动测试选择器是否命中 → 如果选择器变化，更新 `Selectors.searchInput`

#### 问题：搜索结果匹配失败

**日志**：`[INFO] 精确匹配到群: XXX` 没有出现，或 `[WARN] 未精确匹配，使用第一个结果`

**排查**：
1. 确认群名拼写与 Telegram 中完全一致
2. 执行诊断脚本：
```js
// 手动在搜索框输入群名后执行
document.querySelectorAll('.chat-item, .ListItem-button, .chat-list-item').forEach((item, i) => {
  const titleEl = item.querySelector('.chat-title, .fullName, .title-text, h3');
  console.log(`[${i}] titleEl:`, titleEl?.textContent, '| text:', item.textContent?.split('\n')[0]);
});
```
3. 如果 titleEl 为空，更新 `Selectors.chatItemTitle` 添加新的选择器

#### 问题：消息输入框不可编辑

**日志**：`[WARN] waitForEditableInput 未命中` 或 `[ERROR] 未找到可编辑的消息输入框`

**背景**：Telegram Web A 有多个伪装输入框（contentEditable=false），需要过滤。

**排查**：
1. 执行诊断脚本：
```js
document.querySelectorAll('div[contenteditable="true"]').forEach((el, i) => {
  const r = el.getBoundingClientRect();
  console.log(`[${i}] id="${el.id}" ce=${el.contentEditable} ph="${el.dataset?.placeholder||el.getAttribute('data-placeholder')}" size=${Math.round(r.width)}x${Math.round(r.height)}`);
});
```
2. 真正的消息输入框特征：`contentEditable=true` + `data-placeholder` 属性 + 合理的尺寸

#### 问题：输入内容为空

**日志**：`[ERROR] 输入框内容为空！输入可能未生效，中止发送`

**可能原因**：
1. `execCommand('insertText')` 在某些版本不触发 React 合成事件
2. 输入框在输入过程中被重新渲染

**排查**：
1. 检查 `anti-detect.js` 中 `insertChar` 函数的降级逻辑是否生效
2. 尝试在 DevTools 中手动执行：
```js
const el = document.querySelector('div[contenteditable="true"][data-placeholder]');
el.focus();
document.execCommand('insertText', false, '测试');
console.log(el.textContent); // 应该输出 "测试"
```

#### 问题：打开群聊后跳回搜索框

**已修复**：`content.js` 中 `cleanupSearch` 不再派发 Escape 键事件。

**如仍出现**：检查是否有其他代码派发了键盘事件或触发了导航。

### 5. DOM 诊断工具

在 DevTools Console 中执行以下脚本获取完整 DOM 诊断：

```js
(function diagnostic() {
  console.log('=== Telegram Web A DOM 诊断 ===');
  console.log('contentEditable 元素:', document.querySelectorAll('div[contenteditable="true"]').length);
  console.log('搜索输入框:', document.querySelector('input' + ['[placeholder*="搜索"]', '[placeholder*="Search"]', '#telegram-search-input'].join(', input')));
  console.log('聊天列表项:', document.querySelectorAll('.chat-item, .ListItem-button, .chat-list-item').length);
  console.log('消息气泡:', document.querySelectorAll('.message-text, .text-content, .message-content').length);
  console.log('URL:', window.location.href);
  console.log('=== 诊断完成 ===');
})();
```

### 6. 存储数据查看

在 DevTools Console 中执行：
```js
// 查看所有存储数据
chrome.storage.local.get(null, console.log);
// 查看群组配置
chrome.storage.local.get('checkin_groups', d => console.log(JSON.parse(JSON.stringify(d))));
// 查看签到历史
chrome.storage.local.get('checkin_history', d => console.log(d));

### 7. 强制重设闹钟

在 DevTools Console 中执行：
```js
chrome.alarms.getAll(console.log);  // 查看当前闹钟
chrome.alarms.clearAll();           // 清除所有闹钟
chrome.runtime.sendMessage({ action: 'reset_alarm' });  // 重建