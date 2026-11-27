import {
  sb, CONFIG, escapeHtml, $, $$, storage, DIAL_CODES, guessDialCode, toE164, setupBanner, isDemo,
  CONTACT_METHODS, METHOD_ORDER, isHandleMethod, normalizeHandle, isValidHandle,
} from './lib.js';

const app = $('#app');
const store = storage();
const slug = readSlug();

let quiz = null;
let age = null;
let index = 0;
const answers = {}; // { questionId: optionIndex }

function readSlug() {
  const fromQuery = new URLSearchParams(location.search).get('u');
  if (fromQuery) return fromQuery.trim().toLowerCase();
  const m = location.pathname.match(/\/q\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]).trim().toLowerCase() : '';
}

function render(html) {
  app.innerHTML = `<div class="screen-enter">${html}</div>`;
  const focusEl = app.querySelector('[data-autofocus]');
  if (focusEl) focusEl.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}

const progress = (fraction) =>
  `<div class="progress-container" aria-hidden="true"><div class="progress-bar" style="width:${Math.round(fraction * 100)}%"></div></div>`;

const nameHtml = () => escapeHtml(quiz?.display_name || 'them');

const madeWith = () =>
  `<p class="fine made-with">Made with ${escapeHtml(CONFIG.APP_NAME)} &middot; <a class="link" href="/">Make your own</a></p>`;

function renderMessage(icon, title, text, { retry, cta } = {}) {
  render(`
    <div class="not-match-icon" aria-hidden="true">${icon}</div>
    <h2 class="result-title">${escapeHtml(title)}</h2>
    <p class="subtitle">${escapeHtml(text)}</p>
    ${retry ? '<button class="btn btn-primary btn-full" id="retry">Try again</button>' : ''}
    ${cta ? '<a class="btn btn-primary btn-full" href="/">Make your own quiz</a>' : ''}
  `);
  if (retry) $('#retry').onclick = retry;
}

// ---------------------------------------------------------------- load
async function load() {
  setupBanner();
  if (!slug) {
    renderMessage('\u{1F50D}', 'Quiz not found', 'This link looks incomplete. Check it and try again.', { cta: true });
    return;
  }
  const { data, error } = await sb.rpc('get_public_quiz', { p_slug: slug });
  if (error) {
    renderMessage('⚠️', 'Something went wrong', 'We couldn’t load this quiz. Please try again in a moment.', { retry: load });
    return;
  }
  if (!data || !Array.isArray(data.questions) || data.questions.length === 0) {
    renderMessage('\u{1F50D}', 'Quiz not found', 'This quiz doesn’t exist or isn’t live yet.', { cta: true });
    return;
  }
  quiz = data;
  document.title = `Are you a match for ${quiz.display_name}?`;

  if (quiz.preview) {
    const bar = document.createElement('div');
    bar.className = 'setup-banner';
    bar.textContent = quiz.is_published
      ? 'Preview: you\u2019re signed in as the creator, so nothing you do here is saved or counted.'
      : 'Preview of your draft. Only you can see it until you publish. Nothing here is saved.';
    document.body.prepend(bar);
    renderWelcome();
    return;
  }

  const pending = store.get(`pending:${slug}`);
  if (pending && Date.now() - pending.at < 110 * 60 * 1000) {
    renderMatch(pending, { resumed: true });
    return;
  }
  store.remove(`pending:${slug}`);

  const taken = isDemo ? null : store.get(`taken:${slug}`);
  if (taken === 'sent' || taken === 'match') {
    renderMessage('\u{1F48C}', 'You’ve already matched', `You matched with ${quiz.display_name} and shared your details. Fingers crossed!`, { cta: true });
    return;
  }
  if (taken === 'nomatch') {
    renderMessage('\u{1F319}', 'You’ve taken this one', `You’ve already taken ${quiz.display_name}’s quiz. Why not make your own and see who matches with you?`, { cta: true });
    return;
  }
  renderWelcome();
}

