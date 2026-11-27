-- =====================================================================
-- Owner dashboard (admin.html)
--
-- Run this once in Supabase > SQL Editor, after schema.sql. It is safe to
-- run again after updates.
--
-- Then make yourself the owner (use the email you sign in to the app with):
--
--   insert into public.app_admins (user_id)
--   select id from auth.users where lower(email) = lower('you@example.com')
--   on conflict do nothing;
--
-- The dashboard only ever returns totals and public quiz names. It never
-- returns anyone's email, contact details, notes or answers.
-- =====================================================================

-- Who can open the owner dashboard. Nobody can read or change this list
-- through the app; only the SQL Editor can.
create table if not exists public.app_admins (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  added_at  timestamptz not null default now()
);
alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon, authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and exists (select 1 from public.app_admins where user_id = auth.uid());
$$;

-- All the numbers for the owner dashboard in one call.
-- p_days: the period for "this period" numbers and the daily chart (1-365).
-- Days are counted in Lagos time.
create or replace function public.admin_stats(p_days int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz          constant text := 'Africa/Lagos';
  v_days        int := least(greatest(coalesce(p_days, 30), 1), 365);
  v_today       date := (now() at time zone v_tz)::date;
  v_first_day   date;
  v_since       timestamptz;
  v_prev_since  timestamptz;
  v_out         jsonb;
begin
  if not public.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  v_first_day  := v_today - (v_days - 1);
  v_since      := v_first_day::timestamp at time zone v_tz;
  v_prev_since := (v_first_day - v_days)::timestamp at time zone v_tz;

  select jsonb_build_object(
    'generated_at', now(),
    'days',         v_days,
    'timezone',     v_tz,

    -- All-time totals
    'totals', (
      select jsonb_build_object(
        'creators',            (select count(*) from auth.users),
        'active_today',        (select count(*) from auth.users
                                  where last_sign_in_at >= v_today::timestamp at time zone v_tz),
        'active_7d',           (select count(*) from auth.users
                                  where last_sign_in_at >= now() - interval '7 days'),
        'creators_with_quiz',  (select count(distinct owner_id) from public.quizzes),
        'creators_live',       (select count(distinct owner_id) from public.quizzes where is_published),
        'creators_with_match', (select count(distinct q.owner_id)
                                  from public.matches m join public.quizzes q on q.id = m.quiz_id),
        'quizzes',             (select count(*) from public.quizzes),
        'quizzes_live',        (select count(*) from public.quizzes where is_published),
        'drafts',              (select count(*) from public.quizzes where not is_published),
        'drafts_ready',        (select count(*) from public.quizzes q
                                  where not q.is_published
                                    and (select count(*) from public.questions x where x.quiz_id = q.id) >= 3),
        'avg_questions',       (select round(avg(n), 1) from (
                                  select count(*) n from public.questions x
                                    join public.quizzes q on q.id = x.quiz_id
                                   where q.is_published group by x.quiz_id) s),
        'views',               (select coalesce(sum(view_count), 0) from public.quizzes),
        'attempts',            (select count(*) from public.attempts),
        'matched',             (select count(*) from public.attempts where matched),
        'contacts',            (select count(*) from public.matches),
        'avg_score',           (select round(avg(score)) from public.attempts),
        'avg_match_score',     (select round(avg(score)) from public.attempts where matched)
      )
    ),

    -- This period and the one before it, for comparison
    'period', (
      select jsonb_build_object(
        'signups',       (select count(*) from auth.users where created_at >= v_since),
        'quizzes',       (select count(*) from public.quizzes where created_at >= v_since),
        'attempts',      (select count(*) from public.attempts where created_at >= v_since),
        'matched',       (select count(*) from public.attempts where matched and created_at >= v_since),
        'contacts',      (select count(*) from public.matches where created_at >= v_since),
        'prev_signups',  (select count(*) from auth.users where created_at >= v_prev_since and created_at < v_since),
        'prev_quizzes',  (select count(*) from public.quizzes where created_at >= v_prev_since and created_at < v_since),
        'prev_attempts', (select count(*) from public.attempts where created_at >= v_prev_since and created_at < v_since),
        'prev_matched',  (select count(*) from public.attempts where matched and created_at >= v_prev_since and created_at < v_since),
        'prev_contacts', (select count(*) from public.matches where created_at >= v_prev_since and created_at < v_since)
      )
    ),

    -- One row per day in the period
    'daily', (
      with d as (
        select generate_series(v_first_day::timestamp, v_today::timestamp, interval '1 day')::date as day
      ),
      s as (
        select (created_at at time zone v_tz)::date as day, count(*) as n
          from auth.users where created_at >= v_since group by 1
      ),
      q as (
        select (created_at at time zone v_tz)::date as day, count(*) as n
          from public.quizzes where created_at >= v_since group by 1
      ),
      a as (
        select (created_at at time zone v_tz)::date as day, count(*) as n, count(*) filter (where matched) as m
          from public.attempts where created_at >= v_since group by 1
      ),
      c as (
        select (created_at at time zone v_tz)::date as day, count(*) as n
          from public.matches where created_at >= v_since group by 1
      )
      select coalesce(jsonb_agg(jsonb_build_object(
               'day',      d.day,
               'signups',  coalesce(s.n, 0),
               'quizzes',  coalesce(q.n, 0),
               'attempts', coalesce(a.n, 0),
               'matched',  coalesce(a.m, 0),
               'contacts', coalesce(c.n, 0)
             ) order by d.day), '[]'::jsonb)
        from d
        left join s on s.day = d.day
        left join q on q.day = d.day
        left join a on a.day = d.day
        left join c on c.day = d.day
    ),

    -- Why people didn't match (all time)
    'reasons', (
      select jsonb_build_object(
        'age',         count(*) filter (where reason = 'age'),
        'dealbreaker', count(*) filter (where reason = 'dealbreaker'),
        'score',       count(*) filter (where reason = 'score')
      ) from public.attempts where not matched
    ),

    -- Ages of people taking quizzes (all time)
    'ages', (
      select jsonb_build_object(
        '18-24', count(*) filter (where age between 18 and 24),
        '25-29', count(*) filter (where age between 25 and 29),
        '30-34', count(*) filter (where age between 30 and 34),
        '35-39', count(*) filter (where age between 35 and 39),
        '40-49', count(*) filter (where age between 40 and 49),
        '50+',   count(*) filter (where age >= 50)
      ) from public.attempts
    ),

    -- How matches chose to be reached, and what live quizzes offer (all time)
    'contact_methods', (
      select jsonb_build_object(
        'instagram', count(*) filter (where contact_method = 'instagram'),
        'x',         count(*) filter (where contact_method = 'x'),
        'whatsapp',  count(*) filter (where contact_method = 'whatsapp'),
        'email',     count(*) filter (where contact_method = 'email')
      ) from public.matches
    ),
    'methods_offered', (
      select jsonb_build_object(
        'instagram', count(*) filter (where 'instagram' = any(contact_methods)),
        'x',         count(*) filter (where 'x' = any(contact_methods)),
        'whatsapp',  count(*) filter (where 'whatsapp' = any(contact_methods)),
        'email',     count(*) filter (where 'email' = any(contact_methods))
      ) from public.quizzes where is_published
    ),

    -- Do creators follow up on their matches? (all time)
    'follow_up', (
      select jsonb_build_object(
        'new',       count(*) filter (where status = 'new'),
        'contacted', count(*) filter (where status = 'contacted'),
        'archived',  count(*) filter (where status = 'archived')
      ) from public.matches
    ),

    -- Busiest live quizzes (public names and links only)
    'top_quizzes', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.attempts desc, t.views desc), '[]'::jsonb)
        from (
          select q.slug,
                 q.display_name,
                 q.view_count as views,
                 (select count(*) from public.attempts a where a.quiz_id = q.id) as attempts,
                 (select count(*) from public.attempts a where a.quiz_id = q.id and a.matched) as matched,
                 (select count(*) from public.matches m where m.quiz_id = q.id) as contacts,
                 q.created_at
            from public.quizzes q
           where q.is_published
           order by attempts desc, views desc
           limit 10
        ) t
    )
  ) into v_out;

  return v_out;
end $$;

revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.admin_stats(int) from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.admin_stats(int) to authenticated;
