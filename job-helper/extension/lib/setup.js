// The "connect the helper to Next Chapter" form. Used in the popup and on
// the full setup page (options page).

import { api, normalizeBase, originPattern, getSettings, saveSettings, clearSettings } from './api.js';

const TEMPLATE = `
  <h2>Connect the helper to Next Chapter</h2>
  <p class="muted small">You only do this once.</p>

  <label class="big" for="nc-base">1. Your Next Chapter address</label>
  <input id="nc-base" type="url" inputmode="url" autocomplete="off" spellcheck="false"
         placeholder="https://next-chapter.example.workers.dev">
  <p class="help">It's the web address you use to open Next Chapter.</p>

  <label class="big" for="nc-key">2. Your browser helper key</label>
  <div class="row">
    <input id="nc-key" type="password" autocomplete="off" spellcheck="false" placeholder="Paste the key here">
    <button type="button" class="btn-plain" id="nc-show">Show</button>
  </div>
  <p class="help">In Next Chapter, open <b>Settings</b> and find <b>Browser helper key</b>. Click Copy, then paste it here.</p>

  <button type="button" class="btn-big" id="nc-test">Test connection</button>
  <p class="help">Chrome may ask to let the helper talk to your Next Chapter app. Please click <b>Allow</b>.</p>

  <div id="nc-msg" class="box hidden" role="status" aria-live="polite"></div>
  <button type="button" class="btn-big hidden" id="nc-done">Start using the helper</button>

  <div id="nc-current" class="hidden">
    <p class="small muted">Connected to <span id="nc-current-base"></span>.
      <button type="button" class="linklike" id="nc-disconnect">Disconnect</button></p>
  </div>
`;

/**
 * @param {HTMLElement} root
 * @param {{ onDone?: () => void, doneLabel?: string }} options
 */
export async function mountSetup(root, { onDone, doneLabel } = {}) {
  root.innerHTML = TEMPLATE;
  const $ = (id) => root.querySelector('#' + id);
  const base = $('nc-base'), key = $('nc-key'), msg = $('nc-msg'), test = $('nc-test'), done = $('nc-done');
  if (doneLabel) done.textContent = doneLabel;

  const show = (kind, html) => {
    msg.className = 'box ' + kind;
    msg.innerHTML = '';
    msg.append(...(Array.isArray(html) ? html : [html]));
  };

  // Fill in what she typed before (the popup can close while Chrome asks for permission).
  const saved = await getSettings();
  const { draftBase = '', draftKey = '' } = await chrome.storage.local.get(['draftBase', 'draftKey']);
  base.value = draftBase || saved.apiBase || '';
  key.value = draftKey || saved.apiKey || '';
  if (saved.apiBase && saved.apiKey) {
    $('nc-current').classList.remove('hidden');
    $('nc-current-base').textContent = saved.apiBase;
  }

  const keepDraft = () => chrome.storage.local.set({ draftBase: base.value, draftKey: key.value });
  base.addEventListener('input', keepDraft);
  key.addEventListener('input', keepDraft);

  $('nc-show').addEventListener('click', () => {
    const hidden = key.type === 'password';
    key.type = hidden ? 'text' : 'password';
    $('nc-show').textContent = hidden ? 'Hide' : 'Show';
  });

  $('nc-disconnect').addEventListener('click', async () => {
    await clearSettings();
    await chrome.storage.local.remove(['draftBase', 'draftKey']);
    base.value = '';
    key.value = '';
    $('nc-current').classList.add('hidden');
    done.classList.add('hidden');
    show('warn', 'The helper is disconnected. Paste your address and key to connect again.');
  });

  test.addEventListener('click', async () => {
    let origin;
    try {
      origin = normalizeBase(base.value);
    } catch (e) {
      show('err', e.message);
      base.focus();
      return;
    }
    const apiKey = key.value.trim();
    if (!apiKey) {
      show('err', 'Please paste your browser helper key.');
      key.focus();
      return;
    }
    base.value = origin;

    // Ask Chrome for permission to talk to her app (only that one address).
    // This must happen right away, while the click is still "fresh".
    let granted = false;
    const permP = chrome.permissions.request({ origins: [originPattern(origin)] }).catch(() => false);

    test.disabled = true;
    test.textContent = 'Checking…';
    show('warn', 'Checking the connection…');
    try {
      granted = await permP;
      const profile = await api.profile({ base: origin, key: apiKey });
      const name = profile.first_name || (profile.name || '').split(' ')[0] || '';
      await saveSettings({ apiBase: origin, apiKey, name: profile.name || '' });
      await chrome.storage.local.remove(['draftBase', 'draftKey']);
      const hello = document.createElement('span');
      hello.innerHTML = '<b>Connected!</b> ';
      hello.append(document.createTextNode(name ? `Hello, ${name}.` : 'It works.'));
      show('ok', hello);
      $('nc-current').classList.remove('hidden');
      $('nc-current-base').textContent = origin;
      done.classList.remove('hidden');
      done.focus();
    } catch (e) {
      let text = e.message || String(e);
      if (e.status === 0 && !granted) {
        text += ' If Chrome asked for permission, please click Test connection again and choose Allow.';
      }
      show('err', text);
    } finally {
      test.disabled = false;
      test.textContent = 'Test connection';
    }
  });

  done.addEventListener('click', () => onDone && onDone());
}
