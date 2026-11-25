// =====================================================================
// Demo mode: an in-browser stand-in for Supabase.
// Used automatically while js/config.js still has placeholder values,
// so the whole app can be clicked through locally with no setup.
// Everything is saved in this browser's localStorage only.
// Scoring and validation mirror supabase/schema.sql.
// =====================================================================

const KEY = 'compatible-demo-db-v1';
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
const RESERVED = ['admin', 'api', 'app', 'about', 'assets', 'builder', 'css', 'dashboard', 'help',
  'index', 'js', 'login', 'logout', 'privacy', 'quiz', 'settings', 'signup', 'static', 'support', 'terms', 'www'];
const WEIGHTS = { dealbreaker: 5, important: 3, nice: 1 };
const QUIZ_UPDATABLE = ['slug', 'display_name', 'headline', 'intro', 'min_age', 'max_age', 'threshold',
  'contact_methods', 'notify_by_email', 'is_published'];

const fresh = () => ({ users: [], session: null, quizzes: [], questions: [], attempts: [], matches: [] });
const clone = (x) => JSON.parse(JSON.stringify(x));
const nowIso = () => new Date().toISOString();
const ok = (data) => ({ data, error: null });
const fail = (message, code = 'P0001') => ({ data: null, error: { message, code, details: null, hint: null } });

function load() {
  try { return { ...fresh(), ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; } catch { return fresh(); }
}
function save(db) {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* storage full or blocked */ }
}
function uuid() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const toInt = (v) => (typeof v === 'number' && Number.isInteger(v) ? v
  : typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v) : null);

export function resetDemo() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

function quizProblem(db, q) {
  if (!SLUG_RE.test(q.slug || '') || RESERVED.includes(q.slug)) {
    return fail('new row for relation "quizzes" violates check constraint "quizzes_slug_check"', '23514');
  }
  if (db.quizzes.some((x) => x.slug === q.slug && x.id !== q.id)) {
    return fail('duplicate key value violates unique constraint "quizzes_slug_key"', '23505');
  }
  const name = String(q.display_name || '');
  if (name.length < 1 || name.length > 40) return fail('display_name check failed', '23514');
  if (q.headline && q.headline.length > 80) return fail('headline check failed', '23514');
  if (q.intro && q.intro.length > 400) return fail('intro check failed', '23514');
  if (!Number.isInteger(q.min_age) || !Number.isInteger(q.max_age) || q.min_age < 18 || q.max_age > 99 || q.max_age < q.min_age) {
    return fail('age_range_valid check failed', '23514');
  }
  if (!Number.isInteger(q.threshold) || q.threshold < 0 || q.threshold > 100) return fail('threshold check failed', '23514');
  if (!Array.isArray(q.contact_methods) || q.contact_methods.length < 1
      || q.contact_methods.some((m) => !['instagram', 'x', 'whatsapp', 'email'].includes(m))) {
    return fail('contact_methods check failed', '23514');
  }
  return null;
}

