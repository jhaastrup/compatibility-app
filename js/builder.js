import {
  sb, CONFIG, $, $$, escapeHtml, slugify, quizLink, toast, copyText, requireSession, setupBanner, IMPORTANCE, METHOD_ORDER,
} from './lib.js';
import { CATEGORIES, STARTER_PROMPTS, findBankQuestion } from './question-bank.js';

setupBanner();
$$('[data-app-name]').forEach((el) => { el.textContent = CONFIG.APP_NAME; });

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
const MAX_QUESTIONS = 30;
const MIN_TO_PUBLISH = 3;

const params = new URLSearchParams(location.search);
let quizId = params.get('id');
let originalSlug = null;
let publishedInDb = false;
let quiz = {
  display_name: '', slug: '', headline: '', intro: '', min_age: 18, max_age: 99, threshold: 70,
  contact_methods: ['instagram', 'x'], notify_by_email: true, is_published: false,
};
let questions = [];
let dirty = false;
let saving = false;
let slugTouched = false;
let slugState = 'idle';
let slugTimer = null;
let slugSeq = 0;
let bankCat = CATEGORIES[0].id;
let nudgedDraft = false;

const uid = () => {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

const linkPrefix = () => quizLink('').replace(/^https?:\/\//, '');

const session = await requireSession();
if (session) init();

// ---------------------------------------------------------------- load
async function init() {
  $('#slug-prefix').textContent = linkPrefix();

  if (quizId) {
    const [qRes, qsRes] = await Promise.all([
      sb.from('quizzes').select('*').eq('id', quizId).maybeSingle(),
      sb.from('questions').select('id, prompt, options, accepted, importance, position').eq('quiz_id', quizId).order('position'),
    ]);
    if (qRes.error || qsRes.error) {
      $('#loading').innerHTML = `<div class="panel empty"><h2>Couldn’t load this quiz</h2><p>Check your connection and try again.</p><button class="btn btn-primary" onclick="location.reload()">Try again</button></div>`;
      return;
    }
    if (!qRes.data) {
      $('#loading').innerHTML = `<div class="panel empty"><h2>Quiz not found</h2><p>It may have been deleted.</p><a class="btn btn-primary" href="/dashboard.html">Back to dashboard</a></div>`;
      return;
    }
    quiz = { ...quiz, ...qRes.data, headline: qRes.data.headline || '', intro: qRes.data.intro || '' };
    originalSlug = quiz.slug;
    publishedInDb = quiz.is_published;
    slugTouched = true;
    slugState = 'ok';
    questions = (qsRes.data || []).map((x) => ({
      id: x.id, prompt: x.prompt, options: [...x.options], accepted: [...x.accepted], importance: x.importance,
    }));
    $('#page-title').textContent = 'Edit your quiz';
    $('#danger').hidden = false;
    document.title = `Edit: ${quiz.display_name}`;
  }

  fillForm();
  renderQuestions();
  renderBank();
  wire();
  $('#loading').hidden = true;
  $('#builder').hidden = false;
  $$('.q-prompt').forEach(autosize);
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => $$('.q-prompt').forEach(autosize), 150);
  });
  if (quizId) setSlugStatus('ok', 'This is your current link.');
  updateSaveBar();
  if (location.hash === '#publish') {
    $('#publish-panel').scrollIntoView({ block: 'start' });
    $('#is_published').focus({ preventScroll: true });
  }
}

function fillForm() {
  $('#display_name').value = quiz.display_name;
  $('#slug').value = quiz.slug;
  $('#headline').value = quiz.headline;
  $('#intro').value = quiz.intro;
  $('#min_age').value = quiz.min_age;
  $('#max_age').value = quiz.max_age;
  $('#threshold').value = quiz.threshold;
  $('#threshold-value').textContent = `${quiz.threshold}%`;
  METHOD_ORDER.forEach((m) => { $(`#m-${m}`).checked = quiz.contact_methods.includes(m); });
  $('#notify').checked = quiz.notify_by_email;
  $('#is_published').checked = quiz.is_published;
  updateHeadlinePlaceholder();
}

