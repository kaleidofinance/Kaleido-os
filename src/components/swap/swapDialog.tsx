import React from "react";
import { IToken } from "@/constants/types/dex";
import { Search, X, Check } from "lucide-react";
import Button from "@/components/shared/Button";
import { ACTIVE_TOKENS } from "@/constants/tokens";
import * as Dialog from "@radix-ui/react-dialog";
import TokenListItem from "./TokenListItem";

interface ITokenModal {
  open: boolean;
  setOpen: (open: boolean) => void;
  searchkeyToken: string;
  setSearchKeyToken: (searchKey: string) => void;
  searchedToken: IToken[];
  onTokenSelect: (token: IToken) => void;
  selectedToken: IToken | null;
  isClickable?: boolean;
}

interface ISettingModal {
  open: boolean;
  setOpen: (e: boolean) => void;
  slippage: string;
  setSlippage: (value: string) => void;
  deadline: string;
  setDeadline: (value: string) => void;
  autoRouter: boolean;
  setAutoRouter: (value: boolean) => void;
}

const TokenModal = ({
  open,
  setOpen,
  searchedToken,
  setSearchKeyToken,
  searchkeyToken,
  onTokenSelect,
  selectedToken,
  isClickable,
}: ITokenModal) => {
  // Popular tokens to display at the top
  const popularTokens = ACTIVE_TOKENS.slice(0, 5);
  
  // Filter tokens for display
  const displayTokens = searchkeyToken.length > 0 ? searchedToken : ACTIVE_TOKENS;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      {isClickable !== false && (
        <Dialog.Trigger asChild>
          <button 
            className="font-medium text-white flex whitespace-nowrap bg-transparent px-1 py-1 rounded-full text-sm font-bold hover:text-green-400 transition-colors"
          >
            {selectedToken ? selectedToken.symbol : "Select Token"}
          </button>
        </Dialog.Trigger>
      )}
      
      {isClickable === false && (
         <div
          className={`font-medium  flex whitespace-nowrap opacity-50 cursor-not-allowed`}
        >
          {selectedToken ? selectedToken.symbol : "Select Token"}
        </div>
      )}

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[99999] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-[50%] top-[50%] z-[99999] max-h-[85vh] w-[90vw] max-w-lg translate-x-[-50%] translate-y-[-50%] rounded-[10px] bg-card border border-[#00ff99]/30 shadow-xl focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]">
          
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#00ff99]/30">
            <Dialog.Title className="text-lg font-semibold text-white">Select token</Dialog.Title>
            <Dialog.Close asChild>
                <button 
                  className="text-textSecondary hover:text-white transition-colors"
                  onClick={() => setOpen(false)}
                >
                  <X size={20} />
                </button>
            </Dialog.Close>
          </div>

          {/* Search Bar */}
          <div className="px-6 py-4">
              <div className="relative">
                <Search
                  size={20}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-textSecondary"
                />
                <input
                  className="w-full rounded-lg border border-[#00ff99]/30 bg-background pl-10 pr-4 py-3 text-white placeholder:text-textSecondary focus:border-primary focus:outline-none"
                  placeholder="Search by name or address"
                  type="text"
                  value={searchkeyToken}
                  onChange={(e) => setSearchKeyToken(e.target.value)}
                />
              </div>
          </div>

          {/* Popular Tokens Row */}
          {searchkeyToken.length === 0 && (
            <div className="px-6 pb-4">
              <div className="flex space-x-3">
                {popularTokens.map((token, index) => (
                  <button
                    key={index}
                    onClick={() => onTokenSelect(token)}
                    className="flex flex-col items-center space-y-2 p-3 rounded-lg hover:bg-borderline/30 transition-colors border-0"
                  >
                    <div className="w-10 h-10 rounded-full bg-transparent flex items-center justify-center">
                      <img 
                        src={token.logoURI} 
                        alt={token.symbol}
                        className="w-8 h-8 rounded-full"
                        onError={(e) => {
                          e.currentTarget.src = "/logo.png";
                        }}
                      />
                    </div>
                    <span className="text-xs text-white font-medium">{token.symbol}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Token List */}
          <div className="px-6 pb-4 max-h-[50vh] overflow-y-auto">
            {searchkeyToken.length === 0 && (
              <h3 className="text-sm font-medium text-textSecondary mb-3">Popular tokens</h3>
            )}
            
            <div className="space-y-1">
              {displayTokens.map((token, index) => (
                <TokenListItem
                  key={index}
                  token={token}
                  selectedToken={selectedToken}
                  onSelect={onTokenSelect}
                />
              ))}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

const SettingModal = ({ open, setOpen, slippage, setSlippage, deadline, setDeadline, autoRouter, setAutoRouter }: ISettingModal) => {
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[99999]" />
        <Dialog.Content className="fixed left-[50%] top-[50%] z-[99999] w-full max-w-md translate-x-[-50%] translate-y-[-50%] rounded-xl bg-card/95 backdrop-blur-md border border-borderline/60 shadow-2xl focus:outline-none">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-borderline/60 bg-gradient-to-r from-tokenSelector/10 to-tokenSelector/5">
            <Dialog.Title className="text-lg font-semibold text-white">Settings</Dialog.Title>
            <Dialog.Close asChild>
                <button 
                  className="text-textSecondary hover:text-white transition-colors"
                >
                  <X size={20} />
                </button>
            </Dialog.Close>
          </div>

          {/* Content */}
          <div className="p-6">
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-white">
                  Slippage Tolerance
                </p>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={slippage}
                    onChange={(e) => setSlippage(e.target.value)}
                    className="w-20 px-3 py-2 border border-borderline/50 bg-background/50 backdrop-blur-sm text-white rounded-lg text-sm focus:outline-none focus:border-tokenSelector focus:ring-2 focus:ring-tokenSelector/20"
                    placeholder="0.5"
                  />
                  <span className="text-sm text-textSecondary">%</span>
                </div>
              </div>
              
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-white">
                  Transaction Deadline
                </p>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                    className="w-20 px-3 py-2 border border-borderline/50 bg-background/50 backdrop-blur-sm text-white rounded-lg text-sm focus:outline-none focus:border-tokenSelector focus:ring-2 focus:ring-tokenSelector/20"
                    placeholder="20"
                  />
                  <span className="text-sm text-textSecondary">minutes</span>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <p className="text-sm font-medium text-white">
                    Auto Router
                  </p>
                  <p className="text-xs text-textSecondary">
                    Find optimized paths via WETH
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={autoRouter}
                  onChange={(e) => setAutoRouter(e.target.checked)}
                  className="w-4 h-4 text-tokenSelector bg-background/50 border-borderline/50 rounded focus:ring-tokenSelector focus:ring-2"
                />
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export { SettingModal };
export default TokenModal;