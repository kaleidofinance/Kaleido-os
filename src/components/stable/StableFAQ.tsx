"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronUp, DollarSign, Shield, TrendingUp, Lock, Zap } from "lucide-react";

interface FAQItem {
  question: string;
  answer: string;
  icon: React.ElementType;
}

export default function StableFAQ() {
  const [openItems, setOpenItems] = useState<number[]>([]);

  const toggleItem = (index: number) => {
    setOpenItems(prev => 
      prev.includes(index) 
        ? prev.filter(i => i !== index)
        : [...prev, index]
    );
  };

  const faqItems: FAQItem[] = [
    {
      question: "What is kfUSD and how does it work?",
      answer: "kfUSD is Kaleido Agentic DeFI OS's native stablecoin backed 1:1 by stable assets (USDC, USDT, USDe). Every kfUSD is backed by $1 worth of collateral held in transparent on-chain vaults. Users can mint kfUSD by depositing supported assets and redeem them at any time. 50% of collateral is kept idle for instant redemptions, while 50% is deployed to featured lending pools to generate yield.",
      icon: DollarSign
    },
    {
      question: "What assets can I use to mint kfUSD?",
      answer: "You can mint kfUSD using USDC, USDT, and USDe. These assets are held as collateral in the reserve vaults. Simply deposit your chosen asset through the Mint interface on the stablecoin page and receive kfUSD in a 1:1 ratio (minus a small 0.1% fee).",
      icon: Shield
    },
    {
      question: "What are the fees for minting and redeeming kfUSD?",
      answer: "There's a 0.1% fee for both minting and redeeming kfUSD. For example, if you deposit 1000 USDC, you'll receive 999 kfUSD (1000 minus 0.1%). These fees are allocated to fund kafUSD yield generation, supporting the ecosystem's sustainability.",
      icon: TrendingUp
    },
    {
      question: "How is kfUSD different from other stablecoins?",
      answer: "kfUSD is Kaleido's liquidity engine with integrated lending pools. When you mint kfUSD, 50% of your collateral is automatically deployed to featured lending pools at 8% APY, generating yield for kfUSD holders. It's designed to combine stability with passive yield generation.",
      icon: Zap
    },
    {
      question: "What is the backing ratio and how is it maintained?",
      answer: "kfUSD maintains a backing ratio of 100% through fully collateralized vaults. The ratio is calculated as total collateral value divided by kfUSD supply. Users can monitor this ratio in real-time through the stable stats dashboard, showing TVL, total supply, and backing composition.",
      icon: Shield
    },
    {
      question: "How do Yield Vaults work?",
      answer: "Yield Vaults allow you to lock kfUSD and other supported assets to receive kafUSD (liquid staking tokens). These tokens earn yield rewards while maintaining liquidity. There's a 7-day cooldown period for withdrawals to ensure stability. Yield comes from featured pool interest rates (8% APY) and mint/redeem fees.",
      icon: Lock
    },
    {
      question: "What is kafUSD and how does it earn yield?",
      answer: "kafUSD is the liquid staking token you receive when locking assets in Yield Vaults. It represents your staked position and earns yield through lending pool interest (8% APY) and protocol fees (0.1% from mint/redeem). You can check your kafUSD balance in the Lock Assets section and withdraw after the 7-day cooldown.",
      icon: TrendingUp
    },
    {
      question: "How is yield generated and distributed?",
      answer: "Yield comes from two sources: (1) Featured Pool interest at 8% APY from borrowers using deployed collateral, (2) Mint/redeem fees at 0.1% collected from kfUSD operations. The yield is distributed proportionally to kafUSD holders based on their stake size relative to total supply.",
      icon: DollarSign
    },
    {
      question: "What is the cooldown period for Yield Vaults?",
      answer: "There's a 7-day cooldown period when withdrawing from Yield Vaults. This ensures stability and prevents rapid withdrawals that could destabilize the yield generation strategies. During this period, your assets remain locked but continue earning yield. After 7 days, you can complete the withdrawal.",
      icon: Lock
    },
    {
      question: "How do Featured Pools work?",
      answer: "Featured Pools are large lending pools created from 50% of kfUSD collateral deposits. They appear at the top of the Kaleido marketplace with a 'FEATURED' badge and offer instant liquidity. Borrowers can access pools of USDC, USDT, and USDe at 8% APY, and the interest earned funds kafUSD yield distribution.",
      icon: TrendingUp
    },
    {
      question: "Can kfUSD be used across different chains?",
      answer: "kfUSD is currently native to Abstract Chain. The system is designed for future cross-chain expansion to Hyperliquid, BNB Chain, Base, and other networks using Kaleido's modular bridge framework, allowing users to seamlessly move kfUSD between supported chains.",
      icon: Zap
    },
    {
      question: "What happens if the backing ratio falls below 100%?",
      answer: "The system has automatic rebalancing mechanisms through smart contracts. If the backing ratio drops, the protocol prioritizes redemptions from idle collateral (50% of reserves) first. Additionally, deployed collateral from featured pools can be withdrawn to maintain the 1:1 peg.",
      icon: Shield
    }
  ];

  return (
    <div className="space-y-8">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold text-white mb-4">Frequently Asked Questions</h2>
        <p className="text-gray-300 max-w-2xl mx-auto">
          Everything you need to know about kfUSD stablecoin, Yield Vaults, and the Kaleido ecosystem
        </p>
      </div>

      <div className="space-y-4">
        {faqItems.map((item, index) => (
          <div
            key={index}
            className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl overflow-hidden"
          >
            <button
              onClick={() => toggleItem(index)}
              className="w-full p-3 text-left flex items-center justify-between hover:bg-[#2a2a2a]/30 transition-colors"
            >
              <div className="flex items-center">
                <div className="w-7 h-7 bg-green-500/20 rounded-lg flex items-center justify-center mr-3">
                  <item.icon className="w-3.5 h-3.5 text-green-400" />
                </div>
                <h3 className="text-sm font-semibold text-white">{item.question}</h3>
              </div>
              {openItems.includes(index) ? (
                <ChevronUp className="w-4 h-4 text-gray-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-400" />
              )}
            </button>
            
            {openItems.includes(index) && (
              <div className="px-3 pb-3">
                <div className="pl-10">
                  <p className="text-gray-300 text-xs leading-relaxed">{item.answer}</p>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Additional Resources */}
      <div className="bg-black/20 backdrop-blur-sm border border-green-500/40 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Additional Resources</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-black/40 rounded-lg p-3">
            <h4 className="text-white font-semibold mb-2 text-sm">Documentation</h4>
            <p className="text-gray-300 text-xs mb-3">
              Comprehensive and technical documentation for kfUSD & Yield Vaults.
            </p>
            <button className="w-full py-2 bg-green-500 hover:bg-green-600 text-white font-semibold text-sm rounded-lg transition-colors">
              View Docs
            </button>
          </div>

          <div className="bg-black/40 rounded-lg p-3">
            <h4 className="text-white font-semibold mb-2 text-sm">Proof of Reserves</h4>
            <p className="text-gray-300 text-xs mb-3">
              Live on-chain verification of kfUSD backing and reserve composition.
            </p>
            <button className="w-full py-2 bg-green-500 hover:bg-green-600 text-white font-semibold text-sm rounded-lg transition-colors">
              View Reserves
            </button>
          </div>

          <div className="bg-black/40 rounded-lg p-3">
            <h4 className="text-white font-semibold mb-2 text-sm">Community</h4>
            <p className="text-gray-300 text-xs mb-3">
              Join the Kaleido community for support, updates, and discussions.
            </p>
            <button className="w-full py-2 bg-green-500 hover:bg-green-600 text-white font-semibold text-sm rounded-lg transition-colors">
              Join Discord
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