function updateHeadlinePlaceholder() {
  $('#headline').placeholder = `Are you a match for ${quiz.display_name.trim() || 'me'}?`;
}

// ---------------------------------------------------------------- events
function wire() {
  const form = $('#builder');

  $('#display_name').addEventListener('input', (e) => {
    quiz.display_name = e.target.value;
    clearFieldError('display_name');
    updateHeadlinePlaceholder();
    if (!slugTouched) {
      quiz.slug = slugify(quiz.display_name);
      $('#slug').value = quiz.slug;
      scheduleSlugCheck();
    }
    markDirty();
  });

  $('#slug').addEventListener('input', (e) => {
    slugTouched = true;
    const cleaned = e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').slice(0, 30);
    if (cleaned !== e.target.value) e.target.value = cleaned;
    quiz.slug = cleaned;
    scheduleSlugCheck();
    markDirty();
  });

  $('#headline').addEventListener('input', (e) => { quiz.headline = e.target.value; markDirty(); });
  $('#intro').addEventListener('input', (e) => { quiz.intro = e.target.value; markDirty(); });

  ['min_age', 'max_age'].forEach((id) => $(`#${id}`).addEventListener('input', (e) => {
    quiz[id] = e.target.value === '' ? null : Number(e.target.value);
    $('#e-age').hidden = true;
    $('#min_age').classList.remove('invalid');
    $('#max_age').classList.remove('invalid');
    markDirty();
  }));

  $('#threshold').addEventListener('input', (e) => {
    quiz.threshold = Number(e.target.value);
    $('#threshold-value').textContent = `${quiz.threshold}%`;
    markDirty();
  });

  METHOD_ORDER.forEach((m) => $(`#m-${m}`).addEventListener('change', () => {
    quiz.contact_methods = METHOD_ORDER.filter((x) => $(`#m-${x}`).checked);
    $('#e-methods').hidden = true;
    markDirty();
  }));

  $('#notify').addEventListener('change', (e) => { quiz.notify_by_email = e.target.checked; markDirty(); });
  $('#is_published').addEventListener('change', (e) => { quiz.is_published = e.target.checked; markDirty(); });
  $('#pub-copy').addEventListener('click', async () => {
    toast((await copyText($('#pub-link-input').value)) ? 'Link copied' : 'Couldn’t copy. Select the link and copy it.');
  });
  $('#bar-pill').addEventListener('click', () => {
    $('#publish-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('#is_published').focus({ preventScroll: true });
  });

  form.addEventListener('submit', save);
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.target.tagName === 'INPUT' || e.target.classList.contains('q-prompt'))) e.preventDefault();
  });

  $('#add-starter').addEventListener('click', addStarterSet);
  $('#add-custom').addEventListener('click', () => {
    addQuestion({ prompt: '', options: ['Yes', 'No'] }, { focusPrompt: true });
  });
  $('#toggle-bank').addEventListener('click', () => {
    const bank = $('#bank');
    bank.hidden = !bank.hidden;
    $('#toggle-bank').textContent = bank.hidden ? 'Browse question ideas' : 'Hide question ideas';
    if (!bank.hidden) bank.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  $('#close-bank').addEventListener('click', () => {
    $('#bank').hidden = true;
    $('#toggle-bank').textContent = 'Browse question ideas';
  });

  $('#q-list').addEventListener('input', onQuestionInput);
  $('#q-list').addEventListener('click', onQuestionClick);

  $('#delete-quiz').addEventListener('click', confirmDelete);

  window.addEventListener('beforeunload', (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });
}

function markDirty() {
  dirty = true;
  updateSaveBar();
}

function updateSaveBar() {
  const live = $('#is_published').checked;
  const status = $('#save-status');
  status.classList.toggle('dirty', dirty);
  status.textContent = saving ? 'Saving…' : dirty ? 'Unsaved changes' : quizId ? 'All changes saved' : 'Not saved yet';
  $('#save').textContent = live && !publishedInDb ? 'Save & publish' : 'Save';
  const preview = $('#preview');
  preview.hidden = !quizId || !originalSlug;
  if (!preview.hidden) preview.href = quizLink(originalSlug);
  updatePublishPanel();
}

function setPill(el, kind, text) {
  el.className = el.className.replace(/\bpill-(live|draft|pending)\b/g, '').trim();
  el.classList.add(`pill-${kind}`);
  el.textContent = text;
}

// The status card at the top: is the quiz live, and what's left to do.
function updatePublishPanel() {
  const want = $('#is_published').checked;
  const short = Math.max(0, MIN_TO_PUBLISH - questions.length);
  let state;
  let title;
  let sub;
  let pill;

  if (want && publishedInDb) {
    state = 'live'; pill = ['live', '● Live']; title = 'Your quiz is live';
    sub = dirty ? 'Anyone with your link can take it. Save to update what they see.' : 'Anyone with your link can take it.';
  } else if (want) {
    state = 'pending'; pill = ['pending', 'Not live yet']; title = 'Almost live';
    sub = short ? 'Add a few more questions, then save to go live.' : 'Save to put your quiz live and get your link.';
  } else if (publishedInDb) {
    state = 'pending'; pill = ['live', '● Live']; title = 'Taking your quiz offline';
    sub = 'Save to hide it. Your link will stop working until you switch it back on.';
  } else {
    state = 'draft'; pill = ['pending', 'Draft']; title = 'Your quiz is a draft';
    sub = 'Only you can see it. Switch on “Make it live”, then save, to get a link you can share.';
  }

  const panel = $('#publish-panel');
  panel.dataset.state = state;
  setPill($('#pub-pill'), ...pill);
  $('#pub-title').textContent = title;
  $('#pub-sub').textContent = sub;

  const check = $('#pub-check');
  check.hidden = publishedInDb || !short;
  check.textContent = `You need at least ${MIN_TO_PUBLISH} questions to go live. You have ${questions.length}.`;

  const showLink = want && publishedInDb && !!originalSlug;
  $('#pub-link').hidden = !showLink;
  if (showLink) $('#pub-link-input').value = quizLink(originalSlug);

  const pending = want !== publishedInDb && !(want && short);
  $('#pub-actions').hidden = !pending;
  $('#pub-save').textContent = want ? 'Save & publish' : 'Save & take offline';
  $('#pub-save').disabled = saving;

  setPill($('#bar-pill'), publishedInDb ? 'live' : 'pending', publishedInDb ? '● Live' : 'Draft');
}

function showPublishPanel() {
  const panel = $('#publish-panel');
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  panel.classList.remove('pulse');
  void panel.offsetWidth; // restart the animation
  panel.classList.add('pulse');
}

// ---------------------------------------------------------------- slug
function setSlugStatus(state, text) {
  slugState = state;
  const el = $('#slug-status');
  el.textContent = text;
  el.classList.toggle('good', state === 'ok');
  el.classList.toggle('bad', state === 'taken' || state === 'invalid');
  $('#slug-wrap').classList.toggle('invalid', state === 'taken' || state === 'invalid');
}

function scheduleSlugCheck() {
  clearTimeout(slugTimer);
  const s = quiz.slug;
  slugSeq += 1;
  if (!s) { setSlugStatus('invalid', 'Pick a link name.'); return; }
  if (!SLUG_RE.test(s)) {
    setSlugStatus('invalid', s.length < 3 ? 'Use at least 3 characters.' : 'Letters, numbers and dashes only, not starting or ending with a dash.');
    return;
  }
  if (s === originalSlug) { setSlugStatus('ok', 'This is your current link.'); return; }
  setSlugStatus('checking', 'Checking…');
  const seq = slugSeq;
  slugTimer = setTimeout(async () => {
    const { data, error } = await sb.rpc('slug_available', { p_slug: s });
    if (seq !== slugSeq) return;
    if (error) { setSlugStatus('idle', ''); return; }
    if (data) setSlugStatus('ok', `${linkPrefix()}${s} is free ✓`);
    else setSlugStatus('taken', 'That link is taken. Try another.');
  }, 350);
}

// ---------------------------------------------------------------- questions
function renderQuestions() {
  const host = $('#q-list');
  $('#q-count').textContent = questions.length ? `(${questions.length}/${MAX_QUESTIONS})` : '';
  $('#add-starter').hidden = questions.length > 0;
  $('#add-custom').disabled = questions.length >= MAX_QUESTIONS;

  if (questions.length === 0) {
    host.innerHTML = '<p class="hint">No questions yet. Start with a ready-made set, browse ideas, or write your own.</p>';
    renderBank();
    return;
  }

  host.innerHTML = questions.map((q, i) => `
    <div class="q-card" data-qid="${q.id}">
      <div class="q-head">
        <span class="q-num">Question ${i + 1}</span>
        <div class="q-tools">
          <button type="button" class="icon-btn" data-act="up" aria-label="Move question ${i + 1} up" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="icon-btn" data-act="down" aria-label="Move question ${i + 1} down" ${i === questions.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" class="icon-btn" data-act="remove" aria-label="Remove question ${i + 1}">✕</button>
        </div>
      </div>
      <textarea class="textarea q-prompt" data-field="prompt" rows="1" maxlength="200" placeholder="Ask something…" aria-label="Question ${i + 1}">${escapeHtml(q.prompt)}</textarea>
      <p class="hint" style="margin-top:0.8rem">Tick every answer you’d accept</p>
      ${q.options.map((o, j) => `
        <div class="opt-row">
          <button type="button" class="accept-btn" data-act="accept" data-j="${j}" aria-pressed="${q.accepted.includes(j)}"
                  aria-label="Accept answer ${j + 1}" title="I’d accept this">✓</button>
          <input class="input" data-field="option" data-j="${j}" value="${escapeHtml(o)}" maxlength="80" placeholder="Answer ${j + 1}" aria-label="Question ${i + 1}, answer ${j + 1}">
          <button type="button" class="icon-btn" data-act="remove-opt" data-j="${j}" aria-label="Remove answer ${j + 1}" ${q.options.length <= 2 ? 'disabled' : ''}>✕</button>
        </div>`).join('')}
      ${q.options.length < 6 ? '<button type="button" class="btn btn-ghost btn-sm" data-act="add-opt" style="margin-top:0.5rem">+ Add an answer</button>' : ''}
      <div class="q-foot">
        <div class="seg" role="group" aria-label="How much question ${i + 1} matters">
          ${Object.entries(IMPORTANCE).map(([k, v]) => `<button type="button" data-act="importance" data-k="${k}" aria-pressed="${q.importance === k}">${v.label}</button>`).join('')}
        </div>
        <span class="hint">${IMPORTANCE[q.importance].hint}</span>
      </div>
      <p class="error-text" data-err hidden style="margin-top:0.6rem"></p>
    </div>`).join('');
  $$('.q-prompt', host).forEach(autosize);
  renderBank();
}

function autosize(el) {
  if (!el.offsetParent) return; // hidden: measure once visible
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight + 2}px`;
}

function findQ(el) {
  const card = el.closest('[data-qid]');
  if (!card) return {};
  const i = questions.findIndex((q) => q.id === card.dataset.qid);
  return { card, i, q: questions[i] };
}

function onQuestionInput(e) {
  const { card, q } = findQ(e.target);
  if (!q) return;
  if (e.target.dataset.field === 'prompt') {
    if (/\n/.test(e.target.value)) e.target.value = e.target.value.replace(/\s*\n+\s*/g, ' ');
    q.prompt = e.target.value;
    autosize(e.target);
  }
  if (e.target.dataset.field === 'option') q.options[Number(e.target.dataset.j)] = e.target.value;
  card.classList.remove('has-error');
  card.querySelector('[data-err]').hidden = true;
  markDirty();
}

function onQuestionClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const { i, q } = findQ(btn);
  if (!q) return;
  const j = Number(btn.dataset.j);

  switch (btn.dataset.act) {
    case 'accept':
      q.accepted = q.accepted.includes(j) ? q.accepted.filter((a) => a !== j) : [...q.accepted, j].sort((a, b) => a - b);
      break;
    case 'add-opt':
      if (q.options.length >= 6) return;
      q.options.push('');
      break;
    case 'remove-opt':
      if (q.options.length <= 2) return;
      q.options.splice(j, 1);
      q.accepted = q.accepted.filter((a) => a !== j).map((a) => (a > j ? a - 1 : a));
      break;
    case 'importance':
      q.importance = btn.dataset.k;
      break;
    case 'up':
      if (i > 0) [questions[i - 1], questions[i]] = [questions[i], questions[i - 1]];
      break;
    case 'down':
      if (i < questions.length - 1) [questions[i + 1], questions[i]] = [questions[i], questions[i + 1]];
      break;
    case 'remove':
      questions.splice(i, 1);
      toast('Question removed');
      break;
    default:
      return;
  }
  markDirty();
  const keepId = q.id;
  const act = btn.dataset.act;
  renderQuestions();

  // Put focus back somewhere sensible after re-rendering.
  const card = $(`[data-qid="${keepId}"]`);
  if (!card) return;
  if (act === 'add-opt') {
    const inputs = $$('[data-field="option"]', card);
    inputs[inputs.length - 1]?.focus();
  } else if (act === 'up' || act === 'down') {
    (card.querySelector(`[data-act="${act}"]:not([disabled])`) || card.querySelector('[data-act="remove"]')).focus();
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } else if (act === 'accept') {
    card.querySelector(`[data-act="accept"][data-j="${j}"]`)?.focus();
  } else if (act === 'importance') {
    card.querySelector(`[data-act="importance"][data-k="${btn.dataset.k}"]`)?.focus();
  }
}

function addQuestion(base, { focusPrompt = false, quiet = false } = {}) {
  if (questions.length >= MAX_QUESTIONS) {
    toast(`You can have up to ${MAX_QUESTIONS} questions.`, 'error');
    return null;
  }
  const q = { id: uid(), prompt: base.prompt, options: [...base.options], accepted: [], importance: 'important' };
  questions.push(q);
  markDirty();
  renderQuestions();
  if (!quiet) {
    const card = $(`[data-qid="${q.id}"]`);
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (focusPrompt) card.querySelector('[data-field="prompt"]').focus({ preventScroll: true });
  }
  return q;
}

function addStarterSet() {
  let added = 0;
  STARTER_PROMPTS.forEach((p) => {
    if (questions.some((q) => q.prompt === p)) return;
    const bank = findBankQuestion(p);
    if (bank && addQuestion(bank, { quiet: true })) added += 1;
  });
  if (added) {
    toast(`Added ${added} questions. Now tick the answers you’d accept.`);
    $('#q-list').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// ---------------------------------------------------------------- bank
function renderBank() {
  const cats = $('#bank-cats');
  if (!cats) return;
  cats.innerHTML = CATEGORIES.map((c) =>
    `<button type="button" data-cat="${c.id}" aria-pressed="${bankCat === c.id}">${escapeHtml(c.name)}</button>`).join('');
  $$('[data-cat]', cats).forEach((b) => b.addEventListener('click', () => { bankCat = b.dataset.cat; renderBank(); }));

  const cat = CATEGORIES.find((c) => c.id === bankCat);
  $('#bank-items').innerHTML = cat.questions.map((q, k) => {
    const added = questions.some((x) => x.prompt.trim() === q.prompt);
    return `
      <div class="bank-item">
        <div><p>${escapeHtml(q.prompt)}</p><small>${q.options.map(escapeHtml).join(' · ')}</small></div>
        <button type="button" class="btn ${added ? 'btn-ghost' : 'btn-secondary'} btn-sm" data-bank="${k}" ${added ? 'disabled' : ''}>${added ? 'Added ✓' : 'Add'}</button>
      </div>`;
  }).join('');
  $$('[data-bank]').forEach((b) => b.addEventListener('click', () => {
    const q = cat.questions[Number(b.dataset.bank)];
    if (addQuestion(q, { quiet: true })) toast('Added. Tick the answers you’d accept.');
  }));
}

// ---------------------------------------------------------------- validation
function fieldError(id, msg) {
  const el = $(`#e-${id}`);
  if (el) { el.textContent = msg; el.hidden = false; }
  $(`#${id}`)?.classList.add('invalid');
}

