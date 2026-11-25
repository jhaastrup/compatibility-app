import { sb, $, escapeHtml, setupBanner, isDemo } from './lib.js';

setupBanner();

const { data: existing } = await sb.auth.getSession();
if (existing.session) location.replace('/dashboard.html');

if (isDemo) {
  $('.subtitle').textContent = 'Demo mode: no email is sent. Enter any email and you’ll go straight to your dashboard.';
  $('#send').textContent = 'Continue';
}

const email = $('#email');
const adult = $('#adult');

[email, adult].forEach((el) => el.addEventListener('input', () => {
  $(`#${el.getAttribute('aria-describedby')}`).hidden = true;
  el.classList.remove('invalid');
}));

$('#login').addEventListener('submit', async (e) => {
  e.preventDefault();
  ['e-email', 'e-adult', 'e-form'].forEach((id) => { $(`#${id}`).hidden = true; });
  const value = email.value.trim();
  let ok = true;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
    $('#e-email').textContent = value ? 'That email doesn’t look right.' : 'Enter your email.';
    $('#e-email').hidden = false;
    email.classList.add('invalid');
    ok = false;
  }
  if (!adult.checked) {
    $('#e-adult').textContent = 'You need to be 18 or older to use this.';
    $('#e-adult').hidden = false;
    ok = false;
  }
  if (!ok) return;

  const btn = $('#send');
  btn.disabled = true;
  btn.textContent = 'Sending…';

  const { error } = await sb.auth.signInWithOtp({
    email: value,
    options: {
      emailRedirectTo: `${location.origin}/dashboard.html`,
      data: { adult_confirmed_at: new Date().toISOString() },
    },
  });

  btn.disabled = false;
  btn.textContent = isDemo ? 'Continue' : 'Send me a sign-in link';

  if (!error && isDemo) {
    location.href = '/dashboard.html';
    return;
  }

  if (error) {
    const msg = /rate|limit|seconds/i.test(error.message)
      ? 'Too many sign-in emails just now. Wait a minute and try again.'
      : 'Couldn’t send the link. Check the email address and try again.';
    $('#e-form').textContent = msg;
    $('#e-form').hidden = false;
    return;
  }

  $('#app').innerHTML = `
    <div class="screen-enter">
      <div class="heart-icon" aria-hidden="true">\u{1F48C}</div>
      <h2 class="result-title">Check your inbox</h2>
      <p class="subtitle">We sent a sign-in link to <strong>${escapeHtml(value)}</strong>. Open it on this device to get started. It can take a minute, and it might land in spam.</p>
      <a class="btn btn-secondary btn-full" href="/login.html">Use a different email</a>
    </div>`;
});
