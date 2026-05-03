// app/(chat)/page.jsx
import ChatInterface from '@/components/ChatInterface';

export const metadata = {
    title: 'LunaBot — Trợ lý Skincare AI',
    description: 'Tư vấn mỹ phẩm và chăm sóc da thông minh với LunaBot',
};

export default function ChatPage() {
    return <ChatInterface />;
}
