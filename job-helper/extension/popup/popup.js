import { api, getSettings, isSetUp } from '../lib/api.js';
import { mountSetup } from '../lib/setup.js';
import { pickApplication } from '../lib/match.js';

const $ = (id) => document.getElementById(id);
const show = (el, on = true) => el.classList.toggle('hidden', !on);

let tab = null;
let applications = [];

async function activeTab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t || null;
}

function stateKey() {
  return 'tab:' + (tab && tab.id);
}

async function init() {
  tab = await activeTab();
  $('open-app').addEventListener('click', openApp);
  $('settings').addEventListener('click', (e) => {
    e.preventDefault();
    showSetup();
  });
  $('fill').addEventListener('click', fill);
  $('again').addEventListener('click', () => {
    show($('report'), false);
    show($('pick'), true);
  });
  $('app').addEventListener('change', updateHint);

  if (await isSetUp()) showMain();
  else showSetup();
}

async function openApp(e) {
  e.preventDefault();
  const { apiBase } = await getSettings();
  if (apiBase) chrome.tabs.create({ url: apiBase });
  else showSetup();
  window.close();
}

function showSetup() {
  show($('view-main'), false);
  show($('view-setup'), true);
  mountSetup($('view-setup'), { onDone: showMain });
}

async function showMain() {
  show($('view-setup'), false);
  show($('view-main'), true);
  show($('loading'), true);
  ['no-apps', 'pick', 'working', 'error', 'report'].forEach((id) => show($(id), false));

  // Is a fill already running, or finished, for this page?
  let state = null;
  try {
    const all = await chrome.storage.session.get(stateKey());
    state = all[stateKey()] || null;
  } catch {
    state = null;
  }

  try {
    const res = await api.applications();
    applications = (res && res.applications) || [];
  } catch (e) {
    show($('loading'), false);
    showError(e);
    return;
  }
  show($('loading'), false);

  if (!applications.length) {
    show($('no-apps'), true);
    return;
  }

  const select = $('app');
  select.innerHTML = '';
  const matchId = tab && tab.url ? pickApplication(tab.url, applications) : null;
  const placeholder = new Option('Choose the job…', '');
  select.append(placeholder);
  for (const a of applications) {
    const text = [a.title, a.company].filter(Boolean).join(' at ') || 'Untitled application';
    select.append(new Option(text, String(a.id)));
  }
  const stateApp = state && state.applicationId != null ? String(state.applicationId) : '';
  select.value = matchId != null ? String(matchId) : stateApp && applications.some((a) => String(a.id) === stateApp) ? stateApp : '';
  updateHint(matchId != null);

  if (state && state.url === (tab && tab.url) && state.status === 'running') {
    showWorking();
    waitForResult();
    return;
  }
  show($('pick'), true);
  if (state && state.url === (tab && tab.url)) {
    if (state.status === 'done') renderReport(state.result);
    else if (state.status === 'error') showError(new Error(state.error));
  }
}

function selectedApp() {
  const id = $('app').value;
  return applications.find((a) => String(a.id) === id) || null;
}

function updateHint(matched) {
  const app = selectedApp();
  const hint = $('match-hint');
  const openWrap = $('open-job-wrap');
  if (!app) {
    hint.textContent = 'We couldn’t tell which job this page is for. Please choose it from the list.';
    show(openWrap, false);
    $('fill').disabled = true;
    return;
  }
  $('fill').disabled = false;
  hint.textContent = matched === true ? 'This page looks like the application for this job.' : '';
  if (app.apply_url && tab && tab.url && !sameHost(app.apply_url, tab.url)) {
    hint.textContent = 'This page is on a different website than the job you chose. Is it the right page?';
    show(openWrap, true);
    $('open-job').onclick = (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: app.apply_url });
      window.close();
    };
  } else {
    show(openWrap, false);
  }
}

function sameHost(a, b) {
  try {
    const h = (u) => new URL(u).hostname.replace(/^www\./, '');
    return h(a) === h(b);
  } catch {
    return false;
  }
}

function showWorking() {
  show($('pick'), false);
  show($('report'), false);
  show($('error'), false);
  show($('working'), true);
}

// If the popup was closed and opened again while filling, wait for the result.
function waitForResult() {
  const key = stateKey();
  const listener = (changes, area) => {
    if (area !== 'session' || !changes[key]) return;
    const s = changes[key].newValue;
    if (!s || s.status === 'running') return;
    chrome.storage.onChanged.removeListener(listener);
    show($('working'), false);
    show($('pick'), true);
    if (s.status === 'done') renderReport(s.result);
    else showError(new Error(s.error || 'Something went wrong.'));
  };
  chrome.storage.onChanged.addListener(listener);
}

async function fill() {
  const app = selectedApp();
  if (!app || !tab) return;
  showWorking();
  try {
    const res = await chrome.runtime.sendMessage({ type: 'nc-fill', tabId: tab.id, applicationId: app.id, application: app });
    show($('working'), false);
    show($('pick'), true);
    if (!res || !res.ok) throw new Error((res && res.error) || 'Something went wrong.');
    renderReport(res.result);
  } catch (e) {
    show($('working'), false);
    show($('pick'), true);
    showError(e);
  }
}

function showError(e) {
  const box = $('error');
  box.innerHTML = '';
  const p = document.createElement('p');
  p.textContent = (e && e.message) || String(e);
  box.append(p);
  if (/key didn't work|not set up/i.test(p.textContent)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn-plain';
    b.textContent = 'Fix the connection';
    b.addEventListener('click', showSetup);
    box.append(b);
  }
  show(box, true);
}

function li(text, extra) {
  const el = document.createElement('li');
  el.textContent = text;
  if (extra) el.append(extra);
  return el;
}

function renderReport(r) {
  if (!r) return;
  show($('error'), false);
  show($('pick'), false);
  show($('report'), true);

  if (!r.fieldsFound) {
    $('summary').textContent =
      'The helper didn’t find an application form on this page. If the site has an “Apply” button, press it first, then click the helper again.';
  } else {
    $('summary').textContent = r.summary;
  }

  const todo = $('todo');
  todo.innerHTML = '';
  (r.todo || []).forEach((t) => todo.append(li(t)));
  show($('todo-box'), (r.todo || []).length > 0);

  const left = $('left');
  left.innerHTML = '';
  (r.left || []).forEach((item) => {
    const small = document.createElement('span');
    small.className = 'muted small';
    small.textContent = ` (${item.why})`;
    left.append(li(item.label, small));
  });
  show($('left-box'), (r.left || []).length > 0);

  const frames = $('frames');
  frames.innerHTML = '';
  (r.blockedFrames || []).forEach((f) => {
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = 'Open the form by itself';
    a.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: f.src });
      window.close();
    });
    const item = document.createElement('li');
    item.append(a, document.createTextNode(' — then click the helper again on that page.'));
    frames.append(item);
  });
  show($('frames-box'), (r.blockedFrames || []).length > 0);

  show($('told'), !!r.told);
}

init();
