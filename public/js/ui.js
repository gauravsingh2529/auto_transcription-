export const $ = (sel, root = document) => root.querySelector(sel);

/** Tiny element builder — always uses textContent, so user data can't inject HTML. */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c !== null && c !== undefined && c !== false) node.append(c instanceof Node ? c : String(c));
  }
  return node;
}

export function toast(message, type = 'info', ms = 3500) {
  const t = el(
    'div',
    { class: `toast ${type}`, role: type === 'error' ? 'alert' : 'status' },
    el('span', { class: 'toast-icon', 'aria-hidden': 'true' }, type === 'error' ? '!' : '✓'),
    el('span', {}, message),
    el('span', { class: 'toast-bar', 'aria-hidden': 'true' }),
  );
  t.style.setProperty('--ms', `${ms}ms`);
  $('#toasts').append(t);
  setTimeout(() => {
    t.classList.add('leaving');
    t.addEventListener('animationend', () => t.remove(), { once: true });
    setTimeout(() => t.remove(), 600); // fallback when animations are disabled
  }, ms);
}

/** Material-style ripple on every .btn press. */
export function enableRipples() {
  document.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('.btn');
    if (!btn || btn.disabled) return;
    const r = btn.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 2;
    const s = document.createElement('span');
    s.className = 'ripple';
    Object.assign(s.style, {
      width: `${size}px`,
      height: `${size}px`,
      left: `${e.clientX - r.left - size / 2}px`,
      top: `${e.clientY - r.top - size / 2}px`,
    });
    btn.append(s);
    s.addEventListener('animationend', () => s.remove(), { once: true });
  });
}

export const formatDuration = (ms) => {
  const s = Math.floor((ms ?? 0) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export const formatDate = (iso) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard');
  } catch {
    toast('Copy failed', 'error');
  }
}
