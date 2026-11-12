# 🌱 Next Chapter — a job search helper for Mom

A private web app that does most of the job hunt for her. She opens one link and taps **Sign in with Google**. That single step signs her in and connects her Gmail. The app then sets itself up:
- reads emails she has written, to learn how she sounds
- finds resumes and cover letters she has emailed before
- learns her work history
- fills in her search settings
- runs the first job search

After that:

1. **Holds her documents and learns her voice.** Resumes, cover letters, emails, and other writing (Word, PDF, text, or straight from her Gmail). Claude builds a **career record** (the only facts drafts may use) and a **voice guide** (how she actually writes). Her edits to drafts are kept as examples.
2. **Finds jobs every morning, starting with tech sales.** Default targets:
   - roles: SDR/BDR, Account Executive, Account Manager, Customer Success, and Inside Sales
   - employers: software, SaaS, and tech companies, remote or nearby
   
   She can change all of this in Settings. Sources are remote boards (Remotive, RemoteOK, Himalayas), local search (Adzuna, USAJobs), an **AI web scout** for local listings, Greenhouse/Lever careers pages, and RSS feeds. Claude scores each job 0–100 against her record, her wishes, and everything she's taught it. Only jobs above her bar (60 by default) are recommended; the rest are screened out but still viewable.
3. **Every recommended job needs her 👍 or 👎.** She votes in the app or straight from the morning email. A reason is optional (e.g. "Not the kind of work I want", "Pay too low", "Don't want this company").
   - Her votes and reasons go into every later fit check, so she sees fewer jobs like the ones she passed on.
   - "Don't want this company" blocks that employer for good.
   - Applications are only written for jobs she likes. A 👍 gets a draft within the hour.
4. **Learns from her feedback.** There are 👍/👎 buttons and a note on every draft, message, and job, a "How am I doing?" box, and she can simply reply to the morning email. Claude turns all of it into short **lessons** and follows them every time it writes, scores, or searches. Lessons fall into three groups:
   - which jobs to show her
   - how to write for her
   - how to work with her
   
   When she's explicit, it also updates her settings, e.g. "Stop showing me cold-calling jobs" adds an excluded keyword. She can read, add, and delete lessons on the **Learning** page.
5. **Writes a tailored resume, cover letter, email, and form answers for each job**, in her voice. Downloads as Word files or prints to PDF. She can ask for changes in plain words. A request like "make it warmer" applies to all future drafts too, not just this one.
6. **Submits and follows up.**
   - **Email applications:** sends from her Gmail with the files attached.
   - **Website applications:** a checklist plus an "I submitted it" button.
   - **Follow-ups:** drafted after 7, then 10 more days of silence, threaded under the original.
7. **Tracks every application until it's won or closed.** It reads her inbox for employer replies and files each with the right application, even from no-reply applicant-tracking systems. It classifies the reply, moves the application along, and drafts a response when one is needed.
8. **Emails her every morning** with:
   - **what she needs to do**: new jobs to vote on (with one-tap 👍/👎 buttons), drafts to look over, messages to OK
   - **what it did for her**: listings searched, jobs recommended and skipped, applications written and sent, follow-ups, replies noticed, applications closed
   - **what it learned from her lately**
   
   Replying to the email is feedback.

## Safety: what it will and won't do on its own

| Action | Default |
|---|---|
| Search, screen, check fit | Automatic, daily |
| Recommend jobs | Only above her fit bar; **each needs her 👍 or 👎** |
| Write an application | Only for jobs she gave a 👍 (automatic within the hour, can be turned off) |
| Send an application email | **Waits for her OK.** Optional autopilot in Settings. |
| Send a follow-up | **Waits for her OK.** Optional autopilot, weekdays 8am–5pm only. |
| Reply to a person (interview request, question) | **Always waits for her OK.** No setting changes this. |
| Fill in a company's website application form | Never. She submits those herself (see below). |

- **Honesty:** every prompt tells Claude it may not invent or inflate employers, dates, titles, degrees, licenses, numbers, or skills. Each draft includes a "Before you send" note listing anything she should double-check.
- **One-tap votes from email:** the 👍/👎 links are signed and expire after 14 days. They open a small confirm page, so mail scanners that pre-open links can't vote for her.
- **Scam screening:** postings that ask for money, gift cards, or bank or SSN details before an interview are flagged and scored ≤ 15.
- **Prompt injection:** job postings and employer emails are passed to Claude as clearly marked outside content, so text in them is treated as information, not instructions.
- **Who can sign in:** only the Google accounts in the `ALLOWED_EMAILS` secret. The first address is the job seeker; anyone else listed is a helper. Helpers sign in through a separate link that asks Google for name and email only, never Gmail. If a helper uses her button by mistake, the Gmail access they granted is handed straight back. Removing an address from the list signs that person out immediately.
- **Gmail token:** encrypted at rest (AES-GCM). It uses only the `gmail.send` and `gmail.readonly` scopes, so the app can't delete or change anything in her mailbox. Only her own Gmail can be connected.

### Why it doesn't auto-fill website applications

LinkedIn, Indeed, Workday, and most applicant-tracking systems forbid automated submissions in their terms. Many also use CAPTCHAs, and the forms make the applicant swear the answers are true. A bot that fills them in breaks easily and can get her account flagged. So for those jobs the app does everything except the final click: tailored files, drafted answers, the link, and tracking afterward. Email applications, which many small local employers still use, are fully automated.

