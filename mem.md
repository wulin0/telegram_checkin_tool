# 对话记忆总结 — Telegram 智能签到助手项目

## 项目概述

为 Telegram Web A 版 (`https://web.telegram.org/a/`) 开发了 Chrome Manifest V3 扩展，实现多群组自动化签到。具备拟人化行为引擎以防封号。

## 开发历程

### 2026-05-19 08:13 — 项目创建
根据用户提交的详细设计文档，创建了完整项目骨架：
- `manifest.json` (Manifest V3)
- `background.js` (Service Worker，任务调度+闹钟管理)
- `content.js` (DOM 操作引擎，核心签到逻辑)
- `popup/popup.html/js/css` (管理界面)
- `lib/anti-detect.js` (拟人化行为引擎)
- `lib/storage.js` (chrome.storage.local 封装)
- `lib/logger.js` (结构化日志)
- `lib/scheduler.js` (chrome.alarms 任务调度)
- `icons/` 图标资源

### 2026-05-19 ~ 05-20 — 7 轮修复

| # | 问题 | 根因 | 修复 |
|---|------|------|------|
| 1 | 搜索框输入失败 | humanType 只处理 contentEditable，未处理普通 input | 增加 isInput 判断，直接操作 value |
| 2 | 搜索结果匹配失败 | 输入群名后未等待搜索结果 DOM 渲染 | 增加 waitForElement 等待 + 延迟 |
| 3 | chatItemTitle 选择器不命中 & 搜索效率低 | 选择器不匹配实际 DOM | 更新选择器列表 + 搜索框直接赋值 |
| 4 | 消息输入框命中 contentEditable=false 的假元素 | 不验证是否真的可编辑 | 新增 waitForEditableInput 校验 |
| 5 | content.js 语法错误 & execCommand 输入失败 | 模板字符串中文引号 + textContent 在 Telegram 无效 | 字符串拼接 + execCommand('insertText') |
| 6 | 签到输入中断 MODULE is not defined | anti-detect.js 引用 content.js 变量 | 改为硬编码字符串 'anti-detect' |
| 7 | 打开聊天后跳回搜索框 | cleanupSearch 派发 Escape 键事件触发 Telegram 导航 | 移除 Escape 事件，仅清空值 |

## 关键技术决策

1. **所有数据本地存储**（chrome.storage.local），绝不上传
2. **拟人化行为引擎**：含输入打错修正(5%)、思考停顿(15%)、阅读暂停(50%)
3. **闹钟双重保障**：主闹钟(每天)+健康检查(15分钟)，防止闹钟丢失
4. **多选择器策略**：每个 DOM 元素都有备选选择器以兼容版本变化
5. **contentEditable 输入**：优先 execCommand('insertText') → 降级 textContent
6. **搜索框清理**：仅清空值，不派发键盘事件（避免触发导航）
7. **SPA DOM 监听**：使用 MutationObserver 等待元素出现

## 项目文件树

```
telegram-checkin-extension/
├── manifest.json
├── background.js
├── content.js
├── test.html
├── README.md
├── ARCHITECTURE.md
├── CHANGELOG.md
├── DEBUGGING.md
├── lib/
│   ├── anti-detect.js
│   ├── storage.js
│   ├── logger.js
│   └── scheduler.js
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## 归档位置

`my_project/telegram-checkin-extension/`

## 经验教训

1. **DOM 选择器必须基于实际页面验证**，不能假设选择器会命中
2. **Escape 键事件会触发 SPA 导航**，不可随意派发
3. **跨模块变量引用要小心**，lib 文件不能引用宿主文件的变量
4. **contentEditable 元素不能直接赋值**，必须走 execCommand 或合成事件
5. **React 合成事件体系**中，原生事件派发不一定能触发状态更新