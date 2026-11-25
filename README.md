# Compatible

Anyone can build a compatibility quiz, share one link, and hear from the people who match. A visitor who matches leaves an Instagram or X handle (or, if the creator allows it, a WhatsApp number or email), so the creator can see their public profile before saying hi. Visitors never see the creator's answers, and scores are worked out on the server, so the quiz can't be gamed.

This started as a single-page quiz written for one person. That original page is kept in `legacy/original-quiz.html`.

## Try it right now (demo mode)

You don't need any setup to click through it. While `js/config.js` still has the placeholder Supabase values, the app runs in **demo mode**: sign-in skips the email, and quizzes, answers and matches are saved in your browser only.

On a Mac, double-click **`start-demo.command`** in this folder. A Terminal window opens and the site opens in your browser at http://localhost:8000. (Or run `python3 -m http.server 8000` from this folder yourself.) Click **Create your quiz**, enter any email, build and publish a quiz, then use the link on your dashboard to take it yourself. Match, leave a contact, and you'll see it appear in the dashboard. **Reset demo** in the banner wipes everything. Close the Terminal window (or press `Ctrl+C`) to stop it.

Demo mode uses the same scoring rules as the real database, but it's for trying things out only: nobody else can see your quiz. Once you fill in `js/config.js` (setup below), demo mode switches off by itself.

## How it works

1. **The creator** signs in with an email link, picks questions (from a question bank or their own), ticks the answers they'd accept, and marks each question as a *dealbreaker*, *important* or *nice to have*.
2. **They share** `yoursite.com/q/their-name`.
3. **A visitor** confirms they're 18+, answers the questions, and the server scores them:
   - weights: dealbreaker 5, important 3, nice to have 1
   - to match, the visitor needs their age inside the creator's range, every dealbreaker answered the creator's way, and a score at or above the creator's threshold
4. **If they match**, they see where they line up and can leave their name, a contact and a note. The creator chooses which contacts to accept: Instagram, X, WhatsApp, email (new quizzes start with Instagram and X). Handles can be typed as `@name`, `name` or a pasted profile link. Visitors tick a consent box first.
5. **The creator** sees matches in their dashboard, with a one-tap *View profile* button for handles (or *Say hi on WhatsApp* / email). They can optionally get an email for each new match.

## What's in here

| Path | What it is |
|---|---|
| `index.html` | Landing page |
| `login.html` | Email sign-in link (asks for 18+ confirmation) |
| `dashboard.html` | Creator's quizzes, stats and matches |
| `builder.html` | Create or edit a quiz |
| `quiz.html` | The public quiz (served at `/q/<link>`) |
| `privacy.html` | Starter privacy notice. **Fill it in and have it reviewed.** |
| `js/config.js` | **Your settings**: Supabase URL and key, app name |
| `js/question-bank.js` | Ready-made dating questions; add your own |
| `js/demo.js` | Demo mode: a stand-in for Supabase that saves to your browser |
| `supabase/schema.sql` | Database, security rules and scoring functions |
| `supabase/functions/notify-match/` | Optional: emails creators about new matches |
| `_redirects`, `_headers`, `404.html` | Netlify: `/q/<link>` share links, security settings, hiding non-site files, not-found page |
| `vercel.json` | The same share-link rule for Vercel, if you ever move |
| `start-demo.command` | Double-click to run the site on your Mac |
| `legacy/original-quiz.html` | Your original quiz, untouched |

There's no build step. It's plain HTML, CSS and JavaScript, with Supabase as the backend.

## Setup (about 15 minutes)

