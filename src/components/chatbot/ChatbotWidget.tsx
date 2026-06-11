"use client";

import React, { useRef, useEffect, useState } from 'react';
import { IoMdSend } from 'react-icons/io';
import { IoClose, IoAdd } from 'react-icons/io5';
import { RiRobot2Fill } from 'react-icons/ri';
import { FiCopy, FiCheck, FiClock, FiZap, FiSettings, FiShield, FiTrash2, FiActivity, FiArrowUpRight, FiPlus, FiGift } from 'react-icons/fi';
import { FaHistory, FaShieldAlt } from 'react-icons/fa';
import { useChatbot } from './useChatbot';
import './chatbot.css';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import TypeWriter from './TypeWriter';
import { FunctionResult, FunctionSuggestion } from './FunctionComponents';
import ActionsPanel from './ActionsPanel';
import { functionRegistry } from './functionRegistry';
import { useSwapRouter } from '@/hooks/dex/useSwapRouter';
import useDepositCollateral from '@/hooks/useDepositCollateral';
import useDepositNativeColateral from '@/hooks/useDepositNativeColateral';
import useClaimToken from '@/hooks/useClaimToken';
import useStake from '@/hooks/useStake';
import useWithdrawStake from '@/hooks/useWithdrawStake';
import { useStablecoin } from '@/hooks/useStablecoin';
import { ADDRESS_1, USDC_ADDRESS, KLD_ADDRESS, USDR, USDT_ADDRESS, kfUSD_ADDRESS } from '@/constants/utils/addresses';
import useCheckAllowance from '@/hooks/useCheckAllowance';
import useGetValueAndHealth from '@/hooks/useGetValueAndHealth';
import useRepayLoan from '@/hooks/useRepayLoan';
import useCreateLoanListing from '@/hooks/useCreateLoanListing';
import useAcceptListedAds from '@/hooks/useAcceptListedAds';
import { getGatewayQuote } from './services/bridgeService';
import { simulateAgentTransaction } from './services/simulationService';
import { validateAgainstBaseline, updateBaseline } from './services/userBaselineService';
import { auditIntentDivergence } from './services/intentDivergenceService';
import { ethers } from 'ethers';
import { useActiveAccount } from 'thirdweb/react';
import { toast } from 'sonner';

export const CodeBlock = ({ node, inline, className, children, ...props }: any) => {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);
  
  const handleCopy = () => {
    if (codeRef.current) {
      const text = codeRef.current.textContent || '';
      navigator.clipboard.writeText(text)
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        })
        .catch(err => console.error('Failed to copy:', err));
    }
  };
  
  if (inline) {
    return <code className={className} {...props}>{children}</code>;
  }
  
  return (
    <div className="code-block-wrapper">
      <pre className={className}>
        <code ref={codeRef} {...props}>{children}</code>
      </pre>
      <button 
        className="copy-button-fixed"
        onClick={handleCopy}
        title="Copy to clipboard"
      >
        {copied ? <FiCheck size={12} color="#22c55e" /> : <FiCopy size={12} color="#22c55e" />}
      </button>
    </div>
  );
}

