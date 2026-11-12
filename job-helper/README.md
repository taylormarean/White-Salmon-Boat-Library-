# 🌱 Next Chapter — a job search helper for Mom

A private web app that does most of the job hunt for her:

1. **Holds her documents and learns her voice.** She uploads resumes, cover letters, emails, and other writing (Word, PDF, text, or her Gmail sent folder). Claude reads them and builds:
   - a **career record**: every fact about her work history. Drafts may only use these facts.
   - a **voice guide**: how she actually writes (greetings, sign-offs, phrases, tone).
   Each time she edits a draft, the before and after are saved, and later drafts follow those changes.
2. **Finds jobs every morning, local and remote, and checks the fit.** Sources:
   - remote job boards (Remotive, RemoteOK, Himalayas)
   - local search (Adzuna, USAJobs)
   - an **AI web scout** that searches city and county pages, school districts, hospitals, local papers, and employer sites near her town
   - any company careers page on Greenhouse or Lever, and any RSS job feed
   A free keyword screen runs first. Claude then scores each remaining job 0–100 against her career record and wishes (pay, commute radius, remote or in person), with plain-language reasons and gaps. It also flags likely scams.
3. **Writes a tailored resume, cover letter, and email for each job**, in her voice. It also drafts answers to common application-form questions. Everything downloads as Word files or prints to PDF. She can ask for changes in plain words ("make it warmer").
4. **Submits and follows up.**
   - **Email applications:** sends from *her* Gmail with the resume and cover letter attached as .docx.
   - **Website applications:** gives her a short checklist (download the files, open the application page, paste the answers), then one tap on "I submitted it."
   - **Follow-ups:** drafted automatically after 7 and then 10 more days of silence, threaded under the original email.
5. **Tracks every application until it's won or closed.** It reads her Gmail inbox for replies and works out which application each one is about, even when an applicant-tracking system sends it from a no-reply address. Claude sorts each reply as interview, offer, rejection, needs-info, or auto-acknowledgement and moves the application along. When a reply needs an answer, it drafts one. Quiet applications close themselves after the last follow-up. She can also get a short morning summary email.

## Safety: what it will and won't do on its own

| Action | Default |
|---|---|
| Search, screen, check fit | Automatic, daily |
| Write drafts for jobs scoring ≥ 80 | Automatic (adjustable, can be turned off) |
| Send an application email | **Waits for her OK.** Optional autopilot in Settings. |
| Send a follow-up | **Waits for her OK.** Optional autopilot, weekdays 8am–5pm only. |
| Reply to a person (interview request, question) | **Always waits for her OK.** No setting changes this. |
| Fill in a company's website application form | Never. She submits those herself (see below). |

- **Honesty:** every prompt tells Claude it may not invent or inflate employers, dates, titles, degrees, licenses, numbers, or skills. Each draft includes a "Before you send" note listing anything she should double-check.
- **Scam screening:** postings that ask for money, gift cards, or bank or SSN details before an interview are flagged and scored ≤ 15.
- **Prompt injection:** job postings and employer emails are passed to Claude as clearly marked outside content, so text in them is treated as information, not instructions.
- **Gmail token:** encrypted at rest (AES-GCM). It uses only the `gmail.send` and `gmail.readonly` scopes. The app can't delete or change anything in her mailbox.

### Why it doesn't auto-fill website applications

LinkedIn, Indeed, Workday, and most applicant-tracking systems forbid automated submissions in their terms. Many also use CAPTCHAs, and the forms make the applicant swear the answers are true. A bot that fills them in breaks easily and can get her account flagged. So for those jobs the app does everything except the final click: tailored files, drafted answers, the link, and tracking afterward. Email applications, which many small local employers still use, are fully automated.

## Architecture

| Part | Tech | Path |
|---|---|---|
| API + scheduler | Cloudflare Worker (TypeScript), hourly cron | [worker/](worker/) |
| Database | Cloudflare D1 (SQLite) | [worker/schema.sql](worker/schema.sql) |
| AI | Claude API via `@anthropic-ai/sdk` (structured outputs, web search tool, prompt caching, refusal fallbacks) | [worker/src/lib/ai.ts](worker/src/lib/ai.ts), [prompts.ts](worker/src/lib/prompts.ts) |
| Email | Gmail API (OAuth) | [worker/src/lib/gmail.ts](worker/src/lib/gmail.ts) |
| Web app | React + Vite, works on a phone | [frontend/](frontend/) |

The hourly cron sends approved messages, checks Gmail for replies, and drafts or closes follow-ups. Once a day, at her chosen hour, it also runs the job search and sends the morning summary.

## Setup (about 45 minutes)

You need: a Cloudflare account (free tier is fine), an Anthropic API key, and a Google account to create the Gmail OAuth app.

### 1. Worker + database

