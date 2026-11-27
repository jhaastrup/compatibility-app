import {
  sb, CONFIG, $, $$, escapeHtml, quizLink, waChatLink, waShareLink, copyText, toast, timeAgo,
  requireSession, setupBanner, CONTACT_METHODS, isHandleMethod, profileLink,
} from './lib.js';

setupBanner();
$$('[data-app-name]').forEach((el) => { el.textContent = CONFIG.APP_NAME; });

const session = await requireSession();
if (session) start();

let quizzes = [];
let stats = {};
let matches = [];
let questionsByQuiz = {};
let statusFilter = 'new';
let quizFilter = 'all';

function start() {
  $('#who').textContent = session.user.email || '';
  $('#signout').addEventListener('click', async () => {
    await sb.auth.signOut();
    location.href = '/';
  });
  $('#quiz-filter').addEventListener('change', (e) => { quizFilter = e.target.value; renderMatches(); });
  loadAll();
}

async function loadAll() {
  const [qz, st, mt, qs] = await Promise.all([
    sb.from('quizzes').select('*').order('created_at'),
    sb.rpc('my_quiz_stats'),
    sb.from('matches')
      .select('id, quiz_id, name, contact_method, contact_value, note, score, status, created_at, attempt:attempts(answers)')
      .order('created_at', { ascending: false }),
    sb.from('questions').select('id, quiz_id, prompt, options, accepted, importance, position').order('position'),
  ]);

  if (qz.error || mt.error || qs.error) {
    $('#quizzes').innerHTML = `
      <div class="panel empty">
        <h2>Couldn’t load your dashboard</h2>
        <p>Check your connection and try again.</p>
        <button class="btn btn-primary" id="reload">Try again</button>
      </div>`;
    $('#reload').onclick = loadAll;
    return;
  }

  quizzes = qz.data || [];
  stats = Object.fromEntries((st.data || []).map((s) => [s.quiz_id, s]));
  matches = mt.data || [];
  questionsByQuiz = {};
  (qs.data || []).forEach((q) => { (questionsByQuiz[q.quiz_id] ||= []).push(q); });

  renderQuizzes();
  renderMatches();
}

// ---------------------------------------------------------------- quizzes
function renderQuizzes() {
  const host = $('#quizzes');
  $('#new-quiz').hidden = quizzes.length === 0 || quizzes.length >= 5;

  if (quizzes.length === 0) {
    host.innerHTML = `
      <div class="panel empty screen-enter">
        <div class="heart-icon" aria-hidden="true">\u{1F495}</div>
        <h2>Make your first quiz</h2>
        <p>Pick your questions, tick the answers you’d accept, and get a link to share. It takes about three minutes.</p>
        <a class="btn btn-primary" href="/builder.html">Create your quiz</a>
      </div>`;
    $('#matches-section').hidden = true;
    return;
  }

  host.innerHTML = quizzes.map((q) => {
    const s = stats[q.id] || { views: 0, completions: 0, matched: 0, contacts: 0 };
    const link = quizLink(q.slug);
    const qCount = (questionsByQuiz[q.id] || []).length;
    const share = `Are you a match for me? Take my compatibility quiz \u{1F495} ${link}`;
    return `
      <article class="panel screen-enter" data-quiz="${q.id}">
        <div class="quiz-card-head">
          <div>
            <h2>${escapeHtml(q.display_name)}</h2>
            <p class="fine">${escapeHtml(q.headline || `Are you a match for ${q.display_name}?`)} &middot; ${qCount} question${qCount === 1 ? '' : 's'}</p>
          </div>
          ${q.is_published ? '<span class="pill-tag pill-live">● Live</span>' : '<span class="pill-tag pill-draft">Draft</span>'}
        </div>
        ${q.is_published ? `
          <div class="link-row">
            <input class="input" readonly value="${escapeHtml(link)}" aria-label="Your quiz link">
            <button class="btn btn-secondary btn-sm" data-copy="${escapeHtml(link)}">Copy link</button>
            <a class="btn btn-whatsapp btn-sm" href="${escapeHtml(waShareLink(share))}" target="_blank" rel="noopener">Share on WhatsApp</a>
          </div>` : `
          <div class="draft-note">
            <p><b>Not live yet.</b> Nobody can open this quiz until you switch on “Make it live”. You’ll get your share link straight after.</p>
            <a class="btn btn-primary btn-sm" href="/builder.html?id=${q.id}#publish">Make it live</a>
          </div>`}
        <div class="stats">
          <div class="stat"><b>${s.views}</b><span>Views</span></div>
          <div class="stat"><b>${s.completions}</b><span>Took the quiz</span></div>
          <div class="stat"><b>${s.matched}</b><span>Matched</span></div>
          <div class="stat"><b>${s.contacts}</b><span>Left their contact</span></div>
        </div>
        <div class="card-actions">
          <a class="btn ${q.is_published ? 'btn-primary' : 'btn-secondary'} btn-sm" href="/builder.html?id=${q.id}">Edit quiz</a>
          ${q.is_published ? `<a class="btn btn-secondary btn-sm" href="${escapeHtml(link)}" target="_blank" rel="noopener">Preview</a>` : ''}
        </div>
      </article>`;
  }).join('');

  $$('[data-copy]', host).forEach((b) => b.addEventListener('click', async () => {
    toast((await copyText(b.dataset.copy)) ? 'Link copied' : 'Couldn’t copy. Select the link and copy it.');
  }));
}

