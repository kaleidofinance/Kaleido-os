"use client";

import React from 'react';
import { FiZap, FiPlus, FiMinus, FiGift, FiArrowDownLeft, FiArrowUpRight, FiShoppingCart, FiCheck } from 'react-icons/fi';
import { Message } from './useChatbot';
import { FunctionDefinition } from './functionRegistry';

// Define types for function results
interface TokenBalance {
  symbol: string;
  amount: string;
  valueUSD: number;
}

interface WalletBalanceResult {
  totalBalanceUSD: string | number;
  tokens: TokenBalance[];
}

interface PoolToken {
  symbol: string;
  percentage: number;
  valueUSD: number;
}

interface PoolLiquidityResult {
  poolId: string;
  name: string;
  totalLiquidityUSD: number;
  tokens: PoolToken[];
  apr: string;
  utilizationRate: string;
}

interface RiskScoreBreakdown {
  healthFactor: string;
  collateralValueUSD: string;
  liquidationPoint: string;
}

interface ActionProposedResult {
  type: 'swap' | 'lend' | 'addLiquidity' | 'removeLiquidity' | 'claimRewards' | 'stake' | 'unstake' | 'mintStablecoin' | 'borrow' | 'repay' | 'marketplace' | 'bridge';
  fromToken?: string;
  toToken?: string;
  fromChain?: string;
  toChain?: string;
  token?: string;
  tokenA?: string;
  tokenB?: string;
  amount?: string;
  amountA?: string;
  amountB?: string;
  lpAmount?: string;
  rewardType?: string;
  requestId?: number;
  listingId?: number;
  action?: string;
  estimatedFee?: string;
  estimatedTime?: string;
  status: 'proposed' | 'executing' | 'success';
}

interface LoanRiskResult {
  score: number;
  riskLevel: string;
  status: string;
  breakdown: RiskScoreBreakdown;
}

interface MarketplaceDiscoveryResult {
  listings: Array<{
    listingId: number;
    amount: string;
    tokenAddress: string;
    interest: number;
    status: string;
  }>;
  total: number;
}

interface FunctionSuggestionProps {
  message: Message;
  onFunctionSelect: (functionId: string, params?: any) => void;
}

