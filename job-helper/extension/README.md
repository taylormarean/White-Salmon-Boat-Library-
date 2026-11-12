# Next Chapter browser helper (Chrome extension)

The helper fills in a company's job application form for her:

- her name, email, phone, town, LinkedIn and website
- her tailored **resume** and **cover letter** (PDFs from Next Chapter)
- answers to the form's questions: ones already written in Next Chapter, or new ones written in her voice

**It never presses Submit.** She checks the form, fills in anything outlined in yellow, and presses the website's own Submit button herself. Next Chapter then asks her to confirm she sent it.

## Install it (about 2 minutes)

For now the helper is installed by hand, from this folder:

1. In Chrome, go to `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose this `extension` folder.
4. A setup page opens. Paste:
   - the **address** of her Next Chapter app (for example `https://next-chapter.example.workers.dev`)
   - her **Browser helper key**, from Next Chapter → **Settings** → *Browser helper key* → Copy
5. Click **Test connection**. Chrome asks to let the helper talk to that one address. Click **Allow**. It should say "Connected! Hello, ⟨her name⟩."
6. Click the puzzle piece next to the address bar and **pin** "Next Chapter helper", so the green **N** button is always visible.

To update it later, replace the folder's files and click the reload arrow on the helper's card in `chrome://extensions`.

**Later:** publish it to the Chrome Web Store (a one-time $5 developer fee, then upload a zip of this folder). After that she installs it with one click and updates arrive on their own. The store listing should explain the `activeTab`, `scripting` and `storage` permissions as described below.

## How she uses it

1. Open the job's application form (press the site's "Apply" button first if needed).
2. Click the green **N** button.
3. Check that the right job is chosen. It's picked automatically when the page matches the job's link.
4. Press **Fill this application**.
5. Read the short report, for example: *"Filled 9 fields, attached resume + cover letter, wrote 2 answers."*
6. On the page, **green** boxes were filled in for her and **yellow** boxes are hers to do. The page scrolls to the first yellow box.
7. Check everything, then press the website's **Submit** button herself.

## What it leaves for her, on purpose

- Passwords, payment or bank details, Social Security numbers, date of birth.
- Equal-opportunity and demographic questions (gender, race, veteran status, disability and similar).
- "How did you hear about us?", salary, start date, visa or sponsorship, and work-authorization questions. Exception: if she already approved an answer to that exact question in Next Chapter, it uses that answer. The AI never makes these up.
- Tick boxes like "I certify that…", and choices it has no approved answer for.
- Any box that already has something in it. It never overwrites.

## Privacy

- **It only runs when she clicks.** It has no permission to read websites in the background. Chrome's `activeTab` permission lets it see only the tab she's on, and only after she clicks the button.
- **Her key stays on her computer** (`chrome.storage.local`). It is sent only to her own Next Chapter address and never into the job website's page. Calls to Next Chapter go through the helper's background worker.
- **It only talks to her app.** At setup it asks Chrome for access to that one address and nothing else.
- What it sends to Next Chapter: the text of questions it needs an answer for, and a note that she used the helper on that application. It does not send the page or anything she types.
- **Disconnect** at any time: helper → Settings → Disconnect. Or remove the extension in `chrome://extensions`.

### Permissions in `manifest.json`

| Permission | Why |
|---|---|
| `activeTab` | Work on the current tab, only after she clicks the button |
| `scripting` | Put the form filler into that tab when she presses **Fill this application** |
| `storage` | Remember her app address and key on this computer |
| optional `https://*/*` (plus `http://localhost`, `http://127.0.0.1` for development) | Only the single address of her Next Chapter app is requested, at setup |

There are no always-on content scripts and no permanent host permissions.

## Files

| Path | What it is |
|---|---|
| `manifest.json` | Extension settings (Manifest V3) |
| `background.js` | Service worker: talks to Next Chapter, puts the filler into the page, collects the report |
| `content/filler.js` | The form filler, injected only on demand. Also usable on its own as `NextChapterFiller.fill({ profile, files, answers, answerFn })` |
| `popup/` | The window that opens from the toolbar button |
| `options/` | The full-page setup screen |
| `lib/api.js` | Calls to the Next Chapter API (`X-Api-Key` header) |
| `lib/match.js` | Matches the page to an application, and builds the report wording |
| `lib/setup.js`, `lib/ui.css` | Setup form and shared styles |
| `icons/` | Icons; `tools/make-icons.cjs` redraws them |
| `test/form.html` | A Greenhouse-style test form |
| `test/fill.test.cjs` | Tests: `node extension/test/fill.test.cjs` (needs Playwright + Chromium) |

## API it uses

All requests send `X-Api-Key: <key>` to the saved address:

- `GET /api/ext/profile`
- `GET /api/ext/applications`
- `GET /api/ext/applications/{id}/files`
- `GET /api/ext/applications/{id}/answers`
- `POST /api/ext/answer` `{ application_id, question, max_chars? }`
- `POST /api/ext/applications/{id}/filled`

Errors come back as `{ error }`. A 401 shows "The browser helper key didn't work…".

## Known limits

- **Forms inside a box from another website** (for example a Greenhouse form inside a company's careers page) can't be reached with `activeTab`. The report then shows an **Open the form by itself** link. She opens it and clicks the helper again on that page.
- **Fancy upload boxes** with no real file input: the report says "Attach your resume yourself".
- **Type-ahead boxes** (like a city picker): the helper types her town, but she may still need to pick it from the list.
- **Multi-page forms** (Workday and others): click the helper again on each page.
- **Rich-text editors** (`contenteditable`) and closed shadow roots are not filled. They are left for her.