// ---------------------------------------------------------------- welcome + age
function renderWelcome() {
  const headline = quiz.headline ? escapeHtml(quiz.headline) : `Are you a match for ${nameHtml()}?`;
  const intro = quiz.intro
    ? escapeHtml(quiz.intro)
    : 'A quick, thoughtful quiz to see if you two are compatible. Answer honestly — there are no wrong answers, only real ones.';
  const count = quiz.questions.length;
  const mins = Math.max(1, Math.round((count * 10) / 60));
  render(`
    <div class="heart-icon" aria-hidden="true">\u{1F495}</div>
    <h1>${headline}</h1>
    <p class="subtitle" style="white-space:pre-line">${intro}</p>
    <button class="btn btn-primary btn-full" id="start">Begin the quiz</button>
    <p class="fine" style="margin-top:1rem">${count} questions &middot; about ${mins} min &middot; 18+ only</p>
    <p class="fine" style="margin-top:0.5rem">By starting, you agree that your answers are used to check if you and ${nameHtml()} match. Some questions may be personal. <a class="link" href="/privacy.html" target="_blank" rel="noopener">Privacy notice</a></p>
    ${madeWith()}
  `);
  $('#start').onclick = renderAge;
}

function renderAge() {
  render(`
    ${progress(0)}
    <p class="question-counter">First, a quick check</p>
    <h2 class="question-text">How old are you?</h2>
    <form id="age-form" class="form-stack" novalidate>
      <input id="age" class="input pill age-input" type="number" inputmode="numeric" min="1" max="120"
             placeholder="Age" aria-label="Your age" aria-describedby="age-err" value="${age ?? ''}" data-autofocus>
      <p id="age-err" class="error-text" hidden></p>
      <button class="btn btn-primary btn-full" type="submit">Continue</button>
    </form>
  `);
  const input = $('#age');
  const err = $('#age-err');
  input.addEventListener('input', () => { err.hidden = true; input.classList.remove('invalid'); });
  $('#age-form').onsubmit = (e) => {
    e.preventDefault();
    const v = Number(input.value);
    if (!input.value || !Number.isInteger(v) || v < 1 || v > 120) {
      err.textContent = 'Enter your age in years.';
      err.hidden = false;
      input.classList.add('invalid');
      input.focus();
      return;
    }
    if (v < 18) {
      renderMessage('\u{1F319}', 'This quiz is for adults', 'You need to be 18 or older to take it.');
      return;
    }
    if (v < quiz.min_age || v > quiz.max_age) {
      renderNoMatch('age');
      return;
    }
    age = v;
    index = 0;
    renderQuestion();
  };
}

// ---------------------------------------------------------------- questions
function renderQuestion() {
  const q = quiz.questions[index];
  const total = quiz.questions.length;
  const chosen = answers[q.id];
  const compact = q.options.length === 2 && q.options.every((o) => o.length <= 14);

  const isLast = index === total - 1;

  // Tap an answer to select it, then Next. Both answers look the same until
  // one is picked, so the layout never nudges people towards an answer.
  render(`
    ${progress(index / total)}
    <p class="question-counter">Question ${index + 1} of ${total}</p>
    <h2 class="question-text" id="q-text">${escapeHtml(q.prompt)}</h2>
    <div class="option-list${compact ? ' two' : ''}" role="group" aria-labelledby="q-text">${q.options.map((o, i) =>
      `<button type="button" class="option-btn${chosen === i ? ' selected' : ''}" data-i="${i}" aria-pressed="${chosen === i}">${escapeHtml(o)}</button>`).join('')}</div>
    <div class="q-nav">
      <button type="button" class="btn btn-ghost btn-sm" id="back">← Back</button>
      <button type="button" class="btn btn-primary" id="next" ${chosen === undefined ? 'disabled' : ''}>${isLast ? 'See if we match' : 'Next →'}</button>
    </div>
  `);

  const next = $('#next');
  $$('[data-i]', app).forEach((btn) => {
    btn.addEventListener('click', () => {
      answers[q.id] = Number(btn.dataset.i);
      $$('[data-i]', app).forEach((b) => {
        const on = b === btn;
        b.classList.toggle('selected', on);
        b.setAttribute('aria-pressed', String(on));
      });
      next.disabled = false;
    });
  });
  next.onclick = () => {
    if (answers[q.id] === undefined) return;
    next.disabled = true;
    if (isLast) submitAnswers();
    else { index += 1; renderQuestion(); }
  };
  $('#back').onclick = () => {
    if (index === 0) renderAge();
    else { index -= 1; renderQuestion(); }
  };
}

