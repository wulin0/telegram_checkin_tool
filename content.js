/**
 * Content Script — Telegram Web A 版签到执行引擎
 *
 * 运行在 https://web.telegram.org/a/* 页面上下文中
 * 负责 DOM 操作：搜索群聊、发送命令、判断签到结果
 */

(async function () {
  'use strict';

  const MODULE = 'ContentScript';

  Logger.info(MODULE, '签到助手 Content Script 已加载');

  // ─── Telegram Web A DOM 选择器 ───
  // Telegram Web A 是基于 React 的 SPA，选择器可能随版本变化
  // 使用多种策略兼容不同版本

  const Selectors = {
    // 搜索框
    searchInput: [
      '#telegram-search-input',
      'input.search-input',
      'input[placeholder*="搜索"]',
      'input[placeholder*="Search"]',
      '.chat-list-search input',
      '#search-input',
      'input.input-search',
      // 左侧栏 input
      '#LeftColumn input',
      '.left-column input',
    ],
    // 聊天列表中的群组项
    chatItem: [
      '.chat-item',
      '.chatlist-chat',
      '.ListItem-button',
      '.chat-list-item',
      '.ChatListItem',
      '.chat-item-clickable',
    ],
    // 聊天项的标题/名称
    chatItemTitle: [
      '.chat-title',
      '.fullName',
      '.chat-name',
      '.title',
      'h3',
      '.title-text',
      '.ChatInfo h4',
      '.peer-title',
      '.info .name',
      '.content .title',
    ],
    // 消息输入框 — Telegram Web A 使用 contentEditable div
    // ⚠️ #message-input-text 存在但 contentEditable=false，不能作为首选！
    messageInput: [
      // ★ 优先：精确匹配真正的可编辑元素
      'div[contenteditable="true"][data-placeholder]',
      '.input-message-input div[contenteditable="true"]',
      '.composer-area div[contenteditable="true"]',
      '#MiddleColumn div[contenteditable="true"]',
      '.middle-column div[contenteditable="true"]',
      // 中间列内搜索
      '#main-column div[contenteditable="true"]',
      '.messages-container + div div[contenteditable="true"]',
      // 宽松回退（必须带 contenteditable=true）
      'div[contenteditable="true"]',
      'div[data-placeholder]',
      // 最后才尝试 ID 选择器（可能命中不可编辑的容器）
      '#message-input-text',
      '#editable-message-text',
      '#input-message-text',
    ],
    // 发送按钮
    sendButton: [
      'button[type="submit"]',
      '.send-button',
      '.btn-send',
      'button.Button.send',
      'button[aria-label*="Send"]',
      'button[title*="Send"]',
      'button[aria-label*="发送"]',
      'button[title*="发送"]',
      // Telegram Web A 的 SVG 发送按钮
      'svg[data-animate-send]',
      '.Button.primary[title]',
      '#send-message-button',
      // 右下角提交按钮
      '.composer-area button',
    ],
    // 聊天区域的消息
    messageBubble: [
      '.message-text',
      '.text-content',
      '.MessageMeta',
      '.message',
      '.message-content',
      '.content-inner',
    ],
    // 左侧边栏（聊天列表容器）
    chatListContainer: [
      '.chat-list',
      '#chatlist-contacts',
      '.chat-list-container',
      '.left-column .scrollable',
    ],
    // 右侧聊天区
    chatArea: [
      '.chat',
      '#main-column',
      '.chat-container',
      '.messages-container',
    ],
    // 未登录标识
    loginIndicator: [
      '.auth-page',
      '#auth-qr-form',
      'input[name="phone_number"]',
      '.sign-in',
    ],
    // 验证码/风控标识
    verificationIndicator: [
      '.verification-code',
      '.captcha',
      'input[placeholder*="验证"]',
      'input[placeholder*="code"]',
      '.banned',
      '.restriction',
    ],
  };

  // ─── 选择器查找 ───

  /**
   * 按优先级尝试多个选择器，返回第一个找到的元素
   */
  function queryFirst(selectors, parent = document) {
    for (const sel of selectors) {
      try {
        const el = parent.querySelector(sel);
        if (el) return el;
      } catch (e) {
        // 选择器语法错误，跳过
      }
    }
    return null;
  }

  function queryAll(selectors, parent = document) {
    for (const sel of selectors) {
      try {
        const els = parent.querySelectorAll(sel);
        if (els.length > 0) return Array.from(els);
      } catch (e) {
        // 跳过
      }
    }
    return [];
  }

  // ─── MutationObserver 等待元素出现 ───

  /**
   * 等待指定选择器的元素出现在 DOM 中
   * @param {string[]|string} selectors - 选择器数组或单个字符串
   * @param {number} timeout - 超时 ms
   * @param {HTMLElement} [root=document.body]
   * @returns {Promise<HTMLElement|null>}
   */
  function waitForElement(selectors, timeout = 15000, root = document.body) {
    const selArray = Array.isArray(selectors) ? selectors : [selectors];
    return new Promise((resolve) => {
      const existing = queryFirst(selArray);
      if (existing) return resolve(existing);

      let resolved = false;
      const observer = new MutationObserver(() => {
        if (resolved) return;
        const el = queryFirst(selArray);
        if (el) {
          resolved = true;
          observer.disconnect();
          resolve(el);
        }
      });

      observer.observe(root, { childList: true, subtree: true });

      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        observer.disconnect();
        resolve(queryFirst(selArray));
      }, timeout);
    });
  }

  /**
   * 等待一个「真正可编辑」的消息输入框出现
   * 会过滤掉 contentEditable=false 的假元素
   * @param {number} timeout - 超时 ms
   * @returns {Promise<HTMLElement|null>}
   */
  function waitForEditableInput(timeout = 15000) {
    const start = Date.now();

    /** 校验元素是否是真正可编辑的输入框 */
    function findRealEditable() {
      // 策略1：直接找 contentEditable=true 的 div
      const ceEls = document.querySelectorAll('div[contenteditable="true"]');
      for (const el of ceEls) {
        // 排除明显不是消息输入框的元素（太小的、隐藏的）
        const rect = el.getBoundingClientRect();
        if (rect.width < 50 || rect.height < 20) continue;
        if (rect.width > window.innerWidth * 0.9) continue; // 太宽的也不是
        // 优先找有 placeholder 属性的（Telegram 输入框特征）
        if (el.dataset && el.dataset.placeholder || el.getAttribute('data-placeholder')) {
          Logger.debug(MODULE, '找到可编辑输入框(placeholder): id=' + el.id + ', class=' + (typeof el.className === 'string' ? el.className.slice(0, 50) : String(el.className).slice(0, 50)));
          return el;
        }
      }
      // 如果没找到带 placeholder 的，返回第一个尺寸合理的
      for (const el of ceEls) {
        const rect = el.getBoundingClientRect();
        if (rect.width < 50 || rect.height < 20) continue;
        if (el.closest('.chat-list, .left-column, .sidebar, header, nav')) continue; // 排除侧边栏等区域
        Logger.debug(MODULE, '找到可编辑输入框(回退): id=' + el.id + ', size=' + Math.round(rect.width) + 'x' + Math.round(rect.height));
        return el;
      }
      return null;
    }

    return new Promise((resolve) => {
      // 先检查
      const existing = findRealEditable();
      if (existing) return resolve(existing);

      let resolved = false;
      const observer = new MutationObserver(() => {
        if (resolved) return;
        const el = findRealEditable();
        if (el) {
          resolved = true;
          observer.disconnect();
          resolve(el);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['contenteditable'] });

      // 超时：输出诊断信息
      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        observer.disconnect();

        // 诊断：列出页面上所有 contentEditable 相关元素
        const allDivs = document.querySelectorAll('div[id*="input"], div[id*="message"], div[class*="input"], div[class*="composer"], div[contenteditable]');
        function getRectStr(el) {
          try { const r = el.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); }
          catch (err) { return '?'; }
        }
        function getClassNameSafe(el) {
          try { const cn = el.className; return typeof cn === 'string' ? cn.slice(0, 60) : String(cn).slice(0, 60); }
          catch { return ''; }
        }
        Logger.warn(MODULE, 'waitForEditableInput 超时(' + timeout + 'ms)，页面 DOM 诊断:', {
          totalContentEditable: document.querySelectorAll('div[contenteditable="true"]').length,
          candidateElements: Array.from(allDivs).slice(0, 10).map(function(e) {
            return {
              tag: e.tagName,
              id: e.id,
              class: getClassNameSafe(e),
              ce: e.contentEditable,
              rect: getRectStr(e),
              visible: e.offsetParent !== null,
            };
          })
        });
        resolve(null);
      }, timeout);
    });
  }

  // ─── 登录状态检测 ───

  async function checkLoginStatus() {
    const loginEl = queryFirst(Selectors.loginIndicator);
    if (loginEl) {
      Logger.warn(MODULE, '检测到未登录状态');
      return false;
    }

    const chatList = queryFirst(Selectors.chatListContainer);
    if (chatList) return true;

    Logger.debug(MODULE, '登录状态不确定，等待确认...');
    const result = await waitForElement(
      [...Selectors.chatListContainer, ...Selectors.loginIndicator],
      10000
    );
    if (!result) return false;

    return Selectors.chatListContainer.some(sel => {
      try { return result.matches(sel); } catch { return false; }
    });
  }

  // ─── 验证码/风控检测 ───

  function checkVerificationCaptcha() {
    const el = queryFirst(Selectors.verificationIndicator);
    if (el) {
      Logger.error(MODULE, '检测到验证码/风控拦截！停止所有自动化操作');
      return true;
    }
    return false;
  }

  // ─── 核心签到流程 ───

  /**
   * 搜索并打开群聊
   */
  async function openChat(groupName, settings) {
    Logger.info(MODULE, `搜索群聊: ${groupName}`);

    // 1. 找到并点击搜索框
    const searchInput = await waitForElement(Selectors.searchInput, 10000);
    if (!searchInput) {
      Logger.error(MODULE, '未找到搜索输入框');
      return false;
    }
    Logger.debug(MODULE, `找到搜索框: tag=${searchInput.tagName}, type=${searchInput.type}`);

    await AntiDetect.humanClick(searchInput, settings);
    await AntiDetect.humanDelay(settings);

    // 2. 直接填入群名（搜索框不需要拟人化输入，效率优先）
    // 使用原生 setter 确保 React 能感知值变化
    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype, 'value'
    )?.set;
    if (searchInput.tagName === 'INPUT') {
      if (nativeSetter) {
        nativeSetter.call(searchInput, groupName);
      } else {
        searchInput.value = groupName;
      }
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      searchInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    Logger.info(MODULE, `已直接填入搜索关键词: "${groupName}"`);

    // 3. 等待搜索结果出现
    Logger.debug(MODULE, '等待搜索结果 DOM 出现...');
    const searchResult = await waitForElement(Selectors.chatItem, 8000);
    if (!searchResult) {
      Logger.error(MODULE, `搜索"${groupName}"超时`);
      cleanupSearch(searchInput);
      return false;
    }
    await AntiDetect.sleep(500); // 额外等待渲染

    const chatItems = queryAll(Selectors.chatItem);
    Logger.debug(MODULE, `搜索结果: ${chatItems.length} 个聊天项`);

    if (chatItems.length === 0) {
      Logger.error(MODULE, `搜索"${groupName}"无结果`);
      cleanupSearch(searchInput);
      return false;
    }

    // 查找匹配项 — 多策略获取群名
    let targetItem = null;
    for (const item of chatItems) {
      let title = '';
      const titleEl = queryFirst(Selectors.chatItemTitle, item);
      if (titleEl) {
        title = titleEl.textContent.trim();
      } else {
        // 兜底：直接读 item 文本，取第一行（通常是群名）
        title = (item.textContent || '').trim().split('\n')[0].trim();
      }

      Logger.debug(MODULE, `搜索结果项: "${title.slice(0, 35) || '(empty)'}"`);

      if (title && (title.includes(groupName) || groupName.includes(title))) {
        targetItem = item;
        Logger.info(MODULE, `精确匹配到群: ${title}`);
        break;
      }
    }

    if (!targetItem) {
      Logger.warn(MODULE, `未精确匹配，使用第一个结果`);
      targetItem = chatItems[0];
    }

    // 4. 点击打开群聊
    await AntiDetect.humanClick(targetItem, settings);
    Logger.debug(MODULE, '已点击群组，等待聊天窗口加载...');
    await AntiDetect.humanDelay(settings, 2);

    // 5. 清理搜索框
    cleanupSearch(searchInput);
    await AntiDetect.humanDelay(settings, 0.5);

    Logger.info(MODULE, `已打开群聊: ${groupName}`);
    return true;
  }

  function cleanupSearch(searchInput) {
    // 只清空搜索框的值，不派发键盘事件
    // ⚠️ Escape 键会触发 Telegram Web A 关闭当前聊天、回到搜索框
    if (!searchInput) return;
    if (searchInput.tagName === 'INPUT') {
      searchInput.value = '';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  /**
   * 检查是否已签到
   */
  function checkAlreadySigned() {
    const messages = queryAll(Selectors.messageBubble);
    const recentMessages = messages.slice(-10);
    const signedPatterns = [
      /已经签到/, /already signed/i, /已签到/, /签到成功/,
      /check[- ]in success/i, /今日已签/, /重复签到/, /already checked/i,
    ];
    for (const msg of recentMessages) {
      const text = msg.textContent || '';
      if (signedPatterns.some(p => p.test(text))) {
        return { alreadySigned: true, reason: text.trim().slice(0, 100) };
      }
    }
    return { alreadySigned: false, reason: '' };
  }

  /**
   * 发送签到命令
   */
  async function sendCheckinCommand(keyword, settings) {
    Logger.info(MODULE, `发送签到命令: ${keyword}`);

    // 1. 智能判断是否已签到
    if (settings.checkAlreadySigned) {
      const { alreadySigned, reason } = checkAlreadySigned();
      if (alreadySigned) {
        Logger.info(MODULE, `今日已签到，跳过: ${reason}`);
        return { success: true, message: `今日已签到: ${reason}` };
      }
    }

    // 2. 找到「真正可编辑的」消息输入框（过滤掉 contentEditable=false 的假元素）
    Logger.debug(MODULE, '等待可编辑消息输入框就绪...');
    let messageInput = await waitForEditableInput(15000);

    // 如果 waitForEditableInput 没找到，降级尝试旧方法但做校验
    if (!messageInput) {
      Logger.warn(MODULE, 'waitForEditableInput 未命中，降级使用选择器查找+校验...');
      const candidate = await waitForElement(Selectors.messageInput, 8000);
      if (candidate && (candidate.isContentEditable || candidate.contentEditable === 'true')) {
        messageInput = candidate;
        Logger.info(MODULE, '降级查找成功，元素可编辑');
      }
    }

    if (!messageInput) {
      const allCE = document.querySelectorAll('div[contenteditable="true"]');
      Logger.error(MODULE, `未找到可编辑的消息输入框。页面 CE 元素数: ${allCE.length}`, {
        contentEditables: Array.from(allCE).map(e => ({
          id: e.id, class: (e.className?.toString() || '').slice(0, 50),
          ce: e.contentEditable,
          placeholder: e.dataset?.placeholder || e.getAttribute('data-placeholder'),
        }))
      });
      return { success: false, message: '未找到可编辑的消息输入框' };
    }

    const tag = messageInput.tagName;
    const isCE = messageInput.isContentEditable || messageInput.contentEditable === 'true';
    Logger.info(MODULE, `✅ 找到有效输入框: tag=${tag}, contentEditable=${isCE}, id=${messageInput.id || '(无)'}, class=${(messageInput.className?.toString()||'').slice(0,60)}`);

    // 3. 点击 + 聚焦
    await AntiDetect.humanClick(messageInput, settings);
    await AntiDetect.humanDelay(settings, 0.5);

    // 清空已有内容（humanType 内部也会清空，这里做预清空确保干净）
    // 注意：不再手动清空，交给 humanType 统一处理，避免重复清空导致问题

    // 4. 模拟真实逐字输入（内部包含清空→逐字输入→确认的完整流程）
    Logger.info(MODULE, '开始输入签到关键词: "' + keyword + '" (' + keyword.length + '字符)');
    await AntiDetect.humanType(messageInput, keyword, settings);

    // 验证输入结果
    var currentContent = isCE ? messageInput.textContent : messageInput.value;
    Logger.info(MODULE, '输入完成，当前内容: "' + currentContent + '" (长度:' + currentContent.length + ')');

    // ★ 如果内容为空或长度不对，说明输入失败，不要继续发送
    if (currentContent.length === 0) {
      Logger.error(MODULE, '输入框内容为空！输入可能未生效，中止发送');
      return { success: false, message: '输入未生效：输入框内容为空' };
    }
    if (currentContent.length < keyword.length * 0.8) {
      Logger.warn(MODULE, '输入内容不完整：期望' + keyword.length + '字，实际' + currentContent.length + '字。仍尝试发送。');
    }

    // 额外等待，确保 Telegram React 状态同步完成
    await AntiDetect.sleep(800);

    // 5. 发送消息
    const sendBtn = queryFirst(Selectors.sendButton);
    if (sendBtn) {
      // 优先点击发送按钮
      Logger.info(MODULE, `找到发送按钮，点击发送`);
      await AntiDetect.humanClick(sendBtn, settings);
      Logger.info(MODULE, '已点击发送按钮');
    } else {
      // 没有按钮，用 Enter 键发送
      Logger.info(MODULE, '未找到发送按钮，使用 Enter 键发送');
      messageInput.focus();
      await AntiDetect.sleep(100);

      const enterBase = {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
        bubbles: true, cancelable: true, composed: true,
      };

      for (const evtType of ['keydown', 'keypress', 'keyup']) {
        const opts = { ...enterBase };
        if (evtType === 'keypress') opts.charCode = 13;
        messageInput.dispatchEvent(new KeyboardEvent(evtType, opts));
      }
      Logger.info(MODULE, '已派发 Enter 键事件');
    }

    // 等待响应
    await AntiDetect.humanDelay(settings, 1.5);

    // 6. 判断结果
    return await checkCheckinResult(keyword);
  }

  /**
   * 检查签到结果
   */
  async function checkCheckinResult(keyword) {
    await AntiDetect.sleep(2500);

    if (checkVerificationCaptcha()) {
      return {
        success: false,
        message: '检测到验证码/风控拦截，需人工处理',
        reason: 'verification'
      };
    }

    const messages = queryAll(Selectors.messageBubble);
    const recent = messages.slice(-5);
    const recentText = recent.map(m => m.textContent || '').join(' ');

    const successPatterns = [
      /签到成功/, /check[- ]in success/i, /已签到/,
      /获得.*积分/, /获得.*experience/i, /连续签到/, /streak/i,
    ];
    const failPatterns = [
      /签到失败/, /check[- ]in fail/i, /操作频繁/,
      /flood/i, /稍后再试/, /try again/i,
    ];
    const alreadyPatterns = [
      /已经签到/, /already signed/i, /今日已签/,
      /重复签到/, /already checked/i,
    ];

    if (successPatterns.some(p => p.test(recentText))) {
      Logger.info(MODULE, '签到成功');
      return { success: true, message: '签到成功' };
    }
    if (alreadyPatterns.some(p => p.test(recentText))) {
      Logger.info(MODULE, '今日已签到');
      return { success: true, message: '今日已签到' };
    }
    if (failPatterns.some(p => p.test(recentText))) {
      Logger.warn(MODULE, `签到失败: ${recentText.slice(0, 200)}`);
      return { success: false, message: `失败: ${recentText.slice(0, 100)}` };
    }

    Logger.info(MODULE, '命令已发送');
    return { success: true, message: '命令已发送' };
  }

  // ─── 主签到流程 ───

  async function runCheckin() {
    Logger.info(MODULE, '========== 开始签到 ==========');

    const settings = await Storage.getSettings();
    if (!settings.enabled) {
      Logger.info(MODULE, '签到功能已禁用');
      return;
    }

    const isLoggedIn = await checkLoginStatus();
    if (!isLoggedIn) {
      Logger.error(MODULE, '未登录，暂停签到');
      chrome.runtime.sendMessage({ action: 'login_required' }).catch(() => {});
      chrome.runtime.sendMessage({
        action: 'send_notification',
        title: 'Telegram 签到助手',
        message: 'Telegram 未登录，请手动登录后重试',
      }).catch(() => {});
      return;
    }

    const groups = await Storage.getGroups();
    const enabledGroups = groups.filter(g => g.enabled && g.status !== 'error');
    if (enabledGroups.length === 0) {
      Logger.info(MODULE, '无待签到群组');
      return;
    }

    const shuffled = AntiDetect.shuffle(enabledGroups);
    await Storage.updateState({ isRunning: true, currentTask: `签到 ${shuffled.length} 个群组` });

    const results = [];

    for (const group of shuffled) {
      Logger.info(MODULE, `--- ${group.name} (${group.keyword}) ---`);

      let result = null;
      let retryCount = 0;

      while (retryCount <= settings.retryCount) {
        try {
          const opened = await openChat(group.name, settings);
          if (!opened) {
            result = { success: false, message: `无法打开群聊: ${group.name}` };
            break;
          }
          await AntiDetect.readingPause();
          result = await sendCheckinCommand(group.keyword, settings);
          if (result.success) break;
          if (result.reason === 'verification') {
            Logger.error(MODULE, '验证码拦截，停止全部操作');
            await Storage.updateGroup(group.id, { status: 'error' });
            chrome.runtime.sendMessage({
              action: 'send_notification',
              title: '⚠️ Telegram 签到 - 需人工处理',
              message: `群 "${group.name}" 触发了验证码，已停止自动化`,
            }).catch(() => {});
            results.push({ group, result });
            break;
          }
          retryCount++;
          if (retryCount <= settings.retryCount) {
            Logger.info(MODULE, `重试 ${retryCount}/${settings.retryCount}`);
            await AntiDetect.sleep(settings.retryDelay);
          }
        } catch (err) {
          Logger.error(MODULE, `异常: ${err.message}`);
          result = { success: false, message: err.message };
          retryCount++;
          if (retryCount <= settings.retryCount) {
            await AntiDetect.sleep(settings.retryDelay);
          }
        }
      }

      if (result) {
        await Storage.updateCheckinResult(group.id, result);
        results.push({ group, result });
      }
      await AntiDetect.humanDelay(settings, 3, randInt(3000, 6000));
    }

    Logger.info(MODULE, '========== 签到完成 ==========', {
      total: shuffled.length,
      success: results.filter(r => r.result?.success).length,
      fail: results.filter(r => !r.result?.success).length,
    });

    await Storage.updateState({ isRunning: false, currentTask: null });
    chrome.runtime.sendMessage({ action: 'checkin_complete', results }).catch(() => {});
  }

  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // ─── 消息监听 ───

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'runCheckin') {
      Logger.info(MODULE, '收到签到指令');
      runCheckin()
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (msg.action === 'testCheckin') {
      const { groupName, keyword } = msg;
      Logger.info(MODULE, `手动测试签到: ${groupName} / ${keyword}`);
      (async () => {
        const settings = await Storage.getSettings();
        const opened = await openChat(groupName, settings);
        if (!opened) {
          sendResponse({ success: false, message: '无法打开群聊' });
          return;
        }
        const result = await sendCheckinCommand(keyword, settings);
        sendResponse(result);
      })();
      return true;
    }

    if (msg.action === 'checkLogin') {
      checkLoginStatus().then(status => sendResponse({ isLoggedIn: status }));
      return true;
    }
  });

  Logger.info(MODULE, 'Telegram 签到助手已就绪');
})();