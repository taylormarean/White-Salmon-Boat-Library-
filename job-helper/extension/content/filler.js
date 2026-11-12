/*
 * Next Chapter browser helper: the form filler.
 *
 * This file is injected into the job application page only when she presses
 * "Fill this application" in the popup (chrome.scripting + activeTab). It:
 *   - finds the form's boxes (also inside same-origin iframes and open shadow roots)
 *   - works out what each box is asking for from its label
 *   - fills her contact details, attaches her resume and cover letter,
 *     and pastes answers to the questions
 *   - outlines filled boxes in green and boxes left for her in yellow
 *
 * It NEVER clicks a submit button (or any button), never submits a form and
 * never navigates. It never touches passwords, payment details, SSN, date of
 * birth or EEO / demographic questions.
 *
 * The core is a plain function, NextChapterFiller.fill({ profile, files,
 * answers, answerFn }), so it can be tested on a page without the extension.
 */
(function () {
  'use strict';

  var VERSION = '1.0.0';
  if (globalThis.NextChapterFiller && globalThis.NextChapterFiller.version === VERSION) return;

  // ---------------------------------------------------------------- patterns

  // Things we must never fill in for her. Matched against the box's label,
  // name, id, placeholder and autocomplete attribute.
  var SENSITIVE = [
    /pass(word|code|phrase)/,
    /social security|\bssn\b|social insurance|\bsin number\b|national (id|insurance)|tax (id|number)/,
    /credit card|debit card|card number|\bcvv\b|\bcvc\b|security code|expir(y|ation) date|billing address|payment (method|details|info)|\bbank (account|name|details|info)|routing number|account number|\biban\b|swift code/,
    /date of birth|birth ?date|\bdob\b|birthday|\bage\b|how old|18 years/,
    /\bgender\b|\bsex\b|pronoun|sexual orientation|transgender|lgbt/,
    /\brace\b|ethnic|hispanic|latin[oax]|national origin|citizenship|\bheritage\b/,
    /veteran|military (status|service)|armed forces|protected veteran/,
    /disabilit|handicap|impairment|accommodation/,
    /\beeo\b|\beeoc\b|equal (employment )?opportunit|demographic|self[- ]identif|voluntary (self|disclosure)|affirmative action|ofccp/,
    /marital|religio|criminal|convict|felony|arrest|background check/
  ];

  // Questions where an AI-written answer could state a wrong fact about her.
  // We only use an answer she has already approved in the app; otherwise
  // the box is left for her.
  var NO_AI = /salary|compensation|pay (expectation|range|requirement)|desired pay|expected pay|\bwage|hourly rate|authori[sz]ed to work|legally (able|eligible|authori)|work (permit|authori)|sponsor|visa|immigration|start date|when can you start|available to start|availability|notice period|relocat|\brefer(red|ral|ence)|how did you (hear|find|learn)|where did you (hear|find|see)|\bsource\b/;

  var HOW_HEARD = /how did you (hear|find|learn)|where did you (hear|find|see|learn)|referr(al|ed) (source|by)|^source$/;

  var OTHER_LINK = /github|gitlab|twitter|\bx\.com\b|facebook|instagram|tiktok|dribbble|behance|stack ?overflow|youtube/;

  // Words that change the meaning of a question. If one question has one of
  // these and the other doesn't, they are not the same question.
  var KEY_TERMS = ['salary', 'compensation', 'pay', 'relocate', 'relocation', 'sponsor', 'sponsorship', 'visa', 'authorized', 'authorised', 'start', 'notice', 'remote', 'travel', 'weekend', 'shift', 'license', 'licence', 'degree', 'certification', 'language', 'reference'];

  var STOP = new Set(('a an the and or of to in on for with your you yours are is be been being do does did have has had ' +
    'what why how which who whom when where this that these those it its as at by from our we us please ' +
    'describe tell about any if would like can could will should may might me my i am was were here there ' +
    'there also briefly explain share give list provide note optional required answer question').split(' '));

  // Generic job words count for less when comparing questions.
  var WEAK = new Set(['want', 'work', 'job', 'role', 'position', 'company', 'team', 'experience', 'interest', 'opportunit', 'year', 'time']);

  // ---------------------------------------------------------------- helpers

  function norm(s) {
    return String(s == null ? '' : s).replace(/[ \s]+/g, ' ').replace(/\s*\*\s*$/, '').trim();
  }

  function humanize(s) {
    return String(s || '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_\-.[\]]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function lower(s) { return norm(s).toLowerCase(); }

  function winOf(el) { return (el.ownerDocument && el.ownerDocument.defaultView) || window; }

  function tagOf(el) { return el.tagName ? el.tagName.toLowerCase() : ''; }

  function typeOf(el) {
    var t = tagOf(el);
    if (t === 'textarea') return 'textarea';
    if (t === 'select') return 'select';
    return (el.getAttribute('type') || 'text').toLowerCase();
  }

  function isVisible(el) {
    if (!el.isConnected) return false;
    var win = winOf(el);
    var st = win.getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || st.visibility === 'collapse') return false;
    var r = el.getClientRects();
    if (!r.length) return false;
    var b = el.getBoundingClientRect();
    return b.width > 0 || b.height > 0;
  }

  function hasValue(el) {
    var t = typeOf(el);
    if (t === 'file') return !!(el.files && el.files.length);
    if (t === 'checkbox' || t === 'radio') return el.checked;
    if (t === 'select') {
      if (el.multiple) return el.selectedOptions.length > 0;
      var opt = el.options[el.selectedIndex];
      if (!opt) return false;
      if (!norm(opt.value) && !norm(opt.text)) return false;
      // "Select...", "Please select", "--" style first options mean "nothing chosen".
      if (el.selectedIndex === 0 && (!norm(opt.value) || /^(select|choose|please|--|—|none)/i.test(norm(opt.text)))) return false;
      return true;
    }
    return norm(el.value) !== '';
  }

  // Text of an element without the text of form controls inside it
  // (a wrapping <label> around a <select> would otherwise include every option).
  function textWithoutControls(node) {
    if (!node) return '';
    var clone = node.cloneNode(true);
    var junk = clone.querySelectorAll('select, option, textarea, input, button, script, style, svg, [aria-hidden="true"]');
    for (var i = 0; i < junk.length; i++) junk[i].remove();
    return norm(clone.textContent);
  }

  function byIdInRoot(root, id) {
    if (!id) return null;
    if (root.getElementById) return root.getElementById(id);
    try { return root.querySelector('#' + CSS.escape(id)); } catch (e) { return null; }
  }

  function labelFromIds(el, attr) {
    var ids = (el.getAttribute(attr) || '').split(/\s+/).filter(Boolean);
    if (!ids.length) return '';
    var root = el.getRootNode();
    var parts = [];
    for (var i = 0; i < ids.length; i++) {
      var ref = byIdInRoot(root, ids[i]) || (el.ownerDocument && el.ownerDocument.getElementById(ids[i]));
      if (ref) parts.push(textWithoutControls(ref));
    }
    return norm(parts.join(' '));
  }

  // Look at text just before the box: previous siblings, then the parents'
  // previous siblings, a few levels up. Stops at another form control.
  function nearbyText(el) {
    var node = el;
    for (var depth = 0; depth < 4 && node; depth++) {
      var sib = node.previousElementSibling;
      var hops = 0;
      while (sib && hops < 3) {
        if (sib.matches && sib.matches('input, select, textarea')) return '';
        if (sib.matches && sib.matches('a, button, [role=button], script, style, svg, img')) { sib = sib.previousElementSibling; hops++; continue; }
        if (sib.querySelector && sib.querySelector('input:not([type=hidden]), select, textarea')) break;
        var t = textWithoutControls(sib);
        if (t && t.length <= 300) return t;
        sib = sib.previousElementSibling;
        hops++;
      }
      node = node.parentElement;
      if (node && node.matches && node.matches('form, body, fieldset')) break;
    }
    return '';
  }

  function legendText(el) {
    var fs = el.closest && el.closest('fieldset');
    if (fs) {
      var lg = fs.querySelector('legend');
      if (lg) return textWithoutControls(lg);
    }
    var group = el.closest && el.closest('[role=radiogroup], [role=group]');
    if (group) {
      var t = labelFromIds(group, 'aria-labelledby') || norm(group.getAttribute('aria-label'));
      if (t) return t;
    }
    return '';
  }

  /**
   * Work out what a box is called. Returns { label, hints, source }.
   * label: the human question text. hints: name/id/placeholder/autocomplete.
   */
  function describeField(el) {
    var label = '';
    var source = '';
    var t = typeOf(el);
    var root = el.getRootNode();

    if (t === 'radio' || t === 'checkbox') {
      // For a choice, the group's question matters more than "Yes"/"No".
      label = legendText(el);
      if (label) source = 'legend';
    }
    if (!label) { label = labelFromIds(el, 'aria-labelledby'); if (label) source = 'aria-labelledby'; }
    if (!label && el.id) {
      var lab = null;
      try { lab = root.querySelector('label[for="' + CSS.escape(el.id) + '"]'); } catch (e) { lab = null; }
      if (lab) { label = textWithoutControls(lab); if (label) source = 'label-for'; }
    }
    if (!label) {
      var wrap = el.closest && el.closest('label');
      if (wrap) { label = textWithoutControls(wrap); if (label) source = 'label-wrap'; }
    }
    if (!label) { label = norm(el.getAttribute('aria-label')); if (label) source = 'aria-label'; }
    if (!label && (t === 'radio' || t === 'checkbox')) {
      label = nearbyText(el.closest('div, li, p') || el);
      if (label) source = 'nearby';
    }
    if (!label) { label = norm(el.getAttribute('placeholder')); if (label) source = 'placeholder'; }
    if (!label) { label = nearbyText(el); if (label) source = 'nearby'; }
    if (!label) { label = norm(el.getAttribute('title')); if (label) source = 'title'; }
    if (!label) { label = humanize(el.getAttribute('name') || el.id); if (label) source = 'name'; }

    var hints = [
      el.getAttribute('autocomplete') || '',
      el.getAttribute('placeholder') || '',
      humanize(el.getAttribute('name')),
      humanize(el.id),
      el.getAttribute('aria-label') || '',
      humanize(el.getAttribute('data-automation-id') || el.getAttribute('data-qa') || el.getAttribute('data-testid') || '')
    ].join(' | ').toLowerCase();

    return { label: label.replace(/\s*\*\s*$/, '').trim(), hints: hints, source: source };
  }

  function isSensitive(el, info) {
    if (typeOf(el) === 'password') return true;
    var hay = (info.label + ' | ' + info.hints).toLowerCase();
    for (var i = 0; i < SENSITIVE.length; i++) if (SENSITIVE[i].test(hay)) return true;
    // Inside an EEO / demographic section?
    var sec = el.closest && el.closest('fieldset, section, [class*=eeo i], [id*=eeo i], [class*=demographic i], [id*=demographic i]');
    if (sec) {
      var cls = ((sec.className && sec.className.baseVal !== undefined ? sec.className.baseVal : sec.className) || '') + ' ' + (sec.id || '');
      if (/eeo|demographic|self.?identif/i.test(cls)) return true;
      var lg = sec.querySelector && sec.querySelector('legend, h1, h2, h3, h4');
      if (lg && /equal (employment )?opportunit|\beeo\b|demographic|self[- ]identif|voluntary/i.test(lg.textContent || '')) return true;
    }
    return false;
  }

  // ------------------------------------------------------ contact fields

  var CONTACT = [
    { key: 'email', ac: /^email$/, re: /\be-?mail\b/ },
    { key: 'phone', ac: /^tel(-national)?$/, re: /\b(phone|mobile|cell|telephone|tel)\b/ },
    { key: 'linkedin_url', ac: null, re: /linked ?in/ },
    { key: 'preferred', ac: null, re: /preferred|nick ?name|goes by|middle/ },
    { key: 'first_name', ac: /^given-name$/, re: /\b(first|given|fore) ?name\b|^first$|\bfname\b/ },
    { key: 'last_name', ac: /^family-name$/, re: /\b(last|family|sur) ?name\b|^last$|\blname\b|\bsurname\b/ },
    { key: 'current_company', ac: /^organization$/, re: /\b(current|present|most recent|latest) (company|employer|organi[sz]ation)\b|^(company|employer)( name)?$/ },
    { key: 'current_title', ac: /^organization-title$/, re: /\b(current|present|most recent|latest) (job )?(title|role|position)\b|^(job )?title$/ },
    { key: 'name', ac: /^name$/, re: /^(your )?(full |legal |complete )?name$|\bfull ?name\b|^name\b/ },
    { key: 'address', ac: /street-address|address-line|postal-code|country|address-level1/, re: /street|address ?line|\bzip\b|postal|post ?code|\bstate\b|province|country|^address$/ },
    { key: 'location', ac: /^address-level2$/, re: /\b(location|city|town)\b|where (are you|do you) (currently )?(located|live|based)|\bbased in\b/ },
    { key: 'other_link', ac: null, re: OTHER_LINK },
    { key: 'website_url', ac: /^url$/, re: /\b(website|web site|portfolio|personal (site|url|page|link)|blog|homepage)\b|^url$|^link$/ }
  ];

  function profileValue(key, profile) {
    profile = profile || {};
    var name = norm(profile.name);
    var parts = name ? name.split(' ') : [];
    switch (key) {
      case 'first_name': return norm(profile.first_name) || parts[0] || '';
      case 'last_name': return norm(profile.last_name) || (parts.length > 1 ? parts[parts.length - 1] : '');
      case 'name': return name || norm([profile.first_name, profile.last_name].join(' '));
      case 'email': return norm(profile.email);
      case 'phone': return norm(profile.phone);
      case 'location': return norm(profile.location);
      case 'linkedin_url': return norm(profile.linkedin_url);
      case 'website_url': return norm(profile.website_url);
      case 'current_company': return norm(profile.current_company);
      case 'current_title': return norm(profile.current_title);
      default: return '';
    }
  }

  function matchContact(el, info) {
    var t = typeOf(el);
    var ac = (el.getAttribute('autocomplete') || '').toLowerCase().replace(/^section-\S+\s+/, '').replace(/^(shipping|billing)\s+/, '').trim();
    var label = lower(info.label);
    var longLabel = label.length > 45 || t === 'textarea';

    // Strong signals first.
    if (ac && ac !== 'on' && ac !== 'off') {
      for (var i = 0; i < CONTACT.length; i++) if (CONTACT[i].ac && CONTACT[i].ac.test(ac)) return CONTACT[i].key;
    }
    if (t === 'email') return 'email';
    if (t === 'tel') return 'phone';

    // A short yes/no style question ("Have you worked in phone sales?") is not a contact box.
    if (/\?\s*$/.test(label) && !/(number|e-?mail|address|url|link|profile|name|city|location|where)/.test(label)) return null;

    if (longLabel) {
      // A long question can still be asking for a link ("What is your LinkedIn profile URL?").
      if (t === 'textarea') return null;
      if (/linked ?in/.test(label) && /url|link|profile|address/.test(label)) return 'linkedin_url';
      if (/(website|portfolio)/.test(label) && /url|link|address/.test(label) && !OTHER_LINK.test(label)) return 'website_url';
      return null;
    }

    var texts = [label, lower(el.getAttribute('placeholder')), humanize(el.getAttribute('name')), humanize(el.id)];
    for (var j = 0; j < texts.length; j++) {
      var s = texts[j];
      if (!s) continue;
      for (var k = 0; k < CONTACT.length; k++) {
        if (CONTACT[k].re.test(s)) {
          var key = CONTACT[k].key;
          if (t === 'url' && key !== 'linkedin_url' && key !== 'website_url' && key !== 'other_link') continue;
          return key;
        }
      }
    }
    if (t === 'url') return OTHER_LINK.test(label) ? 'other_link' : 'website_url';
    return null;
  }

  function isQuestion(el, info) {
    if (typeOf(el) === 'textarea') return true;
    var l = norm(info.label);
    if (!l) return false;
    if (/\?\s*$/.test(l)) return true;
    if (l.length > 25) return true;
    return /^(why|what|how|describe|tell|please|explain|are|do|have|which|when|list|share|in your own words)\b/i.test(l);
  }

  // ------------------------------------------------------ question matching

  function stem(w) {
    if (w.length > 5 && /ing$/.test(w)) return w.slice(0, -3);
    if (w.length > 4 && /ies$/.test(w)) return w.slice(0, -3) + 'y';
    if (w.length > 4 && /ed$/.test(w)) return w.slice(0, -2);
    if (w.length > 4 && /es$/.test(w) && !/(ss|us)es$/.test(w)) return w.slice(0, -1);
    if (w.length > 3 && /s$/.test(w) && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
    return w;
  }

  function tokens(s) {
    var out = [];
    var words = String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').split(' ');
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (w.length < 2 || STOP.has(w)) continue;
      w = stem(w);
      if (/^opportunit/.test(w)) w = 'opportunit';
      if (/^interest/.test(w)) w = 'interest';
      if (!STOP.has(w) && out.indexOf(w) < 0) out.push(w);
    }
    return out;
  }

  function weight(w) { return WEAK.has(w) ? 0.5 : 1; }

  // Weighted word-overlap similarity between two questions, 0..1.
  function similarity(a, b) {
    var A = tokens(a), B = tokens(b);
    if (!A.length || !B.length) return 0;
    var rawA = String(a).toLowerCase(), rawB = String(b).toLowerCase();
    for (var k = 0; k < KEY_TERMS.length; k++) {
      var re = new RegExp('\\b' + KEY_TERMS[k]);
      if (re.test(rawA) !== re.test(rawB)) return 0;
    }
    var wa = 0, wb = 0, common = 0;
    for (var i = 0; i < A.length; i++) { wa += weight(A[i]); if (B.indexOf(A[i]) >= 0) common += weight(A[i]); }
    for (var j = 0; j < B.length; j++) wb += weight(B[j]);
    return common / Math.sqrt(wa * wb);
  }

  var MATCH_THRESHOLD = 0.6;

  function bestDrafted(question, answers) {
    var best = null, bestScore = 0;
    for (var i = 0; i < (answers || []).length; i++) {
      var a = answers[i];
      if (!a || !a.question || !norm(a.answer)) continue;
      var s = similarity(question, a.question);
      if (s > bestScore) { bestScore = s; best = a; }
    }
    return bestScore >= MATCH_THRESHOLD ? { answer: best.answer, question: best.question, score: bestScore } : null;
  }

  function maxCharsFor(el, label) {
    var ml = el.maxLength;
    if (ml && ml > 0 && ml < 100000) return ml;
    var m = /(?:max(?:imum)?|up to|limit(?:ed)? to|no more than|less than|under|at most)\s*(?:of\s*)?(\d{2,5})\s*(characters|chars|character)/i.exec(label);
    if (m) return parseInt(m[1], 10);
    m = /(\d{2,5})\s*(characters|chars)\s*(max|maximum|or less|or fewer|limit)/i.exec(label);
    if (m) return parseInt(m[1], 10);
    m = /(?:max(?:imum)?|up to|limit(?:ed)? to|no more than|less than|under|at most)\s*(?:of\s*)?(\d{2,4})\s*words/i.exec(label);
    if (m) return parseInt(m[1], 10) * 6;
    return null;
  }

  function fitLength(text, max) {
    text = String(text || '').trim();
    if (!max || text.length <= max) return text;
    var cut = text.slice(0, max);
    var end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf('.\n'));
    if (end > max * 0.5) return cut.slice(0, end + 1).trim();
    var sp = cut.lastIndexOf(' ');
    return (sp > max * 0.5 ? cut.slice(0, sp) : cut).trim();
  }

  // For a dropdown or radio group: which option says the same as the answer?
  function chooseOption(optionTexts, answer) {
    var a = lower(answer);
    if (!a) return -1;
    var i;
    for (i = 0; i < optionTexts.length; i++) if (lower(optionTexts[i]) === a) return i;
    var yes = /^(yes|yeah|yep|i am|i do|i have|i can|i will|correct|absolutely|sure)\b/.test(a);
    var no = /^(no|nope|i am not|i do not|i don't|i have not|i haven't|i cannot|i can't|i won't|not)\b/.test(a);
    if (yes || no) {
      for (i = 0; i < optionTexts.length; i++) {
        var o = lower(optionTexts[i]);
        if (yes && /^yes\b/.test(o)) return i;
        if (no && /^no\b/.test(o)) return i;
      }
    }
    for (i = 0; i < optionTexts.length; i++) {
      var ot = lower(optionTexts[i]);
      if (ot.length > 2 && a.indexOf(ot) === 0) return i;
    }
    return -1;
  }

  // ------------------------------------------------------ setting values

  function protoSetter(el, prop) {
    var proto = Object.getPrototypeOf(el);
    while (proto) {
      var d = Object.getOwnPropertyDescriptor(proto, prop);
      if (d && d.set) return d.set;
      proto = Object.getPrototypeOf(proto);
    }
    return null;
  }

  function fire(el, type, bubbles) {
    var win = winOf(el);
    var ev;
    if (type === 'input') {
      try { ev = new win.InputEvent('input', { bubbles: true, cancelable: false, inputType: 'insertText' }); } catch (e) { ev = new win.Event('input', { bubbles: true }); }
    } else if (type === 'blur' || type === 'focusout') {
      ev = new win.FocusEvent(type, { bubbles: type === 'focusout' });
    } else {
      ev = new win.Event(type, { bubbles: bubbles !== false });
    }
    el.dispatchEvent(ev);
  }

  // Set a value the way a person typing would, so React / Vue / Angular notice.
  function setValue(el, value) {
    var setter = protoSetter(el, 'value');
    if (setter) setter.call(el, value); else el.value = value;
    fire(el, 'input');
    fire(el, 'change');
    fire(el, 'blur');
    fire(el, 'focusout');
    return el.value === value || norm(el.value) === norm(value);
  }

  function selectIndex(el, idx) {
    var setter = protoSetter(el, 'selectedIndex');
    if (setter) setter.call(el, idx); else el.selectedIndex = idx;
    fire(el, 'input');
    fire(el, 'change');
    fire(el, 'blur');
    fire(el, 'focusout');
  }

  function base64ToBytes(b64) {
    var clean = String(b64 || '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
    var bin = atob(clean);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function acceptsPdf(el) {
    var acc = lower(el.getAttribute('accept'));
    if (!acc) return true;
    return /pdf|\*\/\*|application\/\*|^\*$/.test(acc);
  }

  function attachFile(el, fileInfo) {
    var win = winOf(el);
    var file = new win.File([base64ToBytes(fileInfo.base64)], fileInfo.filename || 'document.pdf', {
      type: fileInfo.mime || 'application/pdf',
      lastModified: Date.now()
    });
    var dt = new win.DataTransfer();
    dt.items.add(file);
    el.files = dt.files;
    fire(el, 'input');
    fire(el, 'change');
    return !!(el.files && el.files.length && el.files[0].name === file.name);
  }

  // ------------------------------------------------------ highlighting

  var COLORS = {
    filled: { outline: '3px solid rgba(67, 160, 71, 0.85)', shadow: '0 0 0 5px rgba(129, 199, 132, 0.30)' },
    left: { outline: '3px solid rgba(242, 177, 0, 0.95)', shadow: '0 0 0 5px rgba(255, 213, 79, 0.35)' }
  };

  function visibleBox(el) {
    if (isVisible(el)) return el;
    var p = el.parentElement;
    for (var i = 0; i < 5 && p; i++) {
      if (isVisible(p) && p.getBoundingClientRect().height > 10) return p;
      p = p.parentElement;
    }
    return null;
  }

  function highlight(el, kind) {
    var box = visibleBox(el);
    if (!box) return null;
    var c = COLORS[kind];
    box.style.setProperty('outline', c.outline, 'important');
    box.style.setProperty('outline-offset', '2px', 'important');
    box.style.setProperty('box-shadow', c.shadow, 'important');
    box.setAttribute('data-nc-highlight', kind);
    return box;
  }

  // ------------------------------------------------------ finding controls

  var CONTROL_SELECTOR = 'input, textarea, select';

  function collectDocs(doc, out, blocked) {
    out.push(doc);
    var frames = doc.querySelectorAll('iframe, frame');
    for (var i = 0; i < frames.length; i++) {
      var f = frames[i];
      var child = null;
      try { child = f.contentDocument; } catch (e) { child = null; }
      if (child && child.documentElement) {
        if (out.indexOf(child) < 0) collectDocs(child, out, blocked);
      } else if (isVisible(f)) {
        var r = f.getBoundingClientRect();
        var src = f.src || f.getAttribute('src') || '';
        if (r.width > 150 && r.height > 150 && /^https?:/.test(src)) {
          try { blocked.push({ origin: new URL(src).origin, src: src }); } catch (e) { /* ignore */ }
        }
      }
    }
  }

  function collectFromRoot(root, out) {
    var all = root.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.matches(CONTROL_SELECTOR)) out.push(el);
      if (el.shadowRoot) collectFromRoot(el.shadowRoot, out);
    }
  }

  function isSkippableType(t) {
    return /^(hidden|submit|button|reset|image|search|range|color)$/.test(t);
  }

  function inSearchArea(el) {
    return !!(el.closest && el.closest('[role=search], header nav, nav [role=search]'));
  }

  // Keep only the controls that are part of the application form, not the
  // site's search box or a newsletter sign-up in the footer.
  function scopeControls(controls) {
    var byForm = new Map();
    controls.forEach(function (el) {
      var f = el.form || (el.closest && el.closest('form')) || null;
      if (!byForm.has(f)) byForm.set(f, 0);
      if (!isSkippableType(typeOf(el))) byForm.set(f, byForm.get(f) + 1);
    });
    var docsWithBigForm = new Set();
    byForm.forEach(function (n, f) { if (f && n >= 3) docsWithBigForm.add(f.ownerDocument); });
    return controls.filter(function (el) {
      if (inSearchArea(el)) return false;
      var f = el.form || (el.closest && el.closest('form')) || null;
      if (f && byForm.get(f) < 3 && docsWithBigForm.has(f.ownerDocument)) return false;
      return true;
    });
  }

  function findControls(doc) {
    var docs = [], blocked = [];
    collectDocs(doc, docs, blocked);
    var controls = [];
    docs.forEach(function (d) { collectFromRoot(d, controls); });
    controls = controls.filter(function (el) {
      var t = typeOf(el);
      if (isSkippableType(t)) return false;
      if (el.closest && el.closest('[data-next-chapter-ui]')) return false;
      return true;
    });
    return { controls: scopeControls(controls), blockedFrames: blocked };
  }

  function short(label) {
    var l = norm(label) || 'A box with no name';
    return l.length > 80 ? l.slice(0, 77) + '...' : l;
  }

  function looksLikeResumeUploader(doc) {
    var text = '';
    try { text = (doc.body && (doc.body.innerText || doc.body.textContent)) || ''; } catch (e) { text = ''; }
    return /(upload|attach|drop|choose|select)[^.\n]{0,40}\b(resume|résumé|cv)\b|\b(resume|résumé|cv)\b[^.\n]{0,40}(upload|attach|drop|browse|choose file)/i.test(text);
  }

  async function pool(items, limit, fn) {
    var i = 0;
    async function worker() {
      while (i < items.length) {
        var idx = i++;
        await fn(items[idx], idx);
      }
    }
    var workers = [];
    for (var k = 0; k < Math.min(limit, items.length); k++) workers.push(worker());
    await Promise.all(workers);
  }

  // ------------------------------------------------------ main

  /**
   * Fill the application form on this page.
   * @param {object} opts
   *   profile   { name, email, phone, location, linkedin_url, website_url, first_name, last_name }
   *   files     { resume: {filename, mime, base64}, cover_letter: {...}|null }
   *   answers   [{ question, answer }]   answers already drafted in the app
   *   answerFn  async (question, maxChars) => string   asks the AI (optional)
   *   runId     string; the same box is never handled twice in one run
   *   doc       the document to fill (default: this page)
   *   scroll    scroll to the first yellow box when done (default true)
   *   banner    show the "please check, then submit yourself" note (default true)
   * @returns report object (plain JSON)
   */
  async function fill(opts) {
    opts = opts || {};
    var doc = opts.doc || document;
    var profile = opts.profile || {};
    var files = opts.files || {};
    var answers = opts.answers || [];
    var answerFn = typeof opts.answerFn === 'function' ? opts.answerFn : null;
    var runId = String(opts.runId || Date.now());

    var report = {
      version: VERSION,
      url: (doc.location && doc.location.href) || '',
      isTopFrame: (function () { try { return window.top === window; } catch (e) { return false; } })(),
      fieldsFound: 0,
      filled: [],        // contact details and choices: [{ label, field }]
      answered: [],      // questions: [{ label, source: 'drafted'|'ai' }]
      attached: { resume: false, cover_letter: false },
      alreadyFilled: 0,
      leftForYou: [],    // [{ label, reason }]
      manual: [],        // plain-language things she must do herself
      errors: [],
      blockedFrames: [],
      resumeWanted: false,
      coverWanted: false
    };

    var found = findControls(doc);
    report.blockedFrames = found.blockedFrames;

    var mine = found.controls.filter(function (el) {
      if (el.getAttribute('data-nc-run') === runId) return false;
      el.setAttribute('data-nc-run', runId);
      return true;
    });

    var left = function (el, label, reason) {
      report.leftForYou.push({ label: short(label), reason: reason });
      var box = highlight(el, 'left');
      if (box) leftBoxes.push(box);
    };
    var leftBoxes = [];
    var handledRadioGroups = new Set();
    var questions = [];
    var fileInputs = [];

    for (var i = 0; i < mine.length; i++) {
      var el = mine[i];
      var t = typeOf(el);
      if (t !== 'file' && !isVisible(el)) continue;
      if (el.disabled) continue;
      if (t !== 'file' && el.readOnly && t !== 'select') continue;
      report.fieldsFound++;

      var info = describeField(el);
      var required = el.required || el.getAttribute('aria-required') === 'true' || /\*\s*$/.test(info.label);

      if (t === 'file') { fileInputs.push({ el: el, info: info }); continue; }

      if (isSensitive(el, info)) {
        if (t === 'radio') {
          var gk = 'sens:' + (el.name || info.label);
          if (handledRadioGroups.has(gk)) continue;
          handledRadioGroups.add(gk);
          left(el.closest('fieldset, [role=radiogroup]') || el.parentElement || el, info.label, 'private');
        } else if (!hasValue(el)) {
          left(el, info.label, 'private');
        }
        continue;
      }

      if (t === 'radio') {
        var key = el.name ? 'r:' + el.name : 'r:' + info.label;
        if (handledRadioGroups.has(key)) continue;
        handledRadioGroups.add(key);
        var root = el.getRootNode();
        var group = el.name ? Array.prototype.slice.call(root.querySelectorAll('input[type=radio]')).filter(function (r) { return r.name === el.name; }) : [el];
        if (group.some(function (r) { return r.checked; })) { report.alreadyFilled++; continue; }
        var gLabel = info.label;
        var container = el.closest('fieldset, [role=radiogroup]') || el.parentElement;
        var drafted = bestDrafted(gLabel, answers);
        if (drafted) {
          var optTexts = group.map(function (r) { var d = describeField(r); return labelFromIds(r, 'aria-labelledby') || (r.closest('label') ? textWithoutControls(r.closest('label')) : '') || r.value || d.label; });
          var idx = chooseOption(optTexts, drafted.answer);
          if (idx >= 0) {
            group[idx].click();
            if (group[idx].checked) {
              report.filled.push({ label: short(gLabel), field: 'choice' });
              highlight(container, 'filled');
              continue;
            }
          }
        }
        left(container, gLabel, 'choice');
        continue;
      }

      if (t === 'checkbox') {
        // Consent and "I certify" boxes are hers to tick.
        if (!el.checked && required) left(el.parentElement && el.parentElement.tagName === 'LABEL' ? el.parentElement : el, info.label, 'choice');
        continue;
      }

      if (hasValue(el)) { report.alreadyFilled++; continue; }

      if (t === 'select') {
        if (HOW_HEARD.test(lower(info.label))) { left(el, info.label, 'yours'); continue; }
        var d2 = bestDrafted(info.label, answers);
        if (d2) {
          var texts = Array.prototype.map.call(el.options, function (o) { return o.text; });
          var oi = chooseOption(texts, d2.answer);
          if (oi > 0 || (oi === 0 && norm(el.options[0].value))) {
            selectIndex(el, oi);
            report.filled.push({ label: short(info.label), field: 'choice' });
            highlight(el, 'filled');
            continue;
          }
        }
        left(el, info.label, 'choice');
        continue;
      }

      // Text boxes.
      var contact = matchContact(el, info);
      if (contact) {
        if (contact === 'preferred' || contact === 'other_link' || contact === 'address') { left(el, info.label, 'yours'); continue; }
        var v = profileValue(contact, profile);
        if (!v) { left(el, info.label, 'missing'); continue; }
        if (el.maxLength > 0 && v.length > el.maxLength) { left(el, info.label, 'too-long'); continue; }
        if (setValue(el, v)) {
          report.filled.push({ label: short(info.label), field: contact });
          highlight(el, 'filled');
        } else {
          left(el, info.label, 'would-not-take');
        }
        continue;
      }

      if (HOW_HEARD.test(lower(info.label))) { left(el, info.label, 'yours'); continue; }

      if (isQuestion(el, info)) { questions.push({ el: el, info: info }); continue; }

      left(el, info.label, 'unknown');
    }

    // ---- files
    var resumeInputs = [], coverInputs = [], otherInputs = [];
    fileInputs.forEach(function (f) {
      var hay = (f.info.label + ' | ' + f.info.hints + ' | ' + lower(nearbyText(f.el))).toLowerCase();
      if (/cover/.test(hay)) coverInputs.push(f);
      else if (/resume|résumé|\bcv\b|curriculum/.test(hay)) resumeInputs.push(f);
      else otherInputs.push(f);
    });
    if (!resumeInputs.length && otherInputs.length === 1 && fileInputs.length === 1) resumeInputs.push(otherInputs.pop());
    if (resumeInputs.length) report.resumeWanted = true;
    if (coverInputs.length) report.coverWanted = true;

    function doAttach(list, fileInfo, kind, name) {
      list.forEach(function (f, n) {
        if (n > 0) return; // one copy is enough
        if (f.el.files && f.el.files.length) { report.attached[kind] = true; report.alreadyFilled++; return; }
        if (!fileInfo || !fileInfo.base64) {
          if (kind === 'cover_letter') left(f.el, f.info.label || 'Cover letter', 'no-file');
          return;
        }
        if (!acceptsPdf(f.el)) {
          left(f.el, f.info.label || name, 'not-pdf');
          report.manual.push('This site does not take PDF files for your ' + name + '. Please attach a Word copy yourself (you can download one from Next Chapter).');
          return;
        }
        try {
          if (attachFile(f.el, fileInfo)) {
            report.attached[kind] = true;
            highlight(f.el, 'filled');
          } else {
            left(f.el, f.info.label || name, 'upload-failed');
          }
        } catch (e) {
          report.errors.push('Could not attach ' + name + ': ' + (e && e.message));
          left(f.el, f.info.label || name, 'upload-failed');
        }
      });
    }
    doAttach(resumeInputs, files.resume, 'resume', 'resume');
    doAttach(coverInputs, files.cover_letter, 'cover_letter', 'cover letter');
    otherInputs.forEach(function (f) { if (!(f.el.files && f.el.files.length)) left(f.el, f.info.label || 'File upload', 'unknown-file'); });

    if (!report.attached.resume && !resumeInputs.length && looksLikeResumeUploader(doc)) report.resumeWanted = true;

    // ---- questions
    var aiQueue = [];
    questions.forEach(function (q) {
      var label = q.info.label;
      var l = lower(label);
      if (/cover letter/.test(l) && !/\?/.test(l) && (report.attached.cover_letter)) return; // the PDF is attached already
      if (/(paste|copy).{0,20}(resume|cv)|^resume$|^cv$/.test(l)) { if (!report.attached.resume) left(q.el, label, 'yours'); return; }
      var max = maxCharsFor(q.el, label);
      var drafted = bestDrafted(label, answers);
      if (drafted) {
        var text = fitLength(drafted.answer, max);
        if (setValue(q.el, text)) {
          report.answered.push({ label: short(label), source: 'drafted' });
          highlight(q.el, 'filled');
        } else {
          left(q.el, label, 'would-not-take');
        }
        return;
      }
      if (NO_AI.test(l) || /cover letter/.test(l)) { left(q.el, label, 'yours'); return; }
      if (!answerFn) { left(q.el, label, 'question'); return; }
      aiQueue.push({ el: q.el, label: label, max: max });
    });

    await pool(aiQueue, 3, async function (q) {
      try {
        var ans = await answerFn(q.label, q.max || undefined);
        ans = fitLength(ans, q.max);
        if (!ans) { left(q.el, q.label, 'question'); return; }
        if (hasValue(q.el)) { report.alreadyFilled++; return; } // she typed meanwhile
        if (setValue(q.el, ans)) {
          report.answered.push({ label: short(q.label), source: 'ai' });
          highlight(q.el, 'filled');
        } else {
          left(q.el, q.label, 'would-not-take');
        }
      } catch (e) {
        report.errors.push('Could not write an answer for "' + short(q.label) + '": ' + (e && e.message ? e.message : e));
        left(q.el, q.label, 'question');
      }
    });

    report.leftCount = leftBoxes.length;
    if (opts.scroll !== false) scrollToFirstLeft(doc);
    if (opts.banner !== false && report.isTopFrame) showBanner(doc, summarize(report));
    return report;
  }

  function scrollToFirstLeft(doc) {
    doc = doc || document;
    var docs = [], blocked = [];
    collectDocs(doc, docs, blocked);
    var first = null;
    for (var i = 0; i < docs.length && !first; i++) {
      var found = [];
      (function walk(root) {
        var els = root.querySelectorAll('[data-nc-highlight="left"]');
        for (var k = 0; k < els.length; k++) found.push(els[k]);
        var all = root.querySelectorAll('*');
        for (var j = 0; j < all.length; j++) if (all[j].shadowRoot) walk(all[j].shadowRoot);
      })(docs[i]);
      if (found.length) {
        found.sort(function (a, b) { return a.getBoundingClientRect().top - b.getBoundingClientRect().top; });
        first = found[0];
      }
    }
    if (first) {
      try { first.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { first.scrollIntoView(); }
      return true;
    }
    return false;
  }

  // A short plain-language summary, used by the popup and the page note.
  function summarize(r) {
    var parts = [];
    var nFilled = r.filled.length;
    if (nFilled) parts.push('Filled ' + nFilled + ' field' + (nFilled === 1 ? '' : 's'));
    var files = [];
    if (r.attached.resume) files.push('resume');
    if (r.attached.cover_letter) files.push('cover letter');
    if (files.length) parts.push('attached ' + files.join(' + '));
    var nAns = r.answered.length;
    if (nAns) parts.push('wrote ' + nAns + ' answer' + (nAns === 1 ? '' : 's'));
    var s = parts.length ? parts.join(', ') + '.' : 'Nothing was filled in.';
    s = s.charAt(0).toUpperCase() + s.slice(1);
    return s;
  }

  function showBanner(doc, summary) {
    doc = doc || document;
    var old = doc.querySelector('[data-next-chapter-ui]');
    if (old) old.remove();
    var host = doc.createElement('div');
    host.setAttribute('data-next-chapter-ui', 'banner');
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; right: 16px; bottom: 16px; max-width: 380px;';
    var shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML =
      '<style>' +
      '.card{font:17px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1f2a24;background:#fff;border:2px solid #2e7d4f;border-radius:14px;box-shadow:0 8px 28px rgba(0,0,0,.22);padding:16px 18px;}' +
      '.title{font-weight:700;font-size:18px;margin:0 0 6px;color:#1b5e3a}' +
      'p{margin:6px 0}' +
      '.key{display:inline-block;width:14px;height:14px;border-radius:3px;vertical-align:-2px;margin-right:6px}' +
      '.g{outline:3px solid rgba(67,160,71,.85)}.y{outline:3px solid rgba(242,177,0,.95)}' +
      '.important{font-weight:700}' +
      'button{font:inherit;font-weight:700;margin-top:8px;background:#2e7d4f;color:#fff;border:0;border-radius:10px;padding:10px 18px;cursor:pointer}' +
      'button:focus-visible{outline:3px solid #1b5e3a;outline-offset:2px}' +
      '</style>' +
      '<div class="card" role="status">' +
      '<p class="title">Next Chapter helped with this form</p>' +
      '<p class="sum"></p>' +
      '<p><span class="key g"></span>Green boxes: filled in for you. Please read them.</p>' +
      '<p><span class="key y"></span>Yellow boxes: please fill these in yourself.</p>' +
      '<p class="important">When everything looks right, press the website\'s Submit button yourself.</p>' +
      '<button type="button">Got it</button>' +
      '</div>';
    shadow.querySelector('.sum').textContent = summary || '';
    shadow.querySelector('button').addEventListener('click', function () { host.remove(); });
    (doc.body || doc.documentElement).appendChild(host);
    return host;
  }

  // ------------------------------------------------------ extension glue

  // Called by the service worker through chrome.scripting.executeScript.
  // Questions the app hasn't seen are sent to the service worker, which asks
  // the Next Chapter app (the API key never enters the page).
  async function fillFromExtension(data) {
    var answerFn = function (question, maxChars) {
      return new Promise(function (resolve, reject) {
        try {
          chrome.runtime.sendMessage({ type: 'nc-answer', applicationId: data.applicationId, question: question, maxChars: maxChars || null }, function (res) {
            var err = chrome.runtime.lastError;
            if (err) return reject(new Error(err.message));
            if (res && res.ok) return resolve(res.answer || '');
            reject(new Error((res && res.error) || 'No answer'));
          });
        } catch (e) { reject(e); }
      });
    };
    try {
      return await fill({
        profile: data.profile,
        files: data.files,
        answers: data.answers,
        answerFn: answerFn,
        runId: data.runId,
        scroll: false,
        banner: false
      });
    } catch (e) {
      return { error: String(e && e.message || e), url: location.href };
    }
  }

  globalThis.NextChapterFiller = {
    version: VERSION,
    fill: fill,
    fillFromExtension: fillFromExtension,
    describeField: describeField,
    matchContact: matchContact,
    isSensitive: isSensitive,
    similarity: similarity,
    bestDrafted: bestDrafted,
    chooseOption: chooseOption,
    summarize: summarize,
    showBanner: showBanner,
    scrollToFirstLeft: scrollToFirstLeft,
    MATCH_THRESHOLD: MATCH_THRESHOLD
  };
})();
