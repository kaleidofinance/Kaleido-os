"use client";

import { useState, useEffect } from 'react';
import { ENDPOINTS } from './config';
import { detectFunctions, functionRegistry, getWalletAddress, ConfidenceLevel } from './functionRegistry';
import { findYieldGap } from '@/constants/utils/yieldOracle';
import { findArbitrageGap } from './services/arbitrageOracle';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
  isNew?: boolean; // Flag to track if this is a new message or from history
  
  // New fields for AI function triggering
  contentType?: 'text' | 'functionSuggestion' | 'functionResult';
  functionData?: {
    // For function suggestions (when AI isn't sure)
    suggestions?: Array<{
      id: string;       // Function identifier
      name: string;     // Display name
      description: string; // Short description
      requiresWallet?: boolean; // Whether wallet connection is needed
      params?: any;     // Any pre-filled parameters
    }>;
    
    // For function results
    result?: any;       // Function result data
    visualization?: 'table' | 'chart' | 'card'; // How to visualize the data
    executedFunction?: string; // Name of the function that was executed
    
    // Confidence level for function detection
    confidenceLevel?: string; // Will be one of ConfidenceLevel enum values
    extractedParams?: any;    // Contextual parameters extracted from user message
  };
}

export interface Conversation {
  id: string;
  messages: Message[];
  created_at: number;
  updated_at: number;
}

