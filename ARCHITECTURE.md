# 架构设计文档 — Telegram 智能签到助手

## 概述

Telegram 智能签到助手是一个 Chrome Manifest V3 扩展，在 Telegram Web A (`https://web.telegram.org/a/`) 上实现多群组自动化签到。

## 架构图

```
┌─────────────────────────────────────────────────────────┐
│                    Chrome Extension                      │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │  popup/      │  │  background  │  │ content.js    │ │
│  │  popup.html  │  │  .js         │  │ (页面引擎)     │ │
│  │  popup.js    │◄─┤  (SW)        │◄─┤               │ │
│  │  popup.css   │  │              │  │  lib/         │ │
│  └──────────────┘  │  调度/闹钟    │  │  ├─ anti-detect│ │
│        ▲           │  消息中转    │  │  ├─ storage   │ │
│        │           └──────────────┘  │  ├─ logger    │ │
│        │           chrome.alarms     │  └─ scheduler  │ │
│        │           chrome.storage    └───────────────┘ │
│        ▼                              ▲                │
│  ┌────────────────────────────────────┘                │
│  │          chrome.storage.local                       │
│  │  ┌──────────┬──────────┬──────────┬──────────┐     │
│  │  │ groups   │ history  │ settings │ state    │     │
│  │  └──────────┴──────────┴──────────┴──────────┘     │
│  └─────────────────────────────────────────────────────┘
│                         ▲                               │
└─────────────────────────┼───────────────────────────────┘
                          │
                Telegram Web A (DOM)
```

## 组件详解

### 1. Service Worker (background.js)

**职责**：后台大脑，即使 Popup 关闭也能运行。

| 功能 | 说明 |
|------|------|
| 闹钟管理 | 使用 `chrome.alarms` 创建每日签到闹钟 + 15分钟健康检查 |
| 任务派发 | 向 Telegram 标签页发送 `runCheckin` 消息 |
| 消息中转 | 转发通知请求、登录检测结果等 |
| 生命周期 | 处理 `onInstalled`、`onStartup` 事件 |

**闹钟策略**：
- **主闹钟** (`tg_checkin_daily`)：每天触发一次，时间基于 `baseTime ± jitterMinutes` 随机偏移
- **健康检查闹钟** (`tg_checkin_health`)：每15分钟检查主闹钟是否存在，检测遗漏任务

**Task Dispatch Flow**：
```
alarm触发 → 查找Telegram标签页
              ├─ 存在 → sendMessage('runCheckin')
              └─ 不存在 → 创建新标签页 → 等待load → 延迟5s → sendMessage
```

### 2. Content Script (content.js)

**职责**：DOM 操作引擎，所有签到逻辑的核心。

**运行环境**：仅注入到 `https://web.telegram.org/a/*`

**核心流程**：
```
runCheckin()
  ├─ checkLoginStatus()          → 登录检测
  ├─ shuffle(groups)              → 随机打乱群组顺序
  └─ for each group:
       ├─ openChat(name)          → 搜索+打开群聊
       ├─ readingPause()          → 模拟阅读暂停
       ├─ sendCheckinCommand()    → 输入+发送命令
       └─ checkCheckinResult()    → 判断结果
```

#### openChat 流程
```
1. 找到搜索框 → 点击聚焦
2. 填入群名 → 派发 input/change 事件
3. 等待搜索结果 DOM 出现 (waitForElement, 8s超时)
4. 匹配群名（多策略：titleEl.textContent || 兜底 textContent 第一行）
5. 精确匹配优先 → 回退到第一个结果
6. 点击打开群聊 → 等待加载
7. 清理搜索框（仅清空值，不派发键盘事件）
```

