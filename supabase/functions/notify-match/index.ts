// Emails a creator when someone matches and leaves their details.
//
// Triggered by a Supabase Database Webhook on INSERT into public.matches.
// Sends through Resend (https://resend.com). See README > "Match emails".
//
// Secrets to set (supabase secrets set NAME=value):
//   RESEND_API_KEY   your Resend API key
//   NOTIFY_FROM      e.g. "Compatible <matches@yourdomain.com>" (a domain verified in Resend)
//   SITE_URL         e.g. https://yourdomain.com
//   WEBHOOK_SECRET   any long random string; add the same value as an
//                    "x-webhook-secret" header on the database webhook
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from 'npm:@supabase/supabase-js@2';

const escapeHtml = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

Deno.serve(async (req) => {
  const secret = Deno.env.get('WEBHOOK_SECRET');
  if (!secret || req.headers.get('x-webhook-secret') !== secret) {
    return new Response('Unauthorized', { status: 401 });
  }

  let payload: { type?: string; table?: string; record?: Record<string, unknown> };
  try {
    payload = await req.json();
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  if (payload.type !== 'INSERT' || payload.table !== 'matches' || !payload.record) {
    return new Response('Ignored');
  }
  const match = payload.record;

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  const { data: quiz, error: quizErr } = await admin
    .from('quizzes')
    .select('display_name, owner_id, notify_by_email')
    .eq('id', match.quiz_id)
    .single();
  if (quizErr || !quiz) return new Response('Quiz not found', { status: 404 });
  if (!quiz.notify_by_email) return new Response('Notifications off');

  const { data: userRes, error: userErr } = await admin.auth.admin.getUserById(quiz.owner_id);
  const to = userRes?.user?.email;
  if (userErr || !to) return new Response('No email for owner', { status: 404 });

  const site = (Deno.env.get('SITE_URL') ?? '').replace(/\/$/, '');
  const name = escapeHtml(match.name);
  const note = match.note ? `<p style="margin:16px 0;padding:12px 16px;border-left:3px solid #c4616c;background:#fbf3f0;color:#3a1d22">${escapeHtml(match.note)}</p>` : '';

  // Contact details stay in the dashboard rather than in the email.
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#2d1118">
      <h1 style="font-family:Georgia,serif;font-size:26px;margin:0 0 8px">You have a new match ✨</h1>
      <p style="font-size:16px;line-height:1.6;margin:0">
        <strong>${name}</strong> scored <strong>${escapeHtml(match.score)}%</strong> on your quiz
        and left their ${({ instagram: 'Instagram handle', x: 'X handle', whatsapp: 'WhatsApp number', email: 'email' } as Record<string, string>)[String(match.contact_method)] ?? 'contact'} for you.
      </p>
      ${note}
      <p style="margin:24px 0">
        <a href="${site}/dashboard.html" style="background:#c4616c;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;display:inline-block">Open your dashboard</a>
      </p>
      <p style="font-size:12px;color:#8a6f73">You get these because match emails are on for ${escapeHtml(quiz.display_name)}’s quiz. Turn them off in the quiz editor.</p>
    </div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: Deno.env.get('NOTIFY_FROM'),
      to,
      subject: `New match: ${String(match.name)} (${match.score}%)`,
      html,
    }),
  });

  if (!res.ok) {
    console.error('Resend error', res.status, await res.text());
    return new Response('Email failed', { status: 502 });
  }
  return new Response('Sent');
});
