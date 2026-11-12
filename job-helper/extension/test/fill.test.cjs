#!/usr/bin/env node
/*
 * Tests for the Next Chapter browser helper.
 *
 *   node extension/test/fill.test.cjs
 *
 * Part 1  Pure helpers (URL matching, report merging, address clean-up) in Node.
 * Part 2  The form filler on test/form.html in Chromium, with a stubbed API.
 * Part 3  The real extension loaded in Chromium, talking to a mock Next Chapter
 *         API: setup page, popup list, and a full fill through the service worker.
 *         (Skipped with a note if this Chromium can't load extensions.)
 *
 * Needs only Playwright + Chromium. No network.
 */
'use strict';

const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const EXT = path.resolve(__dirname, '..');
const FILLER = path.join(EXT, 'content', 'filler.js');

// ------------------------------------------------------------------ checks
let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log('  ✓ ' + name);
  } else {
    failed++;
    failures.push(name);
    console.log('  ✗ ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : ''));
  }
}
function section(t) {
  console.log('\n' + t);
}

// ------------------------------------------------------------------ fixtures
const PROFILE = {
  name: 'Margaret Ellis',
  first_name: 'Margaret',
  last_name: 'Ellis',
  email: 'margaret.ellis@example.com',
  phone: '(541) 555-0142',
  location: 'Hood River, OR',
  linkedin_url: 'https://www.linkedin.com/in/margaret-ellis-example',
  website_url: 'https://margaret-ellis.example.com',
};

function fakePdf(title) {
  const text = `%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n% ${title}\ntrailer << /Root 1 0 R >>\n%%EOF\n`;
  return Buffer.from(text, 'latin1').toString('base64');
}
const FILES = {
  resume: { filename: 'Margaret_Ellis_Resume.pdf', mime: 'application/pdf', base64: fakePdf('resume') },
  cover_letter: { filename: 'Margaret_Ellis_Cover_Letter.pdf', mime: 'application/pdf', base64: fakePdf('cover letter') },
};
const ANSWERS = [
  { question: 'Why do you want to work at Acme?', answer: 'I have admired how Acme treats its customers for years, and I want to help more of them succeed.' },
  { question: 'Are you legally authorized to work in the U.S.?', answer: 'Yes' },
  { question: 'Will you require visa sponsorship?', answer: 'No, I will not need sponsorship.' },
  { question: 'What is your greatest weakness?', answer: 'I sometimes take on too much myself.' },
];
const LONG_AI_ANSWER =
  'At the garden center a regular customer came in upset because a large order had gone to the wrong address. ' +
  'I listened, apologized, and drove the plants to her house myself that afternoon. ' +
  'I also called her the next week to see how they were doing. She has sent us three new customers since then, ' +
  'and she still asks for me by name whenever she comes in. That taught me that following up matters more than anything. ' +
  'This extra sentence is only here to make the answer longer than three hundred characters.';

const APPLICATIONS = [
  { id: 101, title: 'Account Executive', company: 'Acme Corp', apply_url: 'http://127.0.0.1:PORT/test/form.html', status: 'ready' },
  { id: 102, title: 'Customer Success Manager', company: 'Globex', apply_url: 'https://boards.greenhouse.io/globex/jobs/4012345', status: 'drafted' },
];

// ------------------------------------------------------------------ server
// Serves the extension folder (for test pages) and a mock Next Chapter API.
function startServer() {
  const calls = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'X-Api-Key, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    };
    if (url.pathname.startsWith('/api/ext/')) {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors);
        return res.end();
      }
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const json = (status, obj) => {
          res.writeHead(status, { 'Content-Type': 'application/json', ...cors });
          res.end(JSON.stringify(obj));
        };
        calls.push({ method: req.method, path: url.pathname, key: req.headers['x-api-key'], body: body ? JSON.parse(body) : null });
        if (req.headers['x-api-key'] !== 'test-key') return json(401, { error: 'Bad key' });
        const p = url.pathname;
        const port = server.address().port;
        if (p === '/api/ext/profile') return json(200, PROFILE);
        if (p === '/api/ext/applications')
          return json(200, { applications: APPLICATIONS.map((a) => ({ ...a, apply_url: a.apply_url.replace('PORT', port) })) });
        let m;
        if ((m = /^\/api\/ext\/applications\/(\d+)\/files$/.exec(p))) return json(200, FILES);
        if ((m = /^\/api\/ext\/applications\/(\d+)\/answers$/.exec(p))) return json(200, { answers: ANSWERS });
        if ((m = /^\/api\/ext\/applications\/(\d+)\/filled$/.exec(p)) && req.method === 'POST') return json(200, { ok: true });
        if (p === '/api/ext/answer' && req.method === 'POST') {
          const b = JSON.parse(body || '{}');
          if (!b.application_id || !b.question) return json(400, { error: 'Missing question' });
          return json(200, { answer: b.max_chars ? LONG_AI_ANSWER : 'I love talking with people and I follow up every time.' });
        }
        return json(404, { error: 'Not found' });
      });
      return;
    }
    const file = path.join(EXT, decodeURIComponent(url.pathname));
    if (!file.startsWith(EXT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end('not found');
    }
    const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, calls, port: server.address().port })));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ part 1