// ---------------------------------------------------------------- matches
function renderMatches() {
  const section = $('#matches-section');
  section.hidden = quizzes.length === 0;
  if (section.hidden) return;

  const inQuiz = matches.filter((m) => quizFilter === 'all' || m.quiz_id === quizFilter);
  const counts = { new: 0, contacted: 0, archived: 0 };
  inQuiz.forEach((m) => { counts[m.status] += 1; });
  const allNew = matches.filter((m) => m.status === 'new').length;

  const badge = $('#new-count');
  badge.hidden = allNew === 0;
  badge.textContent = `${allNew} new`;

  const filters = [['new', 'New'], ['contacted', 'Contacted'], ['archived', 'Archived'], ['all', 'All']];
  $('#status-filter').innerHTML = filters.map(([key, label]) => {
    const n = key === 'all' ? inQuiz.length : counts[key];
    return `<button type="button" data-filter="${key}" aria-pressed="${statusFilter === key}">${label} (${n})</button>`;
  }).join('');
  $$('[data-filter]').forEach((b) => b.addEventListener('click', () => { statusFilter = b.dataset.filter; renderMatches(); }));

  const qf = $('#quiz-filter');
  qf.hidden = quizzes.length < 2;
  if (!qf.hidden) {
    qf.innerHTML = `<option value="all">All quizzes</option>${quizzes.map((q) =>
      `<option value="${q.id}" ${quizFilter === q.id ? 'selected' : ''}>${escapeHtml(q.display_name)} (${escapeHtml(q.slug)})</option>`).join('')}`;
  }

  const list = inQuiz.filter((m) => statusFilter === 'all' || m.status === statusFilter);
  const host = $('#matches');

  if (list.length === 0) {
    const anyLive = quizzes.some((q) => q.is_published);
    const msg = matches.length === 0
      ? (anyLive ? 'No matches yet. Share your link and they’ll show up here.' : 'Publish your quiz and share the link. Matches will show up here.')
      : 'Nothing here right now.';
    host.innerHTML = `<div class="panel empty"><p style="margin:0">${msg}</p></div>`;
    return;
  }

  host.innerHTML = list.map(matchCard).join('');
  wireMatchActions(host);
}

