// designsystem · ds.js — beteende för gemensamma komponenter. ES-modul, inga beroenden.
//
// Meny:  <button class="icon-btn" data-menu="huvudmeny" aria-expanded="false" aria-label="Meny">…</button>
//        <div class="scrim" hidden></div><nav class="menu" id="huvudmeny" hidden>…</nav>
//   Öppnas/stängs med knappen, stängs med Esc, klick på scrim eller val i menyn.
//   Fungerar för innehåll som ritas om (lyssnaren sitter på document).
//
// Toast: import { toast } from './ds/ds.js'; toast('Sparat', { action: 'Ångra', onAction: fn, kind: 'danger', ms: 6000 })

function menuParts(id) {
  const menu = document.getElementById(id);
  const btn = document.querySelector(`[data-menu="${id}"]`);
  const scrim = menu && menu.previousElementSibling && menu.previousElementSibling.classList.contains('scrim') ? menu.previousElementSibling : null;
  return { menu, btn, scrim };
}

export function openMenu(id) {
  const { menu, btn, scrim } = menuParts(id);
  if (!menu) return;
  menu.hidden = false;
  if (scrim) scrim.hidden = false;
  if (btn) btn.setAttribute('aria-expanded', 'true');
  const first = menu.querySelector('[aria-current="page"], a, button');
  if (first) first.focus({ preventScroll: true });
}

export function closeMenu(id, { focusButton = true } = {}) {
  const { menu, btn, scrim } = menuParts(id);
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  if (scrim) scrim.hidden = true;
  if (btn) { btn.setAttribute('aria-expanded', 'false'); if (focusButton) btn.focus({ preventScroll: true }); }
}

function openMenus() { return [...document.querySelectorAll('.menu[id]:not([hidden])')].map((m) => m.id); }

document.addEventListener('click', (e) => {
  const t = e.target instanceof Element ? e.target : null;
  if (!t) return;
  const toggle = t.closest('[data-menu]');
  if (toggle) {
    const id = toggle.getAttribute('data-menu');
    const { menu } = menuParts(id);
    if (menu && menu.hidden) openMenu(id); else closeMenu(id);
    return;
  }
  if (t.classList.contains('scrim')) { openMenus().forEach((id) => closeMenu(id)); return; }
  const inMenu = t.closest('.menu[id]');
  if (inMenu && t.closest('a, button')) closeMenu(inMenu.id, { focusButton: false });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') openMenus().forEach((id) => closeMenu(id));
});

let toastEl = null;
let toastTimer = 0;

export function toast(message, { action, onAction, kind = '', ms } = {}) {
  if (toastEl) toastEl.remove();
  clearTimeout(toastTimer);
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.setAttribute('role', kind === 'danger' ? 'alert' : 'status');
  const text = document.createElement('span');
  text.textContent = message;
  el.append(text);
  if (action && onAction) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action;
    b.addEventListener('click', () => { el.remove(); onAction(); });
    el.append(b);
  }
  document.body.append(el);
  toastEl = el;
  toastTimer = setTimeout(() => { el.remove(); if (toastEl === el) toastEl = null; }, ms ?? (action ? 6000 : 2500));
  return el;
}
