/**
 * chat.js — RAG chat widget for Grid Pathfinder
 * Floats over the map; sends queries to /api/chat; offers "Take me there" navigation.
 */

'use strict';

const CHAT = (() => {

  // ── State ────────────────────────────────────────────────────────────
  let _open      = false;
  let _loading   = false;
  const _messages = [];   // { role: 'user'|'bot', text, department?, subservice? }

  // ── DOM refs (populated on init) ────────────────────────────────────
  let _panel, _msgList, _input, _sendBtn, _toggleBtn, _badge;

  // ── Navigate callback — wired by app.js ─────────────────────────────
  let _onNavigate = null;   // function(department)

  // ── Public: wire the navigate callback ──────────────────────────────
  function onNavigate(fn) { _onNavigate = fn; }

  // ── Toggle panel open / closed ───────────────────────────────────────
  function toggle() {
    _open = !_open;
    _panel.classList.toggle('chat-open', _open);
    _toggleBtn.setAttribute('aria-expanded', String(_open));
    if (_open) {
      _badge.style.display = 'none';
      _input.focus();
      _scrollBottom();
    }
  }

  // ── Add a message to history and render ──────────────────────────────
  function _addMessage(role, text, department, subservice) {
    _messages.push({ role, text, department: department || null, subservice: subservice || null });
    _renderMessages();
    _scrollBottom();
  }

  // ── Render message list ───────────────────────────────────────────────
  function _renderMessages() {
    _msgList.innerHTML = '';

    _messages.forEach(msg => {
      const bubble = document.createElement('div');
      bubble.className = `chat-bubble chat-bubble-${msg.role}`;
      bubble.textContent = msg.text;
      _msgList.appendChild(bubble);

      // "Take me there" button for bot messages that have a department
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
          if (_onNavigate) _onNavigate(msg.department);
          if (_open) toggle();   // close chat panel so map is visible
        });
        loc.appendChild(navBtn);

        _msgList.appendChild(loc);
      }
    });

    // Loading indicator
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

  // ── Send a query to /api/chat ─────────────────────────────────────────
  async function send() {
    const query = _input.value.trim();
    if (!query || _loading) return;

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
        body: JSON.stringify({ query })
      });

      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      _addMessage('bot', data.answer, data.department, data.subservice);
    } catch (err) {
      _addMessage('bot', 'Sorry, I could not reach the assistant. Please try again.');
    } finally {
      _loading = false;
      _sendBtn.disabled = false;
      _renderMessages();
      _scrollBottom();
    }
  }

  // ── Build DOM ─────────────────────────────────────────────────────────
  function _buildDOM() {
    // Toggle button (floating)
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

    // Panel
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

    _msgList  = document.getElementById('chatMessages');
    _input    = document.getElementById('chatInput');
    _sendBtn  = document.getElementById('chatSendBtn');

    _panel.querySelector('.chat-close-btn').addEventListener('click', toggle);
    _sendBtn.addEventListener('click', send);
    _input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
  }

  // ── Init ──────────────────────────────────────────────────────────────
  function init() {
    _buildDOM();
  }

  return { init, onNavigate, toggle };
})();
