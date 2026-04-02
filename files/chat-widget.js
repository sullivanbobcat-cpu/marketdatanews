(function() {
  'use strict';

  // Inject styles
  const style = document.createElement('style');
  style.textContent = `
    #fw-chat-btn {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 9999;
      display: flex;
      align-items: center;
      gap: 8px;
      background: #0d0d0d;
      border: 1px solid #2a2a2a;
      border-radius: 28px;
      padding: 10px 16px 10px 12px;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(0,0,0,0.35);
      transition: box-shadow 0.2s, transform 0.15s;
      font-family: 'IBM Plex Mono', monospace;
      user-select: none;
    }
    #fw-chat-btn:hover {
      box-shadow: 0 6px 28px rgba(0,0,0,0.45);
      transform: translateY(-1px);
    }
    #fw-chat-btn:active { transform: translateY(0); }
    #fw-chat-btn svg { flex-shrink: 0; }
    #fw-btn-label {
      font-size: 10px;
      font-weight: 500;
      color: #b8860b;
      letter-spacing: 0.04em;
      white-space: nowrap;
    }
    #fw-pulse-dot {
      width: 7px;
      height: 7px;
      background: #b8860b;
      border-radius: 50%;
      flex-shrink: 0;
      animation: fw-pulse 2s ease-in-out infinite;
    }
    @keyframes fw-pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.45; transform: scale(0.75); }
    }

    #fw-chat-panel {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 9999;
      width: 380px;
      height: 500px;
      background: #faf8f2;
      border: 1px solid #d4c9a8;
      border-radius: 12px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.22);
      display: none;
      flex-direction: column;
      font-family: 'IBM Plex Mono', monospace;
      overflow: hidden;
    }
    #fw-chat-panel.fw-open { display: flex; }

    #fw-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #0d0d0d;
      padding: 12px 16px;
      flex-shrink: 0;
    }
    #fw-panel-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      font-weight: 600;
      color: #b8860b;
      letter-spacing: 0.05em;
    }
    #fw-panel-title-dot {
      width: 6px;
      height: 6px;
      background: #b8860b;
      border-radius: 50%;
      animation: fw-pulse 2s ease-in-out infinite;
    }
    #fw-close-btn {
      background: none;
      border: none;
      color: #666;
      cursor: pointer;
      padding: 2px;
      line-height: 1;
      font-size: 18px;
      transition: color 0.15s;
      font-family: inherit;
    }
    #fw-close-btn:hover { color: #ccc; }

    #fw-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      scroll-behavior: smooth;
    }
    #fw-messages::-webkit-scrollbar { width: 4px; }
    #fw-messages::-webkit-scrollbar-track { background: transparent; }
    #fw-messages::-webkit-scrollbar-thumb { background: #d4c9a8; border-radius: 2px; }

    .fw-msg {
      max-width: 88%;
      padding: 9px 12px;
      border-radius: 10px;
      font-size: 11px;
      line-height: 1.55;
      word-wrap: break-word;
    }
    .fw-msg-user {
      background: #b8860b;
      color: #fff;
      align-self: flex-end;
      border-bottom-right-radius: 3px;
    }
    .fw-msg-ai {
      background: #ede9dc;
      color: #1a1a1a;
      align-self: flex-start;
      border-bottom-left-radius: 3px;
      border: 1px solid #d4c9a8;
    }
    .fw-msg-welcome {
      background: transparent;
      color: #666;
      border: 1px dashed #d4c9a8;
      align-self: stretch;
      font-size: 10.5px;
      text-align: center;
    }

    #fw-typing {
      display: none;
      align-self: flex-start;
      background: #ede9dc;
      border: 1px solid #d4c9a8;
      border-radius: 10px;
      border-bottom-left-radius: 3px;
      padding: 10px 14px;
    }
    #fw-typing.fw-visible { display: flex; align-items: center; gap: 4px; }
    .fw-dot {
      width: 5px;
      height: 5px;
      background: #888;
      border-radius: 50%;
      animation: fw-bounce 1.2s ease-in-out infinite;
    }
    .fw-dot:nth-child(2) { animation-delay: 0.2s; }
    .fw-dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes fw-bounce {
      0%, 60%, 100% { transform: translateY(0); }
      30% { transform: translateY(-5px); }
    }

    #fw-input-area {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      padding: 10px 12px;
      border-top: 1px solid #d4c9a8;
      background: #faf8f2;
      flex-shrink: 0;
    }
    #fw-input {
      flex: 1;
      border: 1px solid #d4c9a8;
      border-radius: 8px;
      padding: 8px 10px;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 11px;
      background: #fff;
      color: #1a1a1a;
      resize: none;
      outline: none;
      line-height: 1.45;
      max-height: 80px;
      overflow-y: auto;
      transition: border-color 0.15s;
    }
    #fw-input:focus { border-color: #b8860b; }
    #fw-input::placeholder { color: #aaa; }
    #fw-send-btn {
      background: #0d0d0d;
      border: none;
      border-radius: 8px;
      width: 34px;
      height: 34px;
      flex-shrink: 0;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s, transform 0.1s;
    }
    #fw-send-btn:hover { background: #b8860b; }
    #fw-send-btn:active { transform: scale(0.93); }
    #fw-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    #fw-footer {
      text-align: center;
      padding: 4px 0 7px;
      font-size: 9px;
      color: #aaa;
      letter-spacing: 0.03em;
      flex-shrink: 0;
      background: #faf8f2;
    }

    @media (max-width: 440px) {
      #fw-chat-panel { width: calc(100vw - 20px); right: 10px; bottom: 10px; }
      #fw-chat-btn { right: 10px; bottom: 10px; }
    }
  `;
  document.head.appendChild(style);

  // Build button
  const btn = document.createElement('div');
  btn.id = 'fw-chat-btn';
  btn.setAttribute('role', 'button');
  btn.setAttribute('aria-label', 'Ask FeedWatch AI');
  btn.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="#b8860b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <span id="fw-btn-label">Ask FeedWatch</span>
    <span id="fw-pulse-dot"></span>
  `;

  // Build panel
  const panel = document.createElement('div');
  panel.id = 'fw-chat-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'FeedWatch AI Chat');
  panel.innerHTML = `
    <div id="fw-panel-header">
      <div id="fw-panel-title">
        <span id="fw-panel-title-dot"></span>
        FEEDWATCH AI
      </div>
      <button id="fw-close-btn" aria-label="Close chat">&#x2715;</button>
    </div>
    <div id="fw-messages">
      <div class="fw-msg fw-msg-welcome">
        Ask me anything about market data infrastructure, exchange feeds, regulatory deadlines, or fee schedules. Powered by Claude AI.
      </div>
    </div>
    <div id="fw-typing">
      <span class="fw-dot"></span>
      <span class="fw-dot"></span>
      <span class="fw-dot"></span>
    </div>
    <div id="fw-input-area">
      <textarea id="fw-input" placeholder="Ask about feeds, deadlines, fees..." rows="1" aria-label="Message input"></textarea>
      <button id="fw-send-btn" aria-label="Send message" disabled>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <line x1="22" y1="2" x2="11" y2="13" stroke="#b8860b" stroke-width="2" stroke-linecap="round"/>
          <polygon points="22 2 15 22 11 13 2 9 22 2" stroke="#b8860b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        </svg>
      </button>
    </div>
    <div id="fw-footer">Powered by Claude &mdash; Anthropic</div>
  `;

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  // State
  let isOpen = false;
  let isLoading = false;
  const history = []; // {role, content}

  const messagesEl = document.getElementById('fw-messages');
  const typingEl = document.getElementById('fw-typing');
  const inputEl = document.getElementById('fw-input');
  const sendBtn = document.getElementById('fw-send-btn');

  function scrollBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addMessage(text, role) {
    const div = document.createElement('div');
    div.className = 'fw-msg ' + (role === 'user' ? 'fw-msg-user' : 'fw-msg-ai');
    div.textContent = text;
    // Insert before typing indicator
    messagesEl.insertBefore(div, typingEl);
    scrollBottom();
    return div;
  }

  function setLoading(loading) {
    isLoading = loading;
    sendBtn.disabled = loading || inputEl.value.trim().length === 0;
    if (loading) {
      typingEl.classList.add('fw-visible');
      messagesEl.appendChild(typingEl);
    } else {
      typingEl.classList.remove('fw-visible');
    }
    scrollBottom();
  }

  async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || isLoading) return;

    inputEl.value = '';
    inputEl.style.height = 'auto';
    sendBtn.disabled = true;

    addMessage(text, 'user');
    history.push({ role: 'user', content: text });

    setLoading(true);

    try {
      const res = await fetch('/.netlify/functions/ask-feedwatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: history.slice(-10, -1), // prior turns (not the one just added)
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        addMessage(data.error || 'FeedWatch is temporarily unavailable. Please try again.', 'ai');
      } else {
        addMessage(data.reply, 'ai');
        history.push({ role: 'assistant', content: data.reply });
        // Trim history to last 20 entries (10 exchanges)
        if (history.length > 20) history.splice(0, history.length - 20);
      }
    } catch {
      addMessage('FeedWatch is temporarily unavailable. Please try again.', 'ai');
    }

    setLoading(false);
  }

  function openPanel() {
    isOpen = true;
    btn.style.display = 'none';
    panel.classList.add('fw-open');
    inputEl.focus();
  }

  function closePanel() {
    isOpen = false;
    panel.classList.remove('fw-open');
    btn.style.display = 'flex';
  }

  // Auto-resize textarea
  inputEl.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 80) + 'px';
    sendBtn.disabled = isLoading || this.value.trim().length === 0;
  });

  inputEl.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  btn.addEventListener('click', openPanel);
  document.getElementById('fw-close-btn').addEventListener('click', closePanel);
  sendBtn.addEventListener('click', sendMessage);

  // Close on Escape
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && isOpen) closePanel();
  });
})();