// ---------------------------------------------------------------- scoring
async function submitAnswers() {
  render(`
    <div style="padding:2rem 0">
      <div class="spinner" role="status" aria-label="Checking"></div>
      <p class="subtitle" style="margin:0">Checking your compatibility…</p>
    </div>`);

  const { data, error } = await sb.rpc('submit_attempt', { p_slug: slug, p_age: age, p_answers: answers });
  if (error || !data) {
    renderMessage('⚠️', 'Something went wrong', 'We couldn’t check your answers. Your answers are still here, so try again.', { retry: submitAnswers });
    return;
  }
  if (!data.ok) {
    if (data.error === 'rate_limited') {
      renderMessage('⏳', 'Take a breather', 'This quiz has been taken a few times from your network today. Try again tomorrow.');
    } else if (data.error === 'adults_only') {
      renderMessage('\u{1F319}', 'This quiz is for adults', 'You need to be 18 or older to take it.');
    } else if (data.error === 'not_found') {
      renderMessage('\u{1F50D}', 'Quiz not found', 'This quiz has been taken down or changed. Sorry about that.', { cta: true });
    } else {
      renderMessage('⚠️', 'Something went wrong', 'We couldn’t check your answers. Please try again.', { retry: submitAnswers });
    }
    return;
  }

  if (data.preview) {
    if (data.matched) {
      renderMatch({
        token: null, preview: true, score: data.score,
        common: Array.isArray(data.common) ? data.common : [],
        methods: data.contact_methods, at: Date.now(),
      });
    } else {
      renderNoMatch(data.reason, data.preview_reason);
    }
    return;
  }

  if (data.matched) {
    const pending = {
      token: data.token,
      score: data.score,
      common: Array.isArray(data.common) ? data.common : [],
      methods: Array.isArray(data.contact_methods) ? data.contact_methods : quiz.contact_methods,
      at: Date.now(),
    };
    store.set(`pending:${slug}`, pending);
    renderMatch(pending);
    return;
  }
  store.set(`taken:${slug}`, 'nomatch');
  renderNoMatch(data.reason);
}

const PREVIEW_REASONS = {
  age: 'the age is outside your range',
  dealbreaker: 'at least one dealbreaker wasn\u2019t answered your way',
  score: 'the score was below your match threshold',
};

function renderNoMatch(reason, previewReason) {
  const text = reason === 'age'
    ? `${quiz.display_name} is looking for someone in a different age range this time. Wishing you the best on your search.`
    : 'Your answers didn’t line up closely enough this time. That says nothing bad about you — just that you two want different things.';
  render(`
    ${progress(1)}
    <div class="not-match-icon" aria-hidden="true">\u{1F319}</div>
    <h2 class="result-title">Not this time</h2>
    <p class="subtitle">${escapeHtml(text)}</p>
    ${previewReason ? `<p class="hint" style="margin:-1rem 0 1.5rem">Preview only: no match because ${PREVIEW_REASONS[previewReason] || 'of the answers'}. Visitors don\u2019t see this reason.</p>` : ''}
    ${quiz.preview
      ? '<button class="btn btn-primary btn-full" id="again">Try again</button>'
      : `<a class="btn btn-primary btn-full" href="/">Make your own quiz</a>
    <p class="fine" style="margin-top:1rem">Build yours in a couple of minutes and see who matches with you.</p>`}
  `);
  if (isDemo) {
    app.querySelector('.screen-enter').insertAdjacentHTML('beforeend',
      '<button class="btn btn-ghost btn-sm" id="demo-again" style="margin-top:1rem">Demo: take it again</button>');
    $('#demo-again').onclick = () => { Object.keys(answers).forEach((k) => delete answers[k]); renderWelcome(); };
  }
  if (quiz.preview) $('#again').onclick = () => { Object.keys(answers).forEach((k) => delete answers[k]); renderWelcome(); };
}

