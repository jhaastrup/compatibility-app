import { sb, CONFIG, $, $$, escapeHtml, quizLink, requireSession, setupBanner } from './lib.js';

setupBanner();
$$('[data-app-name]').forEach((el) => { el.textContent = CONFIG.APP_NAME; });

const RESEND_DAILY_LIMIT = 100;
const SERIES = [
  { key: 'attempts', name: 'Took a quiz', color: 'var(--series-1)' },
  { key: 'matched', name: 'Matched', color: 'var(--series-2)' },
  { key: 'signups', name: 'New creators', color: 'var(--series-3)' },
];

const content = $('#content');
let days = 30;
let stats = null;
let loading = false;

const fmt = (n) => Number(n || 0).toLocaleString('en-GB');
const pct = (part, whole) => (whole > 0 ? Math.round((100 * part) / whole) : 0);
const periodName = () => (days === 7 ? 'last 7 days' : `last ${days} days`);
const dayLabel = (iso, opts = { day: 'numeric', month: 'short' }) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });

const session = await requireSession();
if (session) start();

async function start() {
  const { data: isAdmin, error } = await sb.rpc('is_admin');
  if (error || !isAdmin) {
    content.innerHTML = `
      <div class="panel empty">
        <h2>This page is only for the site owner</h2>
        <p>Your account doesn’t have access to the owner dashboard.</p>
        <a class="btn btn-primary" href="/dashboard.html">Back to your quizzes</a>
      </div>`;
    return;
  }
  $('#toolbar').hidden = false;
  $$('[data-days]').forEach((b) => b.addEventListener('click', () => {
    days = Number(b.dataset.days);
    $$('[data-days]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    load();
  }));
  $('#refresh').addEventListener('click', load);

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (stats) drawLineChart(); }, 150);
  });
  load();
}

