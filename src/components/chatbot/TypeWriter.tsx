"use client";

import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './ChatbotWidget';

interface TypeWriterProps {
  content: string;
  delay?: number;
  onComplete?: () => void;
}

const TypeWriter: React.FC<TypeWriterProps> = ({ 
  content, 
  delay = 10, 
  onComplete 
}) => {
  const [displayedContent, setDisplayedContent] = useState('');
  const [isComplete, setIsComplete] = useState(false);
  const contentRef = useRef(content);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);  // Reference to the container element
  const containerRef = useRef<HTMLDivElement>(null);

  // Helper function to scroll to the bottom of the chat
  const scrollToBottom = () => {
    // Find the closest scrollable parent element (chat container)
    let element: HTMLElement | null = containerRef.current;
    let scrollableParent: HTMLElement | null = null;
    
    while (element) {
      // Check if this element is scrollable
      if (element.scrollHeight > element.clientHeight) {
        scrollableParent = element;
        break;
      }
      // Move up to parent
      element = element.parentElement;
    }

    // If we found a scrollable parent, scroll it to bottom
    if (scrollableParent) {
      scrollableParent.scrollTop = scrollableParent.scrollHeight;
    } else {
      // Fallback: try to find chat container by class
      const chatContainer = document.querySelector('.chatbot-messages-container');
      if (chatContainer) {
        chatContainer.scrollTop = chatContainer.scrollHeight;
      }
    }
  };

  useEffect(() => {
    // Reset state when content changes
    setDisplayedContent('');
    setIsComplete(false);
    contentRef.current = content;
    
    // Clear any existing animation
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    let currentPosition = 0;
    const contentLength = content.length;
    
    // Scroll to bottom when typing begins
    scrollToBottom();
    
    // Function to add next character
    const typeNextCharacter = () => {
      if (currentPosition < contentLength) {
        // Get next chunk of text (smaller chunks for more natural typing feel)
        // Using a smaller chunk size for a more natural typing effect
        const nextChunkSize = Math.min(3, contentLength - currentPosition);
        const nextChunk = content.substring(currentPosition, currentPosition + nextChunkSize);
        
        setDisplayedContent(prev => prev + nextChunk);
        currentPosition += nextChunkSize;
        
        // Scroll to bottom after each update
        scrollToBottom();
        
        // Schedule next character with variable delay (slightly randomized for natural feel)
        const variableDelay = delay + Math.random() * 10 - 5; // +/- 5ms randomness
        timeoutRef.current = setTimeout(typeNextCharacter, variableDelay);
      } else {
        // Animation completed
        setIsComplete(true);
        // Final scroll to ensure everything is visible
        scrollToBottom();
        if (onComplete) {
          onComplete();
        }
      }
    };
    
    // Start animation
    timeoutRef.current = setTimeout(typeNextCharacter, delay);
    
    // Cleanup
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [content, delay, onComplete]);
  
  // Show the full content when clicked (user can skip animation)
  const handleSkipAnimation = () => {
    if (!isComplete) {
      setDisplayedContent(content);
      setIsComplete(true);
      if (onComplete) {
        onComplete();
      }
      
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    }
  };
    return (
    <div 
      ref={containerRef}
      className="text-sm markdown-content cursor-pointer" 
      onClick={handleSkipAnimation}
      title={isComplete ? "" : "Click to skip animation"}
    >
      <ReactMarkdown
        rehypePlugins={[rehypeSanitize]}
        remarkPlugins={[remarkGfm]} 
        components={{
          code: CodeBlock
        }}
      >
        {displayedContent}
      </ReactMarkdown>
      
      {!isComplete && (
        <span className="typing-cursor">▌</span>
      )}
    </div>
  );
};

export default TypeWriter;
