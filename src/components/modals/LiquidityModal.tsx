"use client";

import React, { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as Tabs from "@radix-ui/react-tabs";
import CreateLiquidity from "@/components/liquidity/createLiquidity";
import RemoveLiquidity from "@/components/liquidity/removeLiquidity";

interface LiquidityModalProps {
  isOpen: boolean;
  onClose: () => void;
  tokenA: string;
  tokenB: string;
  initialTab?: "add" | "remove";
}

export default function LiquidityModal({ isOpen, onClose, tokenA, tokenB, initialTab = "add" }: LiquidityModalProps) {
  const [activeTab, setActiveTab] = useState<string>(initialTab);

  // Reset tab when opening/changing initialTab
  React.useEffect(() => {
    setActiveTab(initialTab);
  }, [isOpen, initialTab]);

  return (
    <Dialog.Root open={isOpen} onOpenChange={onClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/90 z-50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-xl max-h-[90vh] -translate-x-1/2 -translate-y-1/2 bg-black/80 backdrop-blur-xl border border-green-500/30 rounded-2xl overflow-hidden shadow-2xl shadow-green-500/10 outline-none">
          
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-green-500/20 bg-white/5 backdrop-blur-md">
            <div>
              <Dialog.Title className="text-xl font-bold text-white uppercase tracking-wider">
                Manage Liquidity
              </Dialog.Title>
              <p className="text-gray-400 text-sm mt-1 font-mono">
                {tokenA}-{tokenB}
              </p>
            </div>
            <Dialog.Close asChild>
              <button
                className="rounded-full p-2 hover:bg-white/10 transition-colors"
                aria-label="Close"
              >
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </Dialog.Close>
          </div>

          {/* Content */}
          <div className="overflow-y-auto max-h-[calc(90vh-90px)] p-0">
             <Tabs.Root value={activeTab} onValueChange={setActiveTab} className="w-full">
                <div className="px-4 border-b border-white/10 bg-white/5 backdrop-blur-sm">
                    <Tabs.List className="flex gap-6">
                        <Tabs.Trigger 
                            value="add"
                            className="py-3 text-sm font-bold uppercase tracking-wider text-gray-500 hover:text-white data-[state=active]:text-[#00ff99] data-[state=active]:border-b-2 data-[state=active]:border-[#00ff99] transition-all"
                        >
                            Add Liquidity
                        </Tabs.Trigger>
                        <Tabs.Trigger 
                            value="remove"
                             className="py-3 text-sm font-bold uppercase tracking-wider text-gray-500 hover:text-white data-[state=active]:text-[#00ff99] data-[state=active]:border-b-2 data-[state=active]:border-[#00ff99] transition-all"
                        >
                            Remove Liquidity
                        </Tabs.Trigger>
                    </Tabs.List>
                </div>

                <Tabs.Content value="add" className="outline-none">
                    <div className="p-4">
                         {/* Pass basic props. Verify if style props are needed for "modal mode" to reduce padding */}
                        <CreateLiquidity tokenA={tokenA} tokenB={tokenB} />
                    </div>
                </Tabs.Content>
                
                <Tabs.Content value="remove" className="outline-none">
                    <div className="p-4">
                        <RemoveLiquidity tokenA={tokenA} tokenB={tokenB} style={true} />
                    </div>
                </Tabs.Content>
             </Tabs.Root>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
