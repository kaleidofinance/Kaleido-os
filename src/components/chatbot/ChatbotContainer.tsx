"use client";

import dynamic from 'next/dynamic';

// Dynamically import the ChatbotWidget with no SSR
const ChatbotWidget = dynamic(() => import('./ChatbotWidget'), { ssr: false });

export default function ChatbotContainer() {
  return <ChatbotWidget />;
}
