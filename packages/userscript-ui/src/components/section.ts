import { assertAlive } from '../core/lifecycle';
import type { UI } from '../core/mount';
import sectionCss from './section.css?inline';

export interface SectionOptions {
  title?: string;
  description?: string;
}

export interface SectionHandle {
  el: HTMLElement;
  body: HTMLElement;
  destroy(): void;
}

export function createSection(ui: UI, options: SectionOptions = {}): SectionHandle {
  assertAlive(ui, 'section');
  ui.useStyles(sectionCss);

  const root = document.createElement('section');
  root.className = 'ds-section';
  root.setAttribute('data-ds-section', '');

  if (options.title || options.description) {
    const header = document.createElement('header');
    header.className = 'ds-section-header';

    if (options.title) {
      const title = document.createElement('h3');
      title.className = 'ds-section-title';
      title.textContent = options.title;
      header.appendChild(title);
    }

    if (options.description) {
      const description = document.createElement('p');
      description.className = 'ds-section-description';
      description.textContent = options.description;
      header.appendChild(description);
    }

    root.appendChild(header);
  }

  const body = document.createElement('div');
  body.className = 'ds-section-body';
  root.appendChild(body);

  return {
    el: root,
    body,
    destroy() {
      root.remove();
    },
  };
}
