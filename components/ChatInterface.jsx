// components/ChatInterface.jsx
'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useEffect, useRef, useState, useCallback } from 'react';
import { Send, StopCircle, Loader2, Sparkles, ChevronDown, Menu } from 'lucide-react';
import MessageBubble from './MessageBubble';
import ConversationSidebar from './ConversationSidebar';

// Generate or retrieve anonymous session ID
function getSessionId() {
  if (typeof window === 'undefined') return 'ssr';
  let id = localStorage.getItem('luna_session');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('luna_session', id);
  }
  return id;
}

const SUGGESTIONS = [
  'Da tôi bị mụn đầu đen nhiều, nên dùng gì?',
  'Gợi ý serum dưỡng ẩm cho da khô',
  'Quy trình skincare buổi sáng cho da nhạy cảm',
  'Cách thu nhỏ lỗ chân lông hiệu quả',
];

export default function ChatInterface() {
  const sessionId = typeof window !== 'undefined' ? getSessionId() : '';

  const [conversationId, setConversationId] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [retrievedProducts, setRetrievedProducts] = useState([]);

  const messagesEndRef = useRef(null);
  const scrollAreaRef = useRef(null);
  const inputRef = useRef(null);
  // Track latest convId so onFinish can reference it reliably
  const conversationIdRef = useRef(conversationId);

  const [input, setInput] = useState('');

  // Custom fetch wrapper to intercept X-Conversation-Id header from streaming response.
  // This is necessary because @ai-sdk/react v3 removed the onResponse callback.
  const fetchWithConvId = useCallback(async (input, init) => {
    const res = await fetch(input, init);
    const newConvId = res.headers.get('X-Conversation-Id');
    if (newConvId) {
      if (!conversationIdRef.current) {
        setConversationId(newConvId);
      }
      conversationIdRef.current = newConvId;
    }
    return res;
  }, []);

  const {
    messages,
    sendMessage,
    status,
    stop,
    setMessages,
  } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
      body: { sessionId, conversationId },
      fetch: fetchWithConvId,
    }),
    onFinish: async () => {
      scrollToBottom('smooth');
      inputRef.current?.focus();
      // Fetch products for this conversation from DB after the stream completes
      const cid = conversationIdRef.current;
      if (cid) {
        try {
          const res = await fetch(`/api/conversations/${cid}`);
          if (res.ok) {
            const data = await res.json();
            if (data.products?.length > 0) {
              setRetrievedProducts(prev => {
                const map = new Map(prev.map(p => [p.id, p]));
                data.products.forEach(p => map.set(p.id, p));
                return Array.from(map.values());
              });
            }
          }
        } catch { /* non-critical, ignore */ }
      }
    },
  });

  // Keep conversationIdRef in sync
  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  // ── Load existing conversation ────────────────────────────
  async function loadConversation(id) {
    try {
      const res = await fetch(`/api/conversations/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.messages) {
        setMessages(
          data.messages.map(m => ({
            id: m.id,
            role: m.role,
            content: m.content,
          }))
        );
        setRetrievedProducts(data.products || []);
        setConversationId(id);
        scrollToBottom('auto');
      }
    } catch (e) {
      console.error('Failed to load conversation:', e);
    }
  }

  function handleNewChat() {
    setMessages([]);
    setConversationId(null);
    setRetrievedProducts([]);
    inputRef.current?.focus();
  }

  // ── Scroll helpers ────────────────────────────────────────
  function scrollToBottom(behavior = 'smooth') {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }

  // Derived: is the chat actively working (submitted or streaming)?
  const isLoading = status === 'submitted' || status === 'streaming';

  useEffect(() => {
    if (isLoading) scrollToBottom('smooth');
  }, [messages, isLoading]);

  function handleScroll() {
    const el = scrollAreaRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBtn(distFromBottom > 200);
  }

  // ── Form Submission ───────────────────────────────────────
  const handleSubmit = (e) => {
    if (e?.preventDefault) e.preventDefault();
    if (!input?.trim()) return;
    sendMessage({ text: input });
    setInput('');
  };

  // ── Keyboard shortcut: Cmd/Ctrl + Enter ──────────────────
  function handleKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <div className="chat-layout">
      <ConversationSidebar
        sessionId={sessionId}
        activeId={conversationId}
        onSelect={(id) => {
          loadConversation(id);
          setMobileSidebarOpen(false);
        }}
        onNew={() => {
          handleNewChat();
          setMobileSidebarOpen(false);
        }}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(v => !v)}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />

      <main className="chat-main">
        {/* ── Mobile Header ──────────────────────────────── */}
        <div className="mobile-header">
          <button className="mobile-menu-btn" onClick={() => setMobileSidebarOpen(true)}>
            <Menu size={22} />
          </button>
          <div className="mobile-header-title">
            Luna<span>Bot</span>
          </div>
          <div style={{ width: 22 }} /> {/* spacer to balance flex */}
        </div>

        {/* ── Messages Area ──────────────────────────────── */}
        <div
          className="messages-area"
          ref={scrollAreaRef}
          onScroll={handleScroll}
        >
          {isEmpty ? (
            <WelcomeScreen onSuggestion={text => {
              setInput(text);
              setTimeout(() => inputRef.current?.focus(), 50);
            }} />
          ) : (
            <div className="messages-list">
              {messages.map(m => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  products={retrievedProducts}
                />
              ))}

              {isLoading && (
                <div className="msg-row msg-row--bot">
                  <div className="avatar-luna">
                    <LunaAvatarSmall />
                  </div>
                  <div className="bubble bubble--bot bubble--typing">
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Scroll to bottom button */}
        {showScrollBtn && (
          <button
            className="scroll-to-bottom"
            onClick={() => scrollToBottom('smooth')}
          >
            <ChevronDown size={18} />
          </button>
        )}

        {/* ── Input Bar ──────────────────────────────────── */}
        <div className="input-bar-wrap">
          <form className="input-bar" onSubmit={handleSubmit}>
            <textarea
              ref={inputRef}
              className="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Hỏi LunaBot về skincare, sản phẩm, thành phần…"
              rows={1}
              maxLength={2000}
              disabled={isLoading}
              onInput={e => {
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
              }}
            />
            {isLoading ? (
              <button type="button" className="btn-send btn-stop" onClick={stop}>
                <StopCircle size={20} />
              </button>
            ) : (
              <button
                type="submit"
                className="btn-send"
                disabled={!input?.trim()}
              >
                <Send size={18} />
              </button>
            )}
          </form>
          <p className="input-hint">
            {isLoading
              ? <span className="hint-loading"><Loader2 size={11} className="spin" /> LunaBot đang trả lời…</span>
              : 'Nhấn Enter để xuống dòng · Ctrl+Enter để gửi'
            }
          </p>
        </div>
      </main>
    </div>
  );
}

// ── Welcome Screen ────────────────────────────────────────

function WelcomeScreen({ onSuggestion }) {
  return (
    <div className="welcome">
      <div className="welcome-logo">
        <LunaLogoFull />
      </div>
      <h1 className="welcome-title">Xin chào, tôi là <em>LunaBot</em></h1>
      <p className="welcome-subtitle">
        Trợ lý AI chuyên gia Skincare — tư vấn sản phẩm, thành phần và quy trình chăm sóc da phù hợp với bạn.
      </p>

      <div className="suggestions-grid">
        {SUGGESTIONS.map((s, i) => (
          <button
            key={i}
            className="suggestion-chip"
            onClick={() => onSuggestion(s)}
          >
            <Sparkles size={13} className="suggestion-icon" />
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function LunaAvatarSmall() {
  return (
    <svg viewBox="0 0 36 36" fill="none" width="36" height="36">
      <circle cx="18" cy="18" r="18" fill="url(#lg2)" />
      <path d="M24 18c0 3.314-2.686 6-6 6s-6-2.686-6-6 2.686-6 6-6c.79 0 1.548.152 2.242.428A4.5 4.5 0 0118 13.5a4.5 4.5 0 000 9 4.5 4.5 0 002.242-.572A5.978 5.978 0 0124 18z" fill="white" fillOpacity="0.9" />
      <defs>
        <linearGradient id="lg2" x1="0" y1="0" x2="36" y2="36">
          <stop offset="0%" stopColor="#C4956A" />
          <stop offset="100%" stopColor="#8B5E3C" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function LunaLogoFull() {
  return (
    <svg viewBox="0 0 80 80" fill="none" width="80" height="80">
      <circle cx="40" cy="40" r="40" fill="url(#lg_full)" />
      <path d="M54 40c0 7.732-6.268 14-14 14s-14-6.268-14-14 6.268-14 14-14c1.843 0 3.612.354 5.231.998A10.5 10.5 0 0140 31.5a10.5 10.5 0 000 21 10.5 10.5 0 005.231-1.332A13.944 13.944 0 0154 40z" fill="white" fillOpacity="0.92" />
      <defs>
        <linearGradient id="lg_full" x1="0" y1="0" x2="80" y2="80">
          <stop offset="0%" stopColor="#D4A574" />
          <stop offset="50%" stopColor="#C4956A" />
          <stop offset="100%" stopColor="#8B5E3C" />
        </linearGradient>
      </defs>
    </svg>
  );
}
