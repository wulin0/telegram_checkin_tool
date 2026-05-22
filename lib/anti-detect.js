/**
 * AntiDetect — 拟人化行为引擎（防封核心）
 *
 * 核心策略：
 * 1. 随机延迟（非固定间隔）
 * 2. 模拟真实键盘输入（逐字符 keydown/keypress/input/keyup 序列）
 * 3. 鼠标轨迹模拟（mouseover → mousedown → mouseup）
 * 4. 随机时间抖动（打破定时规律）
 *
 * 绝对不使用：
 * - 固定的 setInterval
 * - 直接的 element.click()
 * - input.value 直接赋值
 */
const AntiDetect = (() => {

  // ─── 随机工具 ───

  /** [min, max] 随机整数 */
  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /** [min, max) 随机浮点数 */
  function randFloat(min, max) {
    return Math.random() * (max - min) + min;
  }

  /** 随机打乱数组（Fisher-Yates） */
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ─── 睡眠 ───

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ─── 1. 随机延迟 ───

  /**
   * 随机人类延迟（基于配置文件设定）
   * @param {object} settings - { actionDelayMin, actionDelayMax }
   * @param {number} [multiplier=1] - 乘数因子（某些操作需要更多时间）
   * @param {number} [baseDelay=0] - 基础额外延迟
   */
  async function humanDelay(settings, multiplier = 1, baseDelay = 0) {
    const min = (settings.actionDelayMin || 800) * multiplier;
    const max = (settings.actionDelayMax || 3000) * multiplier;
    const delay = randInt(min, max) + baseDelay;
    await sleep(delay);
  }

  /**
   * 短暂暂停（模拟阅读/查看暂停）
   */
  async function readingPause() {
    // 50%概率暂停 500ms-1500ms 模拟阅读
    if (Math.random() < 0.5) {
      await sleep(randInt(500, 1500));
    }
  }

  // ─── 2. 真实键盘输入模拟 ───

  /**
   * 模拟真实键盘逐字输入
   * @param {HTMLElement} element - 目标输入框
   * @param {string} text - 要输入的文本
   * @param {object} settings
   */
  async function humanType(element, text, settings) {
    if (!element) {
      throw new Error('输入元素不存在');
    }

    await focusElement(element, settings);

    // 判断元素类型
    const isInput = element.tagName === 'INPUT' || element.tagName === 'TEXTAREA';
    const isCE = element.isContentEditable || element.contentEditable === 'true';

    // ── 清空已有内容 ──
    if (isInput) {
      element.value = '';
      element.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (isCE) {
      // contentEditable: 用 execCommand 全选删除（最可靠）
      element.focus();
      // 先尝试用 execCommand 全选+删除
      try {
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
      } catch (e) {
        // 降级：直接清空文本
        element.textContent = '';
      }
      element.dispatchEvent(new InputEvent('input', {
        inputType: 'deleteContentBackward',
        bubbles: true, cancelable: true, composed: true,
      }));
    } else {
      element.textContent = '';
    }

    // 短暂停顿后再开始输入
    await sleep(randInt(100, 200));

    // ── 逐字符输入 ──
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const typingDelay = randInt(
        settings.typingSpeedMin || 50,
        settings.typingSpeedMax || 150
      );

      // 偶尔打错再修正（5%概率）
      if (i > 0 && Math.random() < 0.05) {
        const wrongCharCode = text.charCodeAt(i - 1) + randInt(1, 3);
        const wrongChar = String.fromCharCode(Math.min(wrongCharCode, 126));

        simulateKeyEvent(element, 'keydown', wrongChar);
        simulateKeyEvent(element, 'keypress', wrongChar);
        insertChar(element, wrongChar, isCE, isInput);
        simulateKeyEvent(element, 'input', wrongChar);
        simulateKeyEvent(element, 'keyup', wrongChar);

        await sleep(randInt(100, 250));

        // Backspace 删除错误字符
        simulateKeyEvent(element, 'keydown', 'Backspace');
        simulateKeyEvent(element, 'keyup', 'Backspace');
        try {
          document.execCommand('delete', false, null);
        } catch (e) {
          if (isCE) {
            element.textContent = element.textContent.slice(0, -1);
          } else if (isInput) {
            element.value = element.value.slice(0, -1);
          }
        }
        element.dispatchEvent(new InputEvent('input', {
          inputType: 'deleteContentBackward',
          bubbles: true, cancelable: true, composed: true,
        }));

        await sleep(randInt(80, 200));
      }

      // 正常输入字符
      simulateKeyEvent(element, 'keydown', char);
      simulateKeyEvent(element, 'keypress', char);
      insertChar(element, char, isCE, isInput);
      simulateKeyEvent(element, 'input', char);
      simulateKeyEvent(element, 'keyup', char);

      // ★ 等待本次字符输入完成再继续下一个
      await sleep(typingDelay);

      // 偶尔长停顿（15%概率，模拟思考或分心）
      if (Math.random() < 0.15) {
        await sleep(randInt(300, 800));
      }
    }

    // 输入完成后派发 change 事件
    if (isInput) {
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // 最终确认：输出当前内容用于调试
    var finalContent = isCE ? element.textContent : element.value;
    Logger.debug('anti-detect', 'humanType 输入完成, 内容长度=' + finalContent.length + ', 内容="' + finalContent + '"');
  }

  /**
   * 向元素插入一个字符（根据元素类型选择最佳方式）
   */
  function insertChar(element, char, isCE, isInput) {
    if (isCE) {
      // ★ contentEditable 首选 execCommand（让浏览器/React 原生处理）
      try {
        document.execCommand('insertText', false, char);
      } catch (e) {
        // execCommand 不可用时降级为 textContent 拼接
        element.textContent += char;
      }
    } else if (isInput) {
      element.value += char;
    } else {
      element.textContent += char;
    }
  }

  /**
   * 模拟键盘事件
   */
  function simulateKeyEvent(element, eventType, char) {
    const isBackspace = char === 'Backspace';
    const keyCode = isBackspace ? 8 : char.charCodeAt(0);

    const eventInit = {
      key: char,
      code: isBackspace ? 'Backspace' : ('Key' + char.toUpperCase()),
      keyCode: keyCode,
      which: keyCode,
      bubbles: true,
      cancelable: true,
      composed: true,
      charCode: eventType === 'keypress' ? keyCode : 0,
    };

    element.dispatchEvent(new KeyboardEvent(eventType, eventInit));
    // 也派发 InputEvent（部分框架依赖此事件）
    if (eventType === 'input') {
      element.dispatchEvent(new InputEvent('input', {
        inputType: isBackspace ? 'deleteContentBackward' : 'insertText',
        data: isBackspace ? null : char,
        bubbles: true,
        cancelable: true,
        composed: true,
      }));
    }
  }

  // ─── 3. 鼠标事件模拟 ───

  /**
   * 模拟真实鼠标点击
   * @param {HTMLElement} element
   * @param {object} settings
   */
  async function humanClick(element, settings) {
    if (!element) throw new Error('点击元素不存在');

    // 先聚焦
    await focusElement(element, settings);

    // 微小随机延迟（模拟人移动鼠标的时间）
    await sleep(randInt(50, 150));

    // 触发鼠标事件序列
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width * randFloat(0.3, 0.7);
    const y = rect.top + rect.height * randFloat(0.3, 0.7);

    const mouseOpts = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      button: 0,
      buttons: 1,
      view: window,
    };

    // 1. mouseover → 鼠标移入
    element.dispatchEvent(new MouseEvent('mouseover', {
      ...mouseOpts, buttons: 0
    }));

    await sleep(randInt(20, 60));

    // 2. mousedown → 按下
    element.dispatchEvent(new MouseEvent('mousedown', mouseOpts));

    // 按下保持一段时间（模拟人类按下延迟）
    await sleep(randInt(40, 120));

    // 3. mouseup → 释放
    element.dispatchEvent(new MouseEvent('mouseup', mouseOpts));

    // 4. click → 完整点击
    element.dispatchEvent(new MouseEvent('click', mouseOpts));

    // 5. 也触发 pointer events（部分新版 UI 使用）
    element.dispatchEvent(new PointerEvent('pointerdown', {
      ...mouseOpts, pointerId: 1, pointerType: 'mouse',
    }));
    element.dispatchEvent(new PointerEvent('pointerup', {
      ...mouseOpts, pointerId: 1, pointerType: 'mouse',
    }));

    await sleep(randInt(100, 300));
  }

  // ─── 4. 聚焦模拟 ───

  async function focusElement(element, settings) {
    if (document.activeElement !== element) {
      element.focus();
      // 模拟点击到聚焦的微小延迟
      await sleep(randInt(30, 80));
    }
  }

  // ─── 5. 随机时间抖动 ───

  /**
   * 基于基准时间生成随机偏移
   * @param {string} baseTime - "HH:MM" 格式
   * @param {number} jitterMinutes - 抖动范围（分钟）
   * @returns {{hour: number, minute: number, isoTimestamp: string}}
   */
  function jitterTime(baseTime, jitterMinutes) {
    const [h, m] = baseTime.split(':').map(Number);
    const base = new Date();
    base.setHours(h, m, 0, 0);

    // 随机偏移 [ -jitterMinutes, +jitterMinutes ]
    const offsetMs = randInt(-jitterMinutes * 60000, jitterMinutes * 60000);
    const jittered = new Date(base.getTime() + offsetMs);

    return {
      hour: jittered.getHours(),
      minute: jittered.getMinutes(),
      isoTimestamp: jittered.toISOString()
    };
  }

  // ─── 6. 页面滚动模拟 ───

  /**
   * 逐步滚动（而非瞬间跳转）
   */
  async function smoothScrollTo(container, targetY, duration = 500) {
    const startY = container.scrollTop;
    const distance = targetY - startY;
    const startTime = performance.now();

    return new Promise((resolve) => {
      function step(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // easeInOutCubic 缓动
        const eased = progress < 0.5
          ? 4 * progress * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;
        container.scrollTop = startY + distance * eased;

        if (progress < 1) {
          requestAnimationFrame(step);
        } else {
          resolve();
        }
      }
      requestAnimationFrame(step);
    });
  }

  // ─── 导出 ───

  return {
    randInt, randFloat, shuffle,
    sleep, humanDelay, readingPause,
    humanType, humanClick,
    simulateKeyEvent, focusElement,
    jitterTime, smoothScrollTo,
  };
})();