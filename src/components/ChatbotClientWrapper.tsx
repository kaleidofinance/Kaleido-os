"use client";

import { Suspense, lazy } from 'react';

// Lazily load the ChatbotContainer to avoid issues with server components
const ChatbotContainer = lazy(() => 
  import('@/components/chatbot').then(mod => ({ 
    default: mod.ChatbotContainer 
  }))
);

export default function ChatbotClientWrapper() {
  return (
    <Suspense fallback={null}>
      <ChatbotContainer />
    </Suspense>
  );
}