// ---------------------------------------------------------------- match + contact
function renderMatch(pending, { resumed = false } = {}) {
  const offered = pending.methods && pending.methods.length ? pending.methods : quiz.contact_methods;
  const methods = METHOD_ORDER.filter((m) => offered.includes(m));
  let method = methods[0];
  const n = nameHtml();

  render(`
    ${progress(1)}
    <h2 class="result-title"><span class="match-emoji" aria-hidden="true">✨</span> It’s a match! <span class="match-emoji" aria-hidden="true">✨</span></h2>
    <div class="score-display">${Number(pending.score)}%</div>
    ${pending.common.length ? `
      <p class="eyebrow" style="margin-bottom:0.75rem">Where you two line up</p>
      <ul class="common-list">${pending.common.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>` : ''}
    <p class="subtitle">Leave your details and ${n} can reach out to you.</p>

    <form id="contact" class="form-stack" novalidate>
      <div class="field">
        <label for="c-name">Your first name</label>
        <input id="c-name" class="input" maxlength="60" autocomplete="given-name" aria-describedby="e-name">
        <p id="e-name" class="error-text" hidden></p>
      </div>

      ${methods.length > 1 ? `
      <div class="field">
        <span class="label" id="m-label">How should ${n} reach you?</span>
        <div class="seg full${methods.length > 2 ? ' grid2' : ''}" role="group" aria-labelledby="m-label">
          ${methods.map((m) => `<button type="button" data-m="${m}" aria-pressed="${m === method}">${CONTACT_METHODS[m].label}</button>`).join('')}
        </div>
      </div>` : ''}

      <div class="field" id="f-handle" ${!isHandleMethod(method) ? 'hidden' : ''}>
        <label for="c-handle" id="c-handle-label">${isHandleMethod(method) ? CONTACT_METHODS[method].field : 'Handle'}</label>
        <div class="handle-input" id="c-handle-wrap">
          <span aria-hidden="true">@</span>
          <input id="c-handle" class="input" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="120"
                 placeholder="yourhandle" aria-describedby="e-handle c-handle-hint">
        </div>
        <p class="hint" id="c-handle-hint">Your handle or a link to your profile. ${n} will be able to see your public profile.</p>
        <p id="e-handle" class="error-text" hidden></p>
      </div>

      <div class="field" id="f-wa" ${method !== 'whatsapp' ? 'hidden' : ''}>
        <label for="c-phone">WhatsApp number</label>
        <div class="row">
          <select id="c-dial" class="select dial" aria-label="Country code">
            ${DIAL_CODES.map((d) => `<option value="${d.code}">${escapeHtml(d.label)}</option>`).join('')}
          </select>
          <input id="c-phone" class="input" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="801 234 5678" aria-describedby="e-phone">
        </div>
        <p id="e-phone" class="error-text" hidden></p>
      </div>

      <div class="field" id="f-em" ${method !== 'email' ? 'hidden' : ''}>
        <label for="c-email">Email</label>
        <input id="c-email" class="input" type="email" autocomplete="email" placeholder="you@example.com" aria-describedby="e-email">
        <p id="e-email" class="error-text" hidden></p>
      </div>

      <div class="field">
        <label for="c-note">A note for ${n} <span class="hint">(optional)</span></label>
        <textarea id="c-note" class="textarea" maxlength="500" placeholder="Say hi, or share something about you…"></textarea>
      </div>

      <div class="field">
        <label class="check"><input type="checkbox" id="c-consent" aria-describedby="e-consent">
          <span>I agree to share my name, contact details and quiz answers with ${n} so they can reach me.
          <a class="link" href="/privacy.html" target="_blank" rel="noopener">Privacy notice</a></span></label>
        <p id="e-consent" class="error-text" hidden></p>
      </div>

      <p id="e-form" class="error-text" role="alert" hidden></p>
      <button class="btn btn-primary btn-full" type="submit" id="c-submit">Send to ${n}</button>
    </form>
  `);

  $('#c-dial').value = guessDialCode();
  if (!resumed) celebrate();

  const showErr = (id, msg, inputId) => {
    const el = $(`#${id}`);
    el.textContent = msg;
    el.hidden = false;
    if (inputId) $(`#${inputId}`).classList.add('invalid');
  };
  const clearErrs = () => {
    $$('.error-text', app).forEach((e) => { e.hidden = true; });
    $$('.invalid', app).forEach((e) => e.classList.remove('invalid'));
  };
  $$('input, textarea, select', app).forEach((el) => el.addEventListener('input', () => {
    const errId = (el.getAttribute('aria-describedby') || '').split(' ')[0];
    if (errId) $(`#${errId}`).hidden = true;
    el.classList.remove('invalid');
    if (el.id === 'c-handle') $('#c-handle-wrap').classList.remove('invalid');
  }));

  // A pasted profile link tidies itself to just the handle.
  const tidyHandle = () => {
    const el = $('#c-handle');
    if (!el || !isHandleMethod(method)) return;
    const h = normalizeHandle(method, el.value);
    if (h && h !== el.value && isValidHandle(method, h)) el.value = h;
  };
  $('#c-handle').addEventListener('blur', tidyHandle);
  $('#c-handle').addEventListener('paste', () => setTimeout(tidyHandle, 0));

  $$('[data-m]', app).forEach((b) => b.addEventListener('click', () => {
    method = b.dataset.m;
    $$('[data-m]', app).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    $('#f-wa').hidden = method !== 'whatsapp';
    $('#f-em').hidden = method !== 'email';
    $('#f-handle').hidden = !isHandleMethod(method);
    if (isHandleMethod(method)) {
      $('#c-handle-label').textContent = CONTACT_METHODS[method].field;
      $('#e-handle').hidden = true;
      $('#c-handle-wrap').classList.remove('invalid');
    }
  }));

  $('#contact').onsubmit = async (e) => {
    e.preventDefault();
    clearErrs();
    const name = $('#c-name').value.trim();
    const note = $('#c-note').value.trim();
    const consent = $('#c-consent').checked;
    let value = '';
    let ok = true;
    let firstBad = null;

    if (!name) { showErr('e-name', 'Add your first name.', 'c-name'); ok = false; firstBad ??= '#c-name'; }

    if (isHandleMethod(method)) {
      const raw = $('#c-handle').value.trim();
      value = normalizeHandle(method, raw);
      const site = CONTACT_METHODS[method].label;
      if (!raw) { showErr('e-handle', `Add your ${site} handle.`); $('#c-handle-wrap').classList.add('invalid'); ok = false; firstBad ??= '#c-handle'; }
      else if (!isValidHandle(method, value)) {
        showErr('e-handle', method === 'instagram'
          ? 'That doesn\u2019t look like an Instagram handle. Use letters, numbers, dots or underscores.'
          : 'That doesn\u2019t look like an X handle. Use up to 15 letters, numbers or underscores.');
        $('#c-handle-wrap').classList.add('invalid'); ok = false; firstBad ??= '#c-handle';
      }
    } else if (method === 'whatsapp') {
      const raw = $('#c-phone').value.trim();
      value = toE164($('#c-dial').value, raw);
      if (!raw) { showErr('e-phone', 'Add your WhatsApp number.', 'c-phone'); ok = false; firstBad ??= '#c-phone'; }
      else if (!/^\+[1-9]\d{7,14}$/.test(value)) { showErr('e-phone', 'That number doesn’t look right. Check the country code and digits.', 'c-phone'); ok = false; firstBad ??= '#c-phone'; }
    } else {
      value = $('#c-email').value.trim();
      if (!value) { showErr('e-email', 'Add your email.', 'c-email'); ok = false; firstBad ??= '#c-email'; }
      else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) { showErr('e-email', 'That email doesn’t look right.', 'c-email'); ok = false; firstBad ??= '#c-email'; }
    }

    if (!consent) { showErr('e-consent', 'Tick this so we can pass your details on.'); ok = false; firstBad ??= '#c-consent'; }
    if (!ok) { $(firstBad)?.focus(); return; }

    if (pending.preview) {
      showErr('e-form', 'Preview only: in the real quiz, this sends their details to your dashboard.');
      return;
    }

    const btn = $('#c-submit');
    btn.disabled = true;
    btn.textContent = 'Sending…';

    const { data, error } = await sb.rpc('submit_contact', {
      p_token: pending.token, p_name: name, p_method: method, p_value: value, p_note: note || null, p_consent: true,
    });

    btn.disabled = false;
    btn.textContent = `Send to ${quiz.display_name}`;

    if (error || !data) { showErr('e-form', 'Couldn’t send just now. Check your connection and try again.'); return; }
    if (data.ok || data.error === 'already_submitted') { finish(method); return; }

    switch (data.error) {
      case 'invalid_instagram':
      case 'invalid_x':
        showErr('e-handle', 'That handle doesn\u2019t look right. Check it and try again.');
        $('#c-handle-wrap').classList.add('invalid');
        break;
      case 'invalid_whatsapp': showErr('e-phone', 'That number doesn’t look right. Use the full number with country code.', 'c-phone'); break;
      case 'invalid_email': showErr('e-email', 'That email doesn’t look right.', 'c-email'); break;
      case 'invalid_name': showErr('e-name', 'Add your first name (up to 60 characters).', 'c-name'); break;
      case 'note_too_long': showErr('e-form', 'Your note is a bit long. Keep it under 500 characters.'); break;
      case 'consent_required': showErr('e-consent', 'Tick this so we can pass your details on.'); break;
      case 'expired':
      case 'invalid_token':
        store.remove(`pending:${slug}`);
        renderMessage('⏳', 'This match timed out', 'For safety, matches have to be claimed within two hours. Please take the quiz again.', {
          retry: () => { Object.keys(answers).forEach((k) => delete answers[k]); renderWelcome(); },
        });
        break;
      default: showErr('e-form', 'Something went wrong. Please try again.');
    }
  };
}