async function part1() {
  section('Part 1: helpers (Node)');
  const match = await import(pathToFileURL(path.join(EXT, 'lib', 'match.js')).href);
  const apiMod = await import(pathToFileURL(path.join(EXT, 'lib', 'api.js')).href);

  const apps = [
    { id: 1, apply_url: 'https://boards.greenhouse.io/acme/jobs/4011111' },
    { id: 2, apply_url: 'https://boards.greenhouse.io/globex/jobs/4022222' },
    { id: 3, apply_url: 'https://jobs.lever.co/initech/abc-123/apply' },
    { id: 4, apply_url: 'https://careers.hooli.com/jobs?gh_jid=5550001' },
  ];
  check('picks the Greenhouse job by its path', match.pickApplication('https://boards.greenhouse.io/globex/jobs/4022222#app', apps) === 2);
  check('picks the Lever job by host', match.pickApplication('https://jobs.lever.co/initech/abc-123', apps) === 3);
  check('picks the embedded job by its job id', match.pickApplication('https://www.careers.hooli.com/jobs?gh_jid=5550001&t=x', apps) === 4);
  check('no guess on an unrelated site', match.pickApplication('https://www.example.com/', apps) === null);
  check(
    'no guess between two jobs on the same board with nothing else in common',
    match.pickApplication('https://boards.greenhouse.io/', [apps[0], apps[1]]) === null,
  );

  const merged = match.mergeReports([
    { fieldsFound: 5, filled: [{ label: 'a' }, { label: 'b' }], answered: [{ label: 'q' }], attached: { resume: true, cover_letter: false }, leftForYou: [{ label: 'Gender', reason: 'private' }], manual: [], errors: [], blockedFrames: [], leftCount: 1 },
    { fieldsFound: 1, filled: [], answered: [{ label: 'q2' }], attached: { resume: false, cover_letter: true }, leftForYou: [], manual: [], errors: [], blockedFrames: [], leftCount: 0 },
  ]);
  check('merges frame reports', merged.fieldsFound === 6 && merged.answered.length === 2 && merged.attached.resume && merged.attached.cover_letter);
  check(
    'summary line reads naturally',
    match.summaryLine(merged) === 'Filled 2 fields, attached resume + cover letter, wrote 2 answers.',
    match.summaryLine(merged),
  );

  check('address clean-up adds https://', apiMod.normalizeBase('next-chapter.example.workers.dev/today') === 'https://next-chapter.example.workers.dev');
  check('address clean-up keeps localhost http', apiMod.normalizeBase('http://localhost:8787/') === 'http://localhost:8787');
  let threw = false;
  try {
    apiMod.normalizeBase('http://next-chapter.example.com');
  } catch {
    threw = true;
  }
  check('address clean-up refuses plain http for real sites', threw);
  check('permission pattern drops the port', apiMod.originPattern('http://localhost:8787') === 'http://localhost/*');

  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  const files = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    manifest.options_ui.page,
    ...Object.values(manifest.icons),
    'content/filler.js',
  ];
  check('manifest is MV3 and every file it names exists', manifest.manifest_version === 3 && files.every((f) => fs.existsSync(path.join(EXT, f))));
  check(
    'manifest asks only for activeTab, scripting, storage',
    JSON.stringify([...manifest.permissions].sort()) === JSON.stringify(['activeTab', 'scripting', 'storage']) && !manifest.host_permissions && !manifest.content_scripts,
  );
}

