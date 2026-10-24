import { createButton, createField, createPanel, createSwitch, mountUI } from '../src/index';

const ui = mountUI({ theme: 'dark' });

const panel = createPanel(ui, {
  title: 'Minimal',
  description: 'Only the components this build imports.',
  open: true,
});

const enabled = createSwitch(ui, { checked: true });

panel.body.append(
  createField(ui, {
    label: 'Enabled',
    description: 'A single switch in a minimal bundle.',
    control: enabled,
    inline: true,
  }).el,
);

const save = createButton(ui, { label: 'Apply', variant: 'primary' });
panel.setFooter(save.el);

declare global {
  interface Window {
    __dsMinimalReady?: boolean;
  }
}

window.__dsMinimalReady = true;
