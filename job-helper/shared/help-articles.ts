// Help center articles for Next Chapter, shared by the web app (help pages, instant search) and the
// Worker (public /api/help and the support assistant's knowledge). Plain TypeScript, no imports.
//
// Article bodies use a small markdown subset (rendered safely, never as HTML):
//   ## Heading / ### Subheading, "- " bullets, "1. " numbered steps, **bold**, [text](#/route) links,
//   and [text](https://…) links. Blank lines separate paragraphs.

export interface HelpArticle {
  slug: string;
  title: string;
  category: string;
  summary: string;
  body: string;
  keywords: string[];
}

export const SUPPORT_EMAIL = 'support@nextchapterjobhunter.com';

/** Categories in the order the help center shows them. */
export const HELP_CATEGORIES = ['Getting started', 'Finding jobs', 'Applying', 'After you apply', 'Your story', 'Your account', 'Troubleshooting'] as const;

/** Screens in the app that articles may link to (hash routes). `#/help` and `#/help/<slug>` are also allowed. */
export const APP_ROUTES = ['#/', '#/jobs', '#/applications', '#/practice', '#/story', '#/writing', '#/learning', '#/insights', '#/billing', '#/referrals', '#/settings', '#/help'] as const;

export const HELP_ARTICLES: HelpArticle[] = [
  // ------------------------------------------------------------------ Getting started
  {
    slug: 'what-is-next-chapter',
    title: 'What Next Chapter does for you',
    category: 'Getting started',
    summary: 'An AI job-search helper that finds jobs, writes applications in your voice, sends them from your Gmail when you say so, and follows up.',
    keywords: ['about', 'overview', 'what is', 'how it works', 'features', 'introduction', 'start here', 'what can it do'],
    body: `Next Chapter is a job-search assistant. It does the busywork of a job hunt so you can spend your energy on the parts that need you.

## What it does for you
- **Finds jobs every morning** from job boards and the web, and checks each one against your experience and wishes.
- **Asks for your 👍 or 👎** on each recommended job, and learns your taste from your answers.
- **Writes a tailored resume, cover letter and email** for the jobs you like, using only facts from your own documents.
- **Sends email applications from your Gmail** once you approve them, and helps you apply on company websites.
- **Follows up** when employers go quiet, notices their replies in your inbox, and helps you get ready for interviews.
- **Emails you every morning** with what needs you and what it did for you.

## What stays in your hands
- Nothing goes to an employer until you OK it, unless you turn on autopilot in [Settings](#/settings).
- Replies to real people, like an interview request, always wait for you.
- On company websites, you press the final Submit button yourself.

## Where to start
Open [Today](#/). It always shows what needs you right now. New here? Read [The setup questions](#/help/setup-questions) and [Your first week: test mode](#/help/test-week).`,
  },
  {
    slug: 'sign-in-with-google',
    title: 'Signing in with Google (and the “unverified app” screen)',
    category: 'Getting started',
    summary: 'One Google sign-in connects your Gmail and Calendar. During the beta, Google shows a “hasn’t verified this app” page once — click Advanced, then Go to Next Chapter.',
    keywords: ['sign in', 'log in', 'login', 'google', 'unverified', 'not verified', 'hasn’t verified', 'warning', 'advanced', 'permissions', 'consent', 'calendar', 'gmail access'],
    body: `Next Chapter uses your Google account. One tap on **Sign in with Google** signs you in and connects your Gmail and Google Calendar.

## What Google asks you
Google shows one permission screen asking to let Next Chapter:
- **Send email on your behalf**, so applications and follow-ups go out from your own address.
- **Read your email**, so it can notice employer replies, find resumes you’ve emailed before, and learn how you write.
- **Add calendar events and check when you’re free**, so interviews land on your calendar and replies can offer times that work.

Leave the boxes ticked. If you untick Gmail, you’re still signed in, but the app can’t send applications or watch for replies. You can connect it later in [Settings](#/settings) with **Connect Gmail**.

## “Google hasn’t verified this app”
While Next Chapter is in beta, Google shows a warning page the first time you sign in. This is expected. To continue:
1. Click **Advanced** (a small link near the bottom).
2. Click **Go to Next Chapter**.
3. On the permission screen, leave the boxes ticked and click **Continue**.

You normally only see this once.

## Signing in as a helper
Family members who help you use **Sign in as a helper** instead. That asks Google only for their name and email, never their Gmail. See [Inviting a family helper](#/help/helpers).`,
  },
  {
    slug: 'setup-questions',
    title: 'The setup questions',
    category: 'Getting started',
    summary: 'The first time you sign in, a short Welcome walks you through documents, questions about you and the work you want, and your first search.',
    keywords: ['setup', 'set up', 'onboarding', 'welcome', 'questions', 'first time', 'questionnaire', 'getting started', 'first search', 'change my answers'],
    body: `The first time you sign in, a short **Welcome** walks you through setup. It takes about 10 minutes. You can go **← Back** or skip a step and come back to it later.

## The steps
1. **Welcome**: a quick overview.
2. **Your documents**: tap **Look in my Gmail** to find resumes and cover letters you’ve emailed before, or **Choose files** to add your resume. See [Adding your resume](#/help/add-your-resume).
3. **About you**: your most recent job title, years of experience, what you’re good at, software you know, something you’re proud of, and your LinkedIn link (optional).
4. **The work you want**: kinds of jobs, industries, from home / hybrid / in person, your town, how far you’ll drive, lowest pay, schedule, when you can start, why this move, and dealbreakers.
5. **Learning about you**: the AI reads your documents and answers to build your career record and learn how you write. This takes a minute or two.
6. **A few more questions**: anything that would make your applications stronger. Answer what you can and skip the rest.
7. **Your first search**: tap **Find my first jobs**, then **Go to my dashboard**.

The first search needs your resume and your town. If either is missing, it waits until you add them.

## Changing your answers later
Your answers become your search settings. Change them any time in [Settings](#/settings) (kinds of jobs, town, distance, pay and more), then tap **💾 Save settings**. Your career record lives on [My Writing](#/writing).

If your account uses prepaid credit, step 5 needs a little credit. The questions themselves are free.`,
  },
  {
    slug: 'add-your-resume',
    title: 'Adding your resume and other writing',
    category: 'Getting started',
    summary: 'Add your resume (Word, PDF or text) on My Writing, or pull it from your Gmail, then tap Learn my voice.',
    keywords: ['resume', 'résumé', 'cv', 'upload', 'add file', 'documents', 'cover letter', 'my writing', 'learn my voice', 'career record', 'import', 'paste'],
    body: `Your resume is the most important thing you can give Next Chapter. Every application is built from it.

## Add files
1. Open [My Writing](#/writing). On a phone, tap **More**, then **My writing**.
2. Tap **📄 Add files** and pick your resume. You can also drag files onto the box.
3. Add cover letters, reference letters or emails you’ve written. They help drafts sound like you.
4. When you’ve added everything, tap **🧠 Learn my voice** (or **Learn again**). It takes a minute or two.

Word (.docx), PDF and text files work. Old **.doc** files can’t be read. Open them in Word and use **Save As** to make a .docx, or copy the text and use **📝 Paste text**.

## From your Gmail
If Gmail is connected, **📬 Look in my Gmail again** pulls in resumes and cover letters you’ve emailed before, plus some emails you’ve sent so it can learn your style. Nothing in your mailbox is changed.

## Check what it learned
After learning, My Writing shows two things:
- **Your career record**: the only facts the app is allowed to use. Tap **✏️ Edit** to fix anything that’s wrong. Your edits are kept.
- **How you write**: the style guide used for every letter and email.

Untick **Learn from this** on any document you don’t want it to copy your style from. Tap **Delete** to remove a document.`,
  },
  {
    slug: 'test-week',
    title: 'Your first week: test mode',
    category: 'Getting started',
    summary: 'For your first 7 days, anything Next Chapter “sends” goes to your own inbox instead of the employer, so you can see exactly what they’d get.',
    keywords: ['test mode', 'test week', 'first week', 'trial', 'own inbox', 'my inbox', 'not sent', 'turn off test', '[test]', 'practice run'],
    body: `For your first 7 days, Next Chapter is in **test mode**. Anything it “sends” goes to **your own inbox** instead of the employer, so you can see exactly what they would receive.

## What you’ll see
- A yellow **🧪 Test week** banner at the top of the app with the date it ends.
- Emails in your inbox with a subject that starts **[TEST — would go to …]**, with your resume and cover letter attached.
- On the application’s **History** tab: “Test mode: sent a copy … to you instead of …”.

Nothing reaches an employer during test week. An application you “send” in test mode stays **Ready for you**, so you can send it for real once test mode is over.

## Ending test mode
Test mode turns off by itself after 7 days. To end it sooner, use the link in the yellow banner (**Turn off when you’re ready**), which opens [Settings](#/settings).

Getting test emails and not sure why? See [Why are emails going to my own inbox?](#/help/emails-to-my-own-inbox)`,
  },

  // ------------------------------------------------------------------ Finding jobs
  {
    slug: 'how-jobs-are-found',
    title: 'How jobs are found',
    category: 'Finding jobs',
    summary: 'Every morning Next Chapter searches job boards and the web, screens out what you don’t want, and fit-checks the rest.',
    keywords: ['find jobs', 'search', 'job boards', 'sources', 'where', 'remote', 'local', 'daily search', 'look for jobs', 'greenhouse', 'lever', 'ashby', 'rss', 'web search', 'every morning', 'indeed', 'linkedin', 'ziprecruiter', 'monster', 'glassdoor', 'google jobs', 'jooble', 'big job sites', 'company career pages'],
    body: `Every morning, Next Chapter searches for jobs that match what you told it.

## Where it looks
- **Work-from-home job boards**: Remotive, RemoteOK, Himalayas, Jobicy, We Work Remotely and Working Nomads.
- **Software companies hiring sales**: for sales and customer-success searches, the careers pages of 60+ companies such as Datadog, Stripe, Snowflake, Samsara and Gong. It keeps their U.S. remote openings and any near you.
- **Local jobs**: an AI web search of city and county pages, schools, hospitals and local papers, plus Adzuna, Jooble and USAJobs where they’re available.
- **Google Jobs** (where available): listings Google gathers from LinkedIn, Indeed, ZipRecruiter, Monster, Glassdoor and employers’ own sites. Each daily search uses a few cents of credit.
- **Specific employers** (optional): company careers pages on Greenhouse, Lever or Ashby, and job feeds (RSS). Add them in [Settings](#/settings) under **Where to look**, then **Specific employers and job feeds (advanced)**.

**Found a job somewhere else, like Indeed or LinkedIn?** Add it yourself; see [Adding a job you found yourself](#/help/add-a-job-yourself). The big job sites don’t let apps search them directly.

It starts out looking for tech sales roles (like sales development, account executive, account manager and customer success). You can point it at any kind of work in Settings under **Kinds of jobs** and **What to focus on**.

## What happens to each job
1. Jobs that mention words on your **Never show jobs that mention** list, or come from a blocked employer, are screened out.
2. The rest get a **fit check**: the AI compares the job with your career record, your wishes and everything you’ve taught it, and scores it from 0 to 100. See [Fit scores](#/help/fit-scores).
3. Jobs at or above your bar (60 unless you change it) appear on [Today](#/) and in [Jobs](#/jobs) under **Needs your vote**.

## When it runs
The search runs once a day at the hour you choose in Settings, under **Autopilot**: “Look for new jobs every morning at …”. To search right now, tap **🔎 Look for new jobs now** on Today. A search can take a few minutes.`,
  },
  {
    slug: 'fit-scores',
    title: 'Fit scores: what the number means',
    category: 'Finding jobs',
    summary: 'Each job gets a 0–100 score for how well it matches you. Only jobs above your bar (60 by default) ask for your vote.',
    keywords: ['fit score', 'score', 'match', 'number', 'great fit', 'good fit', 'stretch', 'poor fit', 'be careful', 'scam', 'red flag', 'bar', 'threshold', 'screened out'],
    body: `Each job gets a score from 0 to 100 showing how well it matches you: your experience, your wishes and what you’ve taught the app.

## What the score means
Roughly:
- **85 and up: Great fit**
- **70 to 84: Good fit**
- **50 to 69: Stretch.** Worth a look, but they may want something you don’t have yet.
- **Below 50: Poor fit**
- **Be careful**: the posting looks risky, for example it asks for money, gift cards, or bank or Social Security details before an interview. These are scored 15 or lower. Never pay to apply.

## Why a job got its score
Tap the job’s title to see **Why you fit** and **Things they want that you may not have**. If a job hasn’t been checked yet, tap **Check the fit**.

## Seeing more or fewer jobs
Only jobs at or above your bar ask for your vote. Change the bar in [Settings](#/settings) under **Only ask me about jobs that fit at least**. Lower shows you more jobs; higher shows only the best.

Jobs below the bar aren’t thrown away. Find them in [Jobs](#/jobs) under **Screened out**. If you like one, tap **Actually, I like this one**.

Scores get better the more you vote. See [👍 and 👎: teaching it your taste](#/help/thumbs-up-down).`,
  },
  {
    slug: 'thumbs-up-down',
    title: '👍 and 👎: teaching it your taste',
    category: 'Finding jobs',
    summary: 'Every recommended job needs your 👍 or 👎. Votes decide which jobs get applications and teach the app what to look for.',
    keywords: ['vote', 'thumbs up', 'thumbs down', 'like', 'dislike', 'not for me', 'teach', 'learn', 'taste', 'lessons', 'feedback', 'what i’ve learned', 'reason'],
    body: `Every recommended job needs your 👍 or 👎. Your votes are how Next Chapter learns what you want.

## How to vote
- On [Today](#/) or in [Jobs](#/jobs), tap **👍 I like it** or **👎 Not for me**.
- From the morning email, tap 👍 or 👎 next to a job, then confirm on the page that opens.

After voting you can pick a reason (like “Pay is too low” or “Too far / wrong location”) and add a note. Reasons are optional, but they help a lot.

## What happens next
- **👍**: the job moves to **Liked**, and Next Chapter writes your application, usually within the hour. It also looks for more jobs like it.
- **👎**: the job moves to **Not for me**, and you’ll see fewer like it. If a draft was written but not sent yet, it’s withdrawn.

Changed your mind? Open the job and vote again.

## Teaching it more
Your votes and reasons become short lessons it follows every time it searches, scores or writes. Read, add or delete them on [What I’ve learned](#/learning).

You can also tell it things directly in the **How am I doing?** box, or by replying to the morning email. For example: “Stop showing me cold-calling jobs.” When you’re that clear, it updates your settings too.`,
  },
  {
    slug: 'block-a-company',
    title: 'Blocking a company',
    category: 'Finding jobs',
    summary: 'Give one of their jobs a 👎 with the reason “Don’t want this company”, or list the employer in Settings.',
    keywords: ['block', 'company', 'employer', 'never show', 'hide', 'exclude', 'don’t want this company', 'unblock', 'keywords', 'stop showing'],
    body: `Don’t want to see jobs from an employer again? There are two ways.

## From one of their jobs
1. Tap **👎 Not for me** on the job.
2. Choose the reason **Don’t want this company** and tap **Done**.

That employer is blocked for good, and their other new jobs are cleared from your list.

## In Settings
1. Open [Settings](#/settings).
2. Under **What you’re looking for**, find **Employers I never want to see**.
3. Add one company per line.
4. Tap **💾 Save settings**.

To unblock a company, delete its line and save.

## Blocking kinds of jobs
Add words like “commission only” or “night shift” to **Never show jobs that mention** in the same section. Any job that mentions them is screened out.`,
  },
  {
    slug: 'add-a-job-yourself',
    title: 'Adding a job you found yourself',
    category: 'Finding jobs',
    summary: 'Paste a posting on the Jobs page with “Add a job I found” and Next Chapter checks the fit and helps you apply.',
    keywords: ['add job', 'my own job', 'found a job', 'paste', 'posting', 'newspaper', 'manual', 'link', 'add a job i found'],
    body: `Found a job in the paper, on a store window or online? Add it, and Next Chapter will check the fit and help you apply.

1. Open [Jobs](#/jobs) and tap **➕ Add a job I found**.
2. Paste the link to the posting (optional).
3. Paste the **whole posting**: title, duties, requirements and how to apply.
4. Tap **Add and check the fit**.

The job opens with its fit score. Jobs you add yourself skip the keyword screen, since you picked them. Tap **✍️ Help me apply** to get a tailored resume, cover letter and email.

If it says the job is already in your list, search for it at the top of the Jobs page.`,
  },
  {
    slug: 'not-seeing-jobs',
    title: 'Why am I not seeing any jobs?',
    category: 'Finding jobs',
    summary: 'Usually the search hasn’t run yet, your resume or town is missing, your filters are narrow, or the app is paused.',
    keywords: ['no jobs', 'not seeing jobs', 'few jobs', 'empty', 'all caught up', 'nothing new', 'missing jobs', 'more jobs', 'search not working'],
    body: `If [Today](#/) says you’re all caught up, or very few jobs show up, check these:

- **The search hasn’t run yet.** It runs once a day at your chosen hour. Tap **🔎 Look for new jobs now** on Today to run it now.
- **Your resume or town is missing.** The search needs your career record and where you live. Add your resume on [My Writing](#/writing) and your town in [Settings](#/settings).
- **Your bar is high.** Lower **Only ask me about jobs that fit at least** in Settings. 60 is recommended.
- **Your filters are narrow.** Check **Kinds of jobs**, **Never show jobs that mention**, how far you’ll drive, lowest pay, and the work-from-home and in-person boxes.
- **Look under “Screened out.”** In [Jobs](#/jobs), the **Screened out** tab shows jobs below your bar. Tap **Actually, I like this one** on any good ones.
- **The daily search is off.** In Settings, under **Autopilot**, make sure **Look for new jobs every morning** is ticked.
- **The app is paused** because of credit or a spending limit. Look for a banner at the top of the app. See [“The app paused”](#/help/app-paused).
- **The daily fit-check limit.** To keep costs predictable, it checks up to 25 new jobs a day unless you change it. Raise **Most fit checks per day** in Settings under **Where to look**, then **Specific employers and job feeds (advanced)**.

After changing anything in Settings, tap **💾 Save settings**.`,
  },

  // ------------------------------------------------------------------ Applying
  {
    slug: 'how-drafts-are-written',
    title: 'How your applications are written (real facts only)',
    category: 'Applying',
    summary: 'For jobs you 👍, Next Chapter writes a tailored resume, cover letter, email and form answers in your voice, using only facts from your career record.',
    keywords: ['draft', 'application', 'write', 'resume', 'cover letter', 'tailored', 'facts', 'honest', 'make up', 'invent', 'lie', 'before you send', 'help me apply', 'auto draft', 'voice'],
    body: `When you give a job a 👍, Next Chapter writes a **tailored resume, cover letter, email and answers to likely application questions** for it, usually within the hour. Before writing, it checks that the posting is still open. You can also tap **✍️ Help me apply** on any job to start right away.

Applications are only written for jobs you like. Tapping Help me apply counts as a 👍.

## Only real facts
Drafts may only use facts from **your career record** on [My Writing](#/writing) and your setup answers. Next Chapter is told never to invent or inflate employers, dates, titles, degrees, licenses, numbers or skills.

Each draft comes with a **Before you send** note listing anything you should double-check.

If your career record has a mistake, fix it on My Writing (tap **✏️ Edit**). Every future draft uses the corrected version.

## In your voice
It learns how you write from your letters and emails, and from every change you make to its drafts. Your feedback becomes lessons on [What I’ve learned](#/learning).

## Where to find drafts
Ready drafts appear on [Today](#/) under **Applications ready for you**, and in [Applications](#/applications) under **Getting ready**.

Don’t want drafts written automatically? In [Settings](#/settings), under **Autopilot**, untick **When I give a job 👍, write the resume and cover letter for me right away**.`,
  },
  {
    slug: 'edit-drafts',
    title: 'Editing a draft or asking for changes',
    category: 'Applying',
    summary: 'Edit any draft yourself, or type what you want changed in plain words and tap Rewrite it.',
    keywords: ['edit', 'change', 'rewrite', 'redraft', 'fix', 'shorter', 'warmer', 'formal', 'want changes', 'my own words', 'tone'],
    body: `Every draft is yours to change. Open it from [Applications](#/applications), or tap **Review →** on [Today](#/).

## Edit it yourself
1. Pick a tab: **Resume**, **Cover letter**, **Email** or **Application questions**.
2. Tap **✏️ Edit**, make your changes, then tap **Save changes**.

Simple formatting: “# ” for your name, “## ” for a section, “- ” for a bullet, and two stars on each side for **bold**. Your edits teach the app how you like things.

## Ask for changes in plain words
1. Scroll to **Want changes?** at the bottom.
2. Type what you’d like, for example “Mention my volunteer work at the food bank” or “Make the letter shorter and warmer.”
3. Tap **Rewrite it**. It rewrites the resume, cover letter and email in about a minute.

Requests like “make it warmer” also apply to future drafts, not just this one.

## Tell it how it did
Use the **How’s this resume?** box (👍 Did well or 👎 Needs work) under each draft. What you say there changes every future application.`,
  },
  {
    slug: 'send-by-email',
    title: 'Sending an application by email',
    category: 'Applying',
    summary: 'For employers that take applications by email, Next Chapter sends yours from your Gmail with your resume and cover letter attached once you tap Send.',
    keywords: ['send', 'email application', 'gmail', 'send my application', 'attach', 'attachment', 'apply by email', 'autopilot', 'send to'],
    body: `Some employers take applications by email. For those, Next Chapter sends your application from your own Gmail.

1. Open the application from [Today](#/) or [Applications](#/applications). The top card says **Ready to send ✉️**.
2. Look over the **Resume**, **Cover letter** and **Email** tabs.
3. Check the **Send to** address. Fix it if needed and tap **Save**.
4. Tap **Send my application**.

It goes from your Gmail with your resume and cover letter attached (as PDF files unless your account is set to Word). It appears in your Gmail **Sent** folder like any email you write.

## Good to know
- Nothing is sent until you tap Send, unless you turn on **Send email applications without asking me first** in [Settings](#/settings) under **Autopilot**. We recommend leaving that off until you trust the drafts.
- During your first week it goes to your own inbox instead. See [Your first week: test mode](#/help/test-week).
- Gmail must be connected. See [Gmail disconnected](#/help/gmail-disconnected).
- Rather apply on their website? Tap **I’ll apply on their website instead**.

After it’s sent, the app tracks the application and follows up. See [Follow-ups](#/help/follow-ups).`,
  },
  {
    slug: 'apply-on-websites',
    title: 'Applying on a company’s website',
    category: 'Applying',
    summary: 'Next Chapter prepares your files and answers; you upload them, press Submit yourself, then tap “I submitted it”.',
    keywords: ['website', 'online application', 'apply online', 'form', 'linkedin', 'indeed', 'workday', 'submit', 'i submitted it', 'upload', 'in person', 'drop off'],
    body: `Most companies use an application form on their website. Next Chapter does everything except the final click.

1. Open the application. The top card says **Ready to apply on their website 💻**.
2. Download **Resume (Word)** and **Cover letter (Word)**, or open the Resume or Cover letter tab and use **🖨️ Print / save as PDF**.
3. Tap **Open their application page ↗** and upload the files.
4. If the form asks questions, copy answers from the **Application questions** tab (tap **📋 Copy**).
5. Press the website’s own **Submit** button.
6. Come back and tap **✅ I submitted it**, so the app can track the application and follow up.

## Let the browser helper fill in the form
On a computer with Chrome, the **browser helper** can fill in the form for you: your details, your files and your answers. You still check it and press Submit. See [Installing and using the browser helper](#/help/browser-helper).

## Why it doesn’t submit for you
Sites like LinkedIn, Indeed and Workday forbid automated submissions, often use CAPTCHAs, and ask you to confirm the answers are true. Pressing Submit yourself keeps your accounts safe.

Applying in person? The card says **Ready to drop off**. Print your files, bring them in, and tap **✅ I submitted it** afterward.`,
  },
  {
    slug: 'browser-helper',
    title: 'Installing and using the browser helper',
    category: 'Applying',
    summary: 'A Chrome extension that fills in company application forms for you. It never presses Submit. Install it in about 2 minutes.',
    keywords: ['browser helper', 'extension', 'chrome', 'install', 'fill form', 'autofill', 'helper key', 'browser helper key', 'green n', 'load unpacked', 'developer mode', 'fill this application'],
    body: `The Next Chapter browser helper is a Chrome extension that fills in company application forms for you. **It never presses Submit.** You check the form and submit it yourself.

## Install it (about 2 minutes)
For now the helper is installed by hand from its folder. If you don’t have the folder, email support@nextchapterjobhunter.com.
1. In Chrome, go to **chrome://extensions**.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the **extension** folder.
4. A setup page opens. Paste the **address** of your Next Chapter app, and your **Browser helper key** from [Settings](#/settings) (**Browser helper key**, then **Copy**). Only the account owner can create a key.
5. Click **Test connection**. When Chrome asks to let the helper talk to that address, click **Allow**. It should say “Connected! Hello, …”.
6. Click the puzzle piece next to the address bar and **pin** “Next Chapter helper”, so the green **N** button is always visible.

## Use it
1. Open the job’s application form. Press the site’s Apply button first if needed.
2. Click the green **N** button and check the right job is chosen.
3. Press **Fill this application** and read the short report.
4. **Green** boxes were filled in for you. **Yellow** boxes are yours to do.
5. Check everything, then press the website’s **Submit** button.

On forms with several pages, click the helper again on each page.

## What it leaves for you, on purpose
Passwords, payment or bank details, Social Security numbers, date of birth, demographic questions, salary, start date, visa and work-authorization questions (unless you already approved an answer in Next Chapter), “I certify” boxes, and anything already filled in.

## Privacy
It only runs when you click it, only sees the tab you’re on, and only talks to your own Next Chapter address. Your key stays on your computer. To disconnect, open the helper’s **Settings** and click **Disconnect**, or remove it in chrome://extensions.`,
  },
  {
    slug: 'pdf-and-word',
    title: 'PDF and Word files',
    category: 'Applying',
    summary: 'Download your resume and cover letter as Word files, save them as PDFs, and upload your own Word, PDF or text files.',
    keywords: ['pdf', 'word', 'docx', 'doc', 'download', 'print', 'save as pdf', 'file', 'format', 'attachment'],
    body: `Next Chapter makes your resume and cover letter as **PDF** and **Word** files.

- **Emailed applications** attach your files automatically, as PDFs unless your account is set to Word.
- **Download a Word file**: on an application’s **Resume** or **Cover letter** tab, tap **⬇️ Download Word file**. Website applications also show **Resume (Word)** and **Cover letter (Word)** buttons.
- **Save as a PDF**: tap **🖨️ Print / save as PDF**, then choose **Save as PDF** as the printer.

The file names include your name, so employers can find them easily.

## Adding your own files
You can upload Word (.docx), PDF and text files on [My Writing](#/writing). Old .doc files need to be saved as .docx first.

Want a different look? Download the Word file and adjust it in Word. Changes made in Word aren’t copied back into Next Chapter, so make wording changes in the app too if you want them in future drafts.`,
  },

  // ------------------------------------------------------------------ After you apply
  {
    slug: 'follow-ups',
    title: 'Follow-ups',
    category: 'After you apply',
    summary: 'If an employer goes quiet, Next Chapter drafts a polite follow-up after 7 days and again 10 days later. They wait for your OK unless you turn on autopilot.',
    keywords: ['follow up', 'follow-up', 'no answer', 'no response', 'silence', 'check in', 'waiting', 'closed', 'never heard back', 'autopilot', 'remind'],
    body: `After you apply, Next Chapter keeps watch.

## When it follows up
- After **7 days** of silence, it drafts a short, polite follow-up.
- After **10 more days**, a second follow-up.
- After **21 more days** with no answer, the application is closed.

Change these under **Follow up after** and **Then close it after** in [Settings](#/settings), under **Autopilot**. Follow-ups go as a reply in the same email thread as your application when there is one.

After an interview, it also drafts a friendly check-in if things go quiet.

## You approve them
Follow-ups wait on [Today](#/) under **Messages waiting for your OK**. You can tap:
- **✉️ Looks good — send it**
- **✏️ Edit**
- **I did this myself**, if you called or messaged them yourself
- **Don’t send**

To send them automatically, tick **Send follow-up emails without asking me first** in Settings. They then go out on weekdays during business hours.

## No email address?
For website applications there may be no address to write to. The draft then works as a script for a phone call or LinkedIn message. Add an address to send it, or tap **I did this myself**.`,
  },
  {
    slug: 'employer-replies',
    title: 'When an employer writes back',
    category: 'After you apply',
    summary: 'Next Chapter notices employer emails in your inbox, files them with the right application, and drafts a reply that always waits for your OK.',
    keywords: ['reply', 'replies', 'employer email', 'response', 'heard back', 'rejection', 'not selected', 'interview request', 'inbox', 'news from employers', 'answer'],
    body: `Next Chapter checks your inbox for replies from employers about once an hour, including automated emails from applicant-tracking systems, and files each with the right application.

## What it does
- Sorts the reply: interview request, offer, not moving forward, they need something from you, or just “application received”.
- Moves the application along (for example to **Interviewing** or **Not selected**) and cancels follow-ups that no longer make sense.
- Shows it on [Today](#/) under **News from employers**, and in the morning email.
- When a person needs an answer, it **drafts a reply** in your voice. For interview requests, it can offer times you’re free on your calendar.

## Replies always wait for you
A reply to a real person is never sent on its own. No setting changes this. Find it on Today under **Messages waiting for your OK**, edit it if needed, and tap **✉️ Looks good — send it**.

## Reading their email
Open the application, go to the **History** tab, and tap **Read their email**.

If a reply was missed or filed in the wrong place, change the status yourself with the menu at the top of the application, and add a note on the History tab.`,
  },
  {
    slug: 'interviews',
    title: 'Interviews: prep sheets, your calendar and thank-you notes',
    category: 'After you apply',
    summary: 'Tell Next Chapter about an interview and it researches the company, writes a prep sheet, adds it to your calendar, and drafts a thank-you note afterward.',
    keywords: ['interview', 'prep', 'prepare', 'prep sheet', 'calendar', 'schedule', 'thank you', 'thank-you note', 'questions', 'when am i free', 'phone screen'],
    body: `Got an interview? Next Chapter helps you get ready.

## Add the interview
1. Open the application in [Applications](#/applications).
2. Tap **➕ I have an interview**.
3. Enter when it is (leave it blank if it isn’t set yet), what kind it is, and who you’ll talk to.
4. Tap **Save and prepare me**. This takes 1 to 2 minutes.

## Your prep sheet
It researches the company and writes a prep sheet: what they sell, recent news, what to expect, likely questions with answer outlines from your real experience, stories to have ready, and good questions to ask them. Tap **📄 Open my prep sheet** to read it, or **🖨️ Print**. **Refresh prep** writes a fresh one.

## Your calendar
If your Google Calendar is connected, the interview is added to it. **When am I free?** suggests open times.

## The thank-you note
After the interview, tap **✅ I had it — how did it go?**, add a few notes and the interviewer’s email, then tap **Write my thank-you note**. The note waits for your OK at the top of the application page.

Want to rehearse first? See [Practice role-plays](#/help/practice).`,
  },
  {
    slug: 'practice',
    title: 'Practice role-plays',
    category: 'After you apply',
    summary: 'Rehearse a cold call, discovery call, objections, “sell me this” or a hiring-manager interview with a pretend buyer, then get a scorecard.',
    keywords: ['practice', 'role play', 'role-play', 'rehearse', 'mock interview', 'cold call', 'sell me this pen', 'objections', 'scorecard', 'hiring manager', 'stuck'],
    body: `On [Practice](#/practice) you can rehearse with a pretend buyer or interviewer. Nothing you say there is shared.

## Pick a scenario
- 📞 **Cold call**: earn a busy buyer’s interest.
- 🔍 **Discovery call**: ask good questions and really listen.
- 🛡️ **Handling objections**: “too expensive”, “not now”.
- 🖊️ **“Sell me this”**: the classic interview test.
- 🤝 **Hiring manager interview**: tell your story with confidence.

Tap **Start ▶**. Type, or talk, like you would on a real call. They stay in character. If you freeze, tap **Help, I’m stuck** for a quick tip.

## Your scorecard
After you’ve said at least two things, tap **🏁 Finish & get my scorecard**. You’ll get friendly feedback: what went well, what to work on, better lines to try, and what to practice next.

Each practice session uses a little AI, like other features.`,
  },
  {
    slug: 'offers',
    title: 'Got an offer? Reviewing and negotiating',
    category: 'After you apply',
    summary: 'Paste the offer and Next Chapter explains it in plain words, compares it to typical pay, and drafts a polite negotiation email for your OK.',
    keywords: ['offer', 'negotiate', 'negotiation', 'salary', 'pay', 'counter offer', 'benefits', 'commission', 'ote', 'accept', 'hired'],
    body: `Congratulations! Next Chapter can help you understand an offer and ask for more.

1. Open the application in [Applications](#/applications).
2. Under **Got an offer? 🎉**, paste the offer letter, or type what they told you: base pay, commission or bonus, benefits, start date.
3. Tap **Review my offer**. It takes about a minute.

You’ll get the offer in plain words, typical pay for the role, how yours compares, questions to ask before you say yes, and what you might ask for. Pay comparisons are estimates, so treat them as a starting point.

It also drafts a polite negotiation email, which **waits for your OK** at the top of the application page. Only send it if you want to negotiate.

When you accept, set the application’s status to **Hired 🎉** with the menu at the top of the page.`,
  },

  // ------------------------------------------------------------------ Your story
  {
    slug: 'career-story-linkedin',
    title: 'Your career-change story and LinkedIn',
    category: 'Your story',
    summary: 'My Story writes your 30-second introduction, your “why this move?” answer, and a refreshed LinkedIn headline, About section and job bullets.',
    keywords: ['story', 'my story', 'linkedin', 'career change', 'pitch', 'tell me about yourself', 'headline', 'about section', 'why this move', 'certifications', 'elevator pitch'],
    body: `Moving into a new kind of work? [My Story](#/story) helps you tell one clear, honest story everywhere: in applications, interviews and on LinkedIn.

## Write your story
1. Make sure your resume is on [My Writing](#/writing). The story uses only your real experience.
2. Open **My story & LinkedIn**. On a phone, tap **More** first.
3. Tap **✨ Write my story**. It takes about a minute.

You get a 30-second introduction, an answer to “why this move?”, the skills you’re bringing with proof, a resume summary, a new LinkedIn headline, About section and job bullets, certifications that could help, what a hiring manager might worry about and how to answer, and answers to common interview questions.

## Make it yours
Tap **Edit** on anything that doesn’t sound like you. **🔄 Rewrite it** writes a fresh version, but it replaces everything on the page, including your changes.

## Update your LinkedIn
1. Open [linkedin.com/in/me](https://www.linkedin.com/in/me/).
2. Tap the ✏️ pencil to **Edit intro** (that’s your headline).
3. Then edit **About**, then each job under **Experience**.

Use the **Copy** buttons on My Story and paste each piece in.`,
  },

  // ------------------------------------------------------------------ Your account
  {
    slug: 'credit-and-pricing',
    title: 'Credit and pricing (with an example)',
    category: 'Your account',
    summary: 'No subscription: you prepay credit and are charged 2× what the AI costs us. Most active days come to about $1–2.',
    keywords: ['price', 'pricing', 'cost', 'how much', 'credit', 'billing', 'pay', 'charge', 'subscription', 'add credit', 'free account', 'refund', 'money', 'fee'],
    body: `Next Chapter has **no subscription**. You pay only for the AI work it does, from prepaid credit.

## How it works
- Every time it reads a job, checks a fit, or writes a letter or email, it uses a little AI. Most tasks cost a few cents.
- You’re charged **2× what that AI costs us**. That’s how we keep the lights on.
- Credit stays in your account until you use it. If it runs out, the app simply pauses. Your card is never charged automatically.

## A worked example
Say a fit check costs us 2¢ of AI and a full application (resume, cover letter and email) costs us 15¢. On a busy day the app checks 20 jobs and writes 2 applications:
- AI cost: 20 × 2¢ + 2 × 15¢ = 70¢
- You pay 2×: **$1.40**

Most active days come to about $1–2, and quiet days cost much less. These numbers are only an example. Your real costs are on the billing page.

## Adding credit
1. Open [Credit & billing](#/billing). On a phone, tap **More** first.
2. Under **Add credit**, pick an amount: $10, $25, $50 or $100.
3. Pay securely by card through Stripe. Your credit appears within a few seconds.

The billing page also shows what you spent this month and **What the AI did** over the last 30 days.

## Good to know
- Some accounts are “on the house”: we cover the AI cost and you don’t need credit.
- You can ask for a refund of **unused** credit by emailing support@nextchapterjobhunter.com.
- The 💬 Help assistant is free and works even with $0 credit.
- Want a cap? See [Setting a monthly spending limit](#/help/monthly-limit).`,
  },
  {
    slug: 'monthly-limit',
    title: 'Setting a monthly spending limit',
    category: 'Your account',
    summary: 'Set the most you want to spend in a month on the billing page. When you reach it, AI work pauses until the 1st.',
    keywords: ['limit', 'spending limit', 'monthly limit', 'cap', 'budget', 'maximum', 'spend', 'no limit', 'reset'],
    body: `Want to be sure you never spend more than a set amount? Set a monthly spending limit.

1. Open [Credit & billing](#/billing).
2. Under **Monthly spending limit**, enter the most you want to spend in a month, in dollars (for example 20).
3. Tap **Save limit**.

When you reach it, Next Chapter **pauses its AI work** (searching, fit checks, drafts and reading replies) until the 1st of the next month. You’re never charged more than your limit. A meter on the billing page shows how close you are.

- To raise it, enter a bigger number and tap **Save limit**.
- To remove it, tap **No limit**.

Only the account owner can change the limit. Helpers can’t.`,
  },
  {
    slug: 'referrals',
    title: 'Referrals: earn when friends use Next Chapter',
    category: 'Your account',
    summary: 'Share your link from Refer & earn. You get 50% of the profit from what people you refer use, paid monthly to your bank after a 30-day hold, once you have $25.',
    keywords: ['refer', 'referral', 'invite friends', 'share link', 'earn', 'earnings', 'payout', 'get paid', 'stripe', 'bank', 'commission', 'refer and earn'],
    body: `Know someone else looking for work? Share your link and earn money when they use Next Chapter.

## Your link
Open [Refer & earn](#/referrals) (on a phone, tap **More** first) and tap **📋 Copy link**. Paste it into an email or text message. When someone signs up with your link, they appear under **People you invited**.

## What you earn
You earn **half of the profit** from what the people you refer use. For example: if a task uses 10¢ of AI, they pay 20¢, and you earn 5¢. It never costs them anything extra. You only earn while they’re paying for their own use.

## Getting paid
1. Tap **🏦 Set up payouts**. Our payment partner, Stripe, asks a few questions to confirm who you are and for your bank account. We never see your bank details.
2. Earnings wait for **30 days** (in case of refunds), then become **Available**.
3. Once a month, if your available balance is at least **$25**, it’s sent to your bank.

If a payout doesn’t go through, it’s tried again the next month.`,
  },
  {
    slug: 'helpers',
    title: 'Inviting a family helper',
    category: 'Your account',
    summary: 'Invite a son, daughter or friend from Settings. They sign in with “Sign in as a helper” and can see and help with your search. Their Gmail is never touched.',
    keywords: ['helper', 'family', 'invite', 'son', 'daughter', 'friend', 'share account', 'sign in as a helper', 'help me', 'remove helper', 'switch'],
    body: `A son, daughter or friend can help with your job search: look at your matches, go over drafts, and lend a hand. Their own email is never touched.

## Invite a helper
1. Open [Settings](#/settings).
2. Enter your helper’s Google email address and invite them.
3. They get an invitation email. If it doesn’t arrive, send them the app’s address yourself.

Only you, the account owner, can invite or remove helpers.

## How a helper signs in
1. They open Next Chapter.
2. They tap **Sign in as a helper**, not the main Sign in with Google button.
3. They sign in with the Google account you invited.

Helper sign-in asks Google only for their name and email, never their Gmail. Applications are always sent from your Gmail.

Once in, they see a banner: “You’re helping …”. If they also run their own job search, a menu at the top of the side menu switches between **My job search** and **Helping …**.

## What helpers can’t do
Helpers can’t invite other helpers, change your spending limit, set up text messages, or create a browser helper key. Helpers also get a weekly update and an email if something needs attention.

## Removing a helper
Remove them in Settings. They lose access right away.`,
  },
  {
    slug: 'morning-email-and-texts',
    title: 'Your morning email, texts and weekly summary',
    category: 'Your account',
    summary: 'Each morning you get an email with jobs to vote on and what the app did. Optional daily texts and a Monday weekly summary too.',
    keywords: ['morning email', 'daily email', 'digest', 'summary', 'text', 'texts', 'sms', 'text messages', 'weekly', 'notifications', 'reply to email', 'one-tap'],
    body: `## Your morning email
Each morning, after the daily search, Next Chapter emails you, from your Gmail to your Gmail, with:
- **What you need to do**: new jobs to vote on with one-tap 👍/👎 buttons, drafts to look over, and messages to OK.
- **What it did for you**: listings searched, jobs recommended and skipped, applications written and sent, follow-ups, replies noticed.
- **What it learned from you lately.**

The subject starts with “Your job search today”. **Reply to it** to give feedback, like “Fewer jobs in Portland, please”, and it learns from your reply.

The 👍/👎 buttons open a small page to confirm your vote. The links expire after 14 days.

Turn it on or off in [Settings](#/settings), under **Autopilot**: **Email me every morning**. Tap **👀 Preview today’s email** or **✉️ Send it to me now** to see it.

## Text messages (optional)
You can also get one short text a day when there’s something to do. The account owner can set this up with a mobile number in Settings, where available. Reply STOP to a text to opt out.

## Weekly summary
Every Monday you get a short “Your week in the job search” email. Helpers you’ve invited get a weekly update too. Your numbers are also on [Progress](#/insights).`,
  },
  {
    slug: 'install-on-phone',
    title: 'Putting Next Chapter on your phone’s home screen',
    category: 'Your account',
    summary: 'Next Chapter works in your phone’s browser. Add it to your home screen so it opens like an app.',
    keywords: ['phone', 'iphone', 'android', 'app', 'install', 'home screen', 'add to home screen', 'mobile', 'ipad', 'download app'],
    body: `Next Chapter works in your phone’s web browser. You can add it to your home screen so it opens like an app. There’s nothing to download from an app store.

## iPhone or iPad
1. Open Next Chapter in **Safari**.
2. Tap the **Share** button (a square with an arrow). Don’t see it? Tap **•••** first.
3. Tap **Add to Home Screen**, then **Add**.

## Android
1. Open Next Chapter in **Chrome**.
2. Tap **Add to home screen** when the app offers it on [Today](#/), or open Chrome’s **⋮** menu and choose **Add to Home screen** (or **Install app**).

## Using it on a phone
The buttons along the bottom are **Today**, **Jobs**, **Applications**, **Practice** and **More** (☰). Everything else, like My writing, Settings and Credit & billing, is under **More**.`,
  },
  {
    slug: 'privacy-gmail',
    title: 'Privacy and what Gmail access means',
    category: 'Your account',
    summary: 'Next Chapter can send and read your email, but can’t delete or change anything. Every email waits for your OK by default, and your data is never sold.',
    keywords: ['privacy', 'safe', 'security', 'gmail access', 'read my email', 'permission', 'data', 'sell', 'encrypted', 'delete my email', 'disconnect', 'revoke'],
    body: `## What Gmail access means
Next Chapter asks Google for two Gmail permissions:
- **Send**, so the applications, follow-ups and replies you approve go out from your own address.
- **Read**, so it can notice employer replies, find resumes you’ve emailed before, and learn how you write from emails you’ve sent.

It **cannot delete, archive or change** anything in your mailbox. By default, every email waits for your OK before it’s sent.

It also asks to add events to your Google Calendar and check when you’re free, for interviews.

## How your information is protected
- Your Gmail connection is stored encrypted.
- Job postings and employer emails are treated as information only. Instructions hidden inside them are ignored.
- Your data is never sold or used for advertising.
- Helpers you invite can see your job search.

## Turning access off
- In [Settings](#/settings), under **Gmail**, tap **Disconnect**.
- Or remove Next Chapter at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

Once you do, the app can no longer send or read your email. Read the full [Privacy Policy](https://nextchapterjobhunter.com/privacy.html).`,
  },
  {
    slug: 'delete-account-get-help',
    title: 'Getting help, refunds and deleting your account',
    category: 'Your account',
    summary: 'Ask the 💬 Help assistant or email support@nextchapterjobhunter.com. There’s nothing to cancel; to delete your account, email us from your sign-in address.',
    keywords: ['help', 'support', 'contact', 'email support', 'delete account', 'close account', 'cancel', 'stop', 'refund', 'remove my data', 'bug', 'problem'],
    body: `## Getting help
- Ask our assistant: tap **💬 Help** in the corner of the app while you’re signed in. It’s free.
- Email us at **support@nextchapterjobhunter.com**. Tell us what you were trying to do and what you saw. Please never send passwords or card numbers.

## Stopping
There’s no subscription, so there’s nothing to cancel. Just stop using it whenever you like. To pause the daily work, untick **Look for new jobs every morning** and **Email me every morning** in [Settings](#/settings), then tap **💾 Save settings**.

## Refunds
You can ask for a refund of **unused** credit by emailing support. Credit already used for AI work can’t be refunded.

## Deleting your account
Email support@nextchapterjobhunter.com **from the address you sign in with** and ask us to delete your account. We delete your account data, including your Gmail connection, within 30 days. Some billing records may be kept where the law requires.

You can delete documents on [My Writing](#/writing) and lessons on [What I’ve learned](#/learning) yourself at any time. You can also remove Next Chapter’s access to your Google account at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).`,
  },

  // ------------------------------------------------------------------ Troubleshooting
  {
    slug: 'gmail-disconnected',
    title: 'Gmail disconnected',
    category: 'Troubleshooting',
    summary: 'If Gmail is disconnected, the app can’t send or notice replies. Reconnect it in Settings with Connect Gmail, or sign out and sign in with Google again.',
    keywords: ['gmail disconnected', 'disconnected', 'reconnect', 'connect gmail', 'gmail not connected', 'can’t send', 'not sending', 'invalid grant', 'expired', 'gmail error', 'gmail problem'],
    body: `If you see “Gmail is disconnected” or “Connect Gmail”, Next Chapter can’t send applications or notice employer replies until you reconnect.

## Fix it
1. Open [Settings](#/settings) and find **Gmail**.
2. Tap **Connect Gmail** and sign in with **your own** Google account, the one applications are sent from.
3. On Google’s screen, leave all the boxes ticked and tap **Continue**. If you see “Google hasn’t verified this app”, tap **Advanced**, then **Go to Next Chapter**.

You’ll see “Gmail connected ✅”. Signing out and signing in with Google again also works.

## Why it happens
- A box was unticked on Google’s permission screen.
- Next Chapter’s access was removed in your Google account, or your Google password changed.
- Google expired the connection.

Helpers can’t connect Gmail for you. It must be the job seeker’s own account.

Anything that failed to send while Gmail was disconnected shows on [Today](#/) under **Messages waiting for your OK**. Send it again once you’re reconnected.`,
  },
  {
    slug: 'out-of-credit',
    title: 'Out of credit',
    category: 'Troubleshooting',
    summary: 'At $0 credit, AI work pauses. Nothing is lost and your card isn’t charged. Add credit on the billing page and it picks back up.',
    keywords: ['out of credit', 'no credit', 'zero balance', '$0', 'balance', 'add credit', 'paused', 'stopped', 'top up', 'payment'],
    body: `When your credit reaches $0, Next Chapter pauses its AI work: searching, fit checks, drafts and reading replies. Nothing is lost, and your card is never charged automatically.

## Fix it
1. Open [Credit & billing](#/billing).
2. Under **Add credit**, pick an amount and pay by card.
3. Your credit appears within a few seconds. The app picks back up on its next hourly run, or tap **🔎 Look for new jobs now** on [Today](#/).

## What still works at $0
- Your saved jobs, drafts and applications.
- Sending messages you’ve approved.
- This help center and the 💬 Help assistant, which are free.

On a computer, your balance shows at the bottom of the side menu. To avoid surprises, also see [Setting a monthly spending limit](#/help/monthly-limit).

Accounts that are “on the house” don’t need credit.`,
  },
  {
    slug: 'app-paused',
    title: '“The app paused” — what it means',
    category: 'Troubleshooting',
    summary: 'A banner says the app paused or nothing has happened lately. Usually it’s credit, a spending limit, or Gmail. Here’s what each message means.',
    keywords: ['paused', 'app paused', 'stopped working', 'not working', 'nothing happening', 'stalled', 'no job search has run', 'spending limit reached', 'banner', 'warning', 'resting'],
    body: `Sometimes a banner at the top says the app is paused, or that nothing has happened lately. Here’s what each message means:

- **“Out of credit”**: add credit in [Credit & billing](#/billing). See [Out of credit](#/help/out-of-credit).
- **“You’ve reached the monthly spending limit you set”**: raise or remove your limit in Credit & billing, or wait until the 1st.
- **“You’ve reached this month’s AI limit”** (accounts that are on the house): it resets on the 1st.
- **“The app has reached its spending limit for this month”**: this is a limit on our side, not yours. It will pick back up soon. If it lasts more than a day, email support@nextchapterjobhunter.com.
- **“No job search has run since …”**: usually Gmail is disconnected, credit ran out, or the daily search is turned off. Check the other banners and [Settings](#/settings), under **Autopilot**.
- **“Gmail is disconnected”**: see [Gmail disconnected](#/help/gmail-disconnected).

Nothing is lost while the app is paused. Once it’s fixed, the next hourly run picks up where it left off, or tap **🔎 Look for new jobs now** on [Today](#/).`,
  },
  {
    slug: 'emails-to-my-own-inbox',
    title: 'Why are emails going to my own inbox?',
    category: 'Troubleshooting',
    summary: 'During your first 7 days (test week), applications and messages go to you instead of employers, marked [TEST — would go to …]. Nothing reached the employer.',
    keywords: ['own inbox', 'my inbox', 'emails to me', 'sent to myself', 'test', '[test]', 'would go to', 'employer didn’t get', 'not delivered', 'test mode', 'test week'],
    body: `During your first 7 days, Next Chapter is in **test mode**. Anything it sends, like applications, follow-ups and thank-you notes, goes to **your own inbox** instead of the employer. The subject starts with **[TEST — would go to …]**, so you can see exactly what the employer would get.

This is on purpose, so you can check the drafts before anything real goes out. Nothing has reached the employer.

## What to do
- Read the test emails and attachments. If something’s off, fix your career record on [My Writing](#/writing), or ask for changes on the draft.
- Test mode ends by itself after 7 days. The yellow **🧪 Test week** banner shows the date. To end it early, use the banner’s link to [Settings](#/settings).
- Applications “sent” during test week stay **Ready for you**. Open them in [Applications](#/applications) and send them again once test mode is over.

More about it: [Your first week: test mode](#/help/test-week).`,
  },
  {
    slug: 'no-morning-email',
    title: 'I didn’t get the morning email',
    category: 'Troubleshooting',
    summary: 'Check that it’s turned on in Settings, that Gmail is connected, the hour you picked, and your Gmail folders. You can also send it to yourself now.',
    keywords: ['no morning email', 'didn’t get email', 'missing email', 'daily email', 'digest', 'not receiving', 'spam', 'where is my email', 'no email'],
    body: `The morning email goes out once a day, after the daily search, at the hour set in Settings. If it didn’t come:

1. **Search your Gmail.** It’s sent from your Gmail to yourself with the subject “Your job search today”. Check your inbox, **Sent**, **Promotions**, **Updates** and **Spam**.
2. **Is it turned on?** In [Settings](#/settings), under **Autopilot**, **Email me every morning** must be ticked. Tap **💾 Save settings** after changing it.
3. **Is Gmail connected?** The email is sent through your Gmail. See [Gmail disconnected](#/help/gmail-disconnected).
4. **Check the hour.** It goes out at or after the hour in “Look for new jobs every morning at …”. That’s 24-hour time: 7 means 7 am, 19 means 7 pm.
5. **Is the app paused?** Look for a banner at the top of the app. See [“The app paused”](#/help/app-paused).
6. **Try it now.** In Settings, tap **✉️ Send it to me now**, or **👀 Preview today’s email**.

Still nothing? Email support@nextchapterjobhunter.com.`,
  },
];