// ------------------------------------------------------------------ part 2
async function part2(base) {
  section('Part 2: filler on test/form.html (stubbed API)');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
  const aiCalls = [];
  await page.exposeFunction('__answerStub', (q, max) => {
    aiCalls.push({ q, max });
    return max ? LONG_AI_ANSWER : 'I love talking with people and I follow up every time.';
  });
  await page.goto(base + '/test/form.html');
  const startUrl = page.url();
  await page.addScriptTag({ path: FILLER });

  const report = await page.evaluate(
    async ({ profile, files, answers }) =>
      window.NextChapterFiller.fill({ profile, files, answers, answerFn: (q, max) => window.__answerStub(q, max ?? null), runId: 'run-1' }),
    { profile: PROFILE, files: FILES, answers: ANSWERS },
  );
  await sleep(900); // let the smooth scroll and the fake React re-render finish

  const v = await page.evaluate(() => {
    const $ = (id) => document.getElementById(id);
    const frameDoc = $('extra-frame').contentDocument;
    const radio = document.querySelector('input[name=sponsor]:checked');
    const fileInfo = (id) => {
      const f = $(id).files[0];
      return f ? { name: f.name, type: f.type, size: f.size } : null;
    };
    const hl = (el) => (el.getAttribute('data-nc-highlight') ? el : el.closest('[data-nc-highlight]') || el.parentElement.closest('[data-nc-highlight]'));
    const hlOf = (el) => {
      if (el.getAttribute('data-nc-highlight')) return el.getAttribute('data-nc-highlight');
      let p = el.parentElement;
      for (let i = 0; i < 5 && p; i++, p = p.parentElement) if (p.getAttribute('data-nc-highlight')) return p.getAttribute('data-nc-highlight');
      return null;
    };
    const cc = $('current_company').getBoundingClientRect();
    return {
      first: $('first_name').value,
      last: $('ln').value,
      email: $('contact_e').value,
      phone: $('phone').value,
      location: $('location').value,
      reactLocation: window.__reactState.location,
      linkedin: $('q_linkedin').value,
      website: $('shadow-host').shadowRoot.getElementById('site').value,
      company: $('current_company').value,
      pref: $('pref').value,
      resume: fileInfo('resume'),
      cover: fileInfo('cover_letter'),
      fileChanges: window.__fileChanges,
      why: $('q_why').value,
      customer: $('q_customer').value,
      salary: $('q_salary').value,
      hear: $('q_hear').value,
      auth: $('q_auth').options[$('q_auth').selectedIndex].text,
      sponsor: radio ? radio.value : null,
      pw: $('pw').value,
      dob: $('dob').value,
      eeo: ['gender', 'hispanic', 'veteran', 'disability'].map((id) => $(id).value),
      certify: $('certify').checked,
      fit: frameDoc.getElementById('q_fit').value,
      search: $('site-search').value,
      newsletter: $('nl').value,
      submitted: window.__submitted,
      clicked: window.__clicked,
      hlFirst: hlOf($('first_name')),
      hlWhy: hlOf($('q_why')),
      hlResume: hlOf($('resume')),
      hlGender: hlOf($('gender')),
      hlVeteran: hlOf($('veteran')),
      hlCompany: hlOf($('current_company')),
      hlSalary: hlOf($('q_salary')),
      hlPref: hlOf($('pref')),
      hlFit: hlOf(frameDoc.getElementById('q_fit')),
      hlSearch: hlOf($('site-search')),
      scrollY: window.scrollY,
      companyInView: cc.top >= 0 && cc.bottom <= window.innerHeight,
      banner: !!document.querySelector('[data-next-chapter-ui]'),
      bannerText: document.querySelector('[data-next-chapter-ui]') ? document.querySelector('[data-next-chapter-ui]').shadowRoot.textContent : '',
    };
  });

  // Contact details
  check('first name (label[for])', v.first === 'Margaret', v.first);
  check('last name (wrapping label)', v.last === 'Ellis', v.last);
  check('email (aria-label)', v.email === PROFILE.email, v.email);
  check('phone (type=tel)', v.phone === PROFILE.phone, v.phone);
  check('location in a React-style controlled input shows the value', v.location === PROFILE.location, v.location);
  check('React-style component state got the value (survives re-render)', v.reactLocation === PROFILE.location, v.reactLocation);
  check('LinkedIn (aria-labelledby)', v.linkedin === PROFILE.linkedin_url, v.linkedin);
  check('website (placeholder only, inside a shadow root)', v.website === PROFILE.website_url, v.website);
  check('current company left blank (not in profile)', v.company === '', v.company);
  check('does not overwrite a box that already has a value', v.pref === 'Sue', v.pref);

  // Files
  check('resume PDF attached to the hidden Greenhouse-style input', v.resume && v.resume.name === FILES.resume.filename && v.resume.type === 'application/pdf' && v.resume.size > 50, v.resume);
  check('cover letter PDF attached', v.cover && v.cover.name === FILES.cover_letter.filename, v.cover);
  check('file inputs got a change event', v.fileChanges.resume === 1 && v.fileChanges.cover_letter === 1, v.fileChanges);

  // Questions
  check('drafted answer matched by word overlap ("Acme" vs "Acme Corp")', v.why === ANSWERS[0].answer, v.why);
  check('new question sent to the AI with the box maxlength', aiCalls.some((c) => /unhappy customer/.test(c.q) && c.max === 300), aiCalls);
  check('AI answer trimmed to fit maxlength at a sentence end', v.customer.length > 0 && v.customer.length <= 300 && /[.!?]$/.test(v.customer), v.customer.length);
  check('question inside a same-origin iframe answered', v.fit.length > 0, v.fit);
  check('salary question NOT sent to the AI and left blank', v.salary === '' && !aiCalls.some((c) => /salary/i.test(c.q)), aiCalls.map((c) => c.q));
  check('exactly 2 AI calls (customer + iframe question)', aiCalls.length === 2, aiCalls.map((c) => c.q));
  check('"How did you hear" dropdown left alone', v.hear === '', v.hear);
  check('work-authorization dropdown set from her drafted "Yes"', v.auth === 'Yes', v.auth);
  check('sponsorship radio set from her drafted "No"', v.sponsor === 'no', v.sponsor);

  // Never touched
  check('password not touched', v.pw === '');
  check('date of birth not touched', v.dob === '');
  check('EEO / demographic dropdowns not touched', v.eeo.every((x) => x === ''), v.eeo);
  check('"I certify" checkbox not ticked', v.certify === false);
  check('site search box not touched', v.search === '');
  check('footer newsletter email not touched', v.newsletter === '');
  check('form NOT submitted, no button or link clicked', v.submitted === false && v.clicked.length === 0, v.clicked);
  check('page did not navigate', page.url() === startUrl);

  // Highlights and scrolling
  check('filled boxes outlined green', v.hlFirst === 'filled' && v.hlWhy === 'filled' && v.hlResume === 'filled' && v.hlFit === 'filled', [v.hlFirst, v.hlWhy, v.hlResume, v.hlFit]);
  check('boxes left for her outlined yellow', v.hlGender === 'left' && v.hlVeteran === 'left' && v.hlCompany === 'left' && v.hlSalary === 'left', [v.hlGender, v.hlVeteran, v.hlCompany, v.hlSalary]);
  check('untouched pre-filled / search boxes not outlined', v.hlPref === null && v.hlSearch === null, [v.hlPref, v.hlSearch]);
  check('scrolled to the first yellow box', v.scrollY > 0 && v.companyInView, { scrollY: v.scrollY, inView: v.companyInView });
  check('"submit it yourself" note shown on the page', v.banner && /Submit button yourself/.test(v.bannerText));

  // Report
  const leftLabels = report.leftForYou.map((x) => x.label);
  check('report: 9 fields filled', report.filled.length === 9, report.filled.map((f) => f.label));
  check('report: 3 answers written', report.answered.length === 3, report.answered);
  check('report: resume + cover letter attached', report.attached.resume && report.attached.cover_letter);
  for (const want of ['Gender', 'Veteran Status', 'Disability Status', 'Date of birth', 'Current Company', 'What are your salary expectations?']) {
    check(`report lists "${want}" as left for her`, leftLabels.includes(want), leftLabels);
  }
  const summary = await page.evaluate((r) => window.NextChapterFiller.summarize(r), report);
  check('summary sentence', summary === 'Filled 9 fields, attached resume + cover letter, wrote 3 answers.', summary);

  // Second press: nothing is overwritten and the AI isn't asked again.
  await page.fill('#first_name', 'Maggie');
  const before = aiCalls.length;
  const report2 = await page.evaluate(
    async ({ profile, files, answers }) =>
      window.NextChapterFiller.fill({ profile, files, answers, answerFn: (q, max) => window.__answerStub(q, max ?? null), runId: 'run-2', scroll: false }),
    { profile: PROFILE, files: FILES, answers: ANSWERS },
  );
  const first2 = await page.$eval('#first_name', (e) => e.value);
  check('second run keeps her edits', first2 === 'Maggie', first2);
  check('second run does not ask the AI again', aiCalls.length === before, aiCalls.length - before);
  check('second run fills nothing new', report2.filled.length === 0 && report2.answered.length === 0, report2.filled);

  // Similarity unit checks (in the page, where the filler lives)
  const sim = await page.evaluate(() => {
    const F = window.NextChapterFiller;
    return {
      same: F.similarity('Why are you interested in this role?', 'What interests you about this role?'),
      diff: F.similarity('Describe a time you handled a difficult customer', 'Why do you want to work here?'),
      salaryTrap: F.similarity('What salary do you want for this role?', 'Why do you want this role?'),
    };
  });
  check('similar questions score high', sim.same >= 0.6, sim.same);
  check('different questions score low', sim.diff < 0.3, sim.diff);
  check('salary question never matches a non-salary answer', sim.salaryTrap === 0, sim.salaryTrap);

  // A site with only a drag-and-drop box (no file input): tell her to attach it herself.
  await page.setContent(`
    <form><label>First name <input name="fn"></label><label>Last name <input name="lname"></label>
    <label>Email <input name="em"></label>
    <div class="dz" style="padding:20px;border:2px dashed #999">Drop your resume here to upload</div></form>`);
  await page.addScriptTag({ path: FILLER });
  const r3 = await page.evaluate(({ profile, files }) => window.NextChapterFiller.fill({ profile, files, answers: [], runId: 'dz', banner: false }), {
    profile: PROFILE,
    files: FILES,
  });
  const match = await import(pathToFileURL(path.join(EXT, 'lib', 'match.js')).href);
  const todo = match.todoList(match.mergeReports([r3]), { hasCoverLetter: true });
  check('drag-and-drop-only uploader -> "attach your resume yourself"', !r3.attached.resume && todo.some((t) => /Attach your resume yourself/.test(t)), todo);

  await browser.close();
}

