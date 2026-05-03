// components/MessageBubble.jsx
'use client';

import ReactMarkdown from 'react-markdown';
import ProductCard from './ProductCard';

// Regex to detect product blocks embedded by LunaBot
// We parse products from the retrieved context and pass them as props
const URL_REGEX = /https?:\/\/[^\s)]+/g;

export default function MessageBubble({ message, products = [] }) {
  const isUser = message.role === 'user';

  // AI SDK v6: message text lives in parts array. Fall back to string content
  // (used when messages are loaded from DB via setMessages).
  const messageText = (() => {
    if (typeof message.content === 'string' && message.content) return message.content;
    if (Array.isArray(message.parts)) {
      return message.parts
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('');
    }
    return '';
  })();

  // Extract any product URLs mentioned in the message text
  const mentionedUrls = messageText.match(URL_REGEX) || [];
  const linkedProducts = products.filter(p =>
    p.product_url && mentionedUrls.some(url => url.includes(p.product_url))
  );

  return (
    <div className={`msg-row ${isUser ? 'msg-row--user' : 'msg-row--bot'}`}>
      {!isUser && (
        <div className="avatar-luna">
          <LunaAvatar />
        </div>
      )}

      <div className={`bubble ${isUser ? 'bubble--user' : 'bubble--bot'}`}>
        <ReactMarkdown
          components={{
            // Style links inline
            a: ({ href, children }) => (
              <a href={href} target="_blank" rel="noopener noreferrer" className="md-link">
                {children}
              </a>
            ),
            // Style code blocks
            code: ({ inline, children }) =>
              inline
                ? <code className="md-code-inline">{children}</code>
                : <pre className="md-code-block"><code>{children}</code></pre>,
            // Styled lists
            ul: ({ children }) => <ul className="md-ul">{children}</ul>,
            ol: ({ children }) => <ol className="md-ol">{children}</ol>,
            li: ({ children }) => <li className="md-li">{children}</li>,
            p: ({ children }) => <p className="md-p">{children}</p>,
            strong: ({ children }) => <strong className="md-strong">{children}</strong>,
            h3: ({ children }) => <h3 className="md-h3">{children}</h3>,
            h4: ({ children }) => <h4 className="md-h4">{children}</h4>,
          }}
        >
          {messageText}
        </ReactMarkdown>

        {/* Render product cards if products with URLs were mentioned */}
        {linkedProducts.length > 0 && (
          <div className="product-cards-wrap">
            {linkedProducts.map((p, i) => (
              <ProductCard key={i} product={p} />
            ))}
          </div>
        )}
      </div>

      {isUser && (
        <div className="avatar-user">
          <UserAvatar />
        </div>
      )}
    </div>
  );
}

function LunaAvatar() {
  return (
    <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" width="36" height="36">
      <circle cx="18" cy="18" r="18" fill="url(#luna_grad)" />
      <path d="M24 18c0 3.314-2.686 6-6 6s-6-2.686-6-6 2.686-6 6-6c.79 0 1.548.152 2.242.428A4.5 4.5 0 0118 13.5a4.5 4.5 0 000 9 4.5 4.5 0 002.242-.572A5.978 5.978 0 0124 18z" fill="white" fillOpacity="0.9" />
      <defs>
        <linearGradient id="luna_grad" x1="0" y1="0" x2="36" y2="36">
          <stop offset="0%" stopColor="#C4956A" />
          <stop offset="100%" stopColor="#8B5E3C" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function UserAvatar() {
  return (
    <div className="avatar-user-circle">
      <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="2" />
      </svg>
    </div>
  );
}