// ---------------------------------------------------------------- lookup + search

export function getArticle(slug: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((a) => a.slug === slug);
}

const STOP = new Set(
  ('a an and are as at be been but by can could do does did doing for from get got had has have how i i’m im if in into is it its it’s me my no not of on or our please should so than that the their them then there these they this to too up us was we were what when where which who why will with would you your yours anyone someone something ' +
    'about any just really very want need next chapter app').split(' '),
);

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/👍/g, ' thumbs up like ')
    .replace(/👎/g, ' thumbs down dislike ')
    .replace(/[’‘]/g, "'")
    .replace(/e-mail/g, 'email')
    .replace(/sign-in|signin|log-in|login/g, 'sign in')
    .replace(/[^a-z0-9$@.' ]+/g, ' ')
    .replace(/'s\b/g, '')
    .replace(/[.']/g, ' ');
}

function stem(w: string): string {
  let s = w;
  for (const suf of ['ing', 'ed', 'es', 's']) {
    if (s.endsWith(suf) && s.length - suf.length >= 3) {
      s = s.slice(0, -suf.length);
      break;
    }
  }
  if (s.length > 3 && s.endsWith('e')) s = s.slice(0, -1);
  return s;
}

/** Lowercased, stemmed words, keeping stop words (for matching whole keyword phrases). */
function rawTerms(s: string): string[] {
  return normalize(s).split(/\s+/).filter((w) => w.length > 1 || w === 'i').map(stem);
}

/** Lowercased, stemmed words without stop words. */
export function terms(s: string): string[] {
  return normalize(s).split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)).map(stem);
}

interface Indexed { a: HelpArticle; title: Set<string>; keywords: Set<string>; kwPhrases: string[]; kwRaw: string[][]; summary: Set<string>; body: Map<string, number>; all: Set<string> }
let INDEX: { docs: Indexed[]; df: Map<string, number> } | null = null;

function index() {
  if (INDEX) return INDEX;
  const docs = HELP_ARTICLES.map((a): Indexed => {
    const body = new Map<string, number>();
    for (const t of terms(a.body)) body.set(t, (body.get(t) ?? 0) + 1);
    const title = new Set(terms(a.title));
    const keywords = new Set(a.keywords.flatMap(terms));
    const summary = new Set(terms(a.summary));
    return { a, title, keywords, summary, body, kwPhrases: a.keywords.map((k) => terms(k).join(' ')).filter(Boolean), kwRaw: a.keywords.map(rawTerms).filter((k) => k.length > 1), all: new Set([...title, ...keywords, ...summary, ...body.keys()]) };
  });
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.all) df.set(t, (df.get(t) ?? 0) + 1);
  INDEX = { docs, df };
  return INDEX;
}

/** Simple keyword scoring over title, keywords, summary and body. Best matches first. */
export function searchArticles(q: string, n = 5): HelpArticle[] {
  const qt = [...new Set(terms(q ?? ''))].slice(0, 20);
  if (!qt.length) return [];
  const { docs, df } = index();
  const N = docs.length;
  const phrase = qt.join(' ');
  const raw = new Set(rawTerms(q));
  const scored = docs.map((d) => {
    let score = 0;
    let matched = 0;
    qt.forEach((t, i) => {
      let hit = d.all.has(t);
      let weight = 1;
      let tok = t;
      // Typing as you go: let the last word match the start of a longer word.
      if (!hit && i === qt.length - 1 && t.length >= 3) {
        const pre = [...d.all].find((w) => w.startsWith(t));
        if (pre) { hit = true; tok = pre; weight = 0.5; }
      }
      if (!hit) return;
      matched++;
      const idf = Math.log(1 + N / (df.get(tok) ?? 1));
      let s = 0;
      if (d.title.has(tok)) s += 6;
      if (d.keywords.has(tok)) s += 5;
      if (d.summary.has(tok)) s += 2;
      s += Math.min(3, d.body.get(tok) ?? 0) * 0.6;
      score += s * idf * weight;
    });
    if (!matched) return { a: d.a, score: 0 };
    // A multi-word keyword ("no jobs", "own inbox") whose every word is in the question.
    const kw = d.kwRaw.filter((k) => k.every((w) => raw.has(w)));
    if (kw.length) score += 8 * Math.max(...kw.map((k) => k.length));
    if (qt.length > 1) {
      if (d.kwPhrases.some((k) => k === phrase || (k.includes(phrase) && phrase.length > 4))) score += 25;
      if (terms(d.a.title).join(' ').includes(phrase)) score += 15;
    }
    score *= 0.5 + 0.5 * (matched / qt.length); // reward matching every word
    return { a: d.a, score };
  });
  return scored.filter((s) => s.score > 0).sort((x, y) => y.score - x.score).slice(0, n).map((s) => s.a);
}

// ---------------------------------------------------------------- the markdown subset (parsed, never rendered as HTML)

export type HelpInline = { type: 'text'; text: string } | { type: 'bold'; text: string } | { type: 'link'; text: string; href: string };
export type HelpBlock =
  | { type: 'h2'; text: string }
  | { type: 'h3'; text: string }
  | { type: 'p'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] };

