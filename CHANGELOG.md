# 变更日志 — Telegram 智能签到助手

## v1.0.1 (2026-05-20) — 7轮修复

### 修复 #7: cleanupSearch Escape 键导致跳回搜索对话框
- **根因**：`content.js` → `cleanupSearch` 派发了 Escape 键的 keydown/keyup 事件
- **影响**：打开聊天后页面自动跳回搜索对话框，签到输入无法执行
- **修复**：移除 Escape 键盘事件派发，仅清空输入框值

### 修复 #6: anti-detect.js MODULE 变量未定义
- **根因**：`anti-detect.js:179` 引用 `MODULE` 变量，该变量仅在 `content.js` 中定义
- **影响**：`humanType` 输入过程中 ReferenceError 中断，签到关键词从未写入
- **修复**：将 `Logger.debug(MODULE, ...)` 改为 `Logger.debug('anti-detect', ...)`

### 修复 #5: 语法错误 + contentEditable 输入方式
- **根因1**：`content.js` diagnostic 模板字符串含中文引号导致语法错误（PowerShell 环境下字符串转义问题）
- **根因2**：对 contentEditable 元素使用 textContent 赋值在部分 Telegram 版本中无效
- **修复**：① 模板字符串改为字符串拼接 ② sendCheckinCommand 和 humanType 中 contentEditable 输入改用 execCommand('insertText')

### 修复 #4: 消息输入框命中错误元素
- **根因**：waitForElement 只检查元素存在，不验证是否真的可编辑。`#message-input-text` 存在但 contentEditable=false
- **修复**：① 新增 waitForEditableInput 方法带 contentEditable 校验 ② 调整 messageInput 选择器优先级 ③ sendCheckinCommand 中增加验证+重试

### 修复 #3: chatItemTitle 选择器不匹配 & 搜索框输入优化
- **根因1**：chatItemTitle 选择器未命中 Telegram Web A 实际 DOM
- **根因2**：搜索框逐字拟人输入低效且不可靠
- **修复**：① 更新 chatItemTitle 选择器列表 ② 搜索框改用直接 value 赋值 + input 事件

### 修复 #2: 搜索结果匹配失败
- **根因**：openChat 输入群名后未等待搜索结果 DOM 出现
- **修复**：增加 waitForElement(Selectors.chatItem, 8000) 等待搜索结果 + 500ms 额外等待 + 调试日志

### 修复 #1: 搜索框输入失败
- **根因**：humanType 只处理 contentEditable 的消息输入框，搜索框是普通 input
- **修复**：humanType 增加 isInput 判断，对普通 input 直接操作 value += char + 派发事件

## v1.0.0 (2026-05-19) — 初始版本

### 功能
- Manifest V3 Chrome 扩展框架
- 多群组自动化签到（搜索→打开→输入→发送→判断）
- 拟人化行为引擎（防封核心）
  - 随机延迟 800-3000ms
  - 真实键盘逐字输入（含打错修正 5% 概率）
  - 鼠标事件完整序列
  - 随机时间抖动 ±20 分钟
  - 平滑滚动
- 智能上下文判断（检测已签到避免重复）
- 定时签到（chrome.alarms + 健康检查）
- 失败重试机制
- 验证码/风控检测与即时停止
- 未登录检测
- Popup UI（群组管理/设置/日志/测试）
- 桌面通知

### 技术栈
- Chrome Manifest V3
- Service Worker
- Content Script (DOM 操作)
- chrome.alarms (非精确周期性调度)
- chrome.storage.local (本地持久化)
- MutationObserver (SPA DOM 监听)