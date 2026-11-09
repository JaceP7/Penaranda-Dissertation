/**
 * chat.js — RAG chat widget for Grid Pathfinder
 * Floats over the map; sends queries to /api/chat; offers "Take me there" navigation.
 */

'use strict';

const CHAT = (() => {

  // ── State ────────────────────────────────────────────────────────────
  let _open      = false;
  let _loading   = false;
  const _messages = [];   // { role, text, department?, subservice?, options? }

  // ── Tappable starter prompts (citizens' own phones — most have no idea
  //    what to type first). Label is the chip; query is the full sentence
  //    sent to the RAG so retrieval gets clean natural language.
  //
  //    Every chip below is VERIFIED against the live index: each retrieves its
  //    correct department AND that department is routable to a placed office.
  //    Do not add a chip without checking both — "Cedula" and "Marriage
  //    certificate" were removed because the City Civil Registry and Treasury
  //    publish no services in the online Citizen's Charter, so those queries
  //    mis-routed (marriage certificate landed on the Senior Citizens office). ──
  // Shown until the live analytics has enough asked services to pick the top
  // five itself. Each was tried on the live assistant (tools/test_chips.js).
  // The help desk the out-of-scope and not-on-the-map answers point to.
  const HELP_DESK_DEPT = "MAYOR'S OFFICE PUBLIC ASSISTANCE CENTER";

  const STARTERS = [
    { label: 'Birth certificate', query: 'How do I get a certified copy of my birth certificate?' },
    { label: 'Cedula',            query: 'How do I get a cedula (community tax certificate)?' },
    { label: 'Real property tax', query: 'How do I pay my real property tax at City Hall?' },
    { label: "Mayor's clearance", query: "How do I get a Mayor's Clearance?" },
    { label: 'Where is BPLO?',    query: 'Where is BPLO?' },
  ];

  // ── DOM refs ─────────────────────────────────────────────────────────
  let _panel, _msgList, _input, _sendBtn, _toggleBtn, _badge, _starters;
  let _resume, _newBtn;

  // ── Navigate callback — wired by app.js ──────────────────────────────
  let _onNavigate = null;
  function onNavigate(fn) { _onNavigate = fn; }

  // ── Toggle panel ──────────────────────────────────────────────────────
  function toggle() {
    _open = !_open;
    _panel.classList.toggle('chat-open', _open);
    // lets the landing call-to-action hide itself while the chat is up
    document.body.classList.toggle('chat-showing', _open);
    _panel.setAttribute('aria-hidden', String(!_open));
    _toggleBtn.setAttribute('aria-expanded', String(_open));
    if (_open) {
      _badge.style.display = 'none';
      _syncViewport();
      // Only pull focus on a device with a real keyboard. On a phone, focusing
      // the field opens the soft keyboard immediately, which covers the starter
      // chips and the QR hint before the citizen has read either. They can tap
      // the field when they actually want to type.
      if (!window.matchMedia('(hover: none) and (pointer: coarse)').matches) {
        _input.focus();
      }
      _maybeOfferFreshStart();
      _scrollBottom();
    } else {
      _panel.style.height = '';   // restore CSS-driven sizing when closed
      _panel.style.top = '';
      _panel.classList.remove('chat-kbd');
    }
  }

  // ── Parse numbered/bulleted list items from text ──────────────────────
  function _extractOptions(text) {
    const lines = text.split('\n');
    const opts  = [];
    for (const line of lines) {
      const m = line.match(/^[\s]*(?:\d+[.)]\s*|-\s*|\*\s*)(.+)/);
      if (m) opts.push(m[1].trim());
    }
    return opts.length >= 2 ? opts : [];
  }

  // ── Add message ───────────────────────────────────────────────────────
  function _addMessage(role, text, department, subservice, options, rateLimited, navLabel, extra) {
    const x = extra || {};
    _messages.push({
      role,
      text,
      department:   department   || null,
      subservice:   subservice   || null,
      options:      options      || [],
      rateLimited:  !!rateLimited,
      navLabel:     navLabel     || null,   // what the button really leads to, when not `department`
      related:      x.related    || [],     // other services at the same office (follow-up chips)
      actions:      x.actions    || [],     // 'help' (Public Assistance Center) and/or 'exit'
      place:        x.place      || null,   // 'outside' | 'unmapped' for a "where is" answer
    });
    _renderMessages();
    _scrollBottom();
  }

  // ── Render ────────────────────────────────────────────────────────────
  /**
   * Render a bot answer as readable HTML:
   *  - numbered / bulleted lines become real <ol>/<ul> lists
   *  - "(secure at: X)" becomes a muted sub-note under the item
   *  - **bold** is honoured
   *  - the closing "Go to: OFFICE" line is styled as a distinct chip-line
   */
  function _formatBotText(raw) {
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // "Kliyente / Applicant / Aplikante / Client" all mean the citizen provides it
    // themselves — render that clearly instead of the confusing "secure at: Kliyente".
    const SELF = /^(kliyente|aplikante|applicant|client|self|requestor)$/i;
    const inline = s => esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\s*\(secure at:\s*([^)]+)\)/gi, (m, where) => {
        const w = where.trim();
        if (/^(n\/?a|none|wala)$/i.test(w)) return '';                 // drop empty/N/A
        if (SELF.test(w))
          return '<span class="chat-secure">↳ ikaw ang maghahanda nito (provided by you)</span>';
        return `<span class="chat-secure">↳ secure at: ${w}</span>`;
      });

    const lines = raw.split('\n');
    let html = '';
    let topList = null;   // 'ol' | 'ul' | null
    let liOpen  = false;  // a top-level <li> is open
    let subOpen = false;  // a nested <ul> is open inside the current <li>

    const closeSub = () => { if (subOpen) { html += '</ul>'; subOpen = false; } };
    const closeLi  = () => { closeSub(); if (liOpen) { html += '</li>'; liOpen = false; } };
    const closeTop = () => { closeLi(); if (topList) { html += `</${topList}>`; topList = null; } };

    for (const line of lines) {
      const num = line.match(/^(\s*)\d+[.)]\s+(.*)$/);
      const bul = line.match(/^(\s*)[-•*]\s+(.*)$/);
      const trimmed = line.trim();

      if (num) {                                   // top-level numbered item
        closeLi();
        if (topList !== 'ol') { closeTop(); html += '<ol class="chat-list">'; topList = 'ol'; }
        html += `<li>${inline(num[2])}`; liOpen = true;
      } else if (bul) {
        const indent = bul[1].length;
        if (liOpen && indent >= 2) {               // nested sub-bullet inside current item
          if (!subOpen) { html += '<ul class="chat-sublist">'; subOpen = true; }
          html += `<li>${inline(bul[2])}</li>`;
        } else {                                    // top-level bullet
          closeLi();
          if (topList !== 'ul') { closeTop(); html += '<ul class="chat-list">'; topList = 'ul'; }
          html += `<li>${inline(bul[2])}`; liOpen = true;
        }
      } else if (trimmed === '') {
        // keep any open list intact (blank line = spacing only)
      } else if (/^go to:/i.test(trimmed)) {
        closeTop();
        const pin = typeof uiIcon === 'function' ? uiIcon('map-pin') : '';
        html += `<div class="chat-goto">${pin} ${inline(trimmed.replace(/^go to:\s*/i, ''))}</div>`;
      } else {
        closeTop();
        html += `<p class="chat-para">${inline(trimmed)}</p>`;
      }
    }
    closeTop();
    return html;
  }

  function _renderMessages() {
    _updateStarters();
    _msgList.innerHTML = '';

    _messages.forEach((msg, idx) => {
      // Bubble
      const bubble = document.createElement('div');
      bubble.className = msg.rateLimited
        ? 'chat-bubble chat-bubble-busy'
        : `chat-bubble chat-bubble-${msg.role}`;
      if (msg.role === 'bot') {
        bubble.innerHTML = _formatBotText(msg.text);
      } else {
        bubble.textContent = msg.text;
      }
      _msgList.appendChild(bubble);

      // Clickable option chips (only on last bot message that needs context)
      const isLastMsg = idx === _messages.length - 1;
      if (msg.role === 'bot' && msg.options && msg.options.length && isLastMsg) {
        const chips = document.createElement('div');
        chips.className = 'chat-chips';
        msg.options.forEach(opt => {
          const chip = document.createElement('button');
          chip.className = 'chat-chip';
          chip.textContent = opt;
          chip.addEventListener('click', () => {
            if (_loading) return;
            _input.value = opt;
            send({ source: 'chip' });      // the options are service names
          });
          chips.appendChild(chip);
        });
        _msgList.appendChild(chips);
      }

      // Not on the map / not in the building / out of scope: a sentence (for
      // a service answer) and the help-desk and exit buttons, no route there.
      const place = (msg.role === 'bot' && msg.department) ? _placeActions(msg.department) : null;
      const actions = msg.role !== 'bot' ? []
        : (place && !place.go) ? place.actions
        : (msg.place ? ['help', 'exit'] : msg.actions);
      if (place && !place.go) {
        const note = document.createElement('p');
        note.className = 'chat-place-note';
        note.textContent = place.note;
        _msgList.appendChild(note);
      }
      if (actions.length) {
        const row = document.createElement('div');
        row.className = 'chat-actions';
        actions.forEach(a => {
          const b = document.createElement('button');
          b.className = a === 'exit' ? 'chat-action-btn chat-action-exit' : 'chat-action-btn';
          b.textContent = a === 'exit' ? 'Nearest exit' : 'Public Assistance Center';
          b.addEventListener('click', () => {
            if (a === 'exit') { if (typeof navigateToNearestExit === 'function') navigateToNearestExit(); }
            else if (_onNavigate) _onNavigate(HELP_DESK_DEPT, null, null);
            if (_open) toggle();
          });
          row.appendChild(b);
        });
        _msgList.appendChild(row);
      }

      // "Take me there" button
      if (msg.role === 'bot' && msg.department && (!place || place.go)) {
        const loc = document.createElement('div');
        loc.className = 'chat-location';

        const deptLabel = document.createElement('span');
        deptLabel.className = 'chat-dept-label';
        deptLabel.textContent = msg.navLabel || msg.department;
        loc.appendChild(deptLabel);

        const navBtn = document.createElement('button');
        navBtn.className = 'chat-nav-btn';
        navBtn.textContent = 'Take me there';
        navBtn.addEventListener('click', () => {
          // Pass the subservice too so service-specific routing overrides can
          // apply, and the answer text so the arrival prompt can remind the
          // citizen what to bring — by the time they get there the chat is
          // closed and the requirements are out of sight.
          if (_onNavigate) _onNavigate(msg.department, msg.subservice, msg.text);
          if (_open) toggle();
        });
        loc.appendChild(navBtn);

        _msgList.appendChild(loc);
      }
    });

    // Loading dots
    if (_loading) {
      const dots = document.createElement('div');
      dots.className = 'chat-bubble chat-bubble-bot chat-loading';
      dots.innerHTML = '<span></span><span></span><span></span>';
      _msgList.appendChild(dots);
    }
  }

  function _scrollBottom() {
    _msgList.scrollTop = _msgList.scrollHeight;
  }

  // ── Send ──────────────────────────────────────────────────────────────
  async function send(opts) {
    const source = opts && opts.source === 'chip' ? 'chip' : undefined;
    const query = _input.value.trim();
    if (!query || _loading) return;

    // Snapshot BEFORE adding the current message — prevents the user query
    // from appearing in both `history` and `query` (would be sent twice).
    const history = _messages.slice(-6).map(m => ({
      role:    m.role === 'user' ? 'user' : 'assistant',
      content: m.text
    }));

    _input.value = '';
    _addMessage('user', query);
    _loading = true;
    _sendBtn.disabled = true;
    _renderMessages();
    _scrollBottom();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, history, source })
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`${res.status}: ${errText.slice(0, 120)}`);
      }
      const data = await res.json();

      if (data.rate_limited) {
        // Show a retryable "busy" notice — not a hard error
        _addMessage('bot', data.answer, null, null, [], true);
      } else if (data.kind === 'location' && data.office &&
                 typeof describeOfficeLocation === 'function') {
        // "Where is [office]?" — say where it is from the map this device
        // holds, which the server cannot see (the editor can republish it).
        const where = describeOfficeLocation(data.office, data.lang);
        _addMessage('bot', where.text, where.navDept, null, [], false, where.navLabel, { place: where.place });
      } else {
        const opts = (data.options && data.options.length)
          ? data.options
          : (data.needsContext ? _extractOptions(data.answer) : []);
        _addMessage('bot', data.answer, data.department, data.subservice, opts, false, null,
                    { related: data.related, actions: data.actions });
      }
    } catch (err) {
      _addMessage('bot', `Could not reach the assistant. Check your connection and try again.`);
    } finally {
      _loading = false;
      _sendBtn.disabled = false;
      _renderMessages();
      _scrollBottom();
    }
  }

  // ── Build DOM ─────────────────────────────────────────────────────────
  function _buildDOM() {
    _toggleBtn = document.createElement('button');
    _toggleBtn.id = 'chatToggleBtn';
    _toggleBtn.className = 'chat-toggle-btn';
    _toggleBtn.setAttribute('aria-label', 'Ask about city services');
    _toggleBtn.setAttribute('aria-expanded', 'false');
    // Labeled pill: "City Services Assistant" to the left of a chat icon.
    // Collapses to just the icon while the panel is open (see app.css).
    _toggleBtn.innerHTML =
      '<span class="chat-toggle-label">City Services Assistant</span>' +
      '<span class="chat-toggle-icon">' + (typeof uiIcon === 'function' ? uiIcon('message') : '') + '</span>';

    _badge = document.createElement('span');
    _badge.className = 'chat-badge';
    _badge.style.display = 'none';
    _toggleBtn.appendChild(_badge);
    _toggleBtn.addEventListener('click', toggle);

    _panel = document.createElement('div');
    _panel.id = 'chatPanel';
    _panel.className = 'chat-panel';
    _panel.setAttribute('aria-hidden', 'true');
    _panel.innerHTML = `
      <div class="chat-header">
        <span class="chat-header-icon">${typeof uiIcon === 'function' ? uiIcon('map-pin') : ''}</span>
        <span class="chat-header-title">City Services Assistant</span>
        <button class="chat-new-btn" id="chatNewBtn" hidden
                title="Clear this conversation and ask something unrelated">↻ New</button>
        <button class="chat-close-btn" aria-label="Close chat">✕</button>
      </div>
      <div class="chat-resume" id="chatResume" hidden>
        <span class="chat-resume-text">Bago bang tanong? · Is this a new question?</span>
        <span class="chat-resume-actions">
          <button class="chat-resume-btn primary" id="chatResumeNew">Bagong tanong</button>
          <button class="chat-resume-btn" id="chatResumeKeep">Ituloy / Continue</button>
        </span>
      </div>
      <div class="chat-intro">Ask me about any Calamba City Hall service and I'll guide you there.</div>
      <div class="chat-starters" id="chatStarters">
        <div class="chat-starters-label">Common requests — tap one:</div>
        <div class="chat-starters-chips" id="chatStartersChips"></div>
        <div class="chat-qr-hint">${typeof uiIcon === 'function' ? uiIcon('camera') : ''} Already inside City Hall? <strong>Scan the QR posted near you</strong> to set your location for accurate directions.</div>
      </div>
      <div class="chat-messages" id="chatMessages"></div>
      <div class="chat-followups" id="chatFollowups" hidden>
        <div class="chat-followups-label">Iba pang tanong · More questions</div>
        <div class="chat-followups-chips" id="chatFollowupChips"></div>
      </div>
      <div class="chat-input-row">
        <input  class="chat-input"  id="chatInput"  type="text"
                placeholder="e.g. How do I get a business permit?" maxlength="200" />
        <button class="chat-send-btn" id="chatSendBtn" aria-label="Send">&#9658;</button>
      </div>
    `;

    document.body.appendChild(_toggleBtn);
    document.body.appendChild(_panel);

    _resume  = _panel.querySelector('#chatResume');
    _newBtn  = _panel.querySelector('#chatNewBtn');
    _newBtn.addEventListener('click', () => startFresh());
    _panel.querySelector('#chatResumeNew').addEventListener('click', () => startFresh());
    _panel.querySelector('#chatResumeKeep').addEventListener('click', () => {
      _resume.hidden = true;
    });

    _msgList  = document.getElementById('chatMessages');
    _input    = document.getElementById('chatInput');
    _sendBtn  = document.getElementById('chatSendBtn');
    _starters = document.getElementById('chatStarters');

    // Render the hardcoded starters immediately; analytics may replace them.
    _renderStarterChips(STARTERS);

    _panel.querySelector('.chat-close-btn').addEventListener('click', toggle);
    _sendBtn.addEventListener('click', () => send());   // not send(event): typed text is never a chip
    _input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });

    // Mobile: when the input is focused the keyboard opens — keep the field and
    // latest messages visible by tracking the visual viewport.
    _input.addEventListener('focus', () => setTimeout(() => { _syncViewport(); _scrollBottom(); }, 120));
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', _syncViewport);
      window.visualViewport.addEventListener('scroll', _syncViewport);
    }
  }

  // ── Starter chips ──────────────────────────────────────────────────────
  let _currentStarters = STARTERS;

  /** A chip button. Its text goes to the server marked as a chip, so a
   *  service name is answered straight from the Charter (no search, no LLM)
   *  and the tap is not counted as a typed question. */
  function _chipButton(s, cls) {
    const chip = document.createElement('button');
    chip.className = cls;
    chip.textContent = s.label;
    chip.title = s.query;
    chip.addEventListener('click', () => {
      if (_loading) return;
      _input.value = s.query;
      send({ source: 'chip' });
    });
    return chip;
  }

  function _renderStarterChips(list) {
    _currentStarters = list;
    const wrap = document.getElementById('chatStartersChips');
    if (!wrap) return;
    wrap.innerHTML = '';
    list.forEach(s => wrap.appendChild(_chipButton(s, 'chat-starter-chip')));
    if (_messages.length) _updateStarters();
  }

  /**
   * Chips to show after an answer: other services at the same office first
   * (from the answer's `related`), then the top chips, without repeats or the
   * service just answered. At most five.
   */
  function _followupChips(lastBot, starters) {
    const out = [], seen = new Set();
    const skip = lastBot && lastBot.subservice ? String(lastBot.subservice).toLowerCase() : '';
    const add = (c) => {
      const k = String(c.query).toLowerCase();
      if (out.length >= 5 || seen.has(k) || k === skip) return;
      seen.add(k); out.push(c);
    };
    const short = (n) => { const s = String(n); return s.length <= 52 ? s : s.slice(0, s.lastIndexOf(' ', 51) > 20 ? s.lastIndexOf(' ', 51) : 51) + '…'; };
    ((lastBot && lastBot.related) || []).forEach(n => add({ label: short(n), query: n }));
    (starters || []).forEach(add);
    return out;
  }

  /**
   * What the chat offers for an office (Jace, 2026-11-09, #5): "Take me there"
   * when it is on the map; otherwise a sentence saying so, the Public
   * Assistance Center, and the nearest exit. Never a silent route elsewhere.
   */
  function _placeActions(dept) {
    const status = (typeof serviceLocationStatus === 'function') ? serviceLocationStatus(dept) : 'mapped';
    if (status === 'mapped') return { go: true, actions: [], note: '' };
    return {
      go: false,
      actions: ['help', 'exit'],
      note: status === 'outside'
        ? "This office isn't inside City Hall. The Public Assistance Center can direct you."
        : "This office isn't on this map; it may be outside City Hall. The Public Assistance Center can direct you.",
    };
  }

  // Tidy a raw service name into a short chip label (drop trailing parentheticals).
  // Most-asked chips carry the Charter's full service names, some of which
  // repeat themselves ("... (Cedula) Pagkolekta mula sa ... (Cedula)"). Cut at a
  // word within 52 characters; the chip itself wraps to two lines.
  function _starterLabel(name) {
    const s = String(name).replace(/\s+/g, ' ').trim();
    if (s.length <= 52) return s;
    const cut = s.slice(0, 51);
    const at = s[51] === ' ' ? 51 : cut.lastIndexOf(' ');
    return (at > 20 ? cut.slice(0, at) : cut).replace(/[\s,;:–—-]+$/, '') + '…';
  }

  // Replace the default chips with the top-5 most-asked services from the live
  // analytics log. Falls back silently to the hardcoded STARTERS when there
  // isn't enough real data yet (or analytics isn't reachable).
  async function _loadDynamicStarters() {
    try {
      const res = await fetch('/api/analytics');
      if (!res.ok) return;
      const data = await res.json();
      // Ranked from TYPED questions. Chip taps are 61% of all questions (2026-11-09),
      // so ranking the chips by everything made them rank themselves.
      const top = Array.isArray(data.typedSubservices) ? data.typedSubservices : [];
      if (top.length < 3) return;                       // not enough signal — keep defaults
      const chips = top.slice(0, 5)
        .filter(x => x && x.name)
        .map(x => ({ label: _starterLabel(x.name), query: String(x.name) }));
      if (chips.length >= 3) _renderStarterChips(chips);
    } catch (_) { /* keep hardcoded defaults */ }
  }

  // ── Mobile viewport / keyboard handling ────────────────────────────────
  function _isMobile() { return window.innerWidth <= 640; }

  // Size the open panel to the visible viewport so the input row sits just above
  // the on-screen keyboard (instead of being hidden behind it). When the
  // keyboard is up, hide the intro/starters to give messages + input more room.
  function _syncViewport() {
    if (!_panel) return;
    if (!_open || !_isMobile() || !window.visualViewport) {
      _panel.style.height = '';
      _panel.style.top = '';
      _panel.classList.remove('chat-kbd');
      return;
    }
    const vv = window.visualViewport;
    _panel.style.top    = vv.offsetTop + 'px';
    _panel.style.height = vv.height + 'px';
    _panel.classList.toggle('chat-kbd', vv.height < window.innerHeight * 0.8);
    _scrollBottom();
  }

  // Starters only help before the first exchange — hide them once the
  // conversation begins so they don't clutter the thread.
  function _updateStarters() {
    if (_starters) _starters.style.display = _messages.length === 0 ? '' : 'none';
    // After the first message the chips stay, as one scrolling row above the
    // input (testers kept wanting them back, 2026-11-09).
    const box = document.getElementById('chatFollowups');
    const wrap = document.getElementById('chatFollowupChips');
    if (!box || !wrap) return;
    if (!_messages.length || _loading) { box.hidden = true; return; }
    const lastBot = [..._messages].reverse().find(m => m.role === 'bot') || null;
    const chips = _followupChips(lastBot, _currentStarters);
    wrap.innerHTML = '';
    chips.forEach(c => wrap.appendChild(_chipButton(c, 'chat-followup-chip')));
    box.hidden = chips.length === 0;
  }

  function init() { _buildDOM(); _loadDynamicStarters(); }

  /**
   * Clear the conversation.
   *
   * The panel keeps every previous exchange and sends the last six turns as
   * history, so a second, unrelated question inherits the first one's context
   * and can be answered about the wrong service. This is the way out.
   */
  function startFresh() {
    _messages.length = 0;
    if (_resume) _resume.hidden = true;
    if (_newBtn) _newBtn.hidden = true;
    _render();
    _scrollBottom();
  }

  /** Ask once, on reopening, whether this is a new question or a follow-up. */
  function _maybeOfferFreshStart() {
    const has = _messages.length > 0;
    if (_newBtn) _newBtn.hidden = !has;
    if (_resume) _resume.hidden = !has;
  }

  // Imperative open/close for the view-mode controller (chat-first user view).
  function open()  { if (!_open) toggle(); }
  function close() { if (_open) toggle(); }

  return { init, onNavigate, toggle, open, close, startFresh };
})();
