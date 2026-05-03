// components/ConversationSidebar.jsx
'use client';

import { useState, useEffect } from 'react';
import { Plus, MessageSquare, Trash2, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';

export default function ConversationSidebar({
  sessionId,
  activeId,
  onSelect,
  onNew,
  collapsed,
  onToggle,
  mobileOpen,
  onCloseMobile,
}) {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    fetchConversations();
  }, [sessionId, activeId]);

  async function fetchConversations() {
    setLoading(true);
    try {
      const res = await fetch(`/api/conversations?sessionId=${sessionId}`);
      const data = await res.json();
      setConversations(data.conversations || []);
    } finally {
      setLoading(false);
    }
  }

  async function deleteConv(e, id) {
    e.stopPropagation();
    await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
    setConversations(c => c.filter(x => x.id !== id));
    if (activeId === id) onNew();
  }

  function formatDate(ts) {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
  }

  return (
    <>
      {/* Mobile Backdrop */}
      {mobileOpen && (
        <div className="sidebar-backdrop" onClick={onCloseMobile} />
      )}
      
      <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''} ${mobileOpen ? 'sidebar--mobile-open' : ''}`}>
        {/* Header */}
      <div className="sidebar-header">
        {!collapsed && (
          <div className="sidebar-brand">
            <Sparkles size={16} className="sidebar-brand-icon" />
            <span>Luna<strong>Bot</strong></span>
          </div>
        )}
        <button className="sidebar-toggle" onClick={onToggle} title="Toggle sidebar">
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      {/* New Chat Button */}
      <button className="btn-new-chat" onClick={onNew} title="Cuộc trò chuyện mới">
        <Plus size={16} />
        {!collapsed && <span>Cuộc trò chuyện mới</span>}
      </button>

      {/* Conversation List */}
      {!collapsed && (
        <div className="conv-list">
          {loading && (
            <div className="conv-loading">
              <div className="shimmer" />
              <div className="shimmer" style={{ width: '70%' }} />
              <div className="shimmer" style={{ width: '85%' }} />
            </div>
          )}

          {!loading && conversations.length === 0 && (
            <div className="conv-empty">
              <MessageSquare size={24} />
              <p>Chưa có cuộc trò chuyện nào</p>
            </div>
          )}

          {conversations.map(conv => (
            <div
              key={conv.id}
              className={`conv-item ${conv.id === activeId ? 'conv-item--active' : ''}`}
              onClick={() => onSelect(conv.id)}
            >
              <div className="conv-item-body">
                <MessageSquare size={13} className="conv-item-icon" />
                <span className="conv-item-title">{conv.title}</span>
              </div>
              <div className="conv-item-meta">
                <span className="conv-item-time">{formatDate(conv.updated_at)}</span>
                <button
                  className="conv-delete"
                  onClick={e => deleteConv(e, conv.id)}
                  title="Xóa"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      {!collapsed && (
        <div className="sidebar-footer">
          <p>Luna Beauty © 2026</p>
        </div>
      )}
    </aside>
    </>
  );
}