export function useChatbot() {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentMessage, setCurrentMessage] = useState('');
  const [userId, setUserId] = useState<string>('');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [isSynced, setIsSynced] = useState(false);

  // Initialize userId and conversationId on component mount
  useEffect(() => {
    // Generate or retrieve user ID
    const storedUserId = localStorage.getItem('userId') || `user_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem('userId', storedUserId);
    setUserId(storedUserId);
    
    // Get or create conversation ID
    const storedConversationId = localStorage.getItem('currentConversationId') || generateUUID();
    localStorage.setItem('currentConversationId', storedConversationId);
    setConversationId(storedConversationId);
    
    // Load existing conversation if available
    loadConversation(storedConversationId);
    
    // Add initial message if conversation is new
    if (!localStorage.getItem(`kaleido_conversation_${storedConversationId}`)) {
      const initialMessage: Message = {
        role: 'assistant',
        content: "Hello! I'm Luca, your AI assistant. How can I help you today?",
        timestamp: Date.now() / 1000,
        isNew: false // Initial message should not have animation
      };
      setMessages([initialMessage]);
      saveMessage(storedConversationId, initialMessage);
    }
  }, []);

  // --- New: React to wallet address changes ---
  useEffect(() => {
    // Function to check for wallet address changes
    const checkWalletAddress = () => {
      const walletAddress = localStorage.getItem('kaleidoAddress');
      if (walletAddress && walletAddress !== userId) {
        setUserId(walletAddress);
        localStorage.setItem('userId', walletAddress);
      }
    };
    // Check every 1 second (can be optimized with events if available)
    const interval = setInterval(checkWalletAddress, 1000);
    return () => clearInterval(interval);
  }, [userId]);

  // --- SENTINEL HEARTBEAT: Automated Yield Monitoring ---
  useEffect(() => {
    // Only run if sentient brain is active and synced
    if (!isSynced || !conversationId) return;

    const runSentinelCheck = async () => {
        try {
            // Check permissions before scouting (OFF by default)
            const savedPerms = localStorage.getItem('luca_agent_permissions');
            const perms = savedPerms ? JSON.parse(savedPerms) : { sentinelMode: false };
            
            if (!perms.sentinelMode) return;

            // Cooldown Check: Don't alert more than once per hour
            const lastAlert = localStorage.getItem('last_sentinel_alert');
            const oneHour = 3600000;
            if (lastAlert && (Date.now() - parseInt(lastAlert)) < oneHour) {
                return;
            }


            // 1. Scout for USDC yield gaps
            if (perms.sentinelMode) {
                const gap = await findYieldGap("USDC", 4.0);
                if (gap) {
                    const sentinelMessage: Message = {
                        role: 'assistant',
                        content: `[SENTINEL ALERT] I've found a superior yield opportunity. Your USDC is currently earning ~4%, but I've identified a ${gap.supplyApr}% yield on ${gap.protocol}. Would you like me to optimize your collateral?`,
                        isNew: true,
                        contentType: 'functionResult',
                        functionData: {
                            executedFunction: 'macro_yield_sentinel',
                            visualization: 'card',
                            result: {
                                type: 'macro',
                                action: 'yield_optimization',
                                token: 'USDC',
                                gap: (gap.supplyApr - 4.0).toFixed(2) + '%',
                                target: gap.protocol,
                                status: 'proposed'
                            }
                        }
                    };
                    setMessages(prev => {
                        const lastMessage = prev[prev.length - 1];
                        if (lastMessage?.content.includes("[SENTINEL ALERT]")) return prev;
                        return [...prev, sentinelMessage];
                    });
                    saveMessage(conversationId, sentinelMessage);
                    localStorage.setItem('last_sentinel_alert', Date.now().toString());
                }
            }

            // 2. Scout for Arbitrage Opportunties
            if (perms.arbitrageMode) {
                const arb = await findArbitrageGap("USDC");
                if (arb) {
                    const healingNotice = arb.remediationAttempts && arb.remediationAttempts > 1 
                        ? ` (Healed autonomously in ${arb.remediationAttempts} cycles 🛡️)` 
                        : "";
                    
                    const arbMessage: Message = {
                        role: 'assistant',
                        content: `[PULSE ALERT] Cross-chain arbitrage detected! ${arb.token} is trading with a ${arb.profitPercent}% gap between ${arb.fromChain} and ${arb.toChain}.${healingNotice} \n\nSecurity Audit: ${arb.securityScore < 20 ? '✅ Shielded' : '⚠️ Risk Detected (' + arb.securityScore + ')'} \nEstimated profit: $${arb.estimatedProfitUsd}. Capture now?`,
                        isNew: true,
                        contentType: 'functionResult',
                        functionData: {
                            executedFunction: 'macro_arbitrage_hunt',
                            visualization: 'card',
                            result: {
                                ...arb.route,
                                remediationLogs: arb.remediationLogs,
                                status: 'proposed'
                            }
                        }
                    };
                    setMessages(prev => {
                        const lastMessage = prev[prev.length - 1];
                        if (lastMessage?.content.includes("[PULSE ALERT]")) return prev;
                        return [...prev, arbMessage];
                    });
                    saveMessage(conversationId, arbMessage);
                    localStorage.setItem('last_sentinel_alert', Date.now().toString());
                }
            }
        } catch (error) {
            console.error("Sentinel check failed:", error);
        }
    };

    // Run every 5 minutes
    const interval = setInterval(runSentinelCheck, 300000);
    
    // Also run once after initial sync (delayed slightly for UX)
    const timeout = setTimeout(runSentinelCheck, 8000);

    return () => {
        clearInterval(interval);
        clearTimeout(timeout);
    };
  }, [isSynced, conversationId]);

  // Get conversation history from localStorage
  useEffect(() => {
    const history = getConversationHistory();
    setConversations(history);
  }, [messages]); // Reload when messages change

  // Listen for dashboard tour trigger to close chatbot
  useEffect(() => {
    const handler = () => setIsOpen(false);
    window.addEventListener('startDashboardTour', handler);
    return () => window.removeEventListener('startDashboardTour', handler);
  }, []);

  const generateUUID = (): string => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };

  const loadConversation = (convoId: string) => {
    try {
      const data = localStorage.getItem(`kaleido_conversation_${convoId}`);
      if (data) {
        const conversation: Conversation = JSON.parse(data);
        // Mark all messages from history as not new
        const messagesWithFlag = conversation.messages.map(msg => ({
          ...msg,
          isNew: false
        }));
        setMessages(messagesWithFlag || []);
      }
    } catch (error) {
      console.error("Error loading conversation:", error);
    }
  };

  const saveMessage = (convoId: string, message: Message) => {
    try {
      const existingData = localStorage.getItem(`kaleido_conversation_${convoId}`);
      const conversation: Conversation = existingData 
        ? JSON.parse(existingData) 
        : {
            id: convoId,
            messages: [],
            created_at: Date.now() / 1000,
            updated_at: Date.now() / 1000
          };
      
      conversation.messages.push({
        ...message,
        timestamp: Date.now() / 1000,
        // Preserve the isNew flag if it exists, otherwise default to false
        isNew: message.isNew !== undefined ? message.isNew : false
      });
      conversation.updated_at = Date.now() / 1000;
      
      localStorage.setItem(`kaleido_conversation_${convoId}`, JSON.stringify(conversation));
    } catch (error) {
      console.error("Error saving message:", error);
    }
  };  const sendMessage = async (messageText: string) => {
    if (!messageText.trim() || isLoading) return;
    
    const userMessage: Message = {
      role: 'user',
      content: messageText,
      isNew: false // User messages don't need animation
    };
    
    // Update UI
    setMessages(prev => [...prev, userMessage]);
    setCurrentMessage('');
    setIsLoading(true);
    setError(null);
    
    // Save to local storage
    if (conversationId) {
      saveMessage(conversationId, userMessage);
    }    // Detect functions and get confidence level
    const result = detectFunctions(messageText);
    const { confidence, exactMatches, partialMatches, bestFunction, isGeneralQuestion, extractedParams } = result;
    
    console.log(`Function detection result: confidence=${confidence}, matches=${exactMatches.length}, bestFunction=${bestFunction?.id}, isGeneralQuestion=${isGeneralQuestion}`);
    
    // First, check if this is a general information question
    if (isGeneralQuestion) {
      // This is a conceptual/informational question - pass directly to AI
      console.log('General question detected, passing to AI');
      // Continue to AI response section
    }
    // If not a general question, handle based on confidence level
    else if (confidence === ConfidenceLevel.HIGH && bestFunction) {
      // HIGH CONFIDENCE: Direct function execution
      console.log(`Executing function with high confidence: ${bestFunction.id}`, extractedParams);
      await executeFunction(bestFunction.id, extractedParams);
      setIsLoading(false);
      return;
    } else if (confidence === ConfidenceLevel.MEDIUM) {
      // MEDIUM CONFIDENCE: Show function suggestions
      const options = [...exactMatches, ...partialMatches].slice(0, 3); // Limit to 3 options
      
      const suggestionMessage: Message = {
        role: 'assistant',
        content: "I think you might be looking for one of these functions:",
        isNew: true,
        contentType: 'functionSuggestion',
        functionData: {
          suggestions: options.map(func => ({
            id: func.id,
            name: func.name,
            description: func.description,
            requiresWallet: func.requiresWallet
          })),
          confidenceLevel: confidence,
          extractedParams: extractedParams
        }
      };
      
      setMessages(prev => [...prev, suggestionMessage]);
      
      // Save to local storage
      if (conversationId) {
        saveMessage(conversationId, suggestionMessage);
      }
      
      setIsLoading(false);
      return;
    }    // For LOW confidence, we now pass directly to the AI Engine, just like NONE confidence
    // This means we skip the suggestion UI for low confidence matches
    else if (confidence === ConfidenceLevel.LOW) {
      console.log('Low confidence matches detected, passing to AI Engine instead of showing suggestions');
      // We'll continue to the AI response section below
      // No return statement here, so execution continues to AI section
    }    // If we get here, we're passing to the AI backend for the following cases:
    // This happens when:
    // 1. We have a general information question
    // 2. We have a conversational message (greeting, thanks, etc.)
    // 3. We have no function matches at all (NONE confidence)
    // 4. We have LOW confidence in any matches (now also passed to AI Engine instead of showing suggestions)
    try {      // Prepare metadata for the AI Engine
      // This helps the AI Engine understand the context of the message better
      // const metadata = {
      //   is_likely_general_question: isGeneralQuestion,
      //   available_functions: functionRegistry.map(f => ({
      //     id: f.id,
      //     name: f.name,
      //     description: f.description,
      //     patterns: f.patterns
      //   })),
      //   // Include any matched functions for context
      //   matched_functions: exactMatches.length > 0 || partialMatches.length > 0 ? 
      //     [...exactMatches, ...partialMatches].map(f => f.id).slice(0, 3) : [],
      //   confidence_level: confidence,
      //   // Additional context hints for the AI Engine
      //   query_characteristics: {
      //     is_conceptual: isGeneralQuestion,
      //     is_asking_about_terminology: messageText.toLowerCase().includes("call") || 
      //                                 messageText.toLowerCase().includes("refer") || 
      //                                 messageText.toLowerCase().includes("term") || 
      //                                 messageText.toLowerCase().includes("name") ||
      //                                 messageText.toLowerCase().includes("what is"),
      //     needs_kaleido_specific_response: true, // Always set to true to enforce Kaleido-centric responses
      //     message_length: messageText.length,
      //     word_count: messageText.split(/\s+/).length,
      //     has_question_mark: messageText.includes('?')
      //   }
      // };
      
      // Make API request to AI Engine backend
      const response = await fetch(ENDPOINTS.CHAT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [userMessage],
          user_id: userId,
          conversation_id: conversationId,
          // metadata: metadata // Add the metadata to help the AI Engine
        })
      });
      const data = await response.json();
      
      // Check if there's an error in the response
      if (!response.ok || data.error) {
        throw new Error(data.error || 'Failed to get response from server');
      }
      
      // Handle the fallback response case (when AI Engine is unavailable)
      if (data.error_details?.type === 'connection_error') {
        console.warn('Using fallback response due to connection error:', data.error_details);
      }
      
      // Store conversation ID if received
      if (data.context?.conversation_id) {
        setConversationId(data.context.conversation_id);
        localStorage.setItem('currentConversationId', data.context.conversation_id);
      }
      
      // Add assistant response to UI
      const assistantMessage: Message = {
        role: 'assistant',
        content: data.content || "I'm processing that for you...",
        isNew: true, // New response should have typing animation
        contentType: data.action ? 'functionResult' : 'text',
        functionData: data.action ? {
            result: { ...data.action, status: 'proposed' },
            executedFunction: data.action.type,
            visualization: 'card'
        } : undefined
      };
      
      // Prevent duplicate messages by checking if the last message is identical
      setMessages(prev => {
        const lastMessage = prev[prev.length - 1];
        if (lastMessage && 
            lastMessage.role === assistantMessage.role && 
            lastMessage.content === assistantMessage.content &&
            lastMessage.contentType === assistantMessage.contentType) {
          console.warn('Prevented duplicate message:', assistantMessage.content);
          return prev; // Don't add duplicate
        }
        return [...prev, assistantMessage];
      });
      
      // Save to local storage only if not a duplicate
      if (conversationId) {
        saveMessage(conversationId, assistantMessage);
      }
      
      // Update global neural link status and local state
      setIsSynced(true);
      (window as any).__luca_brain_active = true;
      (window as any).__luca_last_sync = Date.now();
      
    } catch (error: any) {
      console.error('Error in chat request:', error);
      
      // --- AUTONOMOUS RECOVERY ---
      // If the backend fails, try to use the best client-side match anyway (even if it was medium confidence)
      if (result.bestFunction || result.exactMatches.length > 0) {
        console.log('Backend failed, attempting autonomous recovery with local match...');
        const recoveryTarget = result.bestFunction?.id || result.exactMatches[0]?.id;
        if (recoveryTarget) {
            await executeFunction(recoveryTarget, result.extractedParams);
            setIsLoading(false);
            return;
        }
      }

      // Create a graceful error message for the user
      const errorMessage = "I'm sorry, I'm having trouble connecting to my brain, but my local systems are still online. Try asking about your balance or swap instead.";
      
      // Add the error message as an assistant response
      const errorResponseMessage: Message = {
        role: 'assistant',
        content: errorMessage,
        isNew: true, // Error messages should also have animation
        contentType: 'text'
      };
      
      // Prevent duplicate error messages
      setMessages(prev => {
        const lastMessage = prev[prev.length - 1];
        if (lastMessage && 
            lastMessage.role === errorResponseMessage.role && 
            lastMessage.content === errorResponseMessage.content &&
            lastMessage.contentType === errorResponseMessage.contentType) {
          console.warn('Prevented duplicate error message:', errorResponseMessage.content);
          return prev; // Don't add duplicate
        }
        return [...prev, errorResponseMessage];
      });
      
      // Save the error response to storage only if not a duplicate
      if (conversationId) {
        saveMessage(conversationId, errorResponseMessage);
      }
      
      // Also set the error state for the optional error display
      setError('Connection error: ' + (error.message || 'Failed to connect to AI service'));
    } finally {
      setIsLoading(false);
    }
  };

  // Start a new conversation
  const startNewConversation = () => {
    // Generate a new conversation ID
    const newConvoId = generateUUID();
    
    // Update state and localStorage
    setConversationId(newConvoId);
    localStorage.setItem('currentConversationId', newConvoId);
    
    // Reset messages
    setMessages([]);
    setError(null);
    
    // Add initial message
    const initialMessage: Message = {
      role: 'assistant',
      content: "Hello! I'm Luca, your AI assistant. How can I help you today?",
      timestamp: Date.now() / 1000,
      isNew: true // Make initial message animate in new conversation
    };
    setMessages([initialMessage]);
    saveMessage(newConvoId, initialMessage);
    
    // Close history dropdown if open
    setShowHistory(false);
  };
  
  // Load a specific conversation
  const openConversation = (convoId: string) => {
    if (convoId === conversationId) return; // Already on this conversation
    
    setConversationId(convoId);
    localStorage.setItem('currentConversationId', convoId);
    loadConversation(convoId);
    
    // Close history dropdown
    setShowHistory(false);
  };

  // Delete a specific conversation
  const deleteConversation = (convoId: string) => {
    try {
      localStorage.removeItem(`kaleido_conversation_${convoId}`);
      
      // If we're deleting the current active conversation, start a new one
      if (convoId === conversationId) {
        startNewConversation();
      } else {
        // Just refresh the list
        const history = getConversationHistory();
        setConversations(history);
      }
    } catch (error) {
      console.error("Error deleting conversation:", error);
    }
  };

  // Get conversation history from localStorage
  const getConversationHistory = (): Conversation[] => {
    try {
      const history: Conversation[] = [];
      // Get all localStorage keys
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('kaleido_conversation_')) {
          const convoData = localStorage.getItem(key);
          if (convoData) {
            const conversation: Conversation = JSON.parse(convoData);
            if (conversation.messages && conversation.messages.length > 0) {
              history.push(conversation);
            }
          }
        }
      }
      
      // Sort by updated_at (newest first)
      return history.sort((a, b) => b.updated_at - a.updated_at).slice(0, 10);
    } catch (error) {
      console.error("Error getting conversation history:", error);
      return [];
    }
  };

  // Execute a function by ID and add result to the conversation
  const executeFunction = async (functionId: string, params: any = {}) => {
    // Find the function in the registry
    const func = functionRegistry.find(f => f.id === functionId);
    if (!func) {
      console.error(`Function ${functionId} not found in registry`);
      return;
    }
    
    // Check if wallet is required
    if (func.requiresWallet) {
      const walletAddress = getWalletAddress();
      if (!walletAddress) {
        // Handle no wallet case
        const noWalletMessage: Message = {
          role: 'assistant',
          content: `To use this feature, you need to connect your wallet first. Please connect your wallet and try again.`,
          isNew: true
        };
        
        // Prevent duplicate no-wallet messages
        setMessages(prev => {
          const lastMessage = prev[prev.length - 1];
          if (lastMessage && 
              lastMessage.role === noWalletMessage.role && 
              lastMessage.content === noWalletMessage.content) {
            console.warn('Prevented duplicate no-wallet message');
            return prev; // Don't add duplicate
          }
          return [...prev, noWalletMessage];
        });
        
        if (conversationId) {
          saveMessage(conversationId, noWalletMessage);
        }
        return;
      }
    }

    setIsLoading(true);
    
    try {
      // Execute the function
      const result = await func.execute(params);
      
      // If the function is explicitly marked as not an action, treat it as a conversational reflex
      if (func.isAction === false) {
        const textMessage: Message = {
          role: 'assistant',
          content: result as string,
          isNew: true,
          contentType: 'text'
        };

        setMessages(prev => [...prev, textMessage]);
        if (conversationId) {
          saveMessage(conversationId, textMessage);
        }
        setIsLoading(false);
        return;
      }

      // Create a function result message
      const functionResultMessage: Message = {
        role: 'assistant',
        content: `Here's your ${func.name.toLowerCase()} information:`,
        isNew: true,
        contentType: 'functionResult',
        functionData: {
          result,
          executedFunction: func.id,
          visualization: getFunctionVisualization(func.id)
        }
      };
      
      // Add the message to the conversation with duplicate prevention
      setMessages(prev => {
        const lastMessage = prev[prev.length - 1];
        if (lastMessage && 
            lastMessage.role === functionResultMessage.role && 
            lastMessage.content === functionResultMessage.content &&
            lastMessage.contentType === functionResultMessage.contentType &&
            lastMessage.functionData?.executedFunction === functionResultMessage.functionData?.executedFunction) {
          console.warn('Prevented duplicate function result message:', functionResultMessage.content);
          return prev; // Don't add duplicate
        }
        return [...prev, functionResultMessage];
      });
      
      // Save to local storage
      if (conversationId) {
        saveMessage(conversationId, functionResultMessage);
      }
    } catch (error: any) {
      console.error(`Error executing function ${func.id}:`, error);
      
      // Add an error message with duplicate prevention
      const errorMessage: Message = {
        role: 'assistant',
        content: `I'm sorry, I couldn't ${func.name.toLowerCase()} at the moment. ${error.message}`,
        isNew: true,
      };
      
      setMessages(prev => {
        const lastMessage = prev[prev.length - 1];
        if (lastMessage && 
            lastMessage.role === errorMessage.role && 
            lastMessage.content === errorMessage.content) {
          console.warn('Prevented duplicate function error message:', errorMessage.content);
          return prev; // Don't add duplicate
        }
        return [...prev, errorMessage];
      });
      
      // Save error to local storage
      if (conversationId) {
        saveMessage(conversationId, errorMessage);
      }
      
      setError(`Function error: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Helper to determine visualization type for a function
  const getFunctionVisualization = (functionId: string): 'table' | 'chart' | 'card' => {
    switch (functionId) {
      case 'getLoanRiskScore':
        return 'card';
      case 'getWalletBalance':
        return 'table';
      case 'getPoolLiquidity':
        return 'chart';
      default:
        return 'card';
    }
  };
  return {
    isOpen,
    setIsOpen,
    isLoading,
    messages,
    setMessages,
    currentMessage,
    setCurrentMessage,
    error,
    sendMessage,
    executeFunction,
    conversations,
    showHistory,
    setShowHistory,
    startNewConversation,
    openConversation,
    deleteConversation,
    isSynced,
  };
}
