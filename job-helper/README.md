# 🌱 Next Chapter — AI job-search partner

**https://nextchapterjobhunter.com**

Next Chapter does the busywork of a job search in the job seeker's own voice. The person stays in control: by default nothing is sent until they approve it. It started as a tool for one person moving into tech sales and is now a pay-as-you-go service anyone can sign up for.

## What it does

**Getting set up**
- **Sign in with Google.** One consent screen covers sign-in, Gmail (send + read) and Google Calendar (create interview events and check free/busy times).
- **Guided onboarding:**
  - upload a resume and other documents, or let it read Gmail for sent emails and past resumes
  - answer questions about skills, experience, the roles and industries they want, remote/hybrid/in-person, location and travel radius, base pay and OTE, schedule, start date and dealbreakers
  - Claude then asks follow-up questions based on the documents
- **What it builds from that:**
  - a **career record**: the only facts drafts may use
  - a **voice guide**: how they write
  - a **career-change story**: also used for a LinkedIn rewrite (headline, About, experience) and certification suggestions

**Finding jobs**
- **Daily search.** Sources:
  - remote boards: Remotive, RemoteOK, Himalayas, Jobicy, We Work Remotely, Working Nomads
  - for sales searches, the career pages of 60+ software companies that hire sales reps ([companies.ts](worker/src/sources/companies.ts)). They're fetched about once a day and shared by every account.
  - local: Adzuna, Jooble, USAJobs (free keys)
  - **Google Jobs via SerpApi** (optional, paid): listings Google gathers from LinkedIn, Indeed, ZipRecruiter, Monster and Glassdoor. Each search is charged to the customer's credit like AI use.
  - company career pages on Greenhouse, Lever and Ashby, plus RSS feeds
  - a Claude web-search scout for small-town listings
  - Indeed, LinkedIn, ZipRecruiter and Monster have no public search API and forbid scraping, so they're reached through Google Jobs, or the user adds a job they found there.
- **Tech sales by default.** It starts with SDR/BDR, AE, Account Manager, Customer Success and Inside Sales roles at software/SaaS companies. Any field works.
- **Fit scoring.** Each job gets a 0–100 score with reasons, gaps and scam flags. Jobs below the user's bar are screened out.
- **Learning their taste.** **Every recommendation needs their 👍 or 👎**, from the app or one tap in the morning email. Votes and reasons feed every later fit check, and "don't want this company" blocks that employer.
- **Company checks.** Before drafting, it looks up the company (funding, layoffs, rep reviews, pay realism) and checks the posting is still open.

**Applying**
- **Tailored drafts** for each job the user 👍s: resume, cover letter, email and form answers in their voice, as PDF and/or Word.
- **Email applications** go out from their Gmail after they approve them (optional autopilot).
- **Website forms:** the **browser helper** (Chrome extension, [extension/](extension/)) fills in company application forms. The user checks everything and presses Submit.
- **Test week.** For the first 7 days, everything the app "sends" goes to the user's own inbox first.

**Following through**
- **Follow-ups** after 7, then 10, days of silence, threaded in the original email.
- **Replies.** It reads replies and files each one with the right application, including emails from applicant-tracking systems. It classifies the reply and drafts a response that offers times from their **Google Calendar**.
- **Tracking.** Every application is tracked until hired or closed.
- **Interviews and offers:**
  - prep sheets (company research, likely questions, STAR stories from their record, questions to ask) and calendar events
  - **practice role-plays** with a scorecard (cold call, discovery, objections, "sell me this", hiring manager), with voice where the browser supports it
  - thank-you notes after interviews
  - hiring-manager outreach notes for LinkedIn
  - offer review with a drafted negotiation email