### 1. Create the Supabase project
1. Sign up at [supabase.com](https://supabase.com) and create a new project (the free plan is fine).
2. Go to **SQL Editor → New query**, paste in all of `supabase/schema.sql`, and click **Run**. It's safe to run again later if you update it.
   - **After an update** to `schema.sql` (for example, the Instagram/X handles update), paste and run the new version the same way. It upgrades the rules in place and keeps all your quizzes and matches.

### 2. Connect the site
1. Go to **Project Settings → API** (or **API Keys**) and copy the **Project URL** and the **anon / publishable** key.
2. Paste them into `js/config.js`. That key is meant to be public. **Never** put the `service_role` / secret key in the site.

### 3. Set up sign-in links
In **Authentication → URL Configuration**:
- **Site URL**: your live address, e.g. `https://yourdomain.com`
- **Redirect URLs**: add `https://yourdomain.com/dashboard.html` and `http://localhost:8000/dashboard.html`

> **Before you launch:** Supabase's built-in email sender only delivers to members of your Supabase team, so it works for you but not for other people. Go to **Authentication → Emails → SMTP Settings** and connect a provider such as Resend, Brevo or Amazon SES, then raise the email rate limit under **Authentication → Rate Limits**.

### 4. Try it locally with Supabase connected
From this folder:
```bash
python3 -m http.server 8000
```
Open http://localhost:8000, sign in, build your quiz and publish it. Locally, share links look like `/quiz.html?u=your-link`. The tidy `/q/your-link` form needs the hosting rewrite in step 5.

When you open your own quiz while signed in, it runs in **preview mode**: you see the result (including why you didn't match), and nothing is saved or counted.

### 5. Put it online
**Netlify** (where this app lives, at https://compatibility-app.netlify.app): link the GitHub repo with no build command and the publish directory set to the repo root. Every push to `main` deploys. `_redirects` handles `/q/<link>` and keeps the README, database file and old quiz private; `_headers` adds basic security settings.
**Vercel** also works (`vercel.json` has the same rule), but its free plan doesn't allow commercial use.
**Cloudflare Pages** reads the same `_redirects` file if you ever need to move.

Then update the Site URL and Redirect URLs from step 3 to your live domain.

> GitHub Pages won't work out of the box: project pages live under `/compatibility-app/`, and the site expects to run from the root of a domain.

### 6. Optional: email creators about new matches
1. Create a [Resend](https://resend.com) account and verify your sending domain.
2. Install the [Supabase CLI](https://supabase.com/docs/guides/cli), then from this folder:
   ```bash
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase secrets set RESEND_API_KEY=re_xxx NOTIFY_FROM="Compatible <matches@yourdomain.com>" SITE_URL=https://yourdomain.com WEBHOOK_SECRET=$(openssl rand -hex 24)
   supabase functions deploy notify-match --no-verify-jwt
   ```
3. In the dashboard, go to **Database → Webhooks → Create**: table `matches`, event **Insert**, type **Supabase Edge Function** → `notify-match`, and add an HTTP header `x-webhook-secret` with the same value as `WEBHOOK_SECRET`.

The email says who matched, their score and their note, and links to the dashboard. Contact details stay in the dashboard rather than in people's inboxes. Creators can switch these emails off per quiz.

## Rebuilding your original quiz
Sign in, choose **Create your quiz**, and use **Browse question ideas**. Your original questions are all in the bank: "Do you have a personal relationship with God?", "What are you looking for right now?" (it replaces "Are you looking for love?"), "How do you feel about vaping or smoking?", "When a disagreement happens…", "Would you call yourself a romantic?", "How does fitness fit into your life?", and the food, TV, job and surprises questions. Set your age range to 28–35 and your threshold to 70%, and make "What are you looking for right now?" a dealbreaker.

## Safety and privacy, built in
- 18+ gate for creators (at sign-in) and visitors (before the quiz). The server rejects under-18s too.
- The creator's answers, weights and threshold never reach the browser. Visitors are only told *match* or *not this time*, not which question failed.
- Contact details can only be submitted with a one-time token from a real match, must be claimed within 2 hours, and need a consent tick.
- Each network gets 3 attempts per quiz per day. Only a scrambled code of the network address is stored, never the address itself.
- Row-level security means creators only see their own quizzes and matches, and can only change a match's status (not its contents).
- Creators can delete matches, or a whole quiz along with everything linked to it.

## Before launch checklist
- [ ] `js/config.js` filled in, `APP_NAME` chosen
- [ ] Custom SMTP set up in Supabase (step 3)
- [ ] `privacy.html` filled in and reviewed; `PRIVACY_CONTACT` set in `js/config.js`
- [ ] A friend has taken your live quiz end to end on their phone (match and no match)
- [ ] Optional: match emails (step 6)

## Ideas for next
- Per-quiz link previews (title and image) for WhatsApp and Instagram. These need a small server function, because WhatsApp doesn't run JavaScript when it builds a preview.
- Email or WhatsApp verification codes so fake contacts get filtered out.
- A "report this quiz" link and a creator ban list.
- Mutual mode: both sides see compatibility, and the creator can choose to reveal their contact.
- Friends and flatmates modes with their own question banks.
