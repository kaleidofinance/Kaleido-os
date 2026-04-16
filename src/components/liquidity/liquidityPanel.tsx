"use client";
import React, { useCallback, useEffect, useState } from "react";
import TokenIcon from "../icons/tokenIcon";
import { ChevronDown, ChevronUp } from "lucide-react";
import { IToken } from "@/constants/types/dex";
import { ACTIVE_TOKENS } from "@/constants/tokens"; // Use global active tokens

import TokenModal from "../swap/swapDialog";

const findTokenDetails = (token: string) => {
  if (!token) return;
  const tokenFormatted = token.toLowerCase();
  const result = ACTIVE_TOKENS.find((tokenInfo) => {
    const formattedTokenobj = tokenInfo.symbol.toLowerCase();
    return formattedTokenobj.includes(tokenFormatted);
  });
  return result;
};

export function AddLiquidityFrom({
  onTokenSelect,
  symbolA,
  selectedToken,
  onWrap,
  isWrapping
}: {
  selectedToken: IToken | null;
  onTokenSelect: (token: IToken) => void;
  symbolA?: string;
  onWrap?: (amount: string) => void;
  isWrapping?: boolean;
}) {
  const [openFrom, setOpenFrom] = useState<boolean>(false); // eslint-disable-line @typescript-eslint/no-unused-vars
  const [openTo, setOpenTo] = useState<boolean>(false); // eslint-disable-line @typescript-eslint/no-unused-vars
  const [open, setOpen] = useState(false);
  const [searchkeyToken, setSearchKeyToken] = useState<string>("");
  const [searchedToken, setSearchedToken] = useState<IToken[]>(ACTIVE_TOKENS);

  const handleFromTokenClick = (token: IToken) => {
    onTokenSelect(token);
    setOpen(false);
    changeState("from");
  };
  const changeState = (type: string) => {
    if (type === "from") {
      setOpenFrom((prev) => !prev);
    } else {
      setOpenTo((prev) => !prev);
    }
  };

  const searchToken = (keyword: string): IToken[] => {
    const searchTerm = keyword.toString().toLowerCase();
    return ACTIVE_TOKENS.filter((token) => {
      return (
        token.name.toLowerCase().includes(searchTerm) ||
        token.symbol.toLowerCase().includes(searchTerm)
      );
    });
  };

  useEffect(() => {
    const filtered = searchToken(searchkeyToken);
    setSearchedToken(filtered);
  }, [searchkeyToken]);
  return (
    <div className="flex items-center gap-2 rounded-full border border-borderline/40 bg-black px-3 py-1 text-sm font-bold text-white hover:border-[#00ff99] transition-colors">
      {(() => {
        const tokendetails = findTokenDetails(symbolA as string);

        return symbolA ? (
          <div className="flex flex-row space-x-2 items-center">
            <TokenIcon
              symbol={tokendetails?.symbol || ""}
              size="sm"
              logoURI={tokendetails?.logoURI || ""}
              name={tokendetails?.name || ""}
              address={
                tokendetails?.address ||
                "0x0000000000000000000000000000000000000000"
              }
              verified={tokendetails?.verified || false}
              variant="minimal"
              decimals={18}
              className="text-white"
              tags={tokendetails?.tags}
            />
            <TokenModal
              open={open}
              setOpen={setOpen}
              searchedToken={searchedToken}
              setSearchKeyToken={setSearchKeyToken}
              searchkeyToken={searchkeyToken}
              onTokenSelect={handleFromTokenClick}
              selectedToken={tokendetails || null}
            />
          </div>
        ) : (
          <div>
            {selectedToken ? (
              <div className="flex flex-row space-x-2 items-center">
                <TokenIcon
                  symbol={selectedToken?.symbol || ""}
                  size="sm"
                  logoURI={selectedToken?.logoURI || ""}
                  name={selectedToken?.name || ""}
                  address={selectedToken?.address || ""}
                  verified={selectedToken?.verified}
                  variant="minimal"
                  decimals={18}
                  className="text-white"
                  tags={selectedToken?.tags}
                />
                <TokenModal
                  open={open}
                  setOpen={setOpen}
                  searchedToken={searchedToken}
                  setSearchKeyToken={setSearchKeyToken}
                  searchkeyToken={searchkeyToken}
                  onTokenSelect={handleFromTokenClick}
                  selectedToken={selectedToken || null}
                />
              </div>
            ) : (
              <TokenModal
                open={open}
                setOpen={setOpen}
                searchedToken={searchedToken}
                setSearchKeyToken={setSearchKeyToken}
                searchkeyToken={searchkeyToken}
                onTokenSelect={handleFromTokenClick}
                selectedToken={selectedToken || null}
              />
            )}
          </div>
        );
      })()}

      {!openFrom ? (
        <ChevronDown className="w-4 h-4" />
      ) : (
        <ChevronUp className="w-4 h-4" />
      )}
    </div>
  );
}

