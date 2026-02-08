let voiceEnabled = false;

// Generate unique user ID for per-user memory
let userId = null;
function getUserId() {
  if (!userId) {
    const stored = localStorage.getItem('astral_user_id');
    if (stored) {
      userId = stored;
    } else {
      userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('astral_user_id', userId);
    }
  }
  return userId;
}
getUserId(); // Initialize on load

const voiceToggleBtns = document.querySelectorAll('.voice-toggle');
const speechToggleBtns = document.querySelectorAll('.speech-toggle');
const runBtn = document.querySelector('.js-chat-answer-button');
const displayContainer = document.querySelector('.js-chat-display-container');
const inputEl = document.querySelector('.js-chat-response');
const mobileMenuToggle = document.querySelector('.mobile-menu-toggle');
const mobileDropdownMenu = document.querySelector('.mobile-dropdown-menu');
const newChatBtn = document.querySelector('.new-chat-btn');
const mainElement = document.querySelector('main');
const chatSidebar = document.querySelector('.chat-sidebar');
const chatHistoryList = document.querySelector('.js-chat-history-list');
const sidebarToggle = document.querySelector('.sidebar-toggle');
let isSending = false;
let currentController = null;
let sidebarOpen = false;

// Chat history management
let chatHistory = []; // Array of {id, title, messages}
let currentChatId = null;

/* =========================
   SIDEBAR TOGGLE
========================= */
function updateSidebarState() {
  if (chatSidebar) {
    if (sidebarOpen) {
      chatSidebar.classList.remove('collapsed');
    } else {
      chatSidebar.classList.add('collapsed');
    }
  }
}

sidebarToggle?.addEventListener('click', () => {
  sidebarOpen = !sidebarOpen;
  updateSidebarState();
});

/* =========================
   CHAT HISTORY MANAGEMENT
========================= */
function createNewChat() {
  const chatId = Date.now().toString();
  const newChat = {
    id: chatId,
    title: 'New Chat',
    messages: []
  };
  chatHistory.unshift(newChat);
  currentChatId = chatId;
  htmlResult = [];
  saveChatsToStorage();
  loadChatsUI();
  renderHtmlResult(); // Render empty chat display
}

function loadChatsFromStorage() {
  try {
    const raw = localStorage.getItem('chatHistory');
    if (raw) {
      chatHistory = JSON.parse(raw);
      if (chatHistory.length > 0 && !currentChatId) {
        currentChatId = chatHistory[0].id;
      }
    }
  } catch {
    chatHistory = [];
  }
  if (chatHistory.length === 0) {
    createNewChat();
  }
}

function saveChatsToStorage() {
  try {
    localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
  } catch {}
}

function loadChatsUI() {
  chatHistoryList.innerHTML = chatHistory.map(chat => `
    <div class="chat-item ${chat.id === currentChatId ? 'active' : ''}" data-chat-id="${chat.id}">
      <span class="chat-item-title">${chat.title}</span>
      <button class="chat-delete-btn" data-chat-id="${chat.id}" title="Delete chat">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
          <polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
          <line x1="10" y1="11" x2="10" y2="17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <line x1="14" y1="11" x2="14" y2="17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
  `).join('');
  
  // Add click handlers for chat items
  chatHistoryList.querySelectorAll('.chat-item').forEach(item => {
    const titleSpan = item.querySelector('.chat-item-title');
    titleSpan?.addEventListener('click', () => {
      const chatId = item.getAttribute('data-chat-id');
      loadChat(chatId);
    });
  });
  
  // Add delete handlers
  chatHistoryList.querySelectorAll('.chat-delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const chatId = btn.getAttribute('data-chat-id');
      deleteChat(chatId);
    });
  });
}

function loadChat(chatId) {
  currentChatId = chatId;
  const chat = chatHistory.find(c => c.id === chatId);
  if (chat) {
    htmlResult = chat.messages;
    renderHtmlResult();
    loadChatsUI();
  }
}

function updateChatTitle(chatId, title) {
  const chat = chatHistory.find(c => c.id === chatId);
  if (chat) {
    chat.title = title;
    saveChatsToStorage();
    loadChatsUI();
  }
}

