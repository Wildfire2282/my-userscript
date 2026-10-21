/**
 * super-drag 的真实浏览器验收场景。
 *
 * 由 `node tools/browser-check.mjs super-drag` 调用。每个场景是一行「场景 → 预期 → 实际」，
 * 失败只给出差异，不打印堆栈；页面里的异常由 browser-check 单独收集。
 */

export async function run(ctx) {
  const results = [];
  const record = (scenario, expected, actual) => {
    const actualText = typeof actual === 'string' ? actual : JSON.stringify(actual);
    results.push({
      scenario,
      expected: String(expected),
      actual: actualText,
      pass: String(expected) === actualText,
    });
  };

  /** 选中 #text 并拖到同一位置（或指定落点）。 */
  const dragSelectedText = (dropSelector) =>
    ctx.evaluate((dropSel) => {
      const paragraph = document.querySelector('#text');
      const point = window.__page.select(paragraph);
      const dropTarget = dropSel ? document.querySelector(dropSel) : paragraph;
      return {
        selected: point.text,
        claimed: window.__page.drag(paragraph, dropTarget, { point }),
      };
    }, dropSelector ?? null);

  // 1. 选中文字拖动 → 搜索
  const textDrag = await dragSelectedText();
  const searchedText = await ctx.evaluate(() => window.__page.lastOpened());
  record(
    '选中文字拖动 → 用 Google 搜索（后台）',
    `https://www.google.com/search?q=${encodeURIComponent(textDrag.selected)} / active=false`,
    `${searchedText?.url} / active=${String(searchedText?.options?.active)}`,
  );

  // 2. dragstart 必须写入 text/plain，否则 Firefox 不启动拖拽
  record('拖拽数据里带 text/plain', textDrag.selected, textDrag.claimed);

  // 3. 拖链接 → 打开链接
  const linkDrag = await ctx.evaluate(() => {
    window.__page.clearSelection();
    const link = document.querySelector('#link');
    const claimed = window.__page.drag(link, link);
    return { claimed, opened: window.__page.lastOpened() };
  });
  record(
    '拖链接 → 打开链接地址（后台）',
    'https://example.com/target?from=fixture&x=1 / active=false',
    `${linkDrag.opened?.url} / active=${String(linkDrag.opened?.options?.active)}`,
  );

  // 4. 按住 Shift → 这一次前台打开
  const shiftDrag = await ctx.evaluate(() => {
    const link = document.querySelector('#link');
    window.__page.drag(link, link, { shiftKey: true });
    return window.__page.lastOpened();
  });
  record('按住 Shift 拖链接 → 前台打开', 'true', String(shiftDrag?.options?.active === true));

  // 5. 拖图片 → 深色查看器（blob）里带原图地址
  const imageDrag = await ctx.evaluate(async () => {
    const image = document.querySelector('#image');
    window.__page.drag(image, image);
    const opened = window.__page.lastOpened();
    if (!opened) return { url: '', content: '' };
    const content = await (await fetch(opened.url)).text();
    return { url: opened.url, content };
  });
  record(
    '拖图片 → 打开查看器页面并带上原图地址',
    'blob: 开头且包含原图地址',
    `${imageDrag.url.startsWith('blob:') ? 'blob: 开头' : imageDrag.url}且${
      imageDrag.content.includes('https://example.com/image.png') ? '包含' : '不包含'
    }原图地址`,
  );

  // 6. 拖进输入框 → 交给页面处理，不打开任何页面
  const beforeInputDrop = await ctx.evaluate(() => window.__page.openedCount());
  const inputDrop = await dragSelectedText('#field');
  const afterInputDrop = await ctx.evaluate(() => window.__page.openedCount());
  record(
    '拖进输入框 → 不接管、不打开页面',
    `${String(beforeInputDrop)}（已有拖拽数据：${String(Boolean(inputDrop.claimed))}）`,
    `${String(afterInputDrop)}（已有拖拽数据：${String(Boolean(inputDrop.claimed))}）`,
  );

  // 7. drop 之后浏览器补发的那一次 click 被吞掉，之后的点击恢复正常
  const clickAfterDrop = await ctx.evaluate(() => {
    document.querySelector('#click-area').click();
    const swallowed = window.__clicks;
    document.querySelector('#click-area').click();
    return { swallowed, restored: window.__clicks };
  });
  record('拖拽后的那一次点击被吞掉', '0', String(clickAfterDrop.swallowed));
  record('之后的点击照常送达页面', '1', String(clickAfterDrop.restored));

  // 8. 没有任何可拖内容的空白处 → 不接管
  const plainDrag = await ctx.evaluate(() => {
    window.__page.clearSelection();
    const paragraph = document.querySelector('#text');
    return window.__page.drag(paragraph, paragraph);
  });
  record('没有选中文字时拖普通段落 → 不接管', '', plainDrag);

  // 9. Shadow DOM 里的链接也能认领
  const shadowDrag = await ctx.evaluate(() => {
    const link = document.querySelector('#shadow-host').shadowRoot.getElementById('shadow-link');
    window.__page.drag(link, link);
    return window.__page.lastOpened();
  });
  record(
    '拖 Shadow DOM 里的链接 → 打开该链接',
    'https://example.com/shadow',
    shadowDrag?.url ?? '',
  );

  // 10. 菜单项能打开设置面板
  const menuState = await ctx.evaluate(() => {
    const available = typeof window.__gm.menu === 'function';
    window.__gm.menu?.();
    const panel = window.__page.panel();
    return {
      available,
      label: window.__gm.menuLabel,
      visible: panel ? !panel.hidden : false,
    };
  });
  record(
    '菜单项「超级拖拽：设置」打开设置面板',
    '超级拖拽：设置 / 面板可见',
    `${menuState.label} / ${menuState.visible ? '面板可见' : '面板不可见'}`,
  );

  // 11. 自定义地址缺少 {keyword} → 保存被拦下面板不关
  const guard = await ctx.evaluate(() => {
    const panel = window.__page.panel();
    const [engineSelect] = panel.querySelectorAll('select');
    engineSelect.value = 'custom';
    engineSelect.dispatchEvent(new Event('change', { bubbles: true }));
    const input = panel.querySelector('input[type="url"]');
    input.value = 'https://example.com/no-placeholder';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    window.__page.clickButton('保存');
    return {
      stillOpen: !window.__page.panel().hidden,
      error: window.__page.fieldError(),
      storedEngine: window.__gm.store.settings?.defaultEngine ?? '',
    };
  });
  record(
    '自定义地址缺占位符 → 留在面板里提示',
    '面板仍打开 / 提示含 {keyword} / 未写入 custom',
    `${guard.stillOpen ? '面板仍打开' : '面板已关闭'} / 提示${
      guard.error.includes('{keyword}') ? '含 {keyword}' : `不含（${guard.error}）`
    } / ${guard.storedEngine === 'custom' ? '已写入 custom' : '未写入 custom'}`,
  );

  // 12. 填好自定义地址 → 保存写入
  const saved = await ctx.evaluate(() => {
    const panel = window.__page.panel();
    const input = panel.querySelector('input[type="url"]');
    input.value = 'https://example.com/s?q={keyword}';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    window.__page.clickButton('保存');
    return {
      open: !window.__page.panel().hidden,
      stored: window.__gm.store.settings ?? null,
    };
  });
  record(
    '保存有效自定义地址 → 面板关闭并写入设置',
    '面板已关闭 / custom / https://example.com/s?q={keyword}',
    `${saved.open ? '面板仍打开' : '面板已关闭'} / ${saved.stored?.defaultEngine ?? '缺失'} / ${
      saved.stored?.customEngineUrl ?? '缺失'
    }`,
  );

  // 13. 新引擎立刻生效
  const customSearch = await dragSelectedText();
  const customOpened = await ctx.evaluate(() => window.__page.lastOpened());
  record(
    '换引擎后再拖文字 → 用自定义地址搜索',
    `https://example.com/s?q=${encodeURIComponent(customSearch.selected)}`,
    customOpened?.url ?? '',
  );

  // 14. 关掉开关后完全不动网站内容
  const disabled = await ctx.evaluate(() => {
    window.__gm.menu?.();
    const panel = window.__page.panel();
    const checkbox = panel.querySelector('input[type="checkbox"]');
    if (checkbox.checked) window.__page.press(checkbox);
    window.__page.clickButton('保存');
    const openedBefore = window.__page.openedCount();
    const paragraph = document.querySelector('#text');
    window.__page.clearSelection();
    const point = window.__page.select(paragraph);
    const claimed = window.__page.drag(paragraph, paragraph, { point });
    return {
      claimed,
      opened: window.__page.openedCount() - openedBefore,
      enabled: window.__gm.store.settings?.enabled,
    };
  });
  record(
    '关闭「启用」后拖拽无响应',
    '不接管 / 不打开新页面 / enabled=false',
    `${disabled.claimed === '' ? '不接管' : '仍接管'} / ${
      disabled.opened === 0 ? '不打开新页面' : `新增 ${String(disabled.opened)} 个页面`
    } / enabled=${String(disabled.enabled)}`,
  );

  // 15. Escape 关闭面板
  const escaped = await ctx.evaluate(() => {
    window.__gm.menu?.();
    const panel = window.__page.panel();
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return { closed: panel.hidden };
  });
  record('按 Escape 关闭设置面板', 'true', String(escaped.closed));

  return results;
}
