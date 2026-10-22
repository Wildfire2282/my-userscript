const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * 悬浮按钮用的链接图标。
 *
 * `@ui` 只导出了设计体系里已有的图标，没有链接图标，而这里又需要与面板入口
 * 一致的语义，所以在脚本内用同一套线条规则画一个（颜色继承按钮的 `currentColor`）。
 */
export function linkIcon(size = 18): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  for (const definition of [
    'M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L11 4',
    'M14 11a5 5 0 0 0-7.07 0L4.81 13.12a5 5 0 0 0 7.07 7.07L13 20',
  ]) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', definition);
    svg.appendChild(path);
  }

  return svg;
}