async function load() {
  if (loading) return;
  loading = true;
  if (stats) content.classList.add('refreshing');
  $('#refresh').disabled = true;
  const { data, error } = await sb.rpc('admin_stats', { p_days: days });
  loading = false;
  $('#refresh').disabled = false;
  content.classList.remove('refreshing');
  if (error || !data) {
    console.error('admin_stats failed:', error);
    if (!stats) {
      content.innerHTML = `
        <div class="panel empty">
          <h2>Couldn’t load the numbers</h2>
          <p>Check your connection and try again.</p>
          <button class="btn btn-primary" id="retry">Try again</button>
        </div>`;
      $('#retry').onclick = load;
    }
    return;
  }
  stats = data;
  $('#updated').textContent = `Updated ${new Date(data.generated_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  render();
}

// ---------------------------------------------------------------- layout
function render() {
  const t = stats.totals;
  const p = stats.period;

  content.innerHTML = `
    <section class="kpis" aria-label="Headline numbers">
      ${kpi('Creators', t.creators, p.signups, p.prev_signups, 'signed up')}
      ${kpi('Quizzes', t.quizzes, p.quizzes, p.prev_quizzes, 'created', `${fmt(t.quizzes_live)} live, ${fmt(t.drafts)} draft`)}
      ${kpi('Quiz takers', t.attempts, p.attempts, p.prev_attempts, 'took a quiz')}
      ${kpi('Matches', t.matched, p.matched, p.prev_matched, 'matched')}
      ${kpi('Contacts left', t.contacts, p.contacts, p.prev_contacts, 'left a contact')}
    </section>

    <section class="panel block" aria-labelledby="h-activity">
      <h2 id="h-activity">Activity per day</h2>
      <p class="panel-sub">${escapeHtml(capitalise(periodName()))}, Lagos time. Hover or tap the chart for a day’s numbers.</p>
      <div class="legend">${SERIES.map((s) => `<span><i style="background:${s.color}"></i>${escapeHtml(s.name)}</span>`).join('')}</div>
      <div class="chart" id="line-chart"></div>
      <details class="table-toggle">
        <summary>Show as a table</summary>
        <div class="table-wrap">${dailyTable()}</div>
      </details>
    </section>

    <div class="grid-2">
      <section class="panel" aria-labelledby="h-visitors">
        <h2 id="h-visitors">From visit to contact</h2>
        <p class="panel-sub">Everyone who opened a quiz link, all time.</p>
        ${barList([
          { name: 'Opened a quiz', value: t.views },
          { name: 'Took the quiz', value: t.attempts, note: `${pct(t.attempts, t.views)}% of opens` },
          { name: 'Matched', value: t.matched, note: `${pct(t.matched, t.attempts)}% of takers` },
          { name: 'Left a contact', value: t.contacts, note: `${pct(t.contacts, t.matched)}% of matches` },
        ])}
      </section>

      <section class="panel" aria-labelledby="h-creators">
        <h2 id="h-creators">From sign-up to first match</h2>
        <p class="panel-sub">How far creators get, all time.</p>
        ${barList([
          { name: 'Signed up', value: t.creators },
          { name: 'Made a quiz', value: t.creators_with_quiz, note: `${pct(t.creators_with_quiz, t.creators)}% of creators` },
          { name: 'Went live', value: t.creators_live, note: `${pct(t.creators_live, t.creators_with_quiz)}% of quiz makers` },
          { name: 'Got a contact', value: t.creators_with_match, note: `${pct(t.creators_with_match, t.creators_live)}% of live creators` },
        ])}
      </section>
    </div>

    <div class="grid-2">
      <section class="panel" aria-labelledby="h-reasons">
        <h2 id="h-reasons">Why people don’t match</h2>
        <p class="panel-sub">Quiz takers who didn’t match, all time.</p>
        ${barList(sortDesc([
          { name: 'Missed a dealbreaker', value: stats.reasons.dealbreaker },
          { name: 'Score too low', value: stats.reasons.score },
          { name: 'Outside the age range', value: stats.reasons.age },
        ]), { empty: 'No non-matches yet.' })}
      </section>

      <section class="panel" aria-labelledby="h-ages">
        <h2 id="h-ages">Ages of quiz takers</h2>
        <p class="panel-sub">Everyone who took a quiz, all time.</p>
        ${barList(Object.entries(stats.ages).map(([band, value]) => ({ name: band, value })), { empty: 'Nobody has taken a quiz yet.' })}
      </section>
    </div>

    <div class="grid-2">
      <section class="panel" aria-labelledby="h-methods">
        <h2 id="h-methods">How matches want to be reached</h2>
        <p class="panel-sub">Contacts left, all time. Under each: how many live quizzes offer it.</p>
        ${barList(sortDesc([
          { name: 'Instagram', value: stats.contact_methods.instagram, sub: `offered by ${fmt(stats.methods_offered.instagram)}` },
          { name: 'X', value: stats.contact_methods.x, sub: `offered by ${fmt(stats.methods_offered.x)}` },
          { name: 'WhatsApp', value: stats.contact_methods.whatsapp, sub: `offered by ${fmt(stats.methods_offered.whatsapp)}` },
          { name: 'Email', value: stats.contact_methods.email, sub: `offered by ${fmt(stats.methods_offered.email)}` },
        ]), { empty: 'No contacts left yet.' })}
      </section>

      <section class="panel" aria-labelledby="h-follow">
        <h2 id="h-follow">Do creators follow up?</h2>
        <p class="panel-sub">What creators marked each contact as, all time.</p>
        ${barList([
          { name: 'Still new', value: stats.follow_up.new },
          { name: 'Contacted', value: stats.follow_up.contacted },
          { name: 'Archived', value: stats.follow_up.archived },
        ], { empty: 'No contacts left yet.' })}
      </section>
    </div>

    ${healthPanel()}

    <section class="panel block" aria-labelledby="h-top">
      <h2 id="h-top">Busiest live quizzes</h2>
      <p class="panel-sub">Top 10 by quiz takers, all time.</p>
      ${topTable()}
    </section>

    <p class="fine" style="margin-top:1.25rem">“Opened a quiz” counts every time a quiz page loads, not unique people. Creators previewing their own quiz aren’t counted anywhere.</p>
  `;
  drawLineChart();
}

function capitalise(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function kpi(label, total, now, before, verb, extra) {
  let delta = '';
  if (now > before) delta = `<p class="kpi-delta up">▲ up from ${fmt(before)} the ${days} days before</p>`;
  else if (now < before) delta = `<p class="kpi-delta down">▼ down from ${fmt(before)} the ${days} days before</p>`;
  else delta = `<p class="kpi-delta">Same as the ${days} days before</p>`;
  return `
    <div class="panel kpi">
      <p class="kpi-label">${escapeHtml(label)}</p>
      <p class="kpi-value">${fmt(total)}</p>
      <p class="kpi-sub">+${fmt(now)} ${escapeHtml(verb)} in the ${escapeHtml(periodName())}</p>
      ${delta}
      ${extra ? `<p class="kpi-delta">${escapeHtml(extra)}</p>` : ''}
    </div>`;
}

function sortDesc(rows) { return [...rows].sort((a, b) => b.value - a.value); }

// Horizontal bars, one hue, value at the tip.
function barList(rows, { empty } = {}) {
  const max = Math.max(0, ...rows.map((r) => Number(r.value) || 0));
  if (max === 0 && empty) return `<p class="empty-note">${escapeHtml(empty)}</p>`;
  return `<div class="bars">${rows.map((r) => {
    const v = Number(r.value) || 0;
    const w = max > 0 ? Math.max(v > 0 ? 1.5 : 0, (100 * v) / max) : 0;
    const label = `${r.name}: ${fmt(v)}${r.note || r.sub ? `, ${r.note || r.sub}` : ''}`;
    const small = r.note || r.sub;
    return `
      <div class="bar-row" role="img" aria-label="${escapeHtml(label)}">
        <div class="bar-name">${escapeHtml(r.name)}${small ? `<small>${escapeHtml(small)}</small>` : ''}</div>
        <div class="bar-track">
          <div class="bar" style="width:${w.toFixed(2)}%"></div>
          <span class="bar-val">${fmt(v)}</span>
        </div>
      </div>`;
  }).join('')}</div>`;
}

function healthPanel() {
  const t = stats.totals;
  const used = t.active_today;
  const share = Math.min(100, pct(used, RESEND_DAILY_LIMIT));
  const near = share >= 80;
  return `
    <section class="panel block" aria-labelledby="h-health">
      <h2 id="h-health">Health check</h2>
      <p class="panel-sub">Things to keep an eye on.</p>
      <div>
        <div style="display:flex; justify-content:space-between; gap:1rem; flex-wrap:wrap; font-size:0.85rem">
          <span style="color:var(--cream-muted)">Sign-in emails today (about)</span>
          <span style="color:var(--cream); font-weight:600">${fmt(used)} of ${RESEND_DAILY_LIMIT}${near ? ' · ⚠ close to the limit' : ''}</span>
        </div>
        <div class="meter${near ? ' warn' : ''}" role="meter" aria-valuemin="0" aria-valuemax="${RESEND_DAILY_LIMIT}" aria-valuenow="${used}" aria-label="Sign-in emails today"><div style="width:${share}%"></div></div>
        <p class="fine">Creators who signed in today. Each sign-in uses one of Resend’s ${RESEND_DAILY_LIMIT} free emails a day; unused links also count, so the real number can be a bit higher. Exact count: Resend → Emails.</p>
      </div>
      <div class="facts">
        <div class="fact"><b>${fmt(t.active_7d)}</b><span>creators signed in this week</span></div>
        <div class="fact"><b>${t.avg_questions ?? '–'}</b><span>questions per live quiz, on average</span></div>
        <div class="fact"><b>${t.avg_score != null ? `${t.avg_score}%` : '–'}</b><span>average quiz score</span></div>
        <div class="fact"><b>${t.avg_match_score != null ? `${t.avg_match_score}%` : '–'}</b><span>average score when matched</span></div>
      </div>
      ${t.drafts_ready > 0 ? `
        <div class="draft-note callout">
          <p><b>${fmt(t.drafts_ready)} draft${t.drafts_ready === 1 ? '' : 's'} ready but not live.</b> ${t.drafts_ready === 1 ? 'It has' : 'They have'} 3 or more questions but ${t.drafts_ready === 1 ? 'hasn’t' : 'haven’t'} been switched live. Worth a nudge if you know who made ${t.drafts_ready === 1 ? 'it' : 'them'}.</p>
        </div>` : ''}
    </section>`;
}

function topTable() {
  const rows = stats.top_quizzes || [];
  if (!rows.length) return '<p class="empty-note">No live quizzes yet.</p>';
  return `
    <div class="table-wrap" style="max-height:none">
      <table class="data-table">
        <thead><tr><th scope="col">Quiz</th><th scope="col">Opens</th><th scope="col">Took it</th><th scope="col">Matched</th><th scope="col">Match rate</th><th scope="col">Contacts</th></tr></thead>
        <tbody>${rows.map((q) => `
          <tr>
            <td><a href="${escapeHtml(quizLink(q.slug))}" target="_blank" rel="noopener">${escapeHtml(q.display_name)}</a><small>/q/${escapeHtml(q.slug)}</small></td>
            <td>${fmt(q.views)}</td>
            <td>${fmt(q.attempts)}</td>
            <td>${fmt(q.matched)}</td>
            <td>${q.attempts ? `${pct(q.matched, q.attempts)}%` : '–'}</td>
            <td>${fmt(q.contacts)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function dailyTable() {
  const rows = [...stats.daily].reverse();
  return `
    <table class="data-table">
      <thead><tr><th scope="col">Day</th>${SERIES.map((s) => `<th scope="col">${escapeHtml(s.name)}</th>`).join('')}<th scope="col">Contacts</th><th scope="col">Quizzes made</th></tr></thead>
      <tbody>${rows.map((d) => `
        <tr><td>${escapeHtml(dayLabel(d.day, { weekday: 'short', day: 'numeric', month: 'short' }))}</td>${SERIES.map((s) => `<td>${fmt(d[s.key])}</td>`).join('')}<td>${fmt(d.contacts)}</td><td>${fmt(d.quizzes)}</td></tr>`).join('')}
      </tbody>
    </table>`;
}

// ---------------------------------------------------------------- line chart
function niceMax(v) {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * pow >= v) return m * pow;
  }
  return 10 * pow;
}

function drawLineChart() {
  const host = $('#line-chart');
  if (!host) return;
  const data = stats.daily;
  const W = Math.max(280, host.clientWidth);
  const H = 240;
  const m = { top: 10, right: 12, bottom: 28, left: 34 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;
  const n = data.length;
  const maxV = niceMax(Math.max(0, ...data.flatMap((d) => SERIES.map((s) => d[s.key]))));
  const ticks = [4, 5, 2].find((k) => maxV % k === 0) || 4;
  const x = (i) => m.left + (n <= 1 ? iw / 2 : (i * iw) / (n - 1));
  const y = (v) => m.top + ih - (v / maxV) * ih;

  // Gridlines and y ticks (whole numbers)
  let grid = '';
  for (let k = 0; k <= ticks; k += 1) {
    const v = (maxV / ticks) * k;
    if (!Number.isInteger(v)) continue;
    const yy = y(v);
    grid += `<line x1="${m.left}" x2="${W - m.right}" y1="${yy}" y2="${yy}" stroke="${k === 0 ? 'var(--axis)' : 'var(--grid)'}" stroke-width="1" />`;
    grid += `<text x="${m.left - 8}" y="${yy + 4}" text-anchor="end" font-size="11" fill="rgba(253,246,240,0.55)" style="font-variant-numeric:tabular-nums">${fmt(v)}</text>`;
  }

  // X labels: about 5 evenly spaced days, always the first and last
  const want = W < 480 ? 3 : 5;
  const step = Math.max(1, Math.round((n - 1) / (want - 1)));
  let xl = '';
  for (let i = 0; i < n; i += step) {
    if (n - 1 - i < step / 2 && i !== n - 1) continue;
    xl += xLabel(i);
  }
  xl += xLabel(n - 1);
  function xLabel(i) {
    const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
    return `<text x="${x(i)}" y="${H - 8}" text-anchor="${anchor}" font-size="11" fill="rgba(253,246,240,0.55)">${escapeHtml(dayLabel(data[i].day))}</text>`;
  }

  const lines = SERIES.map((s) => {
    const pts = data.map((d, i) => `${x(i).toFixed(1)},${y(d[s.key]).toFixed(1)}`).join(' ');
    const last = data[n - 1];
    return `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
      <circle cx="${x(n - 1)}" cy="${y(last[s.key])}" r="4" fill="${s.color}" stroke="var(--chart-surface)" stroke-width="2" />`;
  }).join('');

  host.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Daily quiz takers, matches and new creators for the ${escapeHtml(periodName())}. Full numbers in the table below.">
      ${grid}${xl}
      <g aria-hidden="true">${lines}</g>
      <line class="cross" x1="0" x2="0" y1="${m.top}" y2="${m.top + ih}" stroke="rgba(253,246,240,0.35)" stroke-width="1" visibility="hidden" />
      <g class="cross-dots" visibility="hidden">${SERIES.map((s) => `<circle r="4" fill="${s.color}" stroke="var(--chart-surface)" stroke-width="2" data-k="${s.key}" />`).join('')}</g>
      <rect class="hit" x="${m.left}" y="${m.top}" width="${iw}" height="${ih}" fill="transparent" tabindex="0" aria-label="Chart: use left and right arrow keys to move between days" />
    </svg>
    <div class="tip" hidden></div>`;

  const svg = host.querySelector('svg');
  const hit = host.querySelector('.hit');
  const cross = host.querySelector('.cross');
  const dots = host.querySelector('.cross-dots');
  const tip = host.querySelector('.tip');
  let current = n - 1;

  function show(i) {
    current = Math.max(0, Math.min(n - 1, i));
    const d = data[current];
    const cx = x(current);
    cross.setAttribute('x1', cx); cross.setAttribute('x2', cx);
    cross.setAttribute('visibility', 'visible');
    dots.setAttribute('visibility', 'visible');
    dots.querySelectorAll('circle').forEach((c) => {
      c.setAttribute('cx', cx);
      c.setAttribute('cy', y(d[c.dataset.k]));
    });
    tip.replaceChildren();
    const head = document.createElement('div');
    head.className = 'tip-day';
    head.textContent = dayLabel(d.day, { weekday: 'short', day: 'numeric', month: 'short' });
    tip.appendChild(head);
    SERIES.forEach((s) => {
      const row = document.createElement('div');
      row.className = 'tip-row';
      const key = document.createElement('i');
      key.style.background = s.color;
      const val = document.createElement('b');
      val.textContent = fmt(d[s.key]);
      const name = document.createElement('span');
      name.textContent = s.name;
      row.append(key, val, name);
      tip.appendChild(row);
    });
    tip.hidden = false;
    const scale = svg.getBoundingClientRect().width / W;
    const px = cx * scale;
    const tw = tip.offsetWidth;
    const left = px + 14 + tw > host.clientWidth ? px - 14 - tw : px + 14;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${m.top * scale}px`;
  }
  function hide() {
    cross.setAttribute('visibility', 'hidden');
    dots.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  }
  function indexAt(evt) {
    const r = svg.getBoundingClientRect();
    const sx = ((evt.clientX - r.left) / r.width) * W;
    return n <= 1 ? 0 : Math.round(((sx - m.left) / iw) * (n - 1));
  }
  hit.addEventListener('pointermove', (e) => show(indexAt(e)));
  hit.addEventListener('pointerdown', (e) => show(indexAt(e)));
  hit.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
  hit.addEventListener('focus', () => show(current));
  hit.addEventListener('blur', hide);
  hit.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(current - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); show(current + 1); }
    if (e.key === 'Home') { e.preventDefault(); show(0); }
    if (e.key === 'End') { e.preventDefault(); show(n - 1); }
  });
}