function deleteChat(chatId) {
  // Remove chat from history
  chatHistory = chatHistory.filter(c => c.id !== chatId);
  
  // If deleted chat was active, load the first one or create new
  if (currentChatId === chatId) {
    if (chatHistory.length > 0) {
      loadChat(chatHistory[0].id);
    } else {
      createNewChat();
    }
  }
  
  saveChatsToStorage();
  loadChatsUI();
}

function getCurrentChat() {
  return chatHistory.find(c => c.id === currentChatId);
}

/* =========================
   MOBILE DROPDOWN MENU
========================= */
newChatBtn?.addEventListener('click', () => {
  createNewChat();
  // Don't close mobile dropdown menu when clicking new chat
});

mobileMenuToggle?.addEventListener('click', (e) => {
  e.stopPropagation();
  mobileDropdownMenu?.classList.toggle('active');
});

// Close sidebar when clicking on main content
mainElement?.addEventListener('pointerdown', () => {
  if (sidebarOpen) {
    sidebarOpen = false;
    updateSidebarState();
  }
});

mainElement?.addEventListener('click', () => {
  if (sidebarOpen) {
    sidebarOpen = false;
    updateSidebarState();
  }
});

// Close sidebar when clicking on the header (outside sidebar area)
document.querySelector('.head')?.addEventListener('pointerdown', (e) => {
  if (sidebarOpen && !sidebarToggle?.contains(e.target)) {
    sidebarOpen = false;
    updateSidebarState();
  }
});

document.querySelector('.head')?.addEventListener('click', (e) => {
  if (sidebarOpen && !sidebarToggle?.contains(e.target)) {
    sidebarOpen = false;
    updateSidebarState();
  }
});

// Close dropdown when clicking outside
document.addEventListener('pointerdown', (e) => {
  // Don't close if clicking the menu toggle, inside the dropdown, or the new chat button
  if (mobileMenuToggle?.contains(e.target) || mobileDropdownMenu?.contains(e.target) || newChatBtn?.contains(e.target)) {
    return;
  }
  mobileDropdownMenu?.classList.remove('active');
});

/* =========================
   VOICE TOGGLE
========================= */
function updateVoiceButton() {
  voiceToggleBtns.forEach(voiceToggleBtn => {
    if (!voiceToggleBtn) return;
    voiceToggleBtn.setAttribute('aria-pressed', String(voiceEnabled));
    const label = voiceToggleBtn.querySelector('.btn-label');
    if (label) {
      // Check if this is a desktop or mobile button
      if (label.textContent.includes(':')) {
        // Desktop button format
        label.textContent = voiceEnabled ? 'Voice : ON' : 'Voice : OFF';
      } else {
        // Mobile dropdown format - just toggle indicator
        label.textContent = voiceEnabled ? '✓ Voice' : 'Voice';
      }
    }
    // reflect active state with a class so CSS can style it
    if (voiceEnabled) voiceToggleBtn.classList.add('on'); else voiceToggleBtn.classList.remove('on');
  });
}

voiceToggleBtns.forEach(voiceToggleBtn => {
  voiceToggleBtn?.addEventListener('click', () => {
    voiceEnabled = !voiceEnabled;
    updateVoiceButton();
  });
});

/* =========================
   STORAGE
========================= */
let htmlResult = [];

function loadFromStorage() {
  loadChatsFromStorage();
  if (currentChatId) {
    const chat = chatHistory.find(c => c.id === currentChatId);
    htmlResult = chat ? chat.messages : [];
  } else {
    htmlResult = [];
  }
}

function saveToStorage() {
  if (currentChatId) {
    const chat = getCurrentChat();
    if (chat) {
      chat.messages = htmlResult;
      saveChatsToStorage();
    }
  }
}

