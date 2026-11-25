import { CONFIG } from './config.js';
import { createDemoClient, resetDemo } from './demo.js';

export { CONFIG };

export const isConfigured =
  !CONFIG.SUPABASE_URL.includes('YOUR-PROJECT') && !CONFIG.SUPABASE_ANON_KEY.startsWith('YOUR-');

// Until Supabase is set up, the app runs in demo mode: everything is stored
// in this browser only, so it can be tried locally with no setup.
export const isDemo = !isConfigured;

export const sb = isConfigured
  ? (await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'))
    .createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY)
  : createDemoClient();

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const isLocal = ['localhost', '127.0.0.1', ''].includes(location.hostname);

export function quizLink(slug) {
  if (CONFIG.PRETTY_LINKS && !isLocal) return `${location.origin}/q/${slug}`;
  return `${location.origin}/quiz.html?u=${encodeURIComponent(slug)}`;
}

export function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '');
}

export function storage(kind = 'local') {
  try {
    const s = kind === 'session' ? window.sessionStorage : window.localStorage;
    const probe = '__probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return {
      get(key) { try { return JSON.parse(s.getItem(key)); } catch { return null; } },
      set(key, val) { try { s.setItem(key, JSON.stringify(val)); } catch { /* ignore */ } },
      remove(key) { try { s.removeItem(key); } catch { /* ignore */ } },
    };
  } catch {
    const mem = new Map();
    return { get: (k) => mem.get(k) ?? null, set: (k, v) => mem.set(k, v), remove: (k) => mem.delete(k) };
  }
}

export function toast(message, kind = 'info') {
  let host = $('#toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.classList.add('toast-out'), 2600);
  setTimeout(() => el.remove(), 3000);
}

export function timeAgo(iso) {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24); if (d < 7) return `${d} day${d > 1 ? 's' : ''} ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function waChatLink(e164, text) {
  const digits = String(e164).replace(/\D/g, '');
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

export function waShareLink(text) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'absolute';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

export function setupBanner() {
  if (!isDemo) return;
  const bar = document.createElement('div');
  bar.className = 'setup-banner';
  bar.innerHTML = '<strong>Demo mode</strong> — everything is saved in this browser only. '
    + 'Add your Supabase details in <code>js/config.js</code> to go live. '
    + '<button type="button" class="btn btn-ghost btn-sm" id="demo-reset">Reset demo</button>';
  document.body.prepend(bar);
  bar.querySelector('#demo-reset').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    if (btn.dataset.confirm !== 'yes') {
      btn.dataset.confirm = 'yes';
      btn.textContent = 'Click again to erase all demo data';
      return;
    }
    resetDemo();
    location.href = '/';
  });
}

export async function requireSession() {
  const { data } = await sb.auth.getSession();
  if (!data.session) {
    location.replace('/login.html');
    return null;
  }
  return data.session;
}

// Common dialling codes. The first match for the visitor's time zone is preselected.
export const DIAL_CODES = [
  { code: '234', label: '+234 Nigeria', zones: ['Africa/Lagos'] },
  { code: '233', label: '+233 Ghana', zones: ['Africa/Accra'] },
  { code: '254', label: '+254 Kenya', zones: ['Africa/Nairobi'] },
  { code: '27', label: '+27 South Africa', zones: ['Africa/Johannesburg'] },
  { code: '256', label: '+256 Uganda', zones: ['Africa/Kampala'] },
  { code: '255', label: '+255 Tanzania', zones: ['Africa/Dar_es_Salaam'] },
  { code: '237', label: '+237 Cameroon', zones: ['Africa/Douala'] },
  { code: '221', label: '+221 Senegal', zones: ['Africa/Dakar'] },
  { code: '20', label: '+20 Egypt', zones: ['Africa/Cairo'] },
  { code: '44', label: '+44 United Kingdom', zones: ['Europe/London'] },
  { code: '353', label: '+353 Ireland', zones: ['Europe/Dublin'] },
  { code: '1', label: '+1 US / Canada', zones: ['America/'] },
  { code: '49', label: '+49 Germany', zones: ['Europe/Berlin'] },
  { code: '33', label: '+33 France', zones: ['Europe/Paris'] },
  { code: '31', label: '+31 Netherlands', zones: ['Europe/Amsterdam'] },
  { code: '971', label: '+971 UAE', zones: ['Asia/Dubai'] },
  { code: '91', label: '+91 India', zones: ['Asia/Kolkata', 'Asia/Calcutta'] },
  { code: '61', label: '+61 Australia', zones: ['Australia/'] },
];

export function guessDialCode() {
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { tz = ''; }
  const hit = DIAL_CODES.find((d) => d.zones.some((z) => tz === z || (z.endsWith('/') && tz.startsWith(z))));
  return hit ? hit.code : '234';
}

// Turns "0801 234 5678" + "234" into "+2348012345678".
export function toE164(dialCode, local) {
  const raw = String(local || '').trim();
  if (raw.startsWith('+')) return '+' + raw.replace(/\D/g, '');
  if (raw.startsWith('00')) return '+' + raw.replace(/\D/g, '').slice(2);
  const digits = raw.replace(/\D/g, '').replace(/^0+/, '');
  return `+${dialCode}${digits}`;
}

export const IMPORTANCE = {
  dealbreaker: { label: 'Dealbreaker', hint: 'They must pick an answer you accept' },
  important: { label: 'Important', hint: 'Counts a lot towards the score' },
  nice: { label: 'Nice to have', hint: 'Counts a little' },
};

// How matches can reach a creator. Order here is the order shown everywhere.
export const METHOD_ORDER = ['instagram', 'x', 'whatsapp', 'email'];
export const CONTACT_METHODS = {
  instagram: { label: 'Instagram', field: 'Instagram handle', via: 'Instagram' },
  x: { label: 'X', field: 'X (Twitter) handle', via: 'X' },
  whatsapp: { label: 'WhatsApp', field: 'WhatsApp number', via: 'WhatsApp' },
  email: { label: 'Email', field: 'Email', via: 'email' },
};
export const isHandleMethod = (m) => m === 'instagram' || m === 'x';

// Accepts "@name", "name" or a pasted profile link and returns just the handle.
export function normalizeHandle(method, raw) {
  let v = String(raw || '').trim();
  v = v.replace(/^(https?:\/\/)?(www\.|m\.|mobile\.)?(instagram\.com|instagr\.am|x\.com|twitter\.com)\//i, '');
  v = v.replace(/[/?#].*$/, '');
  v = v.replace(/^@+/, '');
  return method === 'instagram' ? v.toLowerCase() : v;
}

export function isValidHandle(method, handle) {
  if (method === 'instagram') return /^[a-z0-9._]{1,30}$/.test(handle) && /[a-z0-9]/.test(handle);
  return /^[A-Za-z0-9_]{1,15}$/.test(handle);
}

export function profileLink(method, handle) {
  const h = encodeURIComponent(handle);
  return method === 'instagram' ? `https://www.instagram.com/${h}/` : `https://x.com/${h}`;
}
