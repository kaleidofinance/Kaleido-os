import React from "react";
import { Check } from "lucide-react";
import { IToken } from "@/constants/types/dex";
import { useTokenBalance } from "@/hooks/dex/useTokenBalance";
import { formatBalance } from "@/utils/formatBalance";

interface TokenListItemProps {
    token: IToken;
    selectedToken: IToken | null;
    onSelect: (token: IToken) => void;
}

export default function TokenListItem({ token, selectedToken, onSelect }: TokenListItemProps) {
    const isSelected = selectedToken?.address === token.address;
    const { balance } = useTokenBalance(token);

    // Format address: 0x1234...5678
    const formatAddress = (addr: string) => {
        if (!addr) return "";
        return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
    };

    return (
        <button
            onClick={() => onSelect(token)}
            className={`w-full flex items-center justify-between p-3 rounded-lg transition-colors ${
                isSelected 
                ? "bg-primary/20" 
                : "hover:bg-borderline/30"
            }`}
        >
            <div className="flex items-center space-x-3">
                {/* Logo */}
                <div className="w-10 h-10 rounded-full bg-transparent flex items-center justify-center">
                   <img 
                      src={token.logoURI} 
                      alt={token.symbol}
                      className="w-8 h-8 rounded-full"
                      onError={(e) => { e.currentTarget.src = "/logo.png"; }}
                   />
                </div>
                {/* Symbol + Name + Address */}
                <div className="flex flex-col items-start">
                    <div className="flex items-center space-x-2">
                        <span className="text-white font-medium">{token.symbol}</span>
                         {token.verified && (
                              <Check size={16} className="text-primary" />
                         )}
                    </div>
                    
                    <div className="flex items-center space-x-2">
                         <span className="text-sm text-textSecondary">{token.name}</span>
                         <span className="text-xs text-gray-500 bg-white/10 px-1.5 py-0.5 rounded ml-1 font-mono">
                            {formatAddress(token.address)}
                         </span>
                    </div>
                </div>
            </div>

            {/* Balance */}
            <div className="flex flex-col items-end">
                 <span className="text-white font-medium text-sm">
                    {formatBalance(balance)}
                 </span>
                 <span className="text-xs text-textSecondary">
                    Balance
                 </span>
            </div>
        </button>
    );
}