#### sendCheckinCommand 流程
```
1. checkAlreadySigned() → 智能跳过已签到
2. waitForEditableInput(15s) → 找到真正可编辑的输入框
   └─ 策略：优先 data-placeholder 属性 → 回退尺寸合理 → 排除侧边栏
3. humanClick → 聚焦
4. humanType → 逐字拟人输入
5. 验证输入结果 → 空内容则中止
6. 点击发送按钮 / Enter 键发送
7. checkCheckinResult(2.5s后) → 判断签到结果
```

### 3. 拟人化行为引擎 (lib/anti-detect.js)

**职责**：防封核心，所有操作模拟人类行为。

| 能力 | 实现 |
|------|------|
| 随机延迟 | `humanDelay`: 800-3000ms 随机 + 乘数因子 |
| 键盘输入 | `humanType`: 逐字 keydown→keypress→input→keyup 完整序列 |
| 打错修正 | 5%概率输入错误字符 → Backspace删除 → 重新输入 |
| 鼠标点击 | `humanClick`: mouseover→mousedown→mouseup→click + pointer events |
| 时间抖动 | `jitterTime`: 基准时间 ±N 分钟随机偏移 |
| 平滑滚动 | `smoothScrollTo`: easeInOutCubic 缓动 |
| 阅读暂停 | `readingPause`: 50%概率 500-1500ms 暂停 |

**键盘输入细节**：
- **contentEditable 元素**：优选 `execCommand('insertText')`，降级为 `textContent` 拼接
- **Input 元素**：直接操作 `value` 属性
- **每字符间隔**：50-150ms 随机
- **15%概率**长停顿 300-800ms（模拟思考）

### 4. 存储层 (lib/storage.js)

**存储键**：
| Key | 内容 | 结构 |
|-----|------|------|
| `checkin_groups` | 群组列表 | `[{id, name, keyword, enabled, lastCheckin, status}]` |
| `checkin_history` | 签到历史（上限1000条） | `[{groupId, timestamp, result}]` |
| `checkin_settings` | 全局设置 | `{enabled, baseTime, jitterMinutes, delays...}` |
| `checkin_state` | 运行时状态 | `{isRunning, currentTask, loginStatus}` |
| `checkin_logs` | 日志（上限500条） | `[{timestamp, level, module, message}]` |

### 5. 日志系统 (lib/logger.js)

- 同时输出到 console 和 chrome.storage
- 支持分级：debug / info / warn / error
- 支持按级别、模块、时间范围过滤查询
- 自动截断（500条上限）

### 6. Popup UI (popup/)

- 群组管理（添加/删除/启用/禁用/批量添加）
- 签到测试（单群组手动测试）
- 设置面板（基准时间、延迟范围、重试策略等）
- 实时日志查看
- 签到历史

## 数据流

```
用户操作 Popup → chrome.storage → background.js 读取配置
                                       ↓
                               chrome.alarms 定时触发
                                       ↓
                               查找 Telegram 标签页
                                       ↓
                              chrome.tabs.sendMessage
                                       ↓
                              content.js 接收 runCheckin
                                       ↓
                              DOM 操作（搜索→输入→发送）
                                       ↓
                              结果写入 chrome.storage
                                       ↓
                              background 发送桌面通知
```

## 安全设计

- 所有数据存储在 `chrome.storage.local`，不上传第三方服务器
- 最小权限原则（storage, alarms, notifications, activeTab）
- 仅注入 `https://web.telegram.org/a/*` 页面
- 零外部网络请求（除 Telegram 自身流量）

## 容错机制

| 场景 | 处理 |
|------|------|
| 未登录 | 检测 auth-page 元素 → 暂停 → 通知用户 |
| 验证码/风控 | 检测 captcha 元素 → 停止所有操作 → 通知用户 |
| 输入框未就绪 | waitForEditableInput(15s) → 超时诊断DOM → 降级查找 |
| 签到失败 | 按 retryCount 重试，每次间隔 retryDelay |
| 元素不存在 | 多选择器策略 + MutationObserver 等待 |
| 闹钟丢失 | 15分钟健康检查自动恢复 |