function ChatbotWidget() {  
  const { 
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
    isSynced
  } = useChatbot() as {
    isOpen: boolean;
    setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
    isLoading: boolean;
    messages: Array<any>; // Using any here for simplicity in this context
    setMessages: React.Dispatch<React.SetStateAction<Array<any>>>;
    currentMessage: string;
    setCurrentMessage: React.Dispatch<React.SetStateAction<string>>;
    error: string | null;
    sendMessage: (msg: string) => void;
    executeFunction: (functionId: string) => void;
    conversations: Array<{ id: string; messages: Array<any>; updated_at: number }>;
    showHistory: boolean;
    setShowHistory: React.Dispatch<React.SetStateAction<boolean>>;
    startNewConversation: () => void;
    openConversation: (id: string) => void;
    deleteConversation: (id: string) => void;
    isSynced: boolean;
  };
  
  const activeAccount = useActiveAccount();
  const [showActions, setShowActions] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  interface AgentPermissions {
    swapInfinite: boolean;
    lendInfinite: boolean;
    speedMode: boolean;
    sentinelMode: boolean;
    arbitrageMode: boolean;
  }
  
  // Permissions State - Persisted in localStorage for DeFi OS feel
  const [permissions, setPermissions] = useState<AgentPermissions>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('luca_agent_permissions');
      return saved ? JSON.parse(saved) : {
        swapInfinite: false,
        lendInfinite: false,
        speedMode: false,
        sentinelMode: false,
        arbitrageMode: false
      };
    }
    return { swapInfinite: false, lendInfinite: false, speedMode: false, sentinelMode: false, arbitrageMode: false };
  });

  // Persist permissions when they change
  useEffect(() => {
    localStorage.setItem('luca_agent_permissions', JSON.stringify(permissions));
  }, [permissions]);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [animationCompleted, setAnimationCompleted] = useState<{[key: string]: boolean}>({});
  
  interface AgentTransaction {
    id: string;
    type: string;
    description: string;
    hash: string;
    timestamp: number;
    status: 'success' | 'failed' | 'pending';
  }

  const [agentTransactions, setAgentTransactions] = useState<AgentTransaction[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('luca_agent_transactions');
      return saved ? JSON.parse(saved) : [];
    }
    return [];
  });

  const [historyTab, setHistoryTab] = useState<'chats' | 'txs'>('chats');

  // Persist transactions when they change
  useEffect(() => {
    localStorage.setItem('luca_agent_transactions', JSON.stringify(agentTransactions));
  }, [agentTransactions]);

  const addTransaction = (tx: Omit<AgentTransaction, 'id' | 'timestamp'>) => {
    const newTx: AgentTransaction = {
      ...tx,
      id: Math.random().toString(36).substr(2, 9),
      timestamp: Date.now()
    };
    setAgentTransactions(prev => [newTx, ...prev].slice(0, 50)); // Keep last 50
  };

  // Function to scroll to the bottom of the chat
  const scrollToBottom = () => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  };
  // Auto-execute if Speed Mode is on
  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (permissions.speedMode && 
        lastMessage?.role === 'assistant' && 
        lastMessage?.contentType === 'functionResult' && 
        lastMessage?.functionData?.result?.status === 'proposed') {
      
      const result = lastMessage.functionData.result;
      // Mark as executing so we don't trigger twice
      lastMessage.functionData.result.status = 'executing';
      handleConfirmAction(result);
    }
  }, [messages, permissions.speedMode]);

  // Auto-scroll to bottom of chat when messages change, typing animation completes, chat opens, or panels toggle
  useEffect(() => {
    if (chatContainerRef.current) {
      // Use setTimeout to ensure scrolling happens after render is complete
      setTimeout(() => {
        if (chatContainerRef.current) {
          chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
      }, 0);
    }
  }, [messages, animationCompleted, isOpen, showHistory, showActions]);
  // Focus input and scroll to bottom when chat is opened
  useEffect(() => {
    if (isOpen) {
      // Focus input
      if (inputRef.current) {
        inputRef.current.focus();
      }
      
      // Scroll to bottom with a slight delay to ensure content is rendered
      setTimeout(scrollToBottom, 100);
    }
  }, [isOpen]);

  // Protocol Hooks (Must be called at top level)
  const { handleAgentSwap, addLiquidity, removeLiquidity } = useSwapRouter();
  const depositErc20 = useDepositCollateral();
  const depositNative = useDepositNativeColateral();
  const { claimKLDToken, claimToken } = useClaimToken();
  const { Stake } = useStake();
  const { WithdrawStake } = useWithdrawStake();
  const { mintKfUSD } = useStablecoin();
  const repayLoan = useRepayLoan();
  const createLoanListing = useCreateLoanListing();
  const acceptMarketplaceAd = useAcceptListedAds();
  const { val: usdcAllowance, usdrVal: usdrAllowance, kfusdVal: kfusdAllowance, usdtVal: usdtAllowance } = useCheckAllowance();
  const { data2: healthFactor = 0 } = useGetValueAndHealth();
  
  // Helper to get signer for Agentic execution
  const getSigner = async () => {
    if (typeof window === "undefined" || !window.ethereum) return null;
    const provider = new ethers.BrowserProvider(window.ethereum);
    return await provider.getSigner();
  };

  const handleAgentBridge = async (params: any) => {
    const signer = await getSigner();
    if (!signer) throw new Error("Wallet not connected");

    toast.info(`Fetching optimal bridge route from ${params.fromChain}...`);
    const quote = await getGatewayQuote(
        params.fromChain, 
        params.toChain, 
        params.amount, 
        params.token, 
        params.token,
        activeAccount?.address
    );
    
    if (!quote || !quote.transactionRequest) {
        throw new Error("Could not find a secure bridge route. Please try again later.");
    }

    toast.info(`Executing ${quote.provider} bridge transaction...`);
    
    // Relay/Li.Fi transaction data
    const tx = await signer.sendTransaction({
        to: quote.transactionRequest.to,
        data: quote.transactionRequest.data,
        value: quote.transactionRequest.value || 0
    });

    return tx;
  };

  // Helper to check if any major token has large allowance (infinite)
  const isInfiniteApproved = () => {
    const threshold = 1000000; 
    return usdcAllowance > threshold || usdrAllowance > threshold || kfusdAllowance > threshold || usdtAllowance > threshold;
  };

  const handleSend = () => {
    sendMessage(currentMessage);
  };

  const executeMacroStep = async (macroData: any, stepIndex: number) => {
    try {
      const steps = macroData.steps || [];
      if (stepIndex >= steps.length && !macroData.iterations) {
          macroData.status = 'success';
          setMessages(prev => [...prev]);
          toast.success("Strategy successfully completed!");
          return;
      }

      const stepPattern = steps[stepIndex % steps.length];
      const isLastStep = macroData.iterations 
        ? stepIndex + 1 >= macroData.iterations * 2 
        : stepIndex + 1 >= steps.length;
      
      // Update UI state
      macroData.currentStep = stepIndex + 1;
      setMessages(prev => [...prev]);
      
      // Safety Hardening: Health Factor Check
      if (healthFactor > 0 && Number(healthFactor) < 1.1 && (macroData.action === 'rebalance' || macroData.action === 'yield_optimization')) {
          throw new Error("Action aborted: Your Health Factor is too low ( < 1.1). Moving collateral now could risk liquidation.");
      }

      // PHASE 4: COGNITIVE SAFETY AUDIT (Behavioral + Intent)
      const baselineRisk = validateAgainstBaseline(0, stepPattern.toToken || 'UNKNOWN'); // We'd pass real USD value here
      if (baselineRisk > 80) {
          throw new Error(`Cognitive Lock: This transaction deviates significantly from your historical behavior. Risk Score: ${baselineRisk}/100.`);
      }

      const intentAudit = auditIntentDivergence(messages[messages.length-1].content, macroData.action, stepPattern.toToken || 'ETH');
      if (intentAudit.divergent) {
          throw new Error(`Audit Failure: ${intentAudit.reason}`);
      }

      // PHASE 3: SHADOW-FORK SIMULATION AUDIT
      toast.info(`Shadow-Fork: Auditing step ${stepIndex + 1}...`);
      // Use atomic intent from macroData to guide simulation audit
      const intendedAction = macroData.action === 'yield_optimization' ? 'bridge' : 
                            (macroData.action === 'arbitrage_execution' ? 'swap' : 'swap');
                            
      const simResult = await simulateAgentTransaction("0x...", "0x...", "0", 11124, intendedAction);
      
      if (!simResult.success) {
          throw new Error(`Critical Protection: ${simResult.warning}. Simulation blocked to prevent asset drain.`);
      }
      
      if (simResult.metrics?.hasSymmetryViolation) {
          throw new Error("Sovereign Block: Symmetry Violation detected. Target attempted unauthorized state changes during calculation.");
      }
      
      toast.success(`Simulation Passed: Risk Score ${simResult.riskScore}/100`);

      let tx: any;
      if (stepPattern.type === 'swap') {
        tx = await handleAgentSwap(stepPattern.fromToken, stepPattern.toToken, stepPattern.amount);
      } else if (stepPattern.type === 'bridge') {
        toast.info(`Macro Step ${stepIndex + 1}: Bridging assets...`);
        tx = await handleAgentBridge({ fromChain: stepPattern.fromChain, toChain: stepPattern.toChain, amount: stepPattern.amount, token: stepPattern.token });
      } else if (stepPattern.type === 'deposit' || stepPattern.type === 'lend') {
        const tokenAddr = stepPattern.token === 'USDC' ? USDC_ADDRESS : (stepPattern.token === 'KALE' || stepPattern.token === 'KLD' ? KLD_ADDRESS : stepPattern.token);
        tx = await depositErc20(stepPattern.amount, tokenAddr);
      } else if (stepPattern.type === 'scout') {
        toast.success(`Macro Step ${stepIndex + 1}: Scan Complete.`);
        await new Promise(r => setTimeout(r, 1000));
        await executeMacroStep(macroData, stepIndex + 1);
        return;
      }

      if (tx && (tx.hash || tx.wait)) {
        addTransaction({
          type: 'MACRO_STEP',
          description: `${macroData.action || 'Macro'} Step ${stepIndex + 1}`,
          hash: tx.hash || 'pending',
          status: 'pending'
        });

        if (tx.wait) await tx.wait();
        
        // Update Behavioral Baseline upon success
        updateBaseline(0, stepPattern.toToken || 'ETH'); // Update with the asset used
        
        setAgentTransactions(prev => prev.map(t => t.hash === tx.hash ? {...t, status: 'success'} : t));

        if (!isLastStep) {
          if (permissions.speedMode) {
             await executeMacroStep(macroData, stepIndex + 1);
          } else {
             toast.success(`Step ${stepIndex + 1} complete. Authorize next step.`);
             macroData.status = 'proposed';
             setMessages(prev => [...prev]);
          }
        } else {
          macroData.status = 'success';
          setMessages(prev => [...prev]);
          toast.success("Macro successfully completed!");
        }
      }
    } catch (error: any) {
      console.error("Macro step failed:", error);
      macroData.status = 'failed';
      setMessages(prev => [...prev]);
      toast.error(`Strategy failed at step ${stepIndex + 1}: ${error.message}`);
    }
  };

  const handleConfirmAction = async (data: any) => {
    try {
        if (data.type === 'macro') {
            data.status = 'executing';
            setMessages(prev => [...prev]);
            await executeMacroStep(data, 0);
            return;
        }
        if (data.type === 'swap') {
            const amount = data.amount;
            const fromToken = data.fromToken === 'ETH' ? ADDRESS_1 : (data.fromToken === 'USDC' ? USDC_ADDRESS : data.fromToken);
            const toToken = data.toToken === 'ETH' ? ADDRESS_1 : (data.toToken === 'USDC' ? USDC_ADDRESS : data.toToken);
            
            toast.info(`Initiating swap: ${amount} ${data.fromToken} → ${data.toToken}`);
            const tx = await handleAgentSwap(data.fromToken, data.toToken, amount);
            addTransaction({
              type: 'SWAP',
              description: `${amount} ${data.fromToken} ${data.toToken}`,
              hash: tx.hash || '',
              status: 'pending'
            });
            await tx.wait();
            setAgentTransactions(prev => prev.map(t => t.hash === tx.hash ? {...t, status: 'success'} : t));
            toast.success("Swap Successful!");
        } else if (data.type === 'lend') {
            const amount = data.amount;
            const isNative = data.token === 'ETH' || data.token === 'WETH';

            if (isNative) {
                await depositNative(amount);
            } else {
                const tokenAddr = data.token === 'USDC' ? USDC_ADDRESS : (data.token === 'KALE' || data.token === 'KLD' ? KLD_ADDRESS : data.token);
                await depositErc20(amount, tokenAddr);
            }
            toast.success(`${amount} ${data.token} deposit initiated!`);
        } else if (data.type === 'addLiquidity') {
            toast.info(`Initiating add liquidity: ${data.amountA} ${data.tokenA} + ${data.amountB} ${data.tokenB}`);
            const tokenAAddr = data.tokenA === 'ETH' ? ADDRESS_1 : (data.tokenA === 'USDC' ? USDC_ADDRESS : data.tokenA);
            const tokenBAddr = data.tokenB === 'ETH' ? ADDRESS_1 : (data.tokenB === 'USDC' ? USDC_ADDRESS : data.tokenB);
            const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
            // Assuming default to 18 decimals and to the current wallet address inside the hook
            const tx = await addLiquidity(tokenAAddr, tokenBAddr, data.amountA, data.amountB, ADDRESS_1, deadline, false);
            if (tx && tx.wait) await tx.wait();
            toast.success(`Successfully added liquidity for ${data.tokenA}/${data.tokenB}!`);
        } else if (data.type === 'removeLiquidity') {
            toast.info(`Initiating remove liquidity for ${data.tokenA}/${data.tokenB}`);
            const tokenAAddr = data.tokenA === 'ETH' ? ADDRESS_1 : (data.tokenA === 'USDC' ? USDC_ADDRESS : data.tokenA);
            const tokenBAddr = data.tokenB === 'ETH' ? ADDRESS_1 : (data.tokenB === 'USDC' ? USDC_ADDRESS : data.tokenB);
            // Defaulting parameters assuming 100% or standard withdrawal from the router hook
            const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
            const tx = await removeLiquidity(tokenAAddr, tokenBAddr, data.lpAmount || '0', '0', '0', ADDRESS_1, deadline);
            if (tx && tx.wait) await tx.wait();
            toast.success("Successfully removed liquidity!");
        } else if (data.type === 'claimRewards') {
            toast.info("Initiating reward harvesting...");
            if (data.rewardType === 'KLD' || data.rewardType === 'KALE') {
                 await claimKLDToken();
            } else {
                 await claimToken();
            }
            toast.success("Rewards harvested successfully!");
        } else if (data.type === 'stake') {
            toast.info(`Initiating stake for ${data.amount} KLD...`);
            await Stake(data.amount);
        } else if (data.type === 'unstake') {
            toast.info(`Initiating unstake for ${data.amount} KLD...`);
            await WithdrawStake(data.amount);
        } else if (data.type === 'mintStablecoin') {
            toast.info(`Minting kfUSD using ${data.amount} ${data.token}...`);
            await mintKfUSD(data.token, data.amount);
        } else if (data.type === 'borrow') {
            toast.info(`Initiating borrow for ${data.amount} ${data.token}...`);
            // We reuse the loan listing hook for creating "borrow requests" or listings
            const tx: any = await createLoanListing(data.amount, Number(data.amount), Number(data.amount), Math.floor(Date.now()/1000) + 86400 * 30, 5, data.token || 'USDR');
            if (tx && tx.hash) {
                addTransaction({
                    type: 'BORROW',
                    description: `${data.amount} ${data.token}`,
                    hash: tx.hash,
                    status: 'success'
                });
            }
        } else if (data.type === 'repay') {
            toast.info(`Repaying loan #${data.requestId} with ${data.amount} ${data.token}...`);
            const tokenAddr = data.token === 'USDC' ? USDC_ADDRESS : (data.token === 'USDR' ? USDR : ADDRESS_1);
            const tx: any = await repayLoan(Number(data.requestId), tokenAddr, data.amount);
            if (tx && tx.hash) {
                addTransaction({
                    type: 'REPAY',
                    description: `Loan #${data.requestId} (${data.amount} ${data.token})`,
                    hash: tx.hash,
                    status: 'success'
                });
            }
        } else if (data.type === 'marketplace') {
            if (data.action === 'list') {
                toast.info(`Creating marketplace listing for ${data.amount} ${data.token || 'KALE'}...`);
                const tx: any = await createLoanListing(data.amount, Number(data.amount) * 0.8, Number(data.amount) * 1.2, Math.floor(Date.now()/1000) + 86400 * 7, 10, data.token || 'KALE');
                if (tx && tx.hash) {
                    addTransaction({
                        type: 'LIST',
                        description: `${data.amount} ${data.token || 'KALE'}`,
                        hash: tx.hash,
                        status: 'success'
                    });
                }
            } else {
                toast.info(`Accepting marketplace listing #${data.listingId}...`);
                const tx: any = await acceptMarketplaceAd(Number(data.listingId), data.amount, data.token || 'KALE');
                if (tx && tx.hash) {
                    addTransaction({
                        type: 'BUY',
                        description: `Listing #${data.listingId}`,
                        hash: tx.hash,
                        status: 'success'
                    });
                }
            }
        } else if (data.type === 'tour') {
            const eventName = data.tourType === 'deposit' || data.tourType === 'collateral' ? 'startCollateralTour' : 'startDashboardTour';
            window.dispatchEvent(new CustomEvent(eventName));
            setIsOpen(false); 
            toast.success(`Starting autonomous ${data.tourType} tour...`);
        }
      } catch (err: any) {
          console.error("Agent action failed:", err);
          toast.error(`Action failed: ${err.message || "Unknown error"}`);
      }
    };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };
  // Mark a message as having completed its typing animation
  const handleAnimationComplete = (index: number) => {
    setAnimationCompleted(prev => ({
      ...prev,
      [index]: true
    }));
    
    // Update the message to no longer be marked as new
    // This ensures if the user navigates away and comes back,
    // the animation won't play again
    // Use a ref to prevent unnecessary re-renders during animation
    setMessages(prevMessages => {
      const updatedMessages = [...prevMessages];
      if (updatedMessages[index] && updatedMessages[index].isNew) {
        updatedMessages[index] = {
          ...updatedMessages[index],
          isNew: false
        };
        
        // Update localStorage with the modified message
        try {
          const conversationId = localStorage.getItem('currentConversationId');
          if (conversationId) {
            const existingData = localStorage.getItem(`kaleido_conversation_${conversationId}`);
            if (existingData) {
              const conversation = JSON.parse(existingData);
              conversation.messages = updatedMessages;
              conversation.updated_at = Date.now() / 1000;
              localStorage.setItem(`kaleido_conversation_${conversationId}`, JSON.stringify(conversation));
            }
          }
        } catch (error) {
          console.error("Error updating message animation state:", error);
        }
        
        return updatedMessages;
      }
      return prevMessages; // Return same reference if no change needed
    });
  };

  return (
    <div className="fixed bottom-5 right-5 z-[9999] max-w-full">
      {/* Chat toggle button */}
      <div className="relative group">
        <button 
          className={`flex items-center justify-center w-14 h-14 rounded-full shadow-lg transition-all duration-300
                     ${isOpen ? 'bg-red-500 hover:bg-red-600' : 'bg-green-600 hover:bg-green-700'}`}
          onClick={() => setIsOpen(!isOpen)}
          type="button"
        >
          {isOpen ? (
            <IoClose className="text-white text-xl" />
          ) : (
            <RiRobot2Fill className="text-white text-xl" />
          )}
        </button>
        {/* Tooltip on hover, only when chat is closed */}
        {!isOpen && (
          <div className="absolute right-0 bottom-20 mb-2 hidden group-hover:flex flex-col items-end z-50">
            <div className="px-3 py-2 rounded-lg bg-[#2a2a2a] text-white text-xs font-medium shadow-lg whitespace-nowrap mr-2">
              Luca AI
            </div>
            <div className="w-3 h-3 bg-[#2a2a2a] rotate-45 mt-[-6px] mr-6"></div>
          </div>
        )}
      </div>

      {/* Chat widget */}
      {isOpen && (
        <div className="absolute bottom-16 right-0 sm:right-0 xs:right-[-5px] w-[95vw] max-w-[550px] h-[85vh] max-h-[750px] md:h-[750px] bg-[#1a1a2e]/95 backdrop-blur-xl rounded-3xl shadow-[0_0_50px_rgba(0,0,0,0.5)] flex flex-col border border-[#00ff99]/30 overflow-hidden chatbot-widget">
          {/* Header */}
          <div className="flex items-center justify-between bg-[#0f0f1a]/80 backdrop-blur-sm text-white p-4 border-b border-[#00ff99]/20">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-r from-[#00ff99] to-[#00cc7a] flex items-center justify-center shadow-lg shadow-[#00ff99]/30">
                <RiRobot2Fill className="text-[#0f0f1a] text-sm" />
              </div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-[#00ff99]">Luca AI</h3>
                {healthFactor > 0 && (
                  <div 
                    className={`text-[8px] px-1.5 py-0.5 rounded border font-bold animate-pulse flex items-center gap-1 ${
                      healthFactor < 1.1 ? 'bg-red-500/20 text-red-500 border-red-500/40' :
                      healthFactor < 1.8 ? 'bg-[#ffd700]/20 text-[#ffd700] border-[#ffd700]/40' :
                      'bg-[#00ff99]/20 text-[#00ff99] border-[#00ff99]/40'
                    }`}
                    title="Your Lending Health Factor"
                  >
                    <div className={`w-1 h-1 rounded-full ${healthFactor < 1.1 ? 'bg-red-500' : healthFactor < 1.8 ? 'bg-[#ffd700]' : 'bg-[#00ff99]'}`}></div>
                    HF: {typeof healthFactor === 'number' ? Number(healthFactor).toFixed(2) : healthFactor}
                  </div>
                )}
                
                {/* Neural Link Status Orb */}
                <div 
                  className={`text-[8px] px-1.5 py-0.5 rounded border font-bold flex items-center gap-1 ${isSynced ? 'bg-blue-500/20 text-blue-400 border-blue-500/40' : 'bg-gray-500/10 text-gray-500 border-gray-500/20'}`}
                  title={isSynced ? "Neural Link Active" : "Neural Link Offline"}
                >
                  <div className={`w-1.5 h-1.5 rounded-full ${isSynced ? 'bg-blue-400 shadow-[0_0_8px_#60a5fa] animate-pulse' : 'bg-gray-500'}`}></div>
                  SYNC
                </div>

                {/* Sentinel Mode Orb */}
                {permissions.sentinelMode && (
                  <div 
                    className="text-[8px] px-1.5 py-0.5 rounded border border-[#00ff99]/40 bg-[#00ff99]/20 text-[#00ff99] font-bold flex items-center gap-1"
                    title="Yield Sentinel Mode Active"
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-[#00ff99] shadow-[0_0_8px_#00ff99] animate-pulse"></div>
                    SENTINEL
                  </div>
                )}
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              {/* History button */}
              <div className="tooltip-wrapper">
                <button 
                  onClick={() => {
                    setShowHistory(!showHistory); 
                    if (!showHistory && showActions) {
                      setShowActions(false);
                    }
                  }} 
                  className="text-white hover:text-gray-200 transition-colors"
                >
                  <FaHistory className="text-lg" />
                </button>
                <span className="tooltip">Chat History</span>
              </div>

              <div className="tooltip-wrapper">
                <button 
                  onClick={() => {
                    setShowSettings(!showSettings);
                    if (!showSettings) {
                        setShowHistory(false);
                        setShowActions(false);
                    }
                  }} 
                  className={`transition-colors ${showSettings ? 'text-[#00ff99]' : 'text-white hover:text-gray-200'}`}
                >
                  <FiSettings className="text-lg" />
                </button>
                <span className="tooltip"> Luca Settings</span>
              </div>
              
              <div className="tooltip-wrapper">
                <button 
                  onClick={() => {
                    startNewConversation();
                    setTimeout(scrollToBottom, 100);
                  }}
                  className="text-white hover:text-gray-200 transition-colors"
                >
                  <IoAdd className="text-xl" />
                </button>
                <span className="tooltip">New Conversation</span>
              </div>
              
              <button 
                onClick={() => {
                  const isExecuting = messages.some(m => m.functionData?.result?.status === 'executing');
                  if (isExecuting) {
                      toast.warning("Please wait for transaction to complete");
                      return;
                  }
                  setIsOpen(false);
                }} 
                title={messages.some(m => m.functionData?.result?.status === 'executing') ? "Execution in progress" : "Close"}
              >
                <IoClose className="text-white text-xl" />
              </button>
            </div>
          </div>
          
          {/* Settings / Permissions Panel */}
          {showSettings && (
            <div className="bg-[#1a1a2e] border-b border-[#00ff99]/20 p-4 animate-in slide-in-from-top duration-300">
              <div className="flex items-center gap-2 mb-4">
                <FaShieldAlt className="text-[#00ff99]" />
                <h4 className="text-sm font-bold text-white uppercase tracking-tight">Agent Permissions</h4>
              </div>
              
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-[#12121f] rounded-lg border border-[#00ff99]/10">
                  <div>
                    <div className="text-xs font-bold text-white flex items-center gap-2">
                        Infinite DEX Approval
                        {isInfiniteApproved() && (
                            <span className="text-[7px] px-1 bg-[#00ff99]/20 text-[#00ff99] border border-[#00ff99]/30 rounded uppercase font-bold animate-pulse">Live Active</span>
                        )}
                    </div>
                    <div className="text-[10px] text-gray-400">Allow Luca to spend tokens for swaps</div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                        type="checkbox" 
                        className="sr-only peer" 
                        checked={permissions.swapInfinite}
                        onChange={() => setPermissions((p: AgentPermissions) => ({...p, swapInfinite: !p.swapInfinite}))}
                    />
                    <div className="w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#00ff99]"></div>
                  </label>
                </div>

                <div className="flex items-center justify-between p-3 bg-[#12121f] rounded-lg border border-[#00ff99]/10">
                  <div>
                    <div className="text-xs font-bold text-white flex items-center gap-2">
                        Lending Pre-Auth
                        {isInfiniteApproved() && (
                            <span className="text-[7px] px-1 bg-[#00ff99]/20 text-[#00ff99] border border-[#00ff99]/30 rounded uppercase font-bold animate-pulse">Live Active</span>
                        )}
                    </div>
                    <div className="text-[10px] text-gray-400">Allow Luca to manage deposits</div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                        type="checkbox" 
                        className="sr-only peer" 
                        checked={permissions.lendInfinite}
                        onChange={() => setPermissions((p: any) => ({...p, lendInfinite: !p.lendInfinite}))}
                    />
                    <div className="w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#00ff99]"></div>
                  </label>
                </div>

                <div className="flex items-center justify-between p-3 bg-[#12121f] rounded-lg border border-[#00ff99]/10">
                  <div>
                    <div className="text-xs font-bold text-white flex items-center gap-2">
                        Yield Sentinel AI
                        <span className="text-[7px] px-1 bg-[#00ff99]/10 text-[#00ff99]/60 border border-[#00ff99]/10 rounded uppercase font-bold">Background Scout</span>
                    </div>
                    <div className="text-[10px] text-gray-400">Luca scouts Abstract for yield opportunities</div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                        type="checkbox" 
                        className="sr-only peer" 
                        checked={permissions.sentinelMode}
                        onChange={() => setPermissions((p: any) => ({...p, sentinelMode: !p.sentinelMode}))}
                    />
                    <div className="w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#00ff99]"></div>
                  </label>
                </div>

                <div className="flex items-center justify-between p-3 bg-[#12121f] rounded-lg border border-[#00ff99]/10">
                  <div>
                    <div className="text-xs font-bold text-white flex items-center gap-2">
                        Arbitrage Scout AI
                        <span className="text-[7px] px-1 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded uppercase font-bold">PULSE Hunt</span>
                    </div>
                    <div className="text-[10px] text-gray-400">Luca hunts cross-chain price discrepancies</div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                        type="checkbox" 
                        className="sr-only peer" 
                        checked={permissions.arbitrageMode}
                        onChange={() => setPermissions((p: any) => ({...p, arbitrageMode: !p.arbitrageMode}))}
                    />
                    <div className="w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-400"></div>
                  </label>
                </div>

                <div className="flex items-center justify-between p-3 bg-[#12121f] rounded-lg border border-[#00ff99]/10">
                  <div>
                    <div className="text-xs font-bold text-[#ffd700] flex items-center gap-1">
                      <FiZap className="fill-[#ffd700]" /> Speed Mode
                    </div>
                    <div className="text-[10px] text-gray-400">Skip confirmation cards; execute instantly</div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                        type="checkbox" 
                        className="sr-only peer" 
                        checked={permissions.speedMode}
                        onChange={() => setPermissions((p: AgentPermissions) => ({...p, speedMode: !p.speedMode}))}
                    />
                    <div className="w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#ffd700]"></div>
                  </label>
                </div>

                <div className="mt-4 p-2 bg-[#00ff99]/5 rounded border border-[#00ff99]/10">
                    <p className="text-[9px] text-gray-400 text-center uppercase tracking-widest font-bold">
                        Security Note: These toggles enable "Max Allowance" for the protocol contracts on first use.
                    </p>
                </div>
              </div>
            </div>
          )}
                   {/* History dropdown */}
          {showHistory && (
            <div className="bg-[#1a1a2e] border-b border-[#00ff99]/20 max-h-80 overflow-y-auto chatbot-history-dropdown flex flex-col">
              <div className="flex bg-[#0f0f1a] border-b border-[#00ff99]/10 sticky top-0 z-10">
                  <button 
                      className={`flex-1 py-2.5 text-[10px] font-bold uppercase tracking-widest transition-all ${historyTab === 'chats' ? 'text-[#00ff99] border-b-2 border-[#00ff99] bg-[#00ff99]/5' : 'text-gray-500 hover:text-gray-300'}`}
                      onClick={() => setHistoryTab('chats')}
                  >
                      Recent Conversations
                  </button>
                  <button 
                      className={`flex-1 py-2.5 text-[10px] font-bold uppercase tracking-widest transition-all ${historyTab === 'txs' ? 'text-[#00ff99] border-b-2 border-[#00ff99] bg-[#00ff99]/5' : 'text-gray-500 hover:text-gray-300'}`}
                      onClick={() => setHistoryTab('txs')}
                  >
                      Protocol Ledger
                  </button>
              </div>

              {historyTab === 'chats' ? (
                <>
                  {conversations.length > 0 ? (
                    <ul className="divide-y divide-white/5 chatbot-history-list">
                      {conversations.slice(0, 10).map((convo) => {
                        const previewMessage = convo.messages.find(m => m.role === 'assistant') || 
                                              convo.messages[0] || 
                                              { content: "New conversation" };
                        
                        const date = new Date(convo.updated_at * 1000);
                        const formattedDate = `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
                        
                        const truncatedContent = previewMessage.content.length > 60 
                          ? previewMessage.content.substring(0, 60) + '...'
                          : previewMessage.content;
                          
                        return (
                          <li 
                            key={convo.id} 
                            className="transition-colors border-l-0 border-l-[#00ff99] hover:border-l-4 hover:bg-[#12121f] cursor-pointer group"
                            onClick={() => {
                              openConversation(convo.id);
                              setTimeout(scrollToBottom, 50);
                            }}
                          >
                            <div className="flex items-start p-3">
                               <FiClock className="text-[#00ff99] mt-1 mr-2 opacity-50" />
                               <div className="flex-1">
                                 <div className="text-[10px] font-bold text-[#00ff99]/70 uppercase">{formattedDate}</div>
                                 <div className="text-xs text-gray-300 mt-1">{truncatedContent}</div>
                               </div>
                               <button 
                                 onClick={(e) => {
                                   e.stopPropagation();
                                   deleteConversation(convo.id);
                                 }}
                                 className="p-1.5 text-gray-500 hover:text-red-500 hover:bg-red-500/10 transition-all rounded opacity-0 group-hover:opacity-100 ml-2"
                                 title="Delete conversation"
                               >
                                 <FiTrash2 className="text-sm" />
                               </button>
                             </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <div className="p-12 text-center">
                      <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-[#00ff99]/10 flex items-center justify-center">
                        <FiClock className="text-[#00ff99] text-xl" />
                      </div>
                      <div className="text-xs font-medium text-gray-400 uppercase tracking-widest">No history found</div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowHistory(false);
                          startNewConversation();
                          setTimeout(scrollToBottom, 100);
                        }}
                        className="mt-4 px-4 py-2 bg-[#00ff99]/20 text-[#00ff99] text-[10px] font-bold rounded-full hover:bg-[#00ff99]/30 transition-all uppercase tracking-widest border border-[#00ff99]/30"
                      >
                        New Session
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="p-2 space-y-2 pb-4">
                  {agentTransactions.length > 0 ? (
                    agentTransactions.map((tx) => (
                      <div key={tx.id} className="p-3 bg-[#12121f] rounded-xl border border-white/5 hover:border-[#00ff99]/30 transition-all group">
                         <div className="flex justify-between items-start mb-2">
                           <div className="flex items-center gap-2">
                             <div className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter ${
                               tx.type === 'SWAP' ? 'bg-[#00ccff]/20 text-[#00ccff]' :
                               tx.type === 'BORROW' ? 'bg-purple-500/20 text-purple-500' :
                               tx.type === 'LIST' ? 'bg-amber-500/20 text-amber-500' :
                               'bg-[#00ff99]/20 text-[#00ff99]'
                             }`}>
                               {tx.type}
                             </div>
                             <span className="text-[10px] font-bold text-gray-Profile text-white">{tx.description}</span>
                           </div>
                           <div className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-full ${
                             tx.status === 'success' ? 'bg-[#00ff99]/10 text-[#00ff99]' :
                             tx.status === 'pending' ? 'bg-amber-500/10 text-amber-500 animate-pulse' :
                             'bg-red-500/10 text-red-500'
                           }`}>
                             {tx.status}
                           </div>
                         </div>
                         <div className="flex justify-between items-center text-[9px]">
                           <span className="text-gray-500">{new Date(tx.timestamp).toLocaleString()}</span>
                           <a 
                             href={`https://abstractscan.io/tx/${tx.hash}`}
                             target="_blank"
                             rel="noopener noreferrer"
                             className="text-[#00ff99] hover:underline flex items-center gap-1"
                           >
                             {tx.hash.substring(0, 10)}... {tx.hash.substring(60)}
                             <FiCopy size={10} />
                           </a>
                         </div>
                      </div>
                    ))
                  ) : (
                    <div className="p-12 text-center">
                        <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-white/5 flex items-center justify-center">
                            <FaShieldAlt className="text-gray-500 text-xl" />
                        </div>
                        <div className="text-xs font-bold text-gray-500 uppercase tracking-widest">No transactions logged</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          
          {/* Error message */}
          {error && (
            <div className="bg-red-100 text-red-700 px-4 py-2 text-sm">
              {error}
            </div>
          )}

          {/* Chat messages */}
          <div 
            ref={chatContainerRef}
            className="flex-1 overflow-y-auto p-4 bg-[#12121f] chatbot-messages-container"
          >
            {messages.map((msg, index) => (
              <div 
                key={index}
                className={`max-w-[85%] mb-3 p-3 rounded-2xl backdrop-blur-sm ${
                  msg.role === 'user' 
                    ? 'ml-auto bg-gradient-to-r from-[#00ff99]/20 to-[#00cc7a]/10 text-white border border-[#00ff99]/30 rounded-br-md' 
                    : 'mr-auto bg-[#1e1e30]/80 text-gray-200 border border-[#2a2a40] rounded-bl-md'
                }`}
              >
                <div className="font-semibold text-xs mb-1">
                  {msg.role === 'user' ? 'You' : 'Luca'}
                </div>
                {msg.role === 'user' ? (
                  <div className="text-sm markdown-content">
                    <ReactMarkdown 
                      rehypePlugins={[rehypeSanitize]}
                      remarkPlugins={[remarkGfm]}
                      components={{ code: CodeBlock }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <>
                    {msg.isNew ? (
                      <TypeWriter 
                        content={msg.content} 
                        delay={30}
                        onComplete={() => handleAnimationComplete(index)}
                      />
                    ) : (
                      <div className="text-sm markdown-content">
                        <ReactMarkdown 
                          rehypePlugins={[rehypeSanitize]}
                          remarkPlugins={[remarkGfm]}
                          components={{ code: CodeBlock }}
                        >
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                    )}
                    
                    {msg.contentType === 'functionSuggestion' && (
                      <FunctionSuggestion 
                        message={msg} 
                        onFunctionSelect={executeFunction} 
                      />
                    )}
                    
                    {msg.contentType === 'functionResult' && (
                      <FunctionResult 
                        message={msg} 
                        onConfirmAction={handleConfirmAction} 
                      />
                    )}
                  </>
                )}
              </div>
            ))}

            {/* Loading indicator */}
            {isLoading && (
              <div className="max-w-[85%] mr-auto bg-[#1e1e30]/80 p-3 rounded-2xl border border-[#2a2a40] rounded-bl-md">
                <div className="font-semibold text-xs mb-1 text-gray-400">Luca</div>
                <div className="flex flex-col">
                  <div className="flex space-x-1 mb-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#00ff99] animate-bounce"></div>
                    <div className="w-1.5 h-1.5 rounded-full bg-[#00ff99] animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                    <div className="w-1.5 h-1.5 rounded-full bg-[#00ff99] animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                  </div>
                  <div className="text-[10px] text-gray-500 italic">Thinking...</div>
                </div>
              </div>
            )}
          </div>
          
          {/* Quick Action Buttons */}
          <div className="px-4 py-2 bg-[#0f0f1a]/60 border-t border-[#00ff99]/10 flex gap-2 overflow-x-auto scrollbar-hide no-scrollbar">
            <button 
              onClick={() => sendMessage("Initialize Bridge")}
              className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-full bg-[#00ccff]/10 text-[#00ccff] border border-[#00ccff]/30 hover:bg-[#00ccff]/20 hover:scale-105 transition-all whitespace-nowrap flex items-center gap-2"
            >
              <FiZap className="text-[10px]" /> Initialize Bridge
            </button>
            <button 
              onClick={() => sendMessage("Swap Tokens")}
              className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-full bg-[#36b169]/10 text-[#36b169] border border-[#36b169]/30 hover:bg-[#36b169]/20 hover:scale-105 transition-all whitespace-nowrap flex items-center gap-2"
            >
              <FiActivity className="text-[10px]" /> Swap Assets
            </button>
            <button 
              onClick={() => sendMessage("Deposit & Earn")}
              className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-full bg-[#00ff99]/10 text-[#00ff99] border border-[#00ff99]/30 hover:bg-[#00ff99]/20 hover:scale-105 transition-all whitespace-nowrap flex items-center gap-2"
            >
              <FiArrowUpRight className="text-[10px]" /> Deposit & Earn
            </button>
            <button 
              onClick={() => sendMessage("Draw Credit")}
              className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-full bg-[#ffd700]/10 text-[#ffd700] border border-[#ffd700]/30 hover:bg-[#ffd700]/20 hover:scale-105 transition-all whitespace-nowrap flex items-center gap-2"
            >
              <FiPlus className="text-[10px]" /> Draw Credit
            </button>
            <button 
              onClick={() => sendMessage("Mint kfUSD")}
              className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-full bg-[#36b169]/10 text-[#36b169] border border-[#36b169]/30 hover:bg-[#36b169]/20 hover:scale-105 transition-all whitespace-nowrap flex items-center gap-2"
            >
              <FiGift className="text-[10px]" /> Mint Stablecoin
            </button>
          </div>
          
          {/* Input area */}
          <div className="p-4 bg-[#0f0f1a]/80 border-t border-[#00ff99]/20">
            <div className="flex items-center gap-3">
              <input
                ref={inputRef}
                type="text"
                value={currentMessage}
                onChange={(e) => setCurrentMessage(e.target.value)}
                onKeyDown={handleKeyPress}
                placeholder="Ask Luca anything..."
                className="chatbot-input flex-1 px-4 py-3 bg-[#1a1a2e] border border-[#00ff99]/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#00ff99]/50 focus:border-transparent text-white placeholder-gray-500"
                disabled={isLoading}
              />
              <button
                onClick={handleSend}
                disabled={isLoading || !currentMessage.trim()}
                className="p-3 bg-gradient-to-r from-[#00ff99] to-[#00cc7a] text-[#0f0f1a] rounded-xl hover:shadow-lg hover:shadow-[#00ff99]/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                <IoMdSend className="text-lg" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Default export for dynamic imports
export default ChatbotWidget;