function clearFieldError(id) {
  const el = $(`#e-${id}`);
  if (el) el.hidden = true;
  $(`#${id}`)?.classList.remove('invalid');
}

function questionError(q) {
  if (!q.prompt.trim()) return 'Write the question.';
  const opts = q.options.map((o) => o.trim());
  if (opts.some((o) => !o)) return 'Fill in every answer, or remove the empty one.';
  if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) return 'Two answers are the same.';
  if (q.accepted.length === 0) return 'Tick at least one answer you’d accept.';
  return null;
}

function validateAll() {
  let firstBad = null;
  const flag = (el) => { if (!firstBad) firstBad = el; };

  if (!quiz.display_name.trim()) { fieldError('display_name', 'Add your name.'); flag($('#display_name')); }

  if (slugState === 'taken' || slugState === 'invalid' || !SLUG_RE.test(quiz.slug)) {
    if (slugState !== 'taken') setSlugStatus('invalid', quiz.slug ? 'Letters, numbers and dashes only, 3–30 characters.' : 'Pick a link name.');
    flag($('#slug'));
  }

  const lo = quiz.min_age;
  const hi = quiz.max_age;
  if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 18 || hi > 99 || lo > hi) {
    $('#e-age').textContent = lo < 18 ? 'Everyone must be 18 or older.' : 'Use ages from 18 to 99, youngest first.';
    $('#e-age').hidden = false;
    $('#min_age').classList.add('invalid');
    $('#max_age').classList.add('invalid');
    flag($('#min_age'));
  }

  if (quiz.contact_methods.length === 0) {
    $('#e-methods').textContent = 'Pick at least one way for matches to reach you.';
    $('#e-methods').hidden = false;
    flag($('#m-instagram'));
  }

  questions.forEach((q) => {
    const card = $(`[data-qid="${q.id}"]`);
    const msg = questionError(q);
    const err = card.querySelector('[data-err]');
    card.classList.toggle('has-error', !!msg);
    err.hidden = !msg;
    err.textContent = msg || '';
    if (msg) flag(card.querySelector('[data-field="prompt"]'));
  });

  if ($('#is_published').checked && questions.length < MIN_TO_PUBLISH && !firstBad) {
    toast(`Add at least ${MIN_TO_PUBLISH} questions before publishing.`, 'error');
    flag($('#add-custom'));
  }

  if (firstBad) {
    firstBad.scrollIntoView({ behavior: 'smooth', block: 'center' });
    firstBad.focus({ preventScroll: true });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------- save
async function save(e) {
  e?.preventDefault();
  if (saving) return;
  if (!validateAll()) return;

  saving = true;
  $('#save').disabled = true;
  updateSaveBar();

  const wantLive = $('#is_published').checked;
  const fields = {
    display_name: quiz.display_name.trim(),
    slug: quiz.slug,
    headline: quiz.headline.trim() || null,
    intro: quiz.intro.trim() || null,
    min_age: quiz.min_age,
    max_age: quiz.max_age,
    threshold: quiz.threshold,
    contact_methods: quiz.contact_methods,
    notify_by_email: quiz.notify_by_email,
  };

  try {
    if (!quizId) {
      const { data, error } = await sb.from('quizzes').insert({ ...fields, is_published: false }).select('id').single();
      if (error) throw error;
      quizId = data.id;
      history.replaceState(null, '', `/builder.html?id=${quizId}`);
      $('#page-title').textContent = 'Edit your quiz';
      $('#danger').hidden = false;
    } else {
      const { error } = await sb.from('quizzes').update(wantLive ? fields : { ...fields, is_published: false }).eq('id', quizId);
      if (error) throw error;
    }

    const payload = questions.map((q) => ({
      id: q.id,
      prompt: q.prompt.trim(),
      options: q.options.map((o) => o.trim()),
      accepted: [...new Set(q.accepted)].sort((a, b) => a - b),
      importance: q.importance,
    }));
    const { error: qErr } = await sb.rpc('save_questions', { p_quiz_id: quizId, p_questions: payload });
    if (qErr) throw qErr;

    if (wantLive && !publishedInDb) {
      const { error } = await sb.from('quizzes').update({ is_published: true }).eq('id', quizId);
      if (error) throw error;
    }

    const justPublished = wantLive && !publishedInDb;
    const justUnpublished = !wantLive && publishedInDb;
    publishedInDb = wantLive;
    originalSlug = quiz.slug;
    setSlugStatus('ok', 'This is your current link.');
    dirty = false;
    if (justPublished) {
      toast('Saved. Your quiz is live! Copy your link and share it.');
      showPublishPanel();
    } else if (justUnpublished) {
      toast('Saved. Your quiz is offline now.');
    } else if (wantLive) {
      toast('Saved');
    } else if (questions.length >= MIN_TO_PUBLISH) {
      toast('Saved as a draft. Nobody can see it until you make it live.');
      if (!nudgedDraft) { nudgedDraft = true; showPublishPanel(); }
    } else {
      toast(`Saved as a draft. Add at least ${MIN_TO_PUBLISH} questions to go live.`);
    }
  } catch (err) {
    handleSaveError(err);
  } finally {
    saving = false;
    $('#save').disabled = false;
    updateSaveBar();
  }
}

function handleSaveError(err) {
  const msg = String(err?.message || '');
  if (err?.code === '23505' || /duplicate key.*slug/i.test(msg)) {
    setSlugStatus('taken', 'That link is taken. Try another.');
    $('#slug').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('#slug').focus({ preventScroll: true });
    toast('That link is already taken.', 'error');
  } else if (/slug/i.test(msg) && err?.code === '23514') {
    setSlugStatus('invalid', 'That link name isn’t allowed. Try another.');
    toast('That link name isn’t allowed.', 'error');
  } else if (/up to 5 quizzes/i.test(msg)) {
    toast('You can have up to 5 quizzes.', 'error');
  } else if (/JWT|not authenticated|permission/i.test(msg)) {
    toast('You’ve been signed out. Sign in again to save.', 'error');
  } else {
    toast('Couldn’t save. Check your connection and try again.', 'error');
    console.error(err);
  }
}

// ---------------------------------------------------------------- delete
function confirmDelete() {
  const wrap = $('#delete-wrap');
  wrap.innerHTML = `
    <span class="fine">Delete this quiz and all its matches?</span>
    <button type="button" class="btn btn-danger btn-sm" id="del-yes">Yes, delete</button>
    <button type="button" class="btn btn-ghost btn-sm" id="del-no">Keep it</button>`;
  $('#del-no').onclick = () => {
    wrap.innerHTML = '<button type="button" class="btn btn-danger btn-sm" id="delete-quiz">Delete quiz</button>';
    $('#delete-quiz').onclick = confirmDelete;
  };
  $('#del-yes').onclick = async () => {
    $('#del-yes').disabled = true;
    const { error } = await sb.from('quizzes').delete().eq('id', quizId);
    if (error) { toast('Couldn’t delete. Try again.', 'error'); $('#del-yes').disabled = false; return; }
    dirty = false;
    location.href = '/dashboard.html';
  };
}
