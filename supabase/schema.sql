-- =====================================================================
-- Compatibility app: database schema for Supabase
-- Paste this whole file into Supabase > SQL Editor and run it once.
-- Safe to re-run: functions are replaced, tables are only created if missing.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

-- A creator's quiz. One creator can have a few (limit enforced below).
create table if not exists public.quizzes (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  slug            text not null unique
                  check (slug ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'),
  display_name    text not null check (char_length(display_name) between 1 and 40),
  headline        text check (char_length(headline) <= 80),
  intro           text check (char_length(intro) <= 400),
  min_age         int  not null default 18 check (min_age between 18 and 99),
  max_age         int  not null default 99 check (max_age between 18 and 99),
  threshold       int  not null default 70 check (threshold between 0 and 100),
  contact_methods text[] not null default array['instagram','x']
                  check (cardinality(contact_methods) >= 1
                         and contact_methods <@ array['instagram','x','whatsapp','email']),
  notify_by_email boolean not null default true,
  is_published    boolean not null default false,
  view_count      int  not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint age_range_valid check (max_age >= min_age),
  constraint slug_not_reserved check (slug not in (
    'admin','api','app','about','assets','builder','css','dashboard','help',
    'index','js','login','logout','privacy','quiz','settings','signup',
    'static','support','terms','www'))
);

-- Questions belong to a quiz. `accepted` holds the indexes (0-based) of the
-- options the creator would accept. It is never sent to quiz-takers.
create table if not exists public.questions (
  id          uuid primary key default gen_random_uuid(),
  quiz_id     uuid not null references public.quizzes(id) on delete cascade,
  position    int  not null default 0,
  prompt      text not null check (char_length(prompt) between 1 and 200),
  options     text[] not null check (cardinality(options) between 2 and 6),
  accepted    int[]  not null,
  importance  text not null default 'important'
              check (importance in ('dealbreaker','important','nice')),
  created_at  timestamptz not null default now(),
  constraint options_valid check (
    not ('' = any(options))
    and char_length(array_to_string(options, '|')) <= 600),
  constraint accepted_valid check (
    cardinality(accepted) >= 1
    and 0 <= all(accepted)
    and cardinality(options) > all(accepted))
);
create index if not exists questions_quiz_idx on public.questions(quiz_id, position);

-- Every completed quiz. No personal details here: just age, answers and result.
create table if not exists public.attempts (
  id             uuid primary key default gen_random_uuid(),
  quiz_id        uuid not null references public.quizzes(id) on delete cascade,
  age            int  not null,
  answers        jsonb not null,           -- { "<question_id>": <option_index> }
  score          int  not null,
  matched        boolean not null,
  reason         text,                     -- 'age' | 'dealbreaker' | 'score' | null
  contact_token  uuid unique,              -- issued only on a match
  token_used     boolean not null default false,
  ip_hash        text,                     -- hashed, only used for rate limiting
  created_at     timestamptz not null default now()
);
create index if not exists attempts_quiz_idx on public.attempts(quiz_id, created_at desc);
create index if not exists attempts_ip_idx on public.attempts(quiz_id, ip_hash, created_at);

-- Contact details left by someone who matched (and consented).
create table if not exists public.matches (
  id              uuid primary key default gen_random_uuid(),
  quiz_id         uuid not null references public.quizzes(id) on delete cascade,
  attempt_id      uuid not null unique references public.attempts(id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 60),
  contact_method  text not null check (contact_method in ('instagram','x','whatsapp','email')),
  contact_value   text not null check (char_length(contact_value) <= 254),
  note            text check (char_length(note) <= 500),
  score           int  not null,
  consent_at      timestamptz not null default now(),
  status          text not null default 'new' check (status in ('new','contacted','archived')),
  created_at      timestamptz not null default now()
);
create index if not exists matches_quiz_idx on public.matches(quiz_id, created_at desc);

-- Upgrade: earlier versions only allowed WhatsApp and email. Re-running this
-- file widens the rules so Instagram and X handles are allowed too.
alter table public.quizzes alter column contact_methods set default array['instagram','x'];
alter table public.quizzes drop constraint if exists quizzes_contact_methods_check;
alter table public.quizzes add constraint quizzes_contact_methods_check check (
  cardinality(contact_methods) >= 1
  and contact_methods <@ array['instagram','x','whatsapp','email']);
alter table public.matches drop constraint if exists matches_contact_method_check;
alter table public.matches add constraint matches_contact_method_check check (
  contact_method in ('instagram','x','whatsapp','email'));

-- ---------------------------------------------------------------------
-- Triggers: updated_at, and a cap on quizzes per creator
-- ---------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists quizzes_touch on public.quizzes;
create trigger quizzes_touch before update on public.quizzes
  for each row execute function public.touch_updated_at();

create or replace function public.limit_quizzes_per_owner()
returns trigger language plpgsql set search_path = public as $$
begin
  if (select count(*) from public.quizzes where owner_id = new.owner_id) >= 5 then
    raise exception 'You can have up to 5 quizzes.';
  end if;
  return new;
end $$;

drop trigger if exists quizzes_limit on public.quizzes;
create trigger quizzes_limit before insert on public.quizzes
  for each row execute function public.limit_quizzes_per_owner();

-- ---------------------------------------------------------------------
-- Row level security
-- Creators can only see and change their own quizzes, questions,
-- attempts and matches. Quiz-takers never touch tables directly:
-- they go through the functions further down.
-- ---------------------------------------------------------------------

alter table public.quizzes   enable row level security;
alter table public.questions enable row level security;
alter table public.attempts  enable row level security;
alter table public.matches   enable row level security;

drop policy if exists "owners manage their quizzes" on public.quizzes;
create policy "owners manage their quizzes" on public.quizzes
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "owners manage their questions" on public.questions;
create policy "owners manage their questions" on public.questions
  for all to authenticated
  using (exists (select 1 from public.quizzes q where q.id = quiz_id and q.owner_id = auth.uid()))
  with check (exists (select 1 from public.quizzes q where q.id = quiz_id and q.owner_id = auth.uid()));

drop policy if exists "owners read their attempts" on public.attempts;
create policy "owners read their attempts" on public.attempts
  for select to authenticated
  using (exists (select 1 from public.quizzes q where q.id = quiz_id and q.owner_id = auth.uid()));

drop policy if exists "owners read their matches" on public.matches;
create policy "owners read their matches" on public.matches
  for select to authenticated
  using (exists (select 1 from public.quizzes q where q.id = quiz_id and q.owner_id = auth.uid()));

drop policy if exists "owners update their matches" on public.matches;
create policy "owners update their matches" on public.matches
  for update to authenticated
  using (exists (select 1 from public.quizzes q where q.id = quiz_id and q.owner_id = auth.uid()));

drop policy if exists "owners delete their matches" on public.matches;
create policy "owners delete their matches" on public.matches
  for delete to authenticated
  using (exists (select 1 from public.quizzes q where q.id = quiz_id and q.owner_id = auth.uid()));

-- Table privileges: nothing for anonymous visitors, only what's needed for creators.
revoke all on public.quizzes, public.questions, public.attempts, public.matches from anon, authenticated;

grant select, insert, delete on public.quizzes to authenticated;
grant update (slug, display_name, headline, intro, min_age, max_age, threshold,
              contact_methods, notify_by_email, is_published)
  on public.quizzes to authenticated;
grant select, insert, update, delete on public.questions to authenticated;
grant select on public.attempts to authenticated;
grant select, delete on public.matches to authenticated;
grant update (status) on public.matches to authenticated;

-- ---------------------------------------------------------------------
-- Public functions (used by the quiz page, no sign-in needed)
-- ---------------------------------------------------------------------

-- Returns a published quiz WITHOUT the creator's answers or importance.
-- The signed-in owner can also open their own draft ("preview": true);
-- their visits don't count as views.
create or replace function public.get_public_quiz(p_slug text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quiz public.quizzes%rowtype;
  v_questions json;
  v_preview boolean;
begin
  select * into v_quiz from public.quizzes
   where slug = lower(btrim(p_slug))
     and (is_published or owner_id = auth.uid());
  if not found then
    return null;
  end if;

  v_preview := auth.uid() is not null and v_quiz.owner_id = auth.uid();
  if not v_preview then
    update public.quizzes set view_count = view_count + 1 where id = v_quiz.id;
  end if;

  select coalesce(json_agg(json_build_object(
           'id', q.id, 'prompt', q.prompt, 'options', q.options)
           order by q.position, q.created_at), '[]'::json)
    into v_questions
    from public.questions q
   where q.quiz_id = v_quiz.id;

  return json_build_object(
    'slug',            v_quiz.slug,
    'display_name',    v_quiz.display_name,
    'headline',        v_quiz.headline,
    'intro',           v_quiz.intro,
    'min_age',         v_quiz.min_age,
    'max_age',         v_quiz.max_age,
    'contact_methods', v_quiz.contact_methods,
    'is_published',    v_quiz.is_published,
    'preview',         v_preview,
    'questions',       v_questions);
end $$;

-- Scores a completed quiz on the server. The browser only learns
-- "match" or "not a match", so the creator's answers stay private
-- and nobody can fake a score.
--
-- Weights: dealbreaker 5, important 3, nice-to-have 1.
-- A match needs: age in range, every dealbreaker accepted, score >= threshold.
create or replace function public.submit_attempt(p_slug text, p_age int, p_answers jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quiz        public.quizzes%rowtype;
  v_q           record;
  v_ans         int;
  v_weight      int;
  v_total       int := 0;
  v_earned      int := 0;
  v_failed_db   boolean := false;
  v_score       int;
  v_reason      text;
  v_token       uuid;
  v_ip          text;
  v_ip_hash     text;
  v_recent      int;
  v_common      text[] := '{}';
  v_clean       jsonb := '{}'::jsonb;
  v_preview     boolean;
begin
  if p_age is null or p_age < 18 then
    return json_build_object('ok', false, 'error', 'adults_only');
  end if;
  if p_age > 120 then
    return json_build_object('ok', false, 'error', 'invalid_age');
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object'
     or pg_column_size(p_answers) > 16000 then
    return json_build_object('ok', false, 'error', 'invalid_answers');
  end if;

  select * into v_quiz from public.quizzes
   where slug = lower(btrim(p_slug))
     and (is_published or owner_id = auth.uid());
  if not found then
    return json_build_object('ok', false, 'error', 'not_found');
  end if;
  v_preview := auth.uid() is not null and v_quiz.owner_id = auth.uid();

  -- Rate limit: 3 attempts per quiz per network per 24 hours.
  begin
    v_ip := btrim(split_part(
      coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', ''), ',', 1));
  exception when others then
    v_ip := null;
  end;
  if not v_preview and v_ip is not null and v_ip <> '' then
    v_ip_hash := md5(v_quiz.id::text || ':' || v_ip);
    select count(*) into v_recent from public.attempts
     where quiz_id = v_quiz.id and ip_hash = v_ip_hash
       and created_at > now() - interval '24 hours';
    if v_recent >= 3 then
      return json_build_object('ok', false, 'error', 'rate_limited');
    end if;
  end if;

  for v_q in
    select id, prompt, accepted, importance
      from public.questions
     where quiz_id = v_quiz.id
     order by position, created_at
  loop
    v_weight := case v_q.importance when 'dealbreaker' then 5 when 'important' then 3 else 1 end;
    v_total  := v_total + v_weight;

    v_ans := null;
    begin
      v_ans := (p_answers ->> v_q.id::text)::int;
    exception when others then
      v_ans := null;
    end;

    if v_ans is not null then
      v_clean := v_clean || jsonb_build_object(v_q.id::text, v_ans);
    end if;

    if v_ans is not null and v_ans = any(v_q.accepted) then
      v_earned := v_earned + v_weight;
      if v_q.importance <> 'nice' and cardinality(v_common) < 3 then
        v_common := v_common || v_q.prompt;
      end if;
    elsif v_q.importance = 'dealbreaker' then
      v_failed_db := true;
    end if;
  end loop;

  if v_total = 0 then
    return json_build_object('ok', false, 'error', 'not_found');
  end if;

  v_score := round(100.0 * v_earned / v_total);

  if p_age < v_quiz.min_age or p_age > v_quiz.max_age then
    v_reason := 'age';
  elsif v_failed_db then
    v_reason := 'dealbreaker';
  elsif v_score < v_quiz.threshold then
    v_reason := 'score';
  end if;

  -- The owner testing their own quiz: show the result, save nothing.
  if v_preview then
    return json_build_object(
      'ok', true, 'preview', true, 'matched', v_reason is null, 'score', v_score,
      'reason', case when v_reason = 'age' then 'age' when v_reason is null then null else 'not_compatible' end,
      'preview_reason', v_reason,
      'common', to_json(v_common), 'contact_methods', v_quiz.contact_methods);
  end if;

  if v_reason is null then
    v_token := gen_random_uuid();
  end if;

  insert into public.attempts (quiz_id, age, answers, score, matched, reason, contact_token, ip_hash)
  values (v_quiz.id, p_age, v_clean, v_score, v_reason is null, v_reason, v_token, v_ip_hash);

  if v_reason is null then
    return json_build_object(
      'ok', true, 'matched', true, 'score', v_score, 'token', v_token,
      'common', to_json(v_common), 'contact_methods', v_quiz.contact_methods);
  end if;

  -- Never say which question failed, so the creator's answers stay private.
  return json_build_object(
    'ok', true, 'matched', false,
    'reason', case when v_reason = 'age' then 'age' else 'not_compatible' end);
end $$;

-- Saves contact details after a match. Needs the one-time token from
-- submit_attempt, so it can't be called without actually matching.
create or replace function public.submit_contact(
  p_token   uuid,
  p_name    text,
  p_method  text,
  p_value   text,
  p_note    text,
  p_consent boolean)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.attempts%rowtype;
  v_quiz    public.quizzes%rowtype;
  v_name    text := btrim(coalesce(p_name, ''));
  v_value   text := btrim(coalesce(p_value, ''));
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_consent is not true then
    return json_build_object('ok', false, 'error', 'consent_required');
  end if;

  select * into v_attempt from public.attempts where contact_token = p_token for update;
  if not found or not v_attempt.matched then
    return json_build_object('ok', false, 'error', 'invalid_token');
  end if;
  if v_attempt.token_used then
    return json_build_object('ok', false, 'error', 'already_submitted');
  end if;
  if v_attempt.created_at < now() - interval '2 hours' then
    return json_build_object('ok', false, 'error', 'expired');
  end if;

  select * into v_quiz from public.quizzes where id = v_attempt.quiz_id;
  if p_method is null or not (p_method = any(v_quiz.contact_methods)) then
    return json_build_object('ok', false, 'error', 'method_not_allowed');
  end if;

  if char_length(v_name) not between 1 and 60 then
    return json_build_object('ok', false, 'error', 'invalid_name');
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    return json_build_object('ok', false, 'error', 'note_too_long');
  end if;

  if p_method in ('instagram', 'x') then
    -- Accept "@handle", "handle" or a pasted profile link; keep just the handle.
    v_value := regexp_replace(v_value,
      '^(https?://)?(www\.|m\.|mobile\.)?(instagram\.com|instagr\.am|x\.com|twitter\.com)/', '', 'i');
    v_value := regexp_replace(v_value, '[/?#].*$', '');
    v_value := regexp_replace(v_value, '^@+', '');
    if p_method = 'instagram' then
      v_value := lower(v_value);
      if v_value !~ '^[a-z0-9._]{1,30}$' or v_value !~ '[a-z0-9]' then
        return json_build_object('ok', false, 'error', 'invalid_instagram');
      end if;
    elsif v_value !~ '^[A-Za-z0-9_]{1,15}$' then
      return json_build_object('ok', false, 'error', 'invalid_x');
    end if;
  elsif p_method = 'email' then
    v_value := lower(v_value);
    if char_length(v_value) > 254 or v_value !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      return json_build_object('ok', false, 'error', 'invalid_email');
    end if;
  else
    -- WhatsApp: full international number, e.g. +2348012345678
    v_value := regexp_replace(v_value, '[[:space:]().-]', '', 'g');
    if v_value !~ '^\+[1-9][0-9]{7,14}$' then
      return json_build_object('ok', false, 'error', 'invalid_whatsapp');
    end if;
  end if;

  insert into public.matches (quiz_id, attempt_id, name, contact_method, contact_value, note, score)
  values (v_quiz.id, v_attempt.id, v_name, p_method, v_value, v_note, v_attempt.score);

  update public.attempts set token_used = true where id = v_attempt.id;

  return json_build_object('ok', true);
end $$;

-- Lets the builder check whether a link name is free.
create or replace function public.slug_available(p_slug text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select lower(btrim(p_slug)) ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'
     and lower(btrim(p_slug)) not in (
       'admin','api','app','about','assets','builder','css','dashboard','help',
       'index','js','login','logout','privacy','quiz','settings','signup',
       'static','support','terms','www')
     and not exists (
       select 1 from public.quizzes
        where slug = lower(btrim(p_slug))
          and owner_id is distinct from auth.uid());
$$;

-- ---------------------------------------------------------------------
-- Creator functions (signed-in only; they run with the creator's own
-- permissions, so row level security still applies)
-- ---------------------------------------------------------------------

-- Replaces a quiz's questions in one go, keeping IDs stable so past
-- answers still line up with their questions.
create or replace function public.save_questions(p_quiz_id uuid, p_questions jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  if not exists (select 1 from public.quizzes where id = p_quiz_id) then
    raise exception 'Quiz not found';
  end if;
  if jsonb_typeof(p_questions) <> 'array' then
    raise exception 'Questions must be a list';
  end if;
  if jsonb_array_length(p_questions) > 30 then
    raise exception 'A quiz can have up to 30 questions';
  end if;

  select coalesce(array_agg((q->>'id')::uuid), '{}')
    into v_ids
    from jsonb_array_elements(p_questions) q;

  delete from public.questions
   where quiz_id = p_quiz_id and not (id = any(v_ids));

  insert into public.questions (id, quiz_id, position, prompt, options, accepted, importance)
  select (t.q->>'id')::uuid,
         p_quiz_id,
         (t.ord - 1)::int,
         btrim(t.q->>'prompt'),
         array(select btrim(x) from jsonb_array_elements_text(t.q->'options') x),
         array(select x::int from jsonb_array_elements_text(t.q->'accepted') x),
         coalesce(t.q->>'importance', 'important')
    from jsonb_array_elements(p_questions) with ordinality as t(q, ord)
  on conflict (id) do update
     set position   = excluded.position,
         prompt     = excluded.prompt,
         options    = excluded.options,
         accepted   = excluded.accepted,
         importance = excluded.importance
   where public.questions.quiz_id = p_quiz_id;
end $$;

-- Views, completions and matches for each of the creator's quizzes.
create or replace function public.my_quiz_stats()
returns table (quiz_id uuid, views int, completions bigint, matched bigint, contacts bigint)
language sql
security invoker
set search_path = public
as $$
  select q.id,
         q.view_count,
         (select count(*) from public.attempts a where a.quiz_id = q.id),
         (select count(*) from public.attempts a where a.quiz_id = q.id and a.matched),
         (select count(*) from public.matches m where m.quiz_id = q.id)
    from public.quizzes q
   where q.owner_id = auth.uid();
$$;

-- Who can call what.
revoke execute on function public.get_public_quiz(text) from public;
revoke execute on function public.submit_attempt(text, int, jsonb) from public;
revoke execute on function public.submit_contact(uuid, text, text, text, text, boolean) from public;
revoke execute on function public.slug_available(text) from public;
revoke execute on function public.save_questions(uuid, jsonb) from public;
revoke execute on function public.my_quiz_stats() from public;
revoke execute on function public.touch_updated_at() from public;
revoke execute on function public.limit_quizzes_per_owner() from public;
-- Supabase grants new functions to anon by default; take back the creator-only ones.
revoke execute on function public.slug_available(text) from anon;
revoke execute on function public.save_questions(uuid, jsonb) from anon;
revoke execute on function public.my_quiz_stats() from anon;

grant execute on function public.get_public_quiz(text) to anon, authenticated;
grant execute on function public.submit_attempt(text, int, jsonb) to anon, authenticated;
grant execute on function public.submit_contact(uuid, text, text, text, text, boolean) to anon, authenticated;
grant execute on function public.slug_available(text) to authenticated;
grant execute on function public.save_questions(uuid, jsonb) to authenticated;
grant execute on function public.my_quiz_stats() to authenticated;
