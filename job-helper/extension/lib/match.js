// Small pure helpers shared by the popup and the service worker.
// Kept free of chrome.* so they can be tested in Node.

function hostOf(u) {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function pathParts(u) {
  try {
    return new URL(u).pathname.split('/').filter(Boolean).map((p) => p.toLowerCase());
  } catch {
    return [];
  }
}

function longNumbers(u) {
  return (String(u || '').match(/\d{5,}/g) || []);
}

/**
 * How well does the page she's on match an application's apply_url?
 * 0 = different website. Higher = better match.
 */
export function matchScore(tabUrl, applyUrl) {
  const th = hostOf(tabUrl);
  const ah = hostOf(applyUrl);
  if (!th || !ah || th !== ah) return 0;
  let score = 1;
  try {
    const a = new URL(applyUrl), t = new URL(tabUrl);
    if (a.pathname.replace(/\/+$/, '') === t.pathname.replace(/\/+$/, '') && a.search === t.search) score += 100;
  } catch { /* ignore */ }
  const ap = pathParts(applyUrl), tp = pathParts(tabUrl);
  for (let i = 0; i < Math.min(ap.length, tp.length) && ap[i] === tp[i]; i++) score += 2;
  // Job ids such as Greenhouse's gh_jid=4012345 or /jobs/4012345
  for (const n of longNumbers(applyUrl)) if (String(tabUrl).includes(n)) score += 20;
  return score;
}

/** The id of the application that best matches this page, or null. */
export function pickApplication(tabUrl, applications) {
  let best = null, bestScore = 0, tie = false;
  for (const app of applications || []) {
    const s = matchScore(tabUrl, app.apply_url);
    if (s > bestScore) { best = app; bestScore = s; tie = false; }
    else if (s && s === bestScore) tie = true;
  }
  // Two jobs on the same job board and nothing tells them apart: don't guess.
  if (!best || (tie && bestScore <= 1)) return null;
  return best.id;
}

/** Combine the reports from every frame of the page into one. */
export function mergeReports(reports) {
  const out = {
    fieldsFound: 0,
    filled: [],
    answered: [],
    attached: { resume: false, cover_letter: false },
    alreadyFilled: 0,
    leftForYou: [],
    manual: [],
    errors: [],
    blockedFrames: [],
    resumeWanted: false,
    coverWanted: false,
    leftCount: 0,
  };
  for (const r of reports || []) {
    if (!r) continue;
    if (r.error) { out.errors.push(r.error); continue; }
    out.fieldsFound += r.fieldsFound || 0;
    out.alreadyFilled += r.alreadyFilled || 0;
    out.leftCount += r.leftCount || 0;
    out.filled.push(...(r.filled || []));
    out.answered.push(...(r.answered || []));
    out.leftForYou.push(...(r.leftForYou || []));
    out.manual.push(...(r.manual || []));
    out.errors.push(...(r.errors || []));
    out.blockedFrames.push(...(r.blockedFrames || []));
    out.attached.resume = out.attached.resume || !!(r.attached && r.attached.resume);
    out.attached.cover_letter = out.attached.cover_letter || !!(r.attached && r.attached.cover_letter);
    out.resumeWanted = out.resumeWanted || !!r.resumeWanted;
    out.coverWanted = out.coverWanted || !!r.coverWanted;
  }
  // Frames we could open ourselves are not "blocked".
  const seen = new Set();
  out.blockedFrames = out.blockedFrames.filter((f) => {
    if (seen.has(f.origin)) return false;
    seen.add(f.origin);
    return true;
  });
  out.manual = [...new Set(out.manual)];
  return out;
}

/** "Filled 9 fields, attached resume + cover letter, wrote 2 answers." */
export function summaryLine(r) {
  const parts = [];
  const n = r.filled.length;
  if (n) parts.push(`filled ${n} field${n === 1 ? '' : 's'}`);
  const files = [];
  if (r.attached.resume) files.push('resume');
  if (r.attached.cover_letter) files.push('cover letter');
  if (files.length) parts.push(`attached ${files.join(' + ')}`);
  const a = r.answered.length;
  if (a) parts.push(`wrote ${a} answer${a === 1 ? '' : 's'}`);
  if (!parts.length) return 'Nothing was filled in.';
  const s = parts.join(', ') + '.';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Things she has to do herself, in plain words. */
export function todoList(r, { hasCoverLetter } = {}) {
  const todo = [...r.manual];
  if (!r.attached.resume && r.resumeWanted) todo.push('Attach your resume yourself (the website’s upload box didn’t let the helper do it).');
  if (!r.attached.resume && !r.resumeWanted && r.fieldsFound > 0) {
    todo.push('If the form asks for a resume, attach it yourself.');
  }
  if (hasCoverLetter && !r.attached.cover_letter && r.coverWanted) todo.push('Attach your cover letter yourself.');
  return [...new Set(todo)];
}

/** Group the boxes left for her into short readable lines. */
export function leftList(r) {
  const why = {
    private: 'private, for you to answer',
    choice: 'pick an answer',
    yours: 'for you to answer',
    missing: 'not in your Next Chapter profile',
    question: 'please write an answer',
    unknown: 'please fill in',
    'unknown-file': 'attach the right file',
    'no-file': 'no file in Next Chapter',
    'not-pdf': 'needs a Word file',
    'upload-failed': 'attach it yourself',
    'would-not-take': 'please type it in',
    'too-long': 'please type a shorter version',
  };
  const seen = new Set();
  const out = [];
  for (const item of r.leftForYou) {
    const k = item.label.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ label: item.label, why: why[item.reason] || 'please fill in', reason: item.reason });
  }
  return out;
}