**Staying in the loop**
- **Morning email:** what to do, plus what the app did for them. Optional daily text, a weekly progress summary and a Progress page.
- **Feedback.** Their feedback on anything (including replies to the morning email) becomes **lessons** that every prompt follows. The **What I've learned** page shows them and lets them edit them.
- **Helpers.** They can invite family helpers.
- **Alerts.** If something breaks (Gmail disconnected, out of credit, nothing happening for days), the person and their helpers get an alert.
- **Help.** There's a help center and a support chatbot. The chatbot is free to use and knows the help articles.

## The business

- **Pricing: prepaid credit.** Each Claude call is metered (tokens, cache and web searches, priced per model in [billing.ts](worker/src/billing.ts)). The customer is charged `PRICE_MULTIPLIER` (2) × the AI cost. Credit is bought with Stripe Checkout in $10/$25/$50/$100 packs.
- **Spending limits.** Customers can set a monthly limit. The admin sets a **business-wide monthly AI cap** that pauses all AI work when reached.
- **Comped accounts.** Accounts in `FREE_EMAILS` (e.g. the founder's mom) are free, and the business pays their AI cost.
- **Referrals (one level only).** Everyone gets a referral link. When a referred person uses the app, the referrer earns `REFERRAL_SHARE` (50%) of the profit (charge − AI cost). People who sign up on their own leave 100% with the business.
  - **Payouts:** monthly in cash through **Stripe Connect Express**, after a 30-day hold, once the balance reaches $25.
  - **No earnings from recruiting itself:** a referrer earns only from the usage of the people they referred, never from signing people up.
- **Admin dashboard** (`#/admin`): credit sold, usage charged, AI cost, comped cost, referral earned/paid, profit, users, waitlist, the global cap, per-user comp/credit/cap/suspend, run payouts, and the support-chat log.
- **Beta cap.** While Google hasn't verified the app, at most `MAX_USERS` (100) accounts are active; later sign-ups join a waitlist the admin can approve.

> **Before launch:** have a lawyer review the Terms, the Privacy Policy, the referral program (FTC rules, state laws, tax forms for referral payouts) and income-related wording. To open Gmail access to more than 100 users, Google requires app verification **and an annual CASA security assessment** (because the app reads Gmail).

## Safety defaults

| Action | Default |
|---|---|
| Search, screen, score, research companies | Automatic |
| Recommend a job | Only above the fit bar; **each needs a 👍/👎** |
| Write an application | Only for 👍 jobs (automatic, can be turned off) |
| Send an application or follow-up email | **Waits for approval** (optional autopilot); first week goes to their own inbox |
| Reply to a person (interview, offer, question) | **Always waits for approval** |
| Website application forms | The browser helper fills them in; **the user presses Submit** |

- **Honesty.** Drafts may only use facts from the career record and onboarding answers. Each draft lists anything to double-check.
- **Prompt injection.** Job postings, web pages and employer emails are marked as outside content in every prompt.
- **Gmail token.** Encrypted at rest (AES-GCM). Only send/read scopes are used, so nothing in the mailbox can be deleted or changed. Google-API data use follows Google's Limited Use policy (see `/privacy.html`).
- **Privacy between accounts.** Every row of personal data carries an account id and every query filters by it. Helpers only see the workspaces that invited them, re-checked on every request. Tests cover cross-account access.

## Architecture

| Part | Tech | Path |
|---|---|---|
| API, scheduler, web app hosting | Cloudflare Worker (TypeScript) + static assets, hourly cron | [worker/](worker/) |
| Database | Cloudflare D1 (SQLite), schema v2 (multi-account) | [worker/schema.sql](worker/schema.sql) |
| AI | Claude API (`@anthropic-ai/sdk`): structured outputs, web search, prompt caching, refusal fallbacks; every call metered | [worker/src/lib/ai.ts](worker/src/lib/ai.ts), [billing.ts](worker/src/billing.ts) |
| Sign-in, email, calendar | Google OAuth, Gmail API, Calendar API | [worker/src/lib/gmail.ts](worker/src/lib/gmail.ts), [calendar.ts](worker/src/lib/calendar.ts) |
| Payments | Stripe Checkout + webhooks, Connect Express payouts | [worker/src/stripe.ts](worker/src/stripe.ts) |
| System email / texts | Resend / Twilio (optional) | [worker/src/alerts.ts](worker/src/alerts.ts), [career.ts](worker/src/career.ts) |
| Web app | React + Vite, installable on phones (PWA) | [frontend/](frontend/) |
| Browser helper | Chrome extension (MV3), never submits | [extension/](extension/) |
| Help center articles | Shared by the app and the support chatbot | [shared/help-articles.ts](shared/help-articles.ts) |

The hourly cron works through every active account inside a time budget. For each account it:
- sends approved messages
- reads replies
- drafts follow-ups
- learns from new feedback
- drafts applications for 👍 jobs
- runs the daily search at the account's chosen hour, then sends the morning email
- raises and sends alerts

Payouts run on the 1st of each month. Weekly summaries go out on Mondays.

## Setup

You need:
- [Node.js 20+](https://nodejs.org/)
- a free Cloudflare account, with **nextchapterjobhunter.com** added to it
- a Claude API key from https://console.anthropic.com
- a Google Cloud project for sign-in
- optional: Stripe (payments and payouts), Resend (system email), Twilio (texts), Adzuna and USAJobs (more local jobs)

```bash
git clone https://github.com/taylormarean/White-Salmon-Boat-Library-.git
cd White-Salmon-Boat-Library-
git checkout claude/relaxed-newton-2btiuy
cd job-helper/worker
npm install
npm run setup
```

`npm run setup` walks through everything and is safe to re-run:
1. **Cloudflare login and database.** It also offers to upgrade a database from the single-user version, which means starting it fresh.
2. **Build and deploy.** The site goes live at **https://nextchapterjobhunter.com** (`www` redirects there). If the domain isn't on your Cloudflare account yet, it explains how to add it (change the nameservers at your registrar) and publishes on a temporary workers.dev address meanwhile.
3. **Keys.** The Claude key is typed hidden and stored as an encrypted secret. It then asks for:
   - your email (admin) and your mom's (free account)
   - the Google sign-in keys, printing every console step, including the homepage, privacy, terms and redirect URLs
   - Stripe (with webhook and Connect steps), Resend, Twilio and the job APIs (Adzuna, USAJobs, Jooble, SerpApi), all optional

## Local development

```bash
cd job-helper/worker
printf 'JWT_SECRET=dev-secret-0123456789abcdef\nTOKEN_ENC_KEY=dev-key-0123456789abcdef\nMOCK_AI=1\nDEV_LOGIN=1\nFRONTEND_URL=http://localhost:5173\nADMIN_EMAILS=you@example.com\nFREE_EMAILS=mom@example.com\n' > .dev.vars
npm run db:init
npm run dev                                    # API on :8787

cd ../frontend && npm install && npm run dev   # app on :5173
```

- `MOCK_AI=1` returns canned AI answers and still meters a small amount, so billing works locally.
- `DEV_LOGIN=1` adds an email-only sign-in. Never use it in production.

**Tests:** run `cd worker && npm test`.
- Unit tests cover the follow-up schedule, screening, reply matching, MIME, the source parsers, Word/PDF, the morning email, Google scopes, pricing math and the help center.
- End-to-end tests run the real Worker in Cloudflare's local runtime against a fake Google, Gmail and Stripe. They cover:
  - sign-up with a referral code, helpers, and privacy between accounts
  - 2× charging and the referrer's 50% share
  - running out of credit, monthly limits, the global cap and the waitlist
  - signed, idempotent Stripe webhooks
  - test mode, onboarding answers, story, interview prep with a thank-you note, practice role-plays, outreach, company checks, still-open checks, offers, and the browser-helper API

For the browser extension, run `node extension/test/fill.test.cjs`.