function finish(method) {
  store.remove(`pending:${slug}`);
  store.set(`taken:${slug}`, 'sent');
  render(`
    <div class="heart-icon" aria-hidden="true">\u{1F48C}</div>
    <h2 class="result-title">Sent!</h2>
    <p class="subtitle">${nameHtml()} has your details now. If it feels right, they’ll reach out on ${CONTACT_METHODS[method]?.via || 'the details you left'}.${isHandleMethod(method) ? ' Keep an eye on your message requests too.' : ''} Good luck!</p>
    ${isDemo
      ? '<a class="btn btn-primary btn-full" href="/dashboard.html">Demo: see this match in the dashboard</a>'
      : '<a class="btn btn-secondary btn-full" href="/">Make your own quiz</a>'}
  `);
}

function celebrate() {
  if (typeof window.confetti !== 'function') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const end = Date.now() + 2500;
  const colors = ['#c4616c', '#e8929a', '#ff6b7a', '#d4a574', '#fdf6f0'];
  (function frame() {
    window.confetti({ particleCount: 3, angle: 60, spread: 55, origin: { x: 0, y: 0.7 }, colors });
    window.confetti({ particleCount: 3, angle: 120, spread: 55, origin: { x: 1, y: 0.7 }, colors });
    if (Date.now() < end) requestAnimationFrame(frame);
  }());
}

load();
