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

  // ── DOM refs ─────────────────────────────────────────────────────────
  let _panel, _msgList, _input, _sendBtn, _toggleBtn, _badge;

  // ── Navigate callback — wired by app.js ──────────────────────────────
  let _onNavigate = null;
  function onNavigate(fn) { _onNavigate = fn; }

  // ── Toggle panel ──────────────────────────────────────────────────────
  function toggle() {
    _open = !_open;
    _panel.classList.toggle('chat-open', _open);
    _panel.setAttribute('aria-hidden', String(!_open));
    _toggleBtn.setAttribute('aria-expanded', String(_open));
    if (_open) {
      _badge.style.display = 'none';
      _input.focus();
      _scrollBottom();
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
  function _addMessage(role, text, department, subservice, options, rateLimited) {
    _messages.push({
      role,
      text,
      department:   department   || null,
      subservice:   subservice   || null,
      options:      options      || [],
      rateLimited:  !!rateLimited,
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
        html += `<div class="chat-goto">📍 ${inline(trimmed.replace(/^go to:\s*/i, ''))}</div>`;
      } else {
        closeTop();
        html += `<p class="chat-para">${inline(trimmed)}</p>`;
      }
    }
    closeTop();
    return html;
  }

  function _renderMessages() {
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
            send();
          });
          chips.appendChild(chip);
        });
        _msgList.appendChild(chips);
      }

      // "Take me there" button
      if (msg.role === 'bot' && msg.department) {
        const loc = document.createElement('div');
        loc.className = 'chat-location';

        const deptLabel = document.createElement('span');
        deptLabel.className = 'chat-dept-label';
        deptLabel.textContent = msg.department;
        loc.appendChild(deptLabel);

        const navBtn = document.createElement('button');
        navBtn.className = 'chat-nav-btn';
        navBtn.textContent = 'Take me there';
        navBtn.addEventListener('click', () => {
          // Pass the subservice too so service-specific routing overrides can apply.
          if (_onNavigate) _onNavigate(msg.department, msg.subservice);
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
  async function send() {
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
        body: JSON.stringify({ query, history })
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`${res.status}: ${errText.slice(0, 120)}`);
      }
      const data = await res.json();

      if (data.rate_limited) {
        // Show a retryable "busy" notice — not a hard error
        _addMessage('bot', data.answer, null, null, [], true);
      } else {
        const opts = (data.options && data.options.length)
          ? data.options
          : (data.needsContext ? _extractOptions(data.answer) : []);
        _addMessage('bot', data.answer, data.department, data.subservice, opts);
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
    _toggleBtn.innerHTML = '💬';

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
        <span class="chat-header-icon">🏛️</span>
        <span class="chat-header-title">City Services Assistant</span>
        <button class="chat-close-btn" aria-label="Close chat">✕</button>
      </div>
      <div class="chat-intro">Ask me about any Calamba City Hall service and I'll guide you there.</div>
      <div class="chat-messages" id="chatMessages"></div>
      <div class="chat-input-row">
        <input  class="chat-input"  id="chatInput"  type="text"
                placeholder="e.g. How do I get a business permit?" maxlength="200" />
        <button class="chat-send-btn" id="chatSendBtn" aria-label="Send">&#9658;</button>
      </div>
    `;

    document.body.appendChild(_toggleBtn);
    document.body.appendChild(_panel);

    _msgList = document.getElementById('chatMessages');
    _input   = document.getElementById('chatInput');
    _sendBtn = document.getElementById('chatSendBtn');

    _panel.querySelector('.chat-close-btn').addEventListener('click', toggle);
    _sendBtn.addEventListener('click', send);
    _input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
  }

  function init() { _buildDOM(); }

  return { init, onNavigate, toggle };
})();