## Architecture

| Part | Tech | Path |
|---|---|---|
| API + scheduler | Cloudflare Worker (TypeScript), hourly cron | [worker/](worker/) |
| Database | Cloudflare D1 (SQLite) | [worker/schema.sql](worker/schema.sql) |
| AI | Claude API via `@anthropic-ai/sdk` (structured outputs, web search tool, prompt caching, refusal fallbacks) | [worker/src/lib/ai.ts](worker/src/lib/ai.ts), [prompts.ts](worker/src/lib/prompts.ts) |
| Sign-in + email | Google OAuth: one consent covers sign-in and Gmail | [worker/src/lib/gmail.ts](worker/src/lib/gmail.ts) |
| Web app | React + Vite, served by the same Worker (one address), works on a phone | [frontend/](frontend/) |

The hourly cron sends approved messages, checks Gmail for replies, and drafts or closes follow-ups. Once a day, at her chosen hour, it also runs the job search and sends the morning summary.

## Setup (about 20 minutes, one time)

You need:
- a computer with [Node.js 20+](https://nodejs.org/)
- a free Cloudflare account (the script helps you make one)
- your Claude API key from <https://console.anthropic.com/settings/keys>
- a Google account, used to create the "Sign in with Google" keys

```bash
git clone <this repo> && cd <repo>/job-helper/worker
npm install
npm run setup
```

The script walks you through everything:
1. Logs you in to Cloudflare. A browser window opens.
2. Creates the database and its tables.
3. Builds the web app and publishes it. It prints the address, e.g. `https://next-chapter.<you>.workers.dev`.
4. Asks for your **Claude API key**. The key is hidden as you paste it. It's stored as an encrypted Cloudflare secret and never written to a file.
5. Asks for **your mom's Gmail address**, plus yours if you want to help. Only these accounts can sign in.
6. Shows the exact Google Cloud Console steps for the sign-in keys, with the redirect address already filled in. Then it asks for the client ID and secret.
7. Optionally asks for free Adzuna and USAJobs keys, for more local and government job listings.

Then send her the address. To update the app later, pull the new code and run `npm run setup` again. It skips anything that's already done.

### The Google step, in a little more detail

The script prints these with links. Do them in the [Google Cloud Console](https://console.cloud.google.com/):
1. Create a project and enable the **Gmail API**.
2. Under **Google Auth Platform → Branding**, give the app a name and your email. Under **Audience**, pick **External**.
3. Under **Clients**, create a client of type **Web application**. Add the redirect URI the script printed: `https://<app address>/api/google/callback`.
4. Under **Audience**, click **Publish app**, so it shows "In production". **Don't skip this.** While an app is in "Testing", Google expires its Gmail access every 7 days. No Google review is needed for family use. The first time she signs in, Google shows a "Google hasn't verified this app" page; she clicks **Advanced → Go to Next Chapter**. Tell her to expect it.

### What she sees the first time

1. **Sign in with Google.** Google asks to let Next Chapter "send email on your behalf" and "read your email". She allows both.
2. A **Welcome** screen shows the app getting ready, step by step. It reads her sent emails, pulls in resumes she has emailed, learns her history and voice, and runs the first search. This takes a few minutes.
3. **Today** then shows her matches. She can look over the career record it learned on **My Writing**, and adjust her town, travel distance, and job types in **Settings**.

If she unticks the Gmail boxes, she's still signed in, and the app offers a **Connect my Gmail** button. If no resume turns up in her email, she can add one on **My Writing**.

## Cost

Claude is billed per use; everything else fits in free tiers. The app uses Claude Opus 5.5 (`AI_MODEL` in `wrangler.toml`). This is a rough estimate at the defaults (25 fit checks a day, auto-drafts for strong matches, one web scout per day):
- **Fit check:** a few cents each.
- **Full application draft:** roughly 10–20 cents.
- **Total:** usually around **$1–2 a day** while the search is active.

Her profile is prompt-cached, so it's cheap to reuse across a day's fit checks. **Settings → Most fit checks per day** caps the main cost. Check the usage page in the Anthropic console after the first week.

## Local development

```bash
cd job-helper/worker
printf 'JWT_SECRET=dev-secret-0123456789abcdef\nTOKEN_ENC_KEY=dev-key-0123456789abcdef\nMOCK_AI=1\nDEV_LOGIN=1\nFRONTEND_URL=http://localhost:5173\nALLOWED_EMAILS=mom@example.com\n' > .dev.vars
npm run db:init
npm run dev                                    # API on :8787

cd ../frontend && npm install && npm run dev   # app on :5173
```

- `DEV_LOGIN=1` adds an email-only sign-in box to the login page, so you don't need Google keys locally. Never set it in production.
- `MOCK_AI=1` returns canned AI answers, so you can click through without an API key.

**Tests:** `cd worker && npm test`
- Unit tests cover the follow-up schedule, screening, salary parsing, reply matching, MIME building (including header-injection protection), every job-source parser, Word export and import, and Google scopes.
- `test/signin.integration.test.ts` runs the real Worker in Cloudflare's local runtime against a fake Google. It checks Google sign-in, the allowed-email list, helper sign-in, revoking unwanted tokens, first-run setup from Gmail, and sending an application with attachments.
