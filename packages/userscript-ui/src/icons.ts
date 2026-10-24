const SVG_NS = 'http://www.w3.org/2000/svg';

export function icon(paths: string[], size = 16): SVGSVGElement {
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

  for (const definition of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', definition);
    svg.appendChild(path);
  }

  return svg;
}

export const closeIcon = (): SVGSVGElement => icon(['M18 6 6 18', 'm6 6 12 12']);
export const checkIcon = (): SVGSVGElement => icon(['M20 6 9 17l-5-5']);
export const chevronDownIcon = (): SVGSVGElement => icon(['m6 9 6 6 6-6']);
export const slidersIcon = (): SVGSVGElement =>
  icon([
    'M4 21v-7',
    'M4 10V3',
    'M12 21v-9',
    'M12 8V3',
    'M20 21v-5',
    'M20 12V3',
    'M1 14h6',
    'M9 8h6',
    'M17 16h6',
  ]);

const circle = 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20';

export const infoIcon = (): SVGSVGElement => icon([circle, 'M12 16v-4', 'M12 8h.01']);

export const successIcon = (): SVGSVGElement => icon([circle, 'm8 12 3 3 5-6']);

export const warningIcon = (): SVGSVGElement =>
  icon([
    'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
    'M12 9v4',
    'M12 17h.01',
  ]);

export const errorIcon = (): SVGSVGElement => icon([circle, 'm15 9-6 6', 'm9 9 6 6']);