// Component that renders function suggestions when AI isn't sure what the user wants
export const FunctionSuggestion: React.FC<FunctionSuggestionProps> = ({ message, onFunctionSelect }) => {
  if (!message?.functionData?.suggestions || message.functionData.suggestions.length === 0) {
    return null;
  }
  
  // Get the confidence level string value (handles both enum and direct string)
  let confidenceLevel = 'medium';
  
  // If we have a confidence level, convert it to string
  if (message.functionData.confidenceLevel) {
    // The confidence level might be already a string, or an enum value 
    // that we need to convert to lowercase
    confidenceLevel = message.functionData.confidenceLevel.toString().toLowerCase();
  }

  return (
    <div className="function-suggestion-container">
      <p className="text-sm text-gray-600 mb-2">
        {confidenceLevel === 'medium' ? 
          "I think you might be looking for one of these functions:" :
          "I'm not completely sure what you're asking. Did you mean one of these?"}
      </p>
      <div className="function-options">
        {message.functionData.suggestions.map((suggestion) => (
          <div key={suggestion.id} className="function-option">
            <button
              className={`option-button p-2 my-1 w-full text-left rounded-md bg-green-50 
                         border border-green-200 hover:bg-green-100 transition-all duration-300
                         confidence-${confidenceLevel}`}
              onClick={() => onFunctionSelect(suggestion.id, message.functionData?.extractedParams)}
            >
              <div className="font-medium text-green-700">{suggestion.name}</div>
              <div className="text-xs text-gray-600">{suggestion.description}</div>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

interface TransactionProposalProps {
  result: ActionProposedResult;
  onConfirm: (data: ActionProposedResult) => void;
}

export const TransactionProposal: React.FC<TransactionProposalProps> = ({ result, onConfirm }) => {
  const renderDetails = () => {
    switch (result.type) {
      case 'swap':
        return (
          <div className="swap-details mb-4">
            <div className="flex justify-between items-center bg-[#12121f] p-3 rounded-lg border border-[#00ff99]/10">
              <div>
                <div className="text-[10px] text-gray-500 uppercase">Sell</div>
                <div className="font-bold text-white">{result.amount} {result.fromToken}</div>
              </div>
              <div className="text-[#00ff99]">→</div>
              <div className="text-right">
                <div className="text-[10px] text-gray-500 uppercase">Buy</div>
                <div className="font-bold text-white">{result.toToken}</div>
              </div>
            </div>
          </div>
        );
      case 'addLiquidity':
        return (
          <div className="lend-details mb-4">
            <div className="bg-[#12121f] p-3 rounded-lg border border-[#00ff99]/10">
              <div className="text-[10px] text-gray-500 uppercase text-center mb-1">Providing Liquidity</div>
              <div className="flex justify-around items-center">
                <div className="text-center font-bold text-white">{result.amountA || '0'} {result.tokenA}</div>
                <div className="text-[#00ff99]"><FiPlus /></div>
                <div className="text-center font-bold text-white">{result.amountB || '0'} {result.tokenB}</div>
              </div>
            </div>
          </div>
        );
      case 'removeLiquidity':
        return (
          <div className="lend-details mb-4">
            <div className="bg-[#12121f] p-3 rounded-lg border border-red-500/10">
              <div className="text-[10px] text-gray-500 uppercase">Withdrawing</div>
              <div className="font-bold text-white">{result.lpAmount} of {result.tokenA}/{result.tokenB} Pool</div>
            </div>
          </div>
        );
      case 'claimRewards':
        return (
          <div className="lend-details mb-4">
            <div className="bg-[#12121f] p-3 rounded-lg border border-[#00ff99]/10 flex items-center gap-3">
              <div className="p-2 bg-[#00ff99]/10 rounded-full text-[#00ff99]"><FiGift /></div>
              <div>
                <div className="text-[10px] text-gray-500 uppercase">Collect All</div>
                <div className="font-bold text-white">{result.rewardType} Rewards</div>
              </div>
            </div>
          </div>
        );
      case 'stake':
        return (
          <div className="lend-details mb-4">
            <div className="bg-[#12121f] p-3 rounded-lg border border-[#00ff99]/10">
              <div className="text-[10px] text-gray-500 uppercase">Stake</div>
              <div className="font-bold text-white text-lg">{result.amount} KLD</div>
            </div>
          </div>
        );
      case 'unstake':
        return (
          <div className="lend-details mb-4">
            <div className="bg-[#12121f] p-3 rounded-lg border border-[#00ff99]/10">
              <div className="text-[10px] text-gray-500 uppercase">Unstake</div>
              <div className="font-bold text-white text-lg">{result.amount} KLD</div>
            </div>
          </div>
        );
      case 'mintStablecoin':
        return (
          <div className="lend-details mb-4">
            <div className="bg-[#12121f] p-3 rounded-lg border border-[#00ff99]/10">
              <div className="text-[10px] text-gray-500 uppercase">Mint kfUSD Using</div>
              <div className="font-bold text-white text-lg">{result.amount} {result.token}</div>
            </div>
          </div>
        );
      case 'borrow':
        return (
          <div className="lend-details mb-4">
            <div className="bg-[#12121f] p-3 rounded-lg border border-[#00ff99]/10">
              <div className="text-[10px] text-gray-500 uppercase tracking-tighter">Request Loan / Borrow</div>
              <div className="font-bold text-white text-lg">{result.amount} {result.token}</div>
            </div>
          </div>
        );
      case 'repay':
        return (
          <div className="lend-details mb-4">
            <div className="bg-[#12121f] p-3 rounded-lg border border-red-500/20">
              <div className="text-[10px] text-gray-500 uppercase">Settle Loan Repayment</div>
              <div className="font-bold text-white text-lg">{result.amount} {result.token}</div>
              <div className="text-[9px] text-gray-500 mt-1">Loan ID: #{result.requestId}</div>
            </div>
          </div>
        );
      case 'marketplace':
        return (
          <div className="lend-details mb-4">
            <div className="bg-[#12121f] p-3 rounded-lg border border-[#00ccff]/20">
              <div className="text-[10px] text-gray-500 uppercase">{result.action === 'list' ? 'Create Listing' : 'Accept Listing'}</div>
              <div className="font-bold text-white text-lg">Listing #{result.listingId}</div>
              <div className="text-[9px] text-[#00ccff] font-bold uppercase">{result.amount} {result.token || 'KALE'}</div>
            </div>
          </div>
        );
      case 'lend':
      default:
        return (
          <div className="lend-details mb-4">
            <div className="bg-[#12121f] p-3 rounded-lg border border-[#00ff99]/10">
              <div className="text-[10px] text-gray-500 uppercase">Lend / Deposit</div>
              <div className="font-bold text-white text-lg">{result.amount} {result.token}</div>
            </div>
          </div>
        );
    }
  };

  const getIcon = () => {
    if (result.type === 'addLiquidity') return <FiPlus size={14} />;
    if (result.type === 'removeLiquidity' || result.type === 'unstake') return <FiMinus size={14} />;
    if (result.type === 'claimRewards') return <FiGift size={14} />;
    if (result.type === 'stake') return <FiZap size={14} />;
    if (result.type === 'borrow') return <FiArrowDownLeft size={14} className="text-[#00ff99]" />;
    if (result.type === 'repay') return <FiArrowUpRight size={14} className="text-red-500" />;
    return <FiZap size={14} />;
  };

  const getActionName = () => {
    if (result.type === 'swap') return 'Swap';
    if (result.type === 'lend') return 'Deposit';
    if (result.type === 'addLiquidity') return 'Add Liquidity';
    if (result.type === 'removeLiquidity') return 'Remove Liquidity';
    if (result.type === 'claimRewards') return 'Claim Rewards';
    if (result.type === 'stake') return 'Stake';
    if (result.type === 'unstake') return 'Unstake';
    if (result.type === 'mintStablecoin') return 'Mint kfUSD';
    if (result.type === 'borrow') return 'Borrow';
    if (result.type === 'repay') return 'Repay';
    if (result.type === 'marketplace') return result.action === 'list' ? 'List Asset' : 'Accept Listing';
    return 'Confirm';
  };

  return (
    <div className="transaction-proposal p-4 rounded-xl bg-[#1e1e30] border border-[#00ff99]/30 my-3 shadow-lg">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-2 h-2 rounded-full bg-[#00ff99] animate-pulse"></div>
        <h3 className="text-sm font-bold text-[#00ff99] uppercase tracking-wider">Transaction Proposed</h3>
      </div>
      
      {renderDetails()}

      <button
        onClick={() => onConfirm(result)}
        className="w-full py-2.5 bg-gradient-to-r from-[#00ff99] to-[#00cc7a] text-[#0f0f1a] font-bold rounded-lg hover:shadow-lg hover:shadow-[#00ff99]/20 transition-all flex items-center justify-center gap-2"
      >
        {getIcon()}
        Confirm {getActionName()}
      </button>
      <p className="text-[10px] text-gray-500 mt-2 text-center italic">
        * Clicking confirm will trigger your wallet extension
      </p>
    </div>
  );
}

interface FunctionResultProps {
  message: Message;
  onConfirmAction?: (data: any) => void;
}

/**
 * Component to display a bridge proposal or execution
 */
const BridgeCard: React.FC<{ action: ActionProposedResult }> = ({ action }) => {
  return (
    <div className="bg-[#1a1a2e]/50 backdrop-blur-md rounded-2xl p-4 border border-[#36b169]/30 shadow-lg mb-2">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-[#36b169]/20 rounded-lg text-[#36b169]">
            <FiZap />
          </div>
          <span className="text-[10px] uppercase font-black tracking-widest text-[#36b169]">Gateway Agent</span>
        </div>
        <div className="text-[10px] text-gray-500 font-bold bg-white/5 px-2 py-0.5 rounded uppercase">Route: {action.fromChain} → {action.toChain}</div>
      </div>
      
      <div className="flex flex-col items-center justify-center p-4 bg-black/40 rounded-xl mb-4 border border-white/5">
        <div className="flex items-center gap-6 w-full justify-center">
            <div className="text-center">
                <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center mb-1 mx-auto">
                    <span className="text-xs font-bold text-white">{action.fromChain?.[0]}</span>
                </div>
                <div className="text-[8px] text-gray-400 font-bold uppercase">{action.fromChain}</div>
            </div>
            
            <div className="flex-1 h-[1px] bg-gradient-to-r from-transparent via-[#36b169]/40 to-transparent relative">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[#36b169]">
                    <FiArrowUpRight />
                </div>
            </div>
            
            <div className="text-center">
                <div className="w-10 h-10 rounded-full bg-[#36b169]/20 flex items-center justify-center mb-1 mx-auto border border-[#36b169]/30">
                    <span className="text-xs font-bold text-[#36b169]">{action.toChain?.[0]}</span>
                </div>
                <div className="text-[8px] text-[#36b169] font-bold uppercase">{action.toChain}</div>
            </div>
        </div>
        
        <div className="mt-4 text-center">
            <div className="text-2xl font-black text-white">{action.amount} <span className="text-[#36b169]">{action.token}</span></div>
            <div className="text-[9px] text-gray-500 uppercase tracking-widest mt-1">Cross-Chain Move</div>
        </div>
      </div>
      
      <div className="grid grid-cols-2 gap-2 mb-4">
        <div className="p-2 bg-white/5 rounded-lg border border-white/5">
            <div className="text-[8px] text-gray-500 uppercase font-black mb-0.5">Estimated Fee</div>
            <div className="text-white text-xs font-bold">${action.estimatedFee}</div>
        </div>
        <div className="p-2 bg-white/5 rounded-lg border border-white/5">
            <div className="text-[8px] text-gray-500 uppercase font-black mb-0.5">Estimated Arrival</div>
            <div className="text-white text-xs font-bold">{action.estimatedTime}</div>
        </div>
      </div>
      
      {action.status === 'proposed' && (
        <button className="w-full py-3 bg-[#36b169] hover:bg-[#2e9e56] text-black font-black uppercase text-xs rounded-xl transition-all shadow-lg shadow-[#36b169]/20 flex items-center justify-center gap-2">
           Initialize Bridge
        </button>
      )}
      
      {action.status === 'executing' && (
        <div className="w-full py-3 bg-white/5 text-gray-400 font-black uppercase text-xs rounded-xl flex items-center justify-center gap-2">
           <div className="w-3 h-3 border-2 border-[#36b169] border-t-transparent rounded-full animate-spin"></div>
           Executing Cross-Chain Move...
        </div>
      )}

      {action.status === 'success' && (
        <div className="w-full py-3 bg-[#36b169]/20 text-[#36b169] font-black uppercase text-xs rounded-xl border border-[#36b169]/30 flex items-center justify-center gap-2">
           <FiCheck /> Bridge Complete
        </div>
      )}
    </div>
  );
};

// Component that renders function results with appropriate visualizations
export const FunctionResult: React.FC<FunctionResultProps> = ({ message, onConfirmAction }) => {
  if (!message?.functionData?.result || !message.functionData.executedFunction) {
    return null;
  }

  const { result, executedFunction, visualization } = message.functionData;
  
  // Type guard functions to ensure proper typing
  const isLoanRiskResult = (data: any): data is LoanRiskResult => {
    return data && 'score' in data && 'breakdown' in data;
  };
  
  const isWalletBalanceResult = (data: any): data is WalletBalanceResult => {
    return data && 'totalBalanceUSD' in data && 'tokens' in data;
  };
  
  const isPoolLiquidityResult = (data: any): data is PoolLiquidityResult => {
    return data && 'poolId' in data && 'totalLiquidityUSD' in data;
  };

  const isActionProposedResult = (data: any): data is ActionProposedResult => {
    return data && 'status' in data && data.status === 'proposed';
  };

  // If this is an action proposal or macro, render the special UI
  if (result && (result.status === 'proposed' || result.status === 'executing' || result.status === 'success' || result.status === 'failed')) {
    if (result.type === 'macro') {
      return <MacroCard 
              data={result} 
              onConfirm={onConfirmAction || (() => {})} 
              onCancel={() => {}} 
             />;
    }
    
    if (result.type === 'bridge') {
      return <BridgeCard action={result} />;
    }

    return <TransactionProposal 
            result={result} 
            onConfirm={onConfirmAction || (() => console.warn('onConfirmAction not provided'))} 
           />;
  }

  // Render differently based on the executed function
  switch (executedFunction) {    case 'getMarketplaceListings':
      return (
        <div className="function-result marketplace-discovery p-4 rounded-2xl bg-gradient-to-b from-[#1a1a2e] to-[#0f0f1a] border border-[#00ccff]/30 my-3 shadow-2xl">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h3 className="text-xs font-bold text-[#00ccff] uppercase tracking-widest mb-1">Marketplace Opportunities</h3>
              <div className="text-xl font-black text-white">{result.total} Active Listings Found</div>
            </div>
            <div className="p-2 bg-[#00ccff]/10 rounded-lg text-[#00ccff]">
              <FiShoppingCart size={20} />
            </div>
          </div>
          
          <div className="space-y-3 max-h-80 overflow-y-auto pr-1 custom-scrollbar">
            {result.listings.map((item: any, i: number) => (
              <div key={i} className="p-3 rounded-xl bg-[#1e1e30]/50 border border-white/5 hover:border-[#00ccff]/40 transition-all group">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-[#12121f] border border-white/10 flex items-center justify-center text-[10px] font-bold text-gray-400">
                      #{item.listingId}
                    </div>
                    <div>
                      <div className="font-bold text-white mb-0.5">{item.amount} {item.tokenAddress.includes('0x') ? 'Tokens' : item.tokenAddress}</div>
                      <div className="text-[10px] text-gray-500 font-medium uppercase">Interest: <span className="text-[#00ff99]">{item.interest}%</span></div>
                    </div>
                  </div>
                  <button 
                    onClick={() => {
                        // This would trigger a follow-up action or pre-fill the input
                        // For now we just simulate clicking it
                    }}
                    className="px-3 py-1.5 bg-[#00ccff]/10 hover:bg-[#00ccff]/20 text-[#00ccff] text-[10px] font-bold rounded-md transition-all uppercase tracking-tighter"
                  >
                    View Details
                  </button>
                </div>
              </div>
            ))}
          </div>

          {result.total === 0 && (
            <div className="py-8 text-center text-gray-500 text-sm italic">
                No active listings found at this moment.
            </div>
          )}

          <button className="w-full mt-4 py-2 border border-[#00ccff]/10 rounded-lg text-[10px] text-gray-400 hover:text-[#00ccff] transition-all uppercase font-bold tracking-widest">
              Refresh Market Data
          </button>
        </div>
      );
    case 'getLoanRiskScore':
      if (isLoanRiskResult(result)) {
        return (
          <div className="function-result loan-risk p-3 rounded-md bg-gray-50 border border-[#00ff99]/30 my-2">
            <h3 className="font-medium text-gray-800 mb-2">Loan Risk Analysis</h3>
            <div className={`risk-score p-2 rounded-md text-white ${getRiskScoreColor(result.score)}`}>
              <div className="flex justify-between">
                <span>Risk Score</span>
                <span className="font-bold">{result.score}/100</span>
              </div>
              <div className="text-sm">Status: {result.status}</div>
              <div className="text-sm">Risk Level: {result.riskLevel}</div>
            </div>
            
            <div className="risk-details mt-2 text-sm">
              <div className="flex justify-between items-center py-1 border-b border-[#00ff99]/30">
                <span>Health Factor</span>
                <span className="font-medium">{result.breakdown.healthFactor}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-[#00ff99]/30">
                <span>Collateral Value</span>
                <span className="font-medium">{result.breakdown.collateralValueUSD}</span>
              </div>
              <div className="flex justify-between items-center py-1">
                <span>Liquidation Point</span>
                <span className="font-medium">{result.breakdown.liquidationPoint}</span>
              </div>
            </div>
          </div>
        );
      }
      return null;
      
    case 'getWalletBalance':
      if (isWalletBalanceResult(result)) {
        const total = Number(result.totalBalanceUSD);
        return (
          <div className="function-result portfolio-snapshot p-4 rounded-2xl bg-gradient-to-b from-[#1a1a2e] to-[#0f0f1a] border border-[#00ff99]/30 my-3 shadow-2xl">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-xs font-bold text-[#00ff99] uppercase tracking-widest mb-1">Total Net Worth</h3>
                <div className="text-3xl font-black text-white tracking-tighter">
                  ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="p-2 bg-[#00ff99]/10 rounded-lg text-[#00ff99]">
                <FiZap size={20} />
              </div>
            </div>

            {/* Distribution Bar */}
            <div className="w-full h-2 bg-gray-800 rounded-full flex overflow-hidden mb-6 shadow-inner">
              {result.tokens.map((token: TokenBalance, i: number) => {
                const percentage = (Number(token.valueUSD) / total) * 100;
                const colors = ['bg-[#00ff99]', 'bg-[#ffd700]', 'bg-[#00ccff]', 'bg-[#ff00ff]'];
                return (
                  <div 
                    key={i} 
                    style={{ width: `${percentage}%` }} 
                    className={`${colors[i % colors.length]} h-full transition-all duration-1000 ease-out`}
                    title={`${token.symbol}: ${percentage.toFixed(1)}%`}
                  />
                );
              })}
            </div>
            
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
              {result.tokens.map((token: TokenBalance, index: number) => {
                const percentage = ((Number(token.valueUSD) / total) * 100).toFixed(1);
                return (
                  <div key={index} className="flex justify-between items-center p-3 rounded-xl bg-[#1e1e30]/50 border border-white/5 hover:border-[#00ff99]/20 transition-all group">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-[#12121f] border border-white/10 flex items-center justify-center font-bold text-gray-400 group-hover:border-[#00ff99]/40 transition-colors">
                        {token.symbol.charAt(0)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white">{token.symbol}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400 font-medium">{percentage}%</span>
                        </div>
                        <div className="text-xs text-gray-500 font-medium">{token.amount} {token.symbol}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-white">${Number(token.valueUSD).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                      <div className="text-[10px] text-[#00ff99]/60 uppercase font-bold tracking-tighter">Verified Assets</div>
                    </div>
                  </div>
                );
              })}
            </div>
            
            <button className="w-full mt-4 py-2 border border-[#00ff99]/10 rounded-lg text-[10px] text-gray-500 hover:text-[#00ff99] hover:bg-[#00ff99]/5 transition-all uppercase font-bold tracking-widest">
                Refresh Live Data
            </button>
          </div>
        );
      }
      return null;
      
    case 'getPoolLiquidity':
      if (isPoolLiquidityResult(result)) {
        return (
          <div className="function-result pool-info p-3 rounded-md bg-gray-50 border border-[#00ff99]/30 my-2">
            <h3 className="font-medium text-gray-800 mb-2">{result.name} Statistics</h3>
            <div className="pool-stats grid grid-cols-2 gap-2 mb-2">
              <div className="stat p-2 bg-green-50 rounded-md">
                <div className="text-xs text-gray-500">Total Liquidity</div>
                <div className="font-bold text-green-700">${result.totalLiquidityUSD.toLocaleString()}</div>
              </div>
              <div className="stat p-2 bg-green-50 rounded-md">
                <div className="text-xs text-gray-500">APR</div>
                <div className="font-bold text-green-700">{result.apr}</div>
              </div>
            </div>
            
            <div className="text-sm font-medium text-gray-600 mb-1">Token Distribution</div>
            <div className="tokens-distribution">
              {result.tokens.map((token: PoolToken, index: number) => (
                <div key={index} className="token-row">
                  <div className="flex justify-between items-center text-sm py-1">
                    <span>{token.symbol}</span>
                    <span>${token.valueUSD.toLocaleString()} ({token.percentage}%)</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-1.5 mb-2">
                    <div 
                      className="bg-green-600 h-1.5 rounded-full" 
                      style={{ width: `${token.percentage}%` }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="mt-2 text-sm">
              <div className="flex justify-between items-center py-1 border-t border-[#00ff99]/30">
                <span>Utilization Rate</span>
                <span className="font-medium">{result.utilizationRate}</span>
              </div>
            </div>
          </div>
        );
      }
      return null;
    
    default:
      return (
        <div className="function-result-generic p-3 rounded-md bg-gray-50 border border-[#00ff99]/30 my-2">
          <pre className="text-xs overflow-x-auto">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      );
  }
};

// Helper function to get color based on risk score
const getRiskScoreColor = (score: number): string => {
  if (score >= 80) return 'bg-green-600';
  if (score >= 60) return 'bg-green-500';
  if (score >= 40) return 'bg-yellow-500';
  if (score >= 20) return 'bg-orange-500';
  return 'bg-red-500';
};

// Component for showing execution keywords with tooltips
interface ExecutionKeywordProps {
  word: string;
  description?: string;
}

export const ExecutionKeyword: React.FC<ExecutionKeywordProps> = ({ word, description }) => {
  return (
    <div className="tooltip-wrapper inline-block">
      <span className="execution-keyword">{word}</span>
      {description && <span className="tooltip">{description}</span>}
    </div>
  );
};

export const MacroCard = ({ data, onConfirm, onCancel }: { data: any, onConfirm: (data: any) => void, onCancel: () => void }) => {
    const isProposed = data.status === 'proposed';
    const isExecuting = data.status === 'executing';
    const isSuccess = data.status === 'success';

    return (
        <div className="bg-[#12121f] rounded-2xl border border-[#00ff99]/30 overflow-hidden shadow-2xl shadow-[#00ff99]/5 animate-in fade-in slide-in-from-bottom-4 my-2">
            <div className="p-4 bg-gradient-to-r from-[#00ff99]/10 to-transparent border-b border-[#00ff99]/10 flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-[#00ff99]/20 rounded-lg text-[#00ff99]">
                        <FiZap className="animate-pulse" />
                    </div>
                    <div>
                        <h4 className="text-sm font-black text-white uppercase tracking-widest">Macro: Volume Turbo</h4>
                        <p className="text-[10px] text-gray-400 font-medium">Auto-circular swap sequence</p>
                    </div>
                </div>
                {isExecuting && (
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-[#00ff99] rounded-full animate-ping"></div>
                        <span className="text-[10px] text-[#00ff99] font-bold uppercase tracking-tighter">Executing Step {data.currentStep}</span>
                    </div>
                )}
            </div>

            <div className="p-4 space-y-4 text-left">
                <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-white/5 rounded-xl border border-white/5 text-center">
                        <div className="text-[10px] text-gray-Profile text-gray-400 uppercase font-bold mb-1 tracking-tighter">Target Volume</div>
                        <div className="text-lg font-black text-[#00ff99]">${data.targetVolume}</div>
                    </div>
                    <div className="p-3 bg-white/5 rounded-xl border border-white/5 text-center">
                        <div className="text-[10px] text-gray-Profile text-gray-400 uppercase font-bold mb-1 tracking-tighter">Total Cycles</div>
                        <div className="text-lg font-black text-white">{data.iterations}x</div>
                    </div>
                </div>

                <div className="p-3 bg-[#00ff99]/5 rounded-xl border border-[#00ff99]/10">
                    <div className="flex justify-between text-[10px] mb-2 font-bold uppercase">
                        <span className="text-gray-500">Sequence Progress</span>
                        <span className="text-[#00ff99] font-black">{Math.round((data.currentStep / (data.iterations * 2)) * 100)}%</span>
                    </div>
                    <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                        <div 
                            className="h-full bg-[#00ff99] shadow-[0_0_10px_#00ff99] transition-all duration-1000"
                            style={{ width: `${(data.currentStep / (data.iterations * 2)) * 100}%` }}
                        ></div>
                    </div>
                </div>

                {isProposed && (
                    <div className="flex gap-2 pt-2">
                        <button 
                            onClick={onCancel}
                            className="flex-1 py-3 bg-white/5 text-gray-400 text-[10px] font-bold rounded-xl hover:bg-white/10 border border-white/10 transition-all uppercase tracking-widest"
                        >
                            Abort
                        </button>
                        <button 
                            onClick={() => onConfirm(data)}
                            className="flex-[3] py-3 bg-[#00ff99] text-[#0f0f1a] text-[10px] font-bold rounded-xl hover:shadow-[0_0_20px_rgba(0,255,153,0.4)] transition-all uppercase tracking-widest"
                        >
                            Authorize Sequence
                        </button>
                    </div>
                )}

                {isSuccess && (
                    <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-xl text-center">
                        <div className="text-[#00ff99] text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2">
                            <FiCheck /> Volume Goal Reached
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