```bash
cd job-helper/worker
npm install
npx wrangler login
npx wrangler d1 create next-chapter-db      # paste the database_id into wrangler.toml
npm run db:init:remote

npx wrangler secret put JWT_SECRET          # any long random string
npx wrangler secret put TOKEN_ENC_KEY       # another long random string
npx wrangler secret put ANTHROPIC_API_KEY   # from console.anthropic.com
npx wrangler deploy                         # note the URL, e.g. https://next-chapter-api.<you>.workers.dev
```

In `wrangler.toml`:
- set `API_URL` to the Worker URL
- set `FRONTEND_URL` to wherever the web app will live (step 3)
- set `TIMEZONE` if she isn't on Pacific time

Then deploy again.

Create her login (and one for yourself if you want to help):

```bash
node scripts/create-user.mjs mom@example.com "Her Name" 'a-strong-password' --remote
```

### 2. Gmail (sending and reply tracking)

1. Go to <https://console.cloud.google.com/>, create a project, and enable the **Gmail API**.
2. Open **OAuth consent screen**, choose **External**, and fill in the app name and your email. Add the scopes `gmail.send` and `gmail.readonly`.
3. Open **Credentials**, then **Create OAuth client ID**, then **Web application**. Add this Authorized redirect URI: `https://<your-worker-url>/api/google/callback`
4. Store the client ID and secret:
   `npx wrangler secret put GOOGLE_CLIENT_ID` and `npx wrangler secret put GOOGLE_CLIENT_SECRET`
5. **Important:** on the consent screen, click **Publish app** (set it to "In production"). While an app is in "Testing", Google expires its refresh tokens every 7 days, so Gmail would silently disconnect each week. You don't need Google's verification for personal use. When she connects, she'll see a "Google hasn't verified this app" screen; she clicks **Advanced → Go to (app name)**.
6. In the app, she goes to **Settings → Connect Gmail**.

### 3. Web app

```bash
cd job-helper/frontend
npm install
echo "VITE_API_URL=https://<your-worker-url>" > .env.local
npm run build      # upload dist/ to Cloudflare Pages (or any static host)
```

With Cloudflare Pages: `npx wrangler pages deploy dist --project-name next-chapter`. Put the resulting URL into `FRONTEND_URL` in `wrangler.toml`, then redeploy the Worker.

### 4. Optional: more local jobs

Both are free:
- **Adzuna** (<https://developer.adzuna.com/>):
  `wrangler secret put ADZUNA_APP_ID` and `wrangler secret put ADZUNA_APP_KEY`
- **USAJobs** (<https://developer.usajobs.gov/apikey-request/>), for federal jobs such as Forest Service and VA:
  `wrangler secret put USAJOBS_API_KEY` and `wrangler secret put USAJOBS_EMAIL` (the email you registered with)

Without these, local jobs come from the AI web scout plus any careers pages and feeds you add in Settings.

### 5. First run with her

1. **My Writing:** add her latest resume, two or three cover letters, and a handful of real emails. If Gmail is connected, **Learn from my sent Gmail** pulls in 25 recent sent emails.
2. Tap **Learn my voice**. Read through the career record together, fix anything that's wrong, and answer the questions it asks.
3. **Settings:** fill in her town, how far she'll drive, the kinds of jobs she wants, things to avoid, and minimum pay.
4. **Today → Look for new jobs now.** Open a good match and tap **Help me apply**.

## Cost

Claude is billed per use; everything else fits in free tiers. The app uses Claude Opus 5.5 (`AI_MODEL` in `wrangler.toml`). This is a rough estimate at the defaults (25 fit checks a day, auto-drafts for strong matches, one web scout per day):
- **Fit check:** a few cents each.
- **Full application draft:** roughly 10–20 cents.
- **Total:** usually around **$1–2 a day** while the search is active.

Her profile is prompt-cached, so it's cheap to reuse across a day's fit checks. **Settings → Most fit checks per day** caps the main cost. Check the usage page in the Anthropic console after the first week.

## Local development

```bash
cd job-helper/worker
printf 'JWT_SECRET=dev-secret-0123456789abcdef\nTOKEN_ENC_KEY=dev-key-0123456789abcdef\nMOCK_AI=1\n' > .dev.vars
npm run db:init
node scripts/create-user.mjs mom@example.com "Test Mom" test-password-1
npm run dev            # API on :8787

cd ../frontend && npm install && npm run dev   # app on :5173
```

`MOCK_AI=1` returns canned AI answers, so you can click through everything without an API key. Remove it, or set `ANTHROPIC_API_KEY` in `.dev.vars`, to use real Claude.

Tests: `cd worker && npm test`. They cover the follow-up schedule, screening, salary parsing, reply matching, MIME building (including header-injection protection), every job-source parser, and Word export.