function matchCard(m) {
  const quiz = quizzes.find((q) => q.id === m.quiz_id);
  const creator = quiz ? quiz.display_name : 'me';
  const greeting = `Hi ${m.name}! It’s ${creator} — we matched on my compatibility quiz \u{1F60A}`;
  const method = m.contact_method;
  const isWa = method === 'whatsapp';
  const isHandle = isHandleMethod(method);
  let contactHref;
  let contactLabel;
  let contactClass;
  if (isHandle) {
    contactHref = profileLink(method, m.contact_value);
    contactLabel = method === 'instagram' ? 'View Instagram profile' : 'View X profile';
    contactClass = method === 'instagram' ? 'btn-instagram' : 'btn-x';
  } else if (isWa) {
    contactHref = waChatLink(m.contact_value, greeting);
    contactLabel = 'Say hi on WhatsApp';
    contactClass = 'btn-whatsapp';
  } else {
    contactHref = `mailto:${m.contact_value}?subject=${encodeURIComponent('We matched!')}&body=${encodeURIComponent(greeting)}`;
    contactLabel = 'Send an email';
    contactClass = 'btn-primary';
  }
  const shownValue = isHandle ? `@${m.contact_value}` : m.contact_value;
  const initial = escapeHtml((m.name || '?').trim().charAt(0).toUpperCase());

  return `
    <article class="panel match-card" data-id="${m.id}">
      <div class="match-top">
        <div class="match-who">
          <div class="avatar" aria-hidden="true">${initial}</div>
          <div style="min-width:0">
            <div class="match-name">${escapeHtml(m.name)} ${m.status === 'new' ? '<span class="pill-tag pill-new">New</span>' : ''}</div>
            <div class="match-meta">${timeAgo(m.created_at)}${quizzes.length > 1 && quiz ? ` &middot; ${escapeHtml(quiz.display_name)} (${escapeHtml(quiz.slug)})` : ''}</div>
          </div>
        </div>
        <div class="score-badge">${m.score}%</div>
      </div>
      ${m.note ? `<p class="match-note">${escapeHtml(m.note)}</p>` : ''}
      <p class="match-contact">${CONTACT_METHODS[method]?.label || 'Contact'}: <b>${escapeHtml(shownValue)}</b></p>
      <div class="match-actions">
        <a class="btn ${contactClass} btn-sm" href="${escapeHtml(contactHref)}" target="_blank" rel="noopener">${contactLabel}</a>
        <button class="btn btn-secondary btn-sm" data-act="copy" data-value="${escapeHtml(shownValue)}">Copy</button>
        ${m.status === 'new' ? '<button class="btn btn-secondary btn-sm" data-act="status" data-status="contacted">Mark contacted</button>' : ''}
        ${m.status !== 'archived' ? '<button class="btn btn-ghost btn-sm" data-act="status" data-status="archived">Archive</button>' : '<button class="btn btn-ghost btn-sm" data-act="status" data-status="new">Restore</button>'}
        <span data-del-wrap><button class="btn btn-ghost btn-sm" data-act="delete">Delete</button></span>
      </div>
      ${answersBlock(m)}
    </article>`;
}

function answersBlock(m) {
  const qs = questionsByQuiz[m.quiz_id] || [];
  const given = (m.attempt && m.attempt.answers) || {};
  if (qs.length === 0) return '';
  const rows = qs.map((q) => {
    const a = given[q.id];
    if (a === undefined || a === null) {
      return `<li><span class="q">–</span><span><span class="q">${escapeHtml(q.prompt)}</span><br><span class="a">Not answered (question added later)</span></span></li>`;
    }
    const accepted = (q.accepted || []).includes(Number(a));
    return `<li><span class="${accepted ? 'ok' : 'no'}" aria-label="${accepted ? 'An answer you accept' : 'Not one of your answers'}">${accepted ? '✓' : '✗'}</span>
      <span><span class="q">${escapeHtml(q.prompt)}</span><br><span class="a">${escapeHtml(q.options[a] ?? 'Answer no longer exists')}</span></span></li>`;
  }).join('');
  return `<details class="answers"><summary>See their answers</summary><ul class="answer-rows">${rows}</ul></details>`;
}

function wireMatchActions(host) {
  $$('[data-act]', host).forEach((btn) => btn.addEventListener('click', async () => {
    const card = btn.closest('[data-id]');
    const id = card.dataset.id;
    const act = btn.dataset.act;

    if (act === 'copy') {
      toast((await copyText(btn.dataset.value)) ? 'Copied' : 'Couldn’t copy');
      return;
    }

    if (act === 'status') {
      btn.disabled = true;
      const status = btn.dataset.status;
      const { error } = await sb.from('matches').update({ status }).eq('id', id);
      if (error) { btn.disabled = false; toast('Couldn’t update. Try again.', 'error'); return; }
      const m = matches.find((x) => x.id === id);
      if (m) m.status = status;
      toast(status === 'contacted' ? 'Marked as contacted' : status === 'archived' ? 'Archived' : 'Moved back to New');
      renderMatches();
      return;
    }

    if (act === 'delete') {
      const wrap = btn.closest('[data-del-wrap]');
      wrap.innerHTML = `<span class="fine">Delete for good?</span>
        <button class="btn btn-danger btn-sm" data-confirm="yes">Delete</button>
        <button class="btn btn-ghost btn-sm" data-confirm="no">Keep</button>`;
      wrap.querySelector('[data-confirm="no"]').onclick = () => renderMatches();
      wrap.querySelector('[data-confirm="yes"]').onclick = async (ev) => {
        ev.currentTarget.disabled = true;
        const { error } = await sb.from('matches').delete().eq('id', id);
        if (error) { toast('Couldn’t delete. Try again.', 'error'); renderMatches(); return; }
        matches = matches.filter((x) => x.id !== id);
        toast('Deleted');
        renderMatches();
      };
    }
  }));
}
