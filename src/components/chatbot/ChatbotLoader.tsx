"use client";

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';

// Dynamically import the ChatbotWidget with no SSR
const ChatbotDynamicComponent = dynamic(
  () => import('@/components/chatbot/ChatbotWidget'),
  { 
    ssr: false,
    loading: () => null
  }
);

// AI Engine Status component has been removed

export function ChatbotLoader() {
  const [mounted, setMounted] = useState(false);
  
  // Only show the chatbot once the component has mounted on client-side
  useEffect(() => {
    setMounted(true);
  }, []);
    if (!mounted) return null;
    return (
    <>
      <ChatbotDynamicComponent />
    </>
  );
}