/* =========================
   HELPERS
========================= */
function escapeHtml(text = '') {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function scrollToBottom() {
  // Use scrollTop for better mobile compatibility and reliability
  displayContainer.scrollTop = displayContainer.scrollHeight;
}

/* =========================
   RENDER CHAT
========================= */
function renderHtmlResult() {
  displayContainer.innerHTML = htmlResult.map(log => `
    <div class="chatlog">
      ${log.humanText ? `
        <div class="human-response">
          <p class="text">${escapeHtml(log.humanText)}</p>
        </div>` : ''}

      ${log.aiText !== undefined ? `
        <div class="ai-response">
        
                  ${log.thinking ? `
                  <div class="thinking">
                    <span>A</span>
                    <span>S</span>
                    <span>T</span>
                    <span>R</span>
                    <span>A</span>
                    <span>L</span>
                  </div>` : ''}
          <p class="text">${escapeHtml(log.aiText)}</p>
          
        </div>` : ''}
        
      
    </div>
  `).join('');

  scrollToBottom();
}

/* =========================
   TYPING EFFECT
========================= */
function typeText(element, text, speed = 0.5, onComplete = null) {
  element.textContent = '';
  let i = 0;

  function type() {
    if (i < text.length) {
      element.textContent += text.charAt(i);
      i++;
      // Scroll every 5 characters for better performance on mobile
      if (i % 5 === 0 || i === text.length) {
        scrollToBottom();
      }
      setTimeout(type, speed);
    } else {
      // Typing complete, ensure final scroll and call callback
      scrollToBottom();
      if (onComplete) onComplete();
    }
  }
  type();
}

/* =========================
   FALLBACK AI
========================= */
function fallbackReply(userText) {
  if (userText.length < 6)
    return 'Tell me a bit more so I can help 🙂';

  return `I hear you. "${userText}".  
Would you like advice or just to talk more?`;
}

/* =========================
   SEND MESSAGE
========================= */
async function handleSend() {
  const text = inputEl.value.trim();
  if (!text) return;

  inputEl.value = '';
  // Push human + thinking AI
  htmlResult.push({
    humanText: text,
    aiText: '',
    thinking: true
  });

  // Generate title from first message if this is the first message in chat
  if (htmlResult.length === 1) {
    const titlePreview = text.slice(0, 40).trim();
    updateChatTitle(currentChatId, titlePreview + (text.length > 40 ? '...' : ''));
  }

  saveToStorage();
  renderHtmlResult();

  // start sending: create an AbortController so user can cancel
  const SERVER_URL = window.SERVER_URL || 'http://127.0.0.1:8000';
  const controller = new AbortController();
  currentController = controller;
  isSending = true;
  // update UI: show spinner state and floating logo
  runBtn?.classList.add('sending');
  runBtn?.setAttribute('data-tooltip', 'Cancel request');
  // change Send label to Stop while sending
  try {
    const lbl = runBtn?.querySelector('.btn-label');
    if (lbl) lbl.textContent = 'Stop';
  } catch (e) {}

  try {
    const resp = await fetch(`https://astral-1-sb1i.onrender.com/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, user_id: getUserId() }),
      signal: controller.signal,
    });

    let reply = '';
    if (!resp.ok) throw new Error('Server error');
    const data = await resp.json();
    reply = data.reply || '[No response]';

    const lastIndex = htmlResult.length - 1;
    htmlResult[lastIndex].thinking = false;
    htmlResult[lastIndex].aiText = reply;

    renderHtmlResult();

    const lastAIText = displayContainer.querySelectorAll('.ai-response .text')[displayContainer.querySelectorAll('.ai-response .text').length - 1];
    typeText(lastAIText, reply);
    speak(reply);

  } catch (err) {
    // handle abort differently from other errors
    const lastIndex = htmlResult.length - 1;
    htmlResult[lastIndex].thinking = false;
    if (err && err.name === 'AbortError') {
      htmlResult[lastIndex].aiText = '[Cancelled]';
    } else {
      const fallback = fallbackReply(text);
      htmlResult[lastIndex].aiText = fallback;
      speak(fallback);
    }
    renderHtmlResult();
  } finally {
    // reset sending state
    isSending = false;
    currentController = null;
    runBtn?.classList.remove('sending');
    runBtn?.setAttribute('data-tooltip', 'Send message');
    // restore Send label
    try {
      const lbl = runBtn?.querySelector('.btn-label');
      if (lbl) lbl.textContent = 'Send';
    } catch (e) {}
    saveToStorage();
  }
}


/* No wiki button - server will perform web lookups automatically when needed. */

/* =========================
   EVENTS
========================= */
runBtn?.addEventListener('click', () => {
  if (isSending) {
    // cancel in-flight request
    if (currentController) currentController.abort();
    // UI will be reset in finally, but reset some immediate bits for responsiveness
    runBtn?.classList.remove('sending');
    isSending = false;
    currentController = null;
  } else {
    handleSend();
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    handleSend();
  }
});

/* =========================
   SPEECH RECOGNITION
========================= */
let recognition = null;
let speechEnabled = false;

function updateSpeechButton() {
  speechToggleBtns.forEach(speechToggleBtn => {
    if (!speechToggleBtn) return;
    const label = speechToggleBtn.querySelector('.btn-label');
    if (label) {
      // Check if this is a desktop or mobile button
      if (label.textContent.includes(':')) {
        // Desktop button format
        label.textContent = speechEnabled ? 'Speech : ON' : 'Speech : OFF';
      } else {
        // Mobile dropdown format - just toggle indicator
        label.textContent = speechEnabled ? '✓ Speech' : 'Speech';
      }
    }
    // reflect active state with a class so CSS can style it
    if (speechEnabled) speechToggleBtn.classList.add('on'); else speechToggleBtn.classList.remove('on');
  });
}

// Initialize speech recognition handler
function initSpeechRecognition() {
  console.log('Initializing speech recognition, found', speechToggleBtns.length, 'buttons');
  
  speechToggleBtns.forEach((btn, idx) => {
    console.log('Attaching click handler to speech button', idx);
    btn.addEventListener('click', handleSpeechClick);
  });
}

function handleSpeechClick(e) {
  e.preventDefault();
  e.stopPropagation();
  
  console.log('=== Speech button clicked ===');
  console.log('Current speechEnabled:', speechEnabled);
  console.log('Current recognition:', recognition);
  
  // Check browser support
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert('Speech recognition not supported in this browser. Use Chrome, Edge, or Safari.');
    return;
  }

  // If already listening, stop it
  if (speechEnabled && recognition) {
    console.log('Already listening - stopping');
    recognition.stop();
    return;
  }

  // Start new recognition
  try {
    console.log('Creating new speech recognition instance');
    recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = function() {
      console.log('🎤 Recognition started - now listening');
      speechEnabled = true;
      speechToggleBtns.forEach(btn => {
        btn?.classList.add('listening');
        btn?.setAttribute('aria-pressed', 'true');
      });
      updateSpeechButton();
    };

    recognition.onresult = function(event) {
      console.log('📝 Got result:', event.results[0][0].transcript);
      if (event.results[0].isFinal) {
        const transcript = event.results[0][0].transcript;
        inputEl.value = transcript;
        handleSend();
      }
    };

    recognition.onerror = function(event) {
      console.error('❌ Recognition error:', event.error);
      speechEnabled = false;
      speechToggleBtns.forEach(btn => {
        btn?.classList.remove('listening');
        btn?.setAttribute('aria-pressed', 'false');
      });
      updateSpeechButton();
    };

    recognition.onend = function() {
      console.log('✓ Recognition ended');
      speechEnabled = false;
      speechToggleBtns.forEach(btn => {
        btn?.classList.remove('listening');
        btn?.setAttribute('aria-pressed', 'false');
      });
      updateSpeechButton();
    };

    console.log('Starting recognition.start()');
    recognition.start();
    console.log('Recognition started successfully');
    
  } catch (err) {
    console.error('💥 Failed to start speech recognition:', err);
    speechEnabled = false;
    updateSpeechButton();
  }
}

/* =========================
   VOICE
========================= */
function speak(text) {
  if (!voiceEnabled || !text) return;

  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1;
  utter.pitch = 1;
  utter.volume = 1;

  const voices = speechSynthesis.getVoices();
  if (voices.length) utter.voice = voices[0];

  speechSynthesis.speak(utter);
}
/*
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js")
    .then(() => console.log("Service Worker registered"))
    .catch(err => console.error("Service Worker failed", err));
}
*/
/* =========================
   INIT
========================= */
loadFromStorage();
loadChatsUI();
renderHtmlResult();

updateSpeechButton();
updateVoiceButton();
updateSidebarState();
initSpeechRecognition();







