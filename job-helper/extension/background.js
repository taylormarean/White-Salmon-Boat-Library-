// Service worker. Does the work for the popup so that filling keeps going
// even if the popup closes. Talks to the Next Chapter app (so the API key
// never goes into the job website's page) and injects the filler into the
// tab only when she presses "Fill this application".

import { api, ApiError, isSetUp } from './lib/api.js';
import { mergeReports, summaryLine, todoList, leftList } from './lib/match.js';

const running = new Map(); // tabId -> Promise

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install' && !(await isSetUp())) {
    chrome.runtime.openOptionsPage();
  }
});

// True only for our own pages (popup, setup page), never for a web page's content script.
function fromOurPage(sender) {
  return sender.id === chrome.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return false;

  // The filler (in the job page) needs an answer written for a new question.
  if (msg.type === 'nc-answer') {
    if (!sender.tab || fromOurPage(sender)) return false;
    api
      .answer(msg.applicationId, String(msg.question || '').slice(0, 2000), msg.maxChars || null)
      .then((r) => sendResponse({ ok: true, answer: (r && r.answer) || '' }))
      .catch((e) => sendResponse({ ok: false, error: e.message || String(e) }));
    return true;
  }

  // The popup asks us to fill the tab. Only our own extension pages may ask.
  if (msg.type === 'nc-fill') {
    if (!fromOurPage(sender)) return false;
    startFill(msg.tabId, msg.applicationId, msg.application)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((e) => sendResponse({ ok: false, error: e.message || String(e) }));
    return true;
  }

  if (msg.type === 'nc-status') {
    if (!fromOurPage(sender)) return false;
    sendResponse({ running: running.has(msg.tabId) });
    return false;
  }
  return false;
});

function startFill(tabId, applicationId, application) {
  if (running.has(tabId)) return running.get(tabId);
  const p = doFill(tabId, applicationId, application).finally(() => running.delete(tabId));
  running.set(tabId, p);
  return p;
}

async function setState(tabId, state) {
  try {
    await chrome.storage.session.set({ ['tab:' + tabId]: state });
  } catch {
    /* storage.session missing in very old Chrome: the popup still gets the reply */
  }
}

async function doFill(tabId, applicationId, application) {
  if (!tabId || !applicationId) throw new Error('Please choose which job this is first.');
  const tab = await chrome.tabs.get(tabId);
  await setState(tabId, { status: 'running', applicationId, url: tab.url, startedAt: Date.now() });

  try {
    // 1. Get everything from Next Chapter.
    const [profile, files, answersRes] = await Promise.all([
      api.profile(),
      api.files(applicationId),
      api.answers(applicationId).catch(() => ({ answers: [] })),
    ]);

    // 2. Put the filler into the page (and same-site frames inside it).
    const target = { tabId, allFrames: true };
    try {
      await chrome.scripting.executeScript({ target, files: ['content/filler.js'] });
    } catch (e) {
      // Some frames can't be reached; try just the main page.
      target.allFrames = false;
      try {
        await chrome.scripting.executeScript({ target, files: ['content/filler.js'] });
      } catch (e2) {
        throw new Error(
          "The helper can't work on this page. Open the job application form in this tab, then click the Next Chapter button again.",
        );
      }
    }

    // 3. Fill.
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const data = {
      applicationId,
      runId,
      profile,
      files: { resume: files && files.resume, cover_letter: files && files.cover_letter },
      answers: (answersRes && answersRes.answers) || [],
    };
    const results = await chrome.scripting.executeScript({
      target,
      func: (d) => (globalThis.NextChapterFiller ? globalThis.NextChapterFiller.fillFromExtension(d) : null),
      args: [data],
    });

    const frameReports = results.map((r) => r && r.result).filter(Boolean);
    const report = mergeReports(frameReports);

    // 4. Show her where to look: scroll to the first yellow box, and leave a note on the page.
    const withLeft = results.filter((r) => r && r.result && r.result.leftCount > 0);
    const scrollFrame = withLeft.find((r) => r.frameId === 0) || withLeft[0];
    const summary = summaryLine(report);
    try {
      if (scrollFrame) {
        await chrome.scripting.executeScript({
          target: { tabId, frameIds: [scrollFrame.frameId] },
          func: () => globalThis.NextChapterFiller && globalThis.NextChapterFiller.scrollToFirstLeft(document),
        });
      }
      if (report.fieldsFound > 0) {
        await chrome.scripting.executeScript({
          target: { tabId, frameIds: [0] },
          func: (s) => globalThis.NextChapterFiller && (globalThis.NextChapterFiller.showBanner(document, s), true),
          args: [summary],
        });
      }
    } catch {
      /* cosmetic only */
    }

    // 5. Tell Next Chapter she used the helper on this application.
    const didSomething = report.filled.length || report.answered.length || report.attached.resume || report.attached.cover_letter;
    let told = false;
    if (didSomething) {
      try {
        await api.filled(applicationId);
        told = true;
      } catch {
        told = false;
      }
    }

    const result = {
      summary,
      todo: todoList(report, { hasCoverLetter: !!(files && files.cover_letter) }),
      left: leftList(report),
      blockedFrames: report.blockedFrames,
      fieldsFound: report.fieldsFound,
      alreadyFilled: report.alreadyFilled,
      errors: report.errors,
      told,
      application: application || null,
    };
    await setState(tabId, { status: 'done', applicationId, url: tab.url, result, finishedAt: Date.now() });
    return result;
  } catch (e) {
    const message = e instanceof ApiError || e instanceof Error ? e.message : String(e);
    await setState(tabId, { status: 'error', applicationId, url: tab.url, error: message, finishedAt: Date.now() });
    throw new Error(message);
  }
}

// Forget a tab's report when she goes to another page in it.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url) chrome.storage.session.remove('tab:' + tabId).catch(() => {});
});
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove('tab:' + tabId).catch(() => {});
});