/** Split body text into headings, paragraphs and lists. */
export function parseBlocks(md: string): HelpBlock[] {
  const out: HelpBlock[] = [];
  let para: string[] = [];
  let list: { type: 'ul' | 'ol'; items: string[] } | null = null;
  const flush = () => {
    if (para.length) out.push({ type: 'p', text: para.join(' ') });
    if (list) out.push(list);
    para = [];
    list = null;
  };
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const h = line.match(/^(#{2,3})\s+(.*)$/);
    if (h) { flush(); out.push(h[1].length === 2 ? { type: 'h2', text: h[2] } : { type: 'h3', text: h[2] }); continue; }
    const ul = line.match(/^[-*•]\s+(.*)$/);
    const ol = line.match(/^\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      const type = ul ? 'ul' : 'ol';
      if (para.length) { out.push({ type: 'p', text: para.join(' ') }); para = []; }
      if (list && list.type !== type) { out.push(list); list = null; }
      if (!list) list = { type, items: [] };
      list.items.push((ul ?? ol)![1]);
      continue;
    }
    if (list) flush();
    para.push(line);
  }
  flush();
  return out;
}

/** **bold** and [text](href) inside a line. Everything else is plain text. */
export function parseInline(s: string): HelpInline[] {
  const out: HelpInline[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ type: 'text', text: s.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ type: 'bold', text: m[1] });
    else out.push({ type: 'link', text: m[2], href: m[3] });
    last = re.lastIndex;
  }
  if (last < s.length) out.push({ type: 'text', text: s.slice(last) });
  return out;
}

/** Only in-app routes and https links are ever made clickable. Returns null for anything else. */
export function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^#\/[\w\-/?=&.%]*$/.test(h)) return h;
  if (/^https:\/\/[^\s"'<>]+$/i.test(h)) return h;
  return null;
}

/** Every link target in a body (used by tests to check routes). */
export function linksIn(md: string): string[] {
  return [...md.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)].map((m) => m[1]);
}
