// Configuration for the Kaleido AI Chatbot Widget

// Using Next.js API routes as a proxy to the AI Engine
// This way we don't need to expose the AI Engine directly to the client
export const ENDPOINTS = {
  CHAT: '/api/chat',
};

// Chatbot default settings
export const CHATBOT_CONFIG = {
  initialMessage: "Hello! I'm Luca, your AI assistant. How can I help you today?",
  isOpen: false, // Initial state of the chatbot (closed by default)
  position: 'bottom-right', // Widget position
  maxHeight: '500px', // Widget height
  maxWidth: '350px', // Widget width
};