export function AddLiquidityTo({
  selectedToken,
  onTokenSelect,
  symbolB,
}: {
  selectedToken: IToken | null;
  onTokenSelect: (token: IToken) => void;
  symbolB?: string;
}) {
  const [openFrom, setOpenFrom] = useState<boolean>(false); // eslint-disable-line @typescript-eslint/no-unused-vars
  const [openTo, setOpenTo] = useState<boolean>(false);
  const [open, setOpen] = useState(false);
  const [searchkeyToken, setSearchKeyToken] = useState<string>("");
  const [searchedToken, setSearchedToken] = useState<IToken[]>(ACTIVE_TOKENS);

  const handleToTokenClick = useCallback((token: IToken) => {
    onTokenSelect(token);
    setOpen(false);
    changeState("to");
  }, []);

  const changeState = useCallback((type: string) => {
    if (type === "from") {
      setOpenFrom((prev) => !prev);
    } else {
      setOpenTo((prev) => !prev);
    }
  }, []);

  const searchToken = (keyword: string): IToken[] => {
    const searchTerm = keyword.toString().toLowerCase();
    return ACTIVE_TOKENS.filter((token) => {
      return (
        token.name.toLowerCase().includes(searchTerm) ||
        token.symbol.toLowerCase().includes(searchTerm)
      );
    });
  };

  useEffect(() => {
    const filtered = searchToken(searchkeyToken);
    setSearchedToken(filtered);
  }, [searchkeyToken]);

  return (
    <div className="flex items-center gap-2 rounded-full border border-borderline/40 bg-black px-3 py-1 text-sm font-bold text-white hover:border-[#00ff99] transition-colors">
      {(() => {
        const tokendetails = findTokenDetails(symbolB as string);

        return symbolB ? (
          <div className="flex flex-row space-x-2 items-center">
            <TokenIcon
              symbol={tokendetails?.symbol || ""}
              size="sm"
              logoURI={tokendetails?.logoURI || ""}
              name={tokendetails?.name || ""}
              address={
                tokendetails?.address ||
                "0x0000000000000000000000000000000000000000"
              }
              verified={tokendetails?.verified || false}
              variant="minimal"
              decimals={18}
              className="text-white"
              tags={tokendetails?.tags}
            />
            <TokenModal
              open={open}
              setOpen={setOpen}
              searchedToken={searchedToken}
              setSearchKeyToken={setSearchKeyToken}
              searchkeyToken={searchkeyToken}
              onTokenSelect={handleToTokenClick}
              selectedToken={tokendetails || null}
            />
          </div>
        ) : (
          <div>
            {selectedToken ? (
              <div className="flex flex-row space-x-2 items-center">
                <TokenIcon
                  symbol={selectedToken?.symbol || ""}
                  size="sm"
                  logoURI={selectedToken?.logoURI || ""}
                  name={selectedToken?.name || ""}
                  address={selectedToken?.address || ""}
                  verified={selectedToken?.verified}
                  variant="minimal"
                  decimals={18}
                  className="text-white"
                  tags={selectedToken?.tags}
                />
                <TokenModal
                  open={open}
                  setOpen={setOpen}
                  searchedToken={searchedToken}
                  setSearchKeyToken={setSearchKeyToken}
                  searchkeyToken={searchkeyToken}
                  onTokenSelect={handleToTokenClick}
                  selectedToken={selectedToken || null}
                />
              </div>
            ) : (
              <TokenModal
                open={open}
                setOpen={setOpen}
                searchedToken={searchedToken}
                setSearchKeyToken={setSearchKeyToken}
                searchkeyToken={searchkeyToken}
                onTokenSelect={handleToTokenClick}
                selectedToken={selectedToken || null}
              />
            )}
          </div>
        );
      })()}
      {!openTo ? (
        <ChevronDown className="w-4 h-4" />
      ) : (
        <ChevronUp className="w-4 h-4" />
      )}
    </div>
  );
}