// ------------------------------------------------------------------ part 3
async function part3(base, calls) {
  section('Part 3: the real extension in Chromium (mock Next Chapter API)');
  // Test copy of the extension. The only change: grant the test server's
  // origin up front, because a test can't click "Allow" on Chrome's prompt
  // or click the toolbar button that grants activeTab.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-ext-'));
  const extCopy = path.join(tmp, 'ext');
  fs.cpSync(EXT, extCopy, { recursive: true, filter: (src) => !src.includes(path.sep + 'test' + path.sep) || src.endsWith('form.html') });
  const mf = JSON.parse(fs.readFileSync(path.join(extCopy, 'manifest.json'), 'utf8'));
  mf.host_permissions = ['http://127.0.0.1/*'];
  fs.writeFileSync(path.join(extCopy, 'manifest.json'), JSON.stringify(mf, null, 2));

  let context;
  try {
    context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${extCopy}`, `--load-extension=${extCopy}`],
    });
  } catch (e) {
    console.log('  (skipped: this Chromium could not load extensions: ' + String(e.message).split('\n')[0] + ')');
    return;
  }
  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10000 });
    const extId = new URL(sw.url()).host;
    check('service worker starts', !!extId);
    const errors = [];
    context.on('weberror', (e) => errors.push(String(e.error())));

    // First install opens the setup page.
    await sleep(500);
    const setupOpened = context.pages().some((p) => p.url().includes('/options/options.html'));
    check('setup page opens on first install', setupOpened, context.pages().map((p) => p.url()));

    // Setup: wrong key, then right key.
    const opt = await context.newPage();
    opt.on('pageerror', (e) => errors.push(String(e)));
    await opt.goto(`chrome-extension://${extId}/options/options.html`);
    // A test can't click Chrome's "Allow" dialog; the test copy already has the permission.
    await opt.evaluate(() => {
      chrome.permissions.request = async () => true;
    });
    await opt.fill('#nc-base', base);
    await opt.fill('#nc-key', 'wrong-key');
    await opt.click('#nc-test');
    await opt.waitForFunction(() => /key didn't work/.test(document.querySelector('#nc-msg').textContent), null, { timeout: 5000 });
    check('setup: bad key shows a plain-language message', true);
    await opt.fill('#nc-key', 'test-key');
    await opt.click('#nc-test');
    await opt.waitForFunction(() => /Connected/.test(document.querySelector('#nc-msg').textContent), null, { timeout: 5000 });
    const hello = await opt.$eval('#nc-msg', (e) => e.textContent);
    check('setup: "Test connection" shows her name', /Hello, Margaret\./.test(hello), hello);
    const stored = await opt.evaluate(() => chrome.storage.local.get(['apiBase', 'apiKey']));
    check('setup: address and key saved locally', stored.apiBase === base && stored.apiKey === 'test-key', stored);
    check('API requests carry the X-Api-Key header', calls.filter((c) => c.path === '/api/ext/profile').pop().key === 'test-key');

    // The job page, then the popup (opened as a tab here).
    const job = await context.newPage();
    await job.goto(base + '/test/form.html');
    const popup = await context.newPage();
    popup.on('pageerror', (e) => errors.push(String(e)));
    await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
    await popup.waitForSelector('#pick:not(.hidden), #error:not(.hidden), #no-apps:not(.hidden)', { timeout: 5000 });
    const opts = await popup.$$eval('#app option', (os) => os.map((o) => o.textContent));
    check('popup lists her applications', opts.includes('Account Executive at Acme Corp') && opts.includes('Customer Success Manager at Globex'), opts);
    const btn = await popup.$eval('#fill', (b) => b.textContent);
    check('popup shows the big "Fill this application" button', btn === 'Fill this application');

    // Fill the job tab through the service worker, the same message the button sends.
    const jobTabId = await popup.evaluate(async (url) => (await chrome.tabs.query({ url })).map((t) => t.id)[0], base + '/test/form.html');
    const res = await popup.evaluate(
      (tabId) => chrome.runtime.sendMessage({ type: 'nc-fill', tabId, applicationId: 101 }),
      jobTabId,
    );
    check('service worker fill succeeded', res && res.ok, res);
    const result = (res && res.result) || {};
    check(
      'popup report sentence',
      result.summary === 'Filled 9 fields, attached resume + cover letter, wrote 3 answers.',
      result.summary,
    );
    check('report lists boxes left for her', (result.left || []).some((l) => l.label === 'Gender' && /private/.test(l.why)), result.left);
    check('app told about the fill (POST /filled)', calls.some((c) => c.method === 'POST' && c.path === '/api/ext/applications/101/filled') && result.told === true);
    const aiCalls = calls.filter((c) => c.path === '/api/ext/answer');
    check(
      'new questions sent to POST /api/ext/answer with application_id and max_chars',
      aiCalls.length === 2 && aiCalls.every((c) => c.body.application_id === 101) && aiCalls.some((c) => c.body.max_chars === 300),
      aiCalls.map((c) => c.body),
    );
    const jv = await job.evaluate(() => ({
      first: document.getElementById('first_name').value,
      react: window.__reactState.location,
      resume: document.getElementById('resume').files.length,
      fit: document.getElementById('extra-frame').contentDocument.getElementById('q_fit').value,
      gender: document.getElementById('gender').value,
      submitted: window.__submitted,
      banner: !!document.querySelector('[data-next-chapter-ui]'),
    }));
    check('job page filled through the extension (isolated world)', jv.first === 'Margaret' && jv.react === PROFILE.location && jv.resume === 1 && jv.fit.length > 0, jv);
    check('extension did not submit or touch EEO', jv.submitted === false && jv.gender === '');
    check('page note shown by the extension', jv.banner);

    // Popup re-opened later shows the saved report for that tab? (state is per tab; the popup tab differs, so just check storage)
    const state = await popup.evaluate((id) => chrome.storage.session.get('tab:' + id), jobTabId);
    check('report saved for the tab (popup can show it again)', state['tab:' + jobTabId] && state['tab:' + jobTabId].status === 'done');

    check('no JavaScript errors in extension pages', errors.length === 0, errors);
  } finally {
    await context.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------ main
(async () => {
  const { server, calls, port } = await startServer();
  const base = `http://127.0.0.1:${port}`;
  try {
    await part1();
    await part2(base);
    await part3(base, calls);
  } catch (e) {
    failed++;
    failures.push('crashed: ' + e.message);
    console.error(e);
  } finally {
    server.close();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('Failed:\n - ' + failures.join('\n - '));
    process.exit(1);
  }
})();