function splitTop(s) {
  const out = []; let depth = 0; let cur = '';
  for (const ch of s) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function createDemoClient() {
  // ---------------------------------------------------------------- auth
  const auth = {
    async getSession() {
      return { data: { session: load().session }, error: null };
    },
    async signInWithOtp({ email }) {
      const db = load();
      const addr = String(email || '').trim().toLowerCase();
      let user = db.users.find((u) => u.email === addr);
      if (!user) { user = { id: uuid(), email: addr }; db.users.push(user); }
      db.session = { access_token: 'demo', token_type: 'bearer', user: { id: user.id, email: user.email } };
      save(db);
      return { data: {}, error: null };
    },
    async signOut() {
      const db = load();
      db.session = null;
      save(db);
      return { error: null };
    },
  };

  // ---------------------------------------------------------------- tables
  class Query {
    constructor(table) {
      this.table = table;
      this.op = 'select';
      this.cols = '*';
      this.returning = false;
      this.filters = [];
      this.orders = [];
      this.mode = 'many';
      this.payload = null;
    }

    select(cols = '*') {
      if (this.op === 'select') this.cols = cols; else { this.returning = true; this.cols = cols; }
      return this;
    }
    insert(p) { this.op = 'insert'; this.payload = p; return this; }
    update(p) { this.op = 'update'; this.payload = p; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(col, val) { this.filters.push([col, val]); return this; }
    order(col, { ascending = true } = {}) { this.orders.push([col, ascending]); return this; }
    single() { this.mode = 'single'; return this; }
    maybeSingle() { this.mode = 'maybe'; return this; }
    then(resolve, reject) { return Promise.resolve().then(() => this.run()).then(resolve, reject); }

    project(db, row) {
      if (this.cols === '*' || !this.cols) return clone(row);
      const out = {};
      for (const item of splitTop(this.cols)) {
        if (item === '*') { Object.assign(out, clone(row)); continue; }
        const m = item.match(/^(?:([a-z_]+):)?([a-z_]+)\(([^)]*)\)$/);
        if (m) {
          const [, alias = m[2], table, cols] = m;
          const fk = `${table.replace(/s$/, '')}_id`;
          const target = (db[table] || []).find((x) => x.id === row[fk]);
          out[alias] = target ? Object.fromEntries(cols.split(',').map((c) => c.trim()).filter(Boolean).map((c) => [c, clone(target[c])])) : null;
        } else {
          out[item] = clone(row[item] ?? null);
        }
      }
      return out;
    }

    shape(rows) {
      if (this.mode === 'single') {
        return rows.length === 1 ? ok(rows[0]) : fail('JSON object requested, multiple (or no) rows returned', 'PGRST116');
      }
      if (this.mode === 'maybe') {
        return rows.length > 1 ? fail('JSON object requested, multiple (or no) rows returned', 'PGRST116') : ok(rows[0] ?? null);
      }
      return ok(rows);
    }

    run() {
      const db = load();
      const me = db.session?.user?.id;
      if (!me || !['quizzes', 'questions', 'attempts', 'matches'].includes(this.table)) {
        return fail('permission denied', '42501');
      }
      const mine = new Set(db.quizzes.filter((q) => q.owner_id === me).map((q) => q.id));
      const visible = (r) => (this.table === 'quizzes' ? r.owner_id === me : mine.has(r.quiz_id));
      const matches = (r) => visible(r) && this.filters.every(([c, v]) => String(r[c]) === String(v));

      if (this.op === 'select') {
        let rows = db[this.table].filter(matches);
        for (const [c, asc] of [...this.orders].reverse()) {
          rows = [...rows].sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1));
        }
        return this.shape(rows.map((r) => this.project(db, r)));
      }

      if (this.op === 'insert') {
        if (this.table !== 'quizzes') return fail('permission denied', '42501');
        const p = this.payload || {};
        if (db.quizzes.filter((q) => q.owner_id === me).length >= 5) return fail('You can have up to 5 quizzes.');
        const quiz = {
          id: uuid(), owner_id: me, slug: p.slug, display_name: p.display_name,
          headline: p.headline ?? null, intro: p.intro ?? null,
          min_age: p.min_age ?? 18, max_age: p.max_age ?? 99, threshold: p.threshold ?? 70,
          contact_methods: p.contact_methods ?? ['instagram', 'x'],
          notify_by_email: p.notify_by_email ?? true, is_published: !!p.is_published,
          view_count: 0, created_at: nowIso(), updated_at: nowIso(),
        };
        const problem = quizProblem(db, quiz);
        if (problem) return problem;
        db.quizzes.push(quiz);
        save(db);
        return this.returning ? this.shape([this.project(db, quiz)]) : ok(null);
      }

      if (this.op === 'update') {
        const p = this.payload || {};
        const targets = db[this.table].filter(matches);
        for (const row of targets) {
          if (this.table === 'quizzes') {
            const bad = Object.keys(p).find((k) => !QUIZ_UPDATABLE.includes(k));
            if (bad) return fail(`permission denied for column ${bad}`, '42501');
            const next = { ...row, ...p, updated_at: nowIso() };
            const problem = quizProblem(db, next);
            if (problem) return problem;
            Object.assign(row, next);
          } else if (this.table === 'matches') {
            if (Object.keys(p).some((k) => k !== 'status')) return fail('permission denied', '42501');
            if (!['new', 'contacted', 'archived'].includes(p.status)) return fail('status check failed', '23514');
            row.status = p.status;
          } else {
            return fail('permission denied', '42501');
          }
        }
        save(db);
        return ok(null);
      }

      if (this.op === 'delete') {
        const targets = new Set(db[this.table].filter(matches).map((r) => r.id));
        if (this.table === 'quizzes') {
          db.quizzes = db.quizzes.filter((q) => !targets.has(q.id));
          db.questions = db.questions.filter((q) => !targets.has(q.quiz_id));
          db.attempts = db.attempts.filter((a) => !targets.has(a.quiz_id));
          db.matches = db.matches.filter((m) => !targets.has(m.quiz_id));
        } else if (this.table === 'matches') {
          db.matches = db.matches.filter((m) => !targets.has(m.id));
        } else {
          return fail('permission denied', '42501');
        }
        save(db);
        return ok(null);
      }
      return fail('unsupported', '42601');
    }
  }

  // ---------------------------------------------------------------- functions
  const findQuiz = (db, slug, me) => db.quizzes.find((q) => q.slug === String(slug || '').trim().toLowerCase()
    && (q.is_published || q.owner_id === me));
  const quizQuestions = (db, quizId) => db.questions.filter((q) => q.quiz_id === quizId)
    .sort((a, b) => a.position - b.position || (a.created_at < b.created_at ? -1 : 1));

  const RPC = {
    get_public_quiz({ p_slug }, db, me) {
      const quiz = findQuiz(db, p_slug, me);
      if (!quiz) return ok(null);
      quiz.view_count += 1;
      save(db);
      return ok({
        slug: quiz.slug, display_name: quiz.display_name, headline: quiz.headline, intro: quiz.intro,
        min_age: quiz.min_age, max_age: quiz.max_age, contact_methods: [...quiz.contact_methods],
        is_published: quiz.is_published,
        preview: false, // in demo you play the visitor, so you can see the whole flow
        questions: quizQuestions(db, quiz.id).map((q) => ({ id: q.id, prompt: q.prompt, options: [...q.options] })),
      });
    },

    submit_attempt({ p_slug, p_age, p_answers }, db, me) {
      const age = toInt(p_age);
      if (age === null || age < 18) return ok({ ok: false, error: 'adults_only' });
      if (age > 120) return ok({ ok: false, error: 'invalid_age' });
      if (!p_answers || typeof p_answers !== 'object' || Array.isArray(p_answers)) return ok({ ok: false, error: 'invalid_answers' });
      const quiz = findQuiz(db, p_slug, me);
      if (!quiz) return ok({ ok: false, error: 'not_found' });

      let total = 0; let earned = 0; let failedDealbreaker = false;
      const common = []; const clean = {};
      for (const q of quizQuestions(db, quiz.id)) {
        const w = WEIGHTS[q.importance];
        total += w;
        const a = toInt(p_answers[q.id]);
        if (a !== null) clean[q.id] = a;
        if (a !== null && q.accepted.includes(a)) {
          earned += w;
          if (q.importance !== 'nice' && common.length < 3) common.push(q.prompt);
        } else if (q.importance === 'dealbreaker') {
          failedDealbreaker = true;
        }
      }
      if (total === 0) return ok({ ok: false, error: 'not_found' });

      const score = Math.round((100 * earned) / total);
      let reason = null;
      if (age < quiz.min_age || age > quiz.max_age) reason = 'age';
      else if (failedDealbreaker) reason = 'dealbreaker';
      else if (score < quiz.threshold) reason = 'score';

      const token = reason === null ? uuid() : null;
      db.attempts.push({
        id: uuid(), quiz_id: quiz.id, age, answers: clean, score, matched: reason === null, reason,
        contact_token: token, token_used: false, ip_hash: null, created_at: nowIso(),
      });
      save(db);

      if (reason === null) {
        return ok({ ok: true, matched: true, score, token, common, contact_methods: [...quiz.contact_methods] });
      }
      return ok({ ok: true, matched: false, reason: reason === 'age' ? 'age' : 'not_compatible' });
    },

    submit_contact({ p_token, p_name, p_method, p_value, p_note, p_consent }, db) {
      if (p_consent !== true) return ok({ ok: false, error: 'consent_required' });
      const attempt = db.attempts.find((a) => a.contact_token && a.contact_token === p_token);
      if (!attempt || !attempt.matched) return ok({ ok: false, error: 'invalid_token' });
      if (attempt.token_used) return ok({ ok: false, error: 'already_submitted' });
      if (Date.now() - new Date(attempt.created_at).getTime() > 2 * 60 * 60 * 1000) return ok({ ok: false, error: 'expired' });
      const quiz = db.quizzes.find((q) => q.id === attempt.quiz_id);
      if (!p_method || !quiz.contact_methods.includes(p_method)) return ok({ ok: false, error: 'method_not_allowed' });

      const name = String(p_name || '').trim();
      if (name.length < 1 || name.length > 60) return ok({ ok: false, error: 'invalid_name' });
      const note = String(p_note || '').trim() || null;
      if (note && note.length > 500) return ok({ ok: false, error: 'note_too_long' });

      let value = String(p_value || '').trim();
      if (p_method === 'instagram' || p_method === 'x') {
        value = value
          .replace(/^(https?:\/\/)?(www\.|m\.|mobile\.)?(instagram\.com|instagr\.am|x\.com|twitter\.com)\//i, '')
          .replace(/[/?#].*$/, '')
          .replace(/^@+/, '');
        if (p_method === 'instagram') {
          value = value.toLowerCase();
          if (!/^[a-z0-9._]{1,30}$/.test(value) || !/[a-z0-9]/.test(value)) return ok({ ok: false, error: 'invalid_instagram' });
        } else if (!/^[A-Za-z0-9_]{1,15}$/.test(value)) {
          return ok({ ok: false, error: 'invalid_x' });
        }
      } else if (p_method === 'email') {
        value = value.toLowerCase();
        if (value.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return ok({ ok: false, error: 'invalid_email' });
      } else {
        value = value.replace(/[\s().-]/g, '');
        if (!/^\+[1-9]\d{7,14}$/.test(value)) return ok({ ok: false, error: 'invalid_whatsapp' });
      }

      db.matches.push({
        id: uuid(), quiz_id: quiz.id, attempt_id: attempt.id, name, contact_method: p_method,
        contact_value: value, note, score: attempt.score, consent_at: nowIso(), status: 'new', created_at: nowIso(),
      });
      attempt.token_used = true;
      save(db);
      return ok({ ok: true });
    },

    slug_available({ p_slug }, db, me) {
      if (!me) return fail('permission denied', '42501');
      const s = String(p_slug || '').trim().toLowerCase();
      return ok(SLUG_RE.test(s) && !RESERVED.includes(s) && !db.quizzes.some((q) => q.slug === s && q.owner_id !== me));
    },

    save_questions({ p_quiz_id, p_questions }, db, me) {
      if (!me) return fail('permission denied', '42501');
      const quiz = db.quizzes.find((q) => q.id === p_quiz_id && q.owner_id === me);
      if (!quiz) return fail('Quiz not found');
      if (!Array.isArray(p_questions)) return fail('Questions must be a list');
      if (p_questions.length > 30) return fail('A quiz can have up to 30 questions');

      const existing = new Map(db.questions.filter((q) => q.quiz_id === quiz.id).map((q) => [q.id, q]));
      const next = [];
      for (const [i, raw] of p_questions.entries()) {
        const prompt = String(raw.prompt || '').trim();
        const options = (raw.options || []).map((o) => String(o).trim());
        const accepted = (raw.accepted || []).map(toInt);
        const importance = raw.importance || 'important';
        const valid = prompt.length >= 1 && prompt.length <= 200
          && options.length >= 2 && options.length <= 6 && !options.includes('') && options.join('|').length <= 600
          && accepted.length >= 1 && accepted.every((a) => a !== null && a >= 0 && a < options.length)
          && ['dealbreaker', 'important', 'nice'].includes(importance);
        if (!valid) return fail('new row for relation "questions" violates check constraint', '23514');
        next.push({
          id: raw.id || uuid(), quiz_id: quiz.id, position: i, prompt, options, accepted, importance,
          created_at: existing.get(raw.id)?.created_at || nowIso(),
        });
      }
      db.questions = db.questions.filter((q) => q.quiz_id !== quiz.id).concat(next);
      save(db);
      return ok(null);
    },

    my_quiz_stats(_args, db, me) {
      if (!me) return fail('permission denied', '42501');
      return ok(db.quizzes.filter((q) => q.owner_id === me).map((q) => ({
        quiz_id: q.id,
        views: q.view_count,
        completions: db.attempts.filter((a) => a.quiz_id === q.id).length,
        matched: db.attempts.filter((a) => a.quiz_id === q.id && a.matched).length,
        contacts: db.matches.filter((m) => m.quiz_id === q.id).length,
      })));
    },
  };

  return {
    isDemo: true,
    auth,
    from: (table) => new Query(table),
    async rpc(name, args = {}) {
      const fn = RPC[name];
      if (!fn) return fail(`function ${name} not found`, 'PGRST202');
      const db = load();
      return fn(args, db, db.session?.user?.id || null);
    },
  };
}
