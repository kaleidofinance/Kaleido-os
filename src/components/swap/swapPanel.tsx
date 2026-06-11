"use client";

import React, { useEffect, useState } from "react";
import TokenIcon from "../icons/tokenIcon";
import { ChevronDown, ChevronUp } from "lucide-react";
import { IToken } from "@/constants/types/dex";
import { validAddress } from "@/constants/utils/validAddress";
import TokenModal from "./swapDialog";
import { ACTIVE_TOKENS, searchTokens } from "@/constants/tokens";

export function SwapFrom({
  selectedToken: selectedFromToken,
  onTokenSelect,
}: {
  selectedToken: IToken | null;
  onTokenSelect: (token: IToken) => void;
}) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [openFrom, setOpenFrom] = useState<boolean>(false); // eslint-disable-line @typescript-eslint/no-unused-vars
  const [openTo, setOpenTo] = useState<boolean>(false); // eslint-disable-line @typescript-eslint/no-unused-vars
  const [open, setOpen] = useState(false);
  const [searchkeyToken, setSearchKeyToken] = useState<string>("");
  const [searchedToken, setSearchedToken] = useState<IToken[]>(ACTIVE_TOKENS);

  const handleFromTokenClick = (token: IToken) => {
    console.log("handling the token selection");
    onTokenSelect(token);
    console.log("selected Token:", token);
    setOpen(false);
    changeState("from");
    // console.log("Modal state:", open);
  };

  const changeState = (type: string) => {
    if (type === "from") {
      setOpenFrom((prev) => !prev);
    } else {
      setOpenTo((prev) => !prev);
    }
  };

  useEffect(() => {
    const filtered = searchTokens(searchkeyToken);
    setSearchedToken(filtered);
  }, [searchkeyToken]);
  return (
    <div className="flex items-center gap-2 rounded-full bg-black border border-[#00ff99]/50 px-4 py-2 text-sm font-bold text-white hover:border-[#00ff99] transition-all cursor-pointer">
      {selectedFromToken && validAddress(selectedFromToken?.address) ? (
        <div className="flex flex-row space-x-2 items-center">
          <TokenIcon
            symbol={selectedFromToken?.symbol || ""}
            size="sm"
            logoURI={selectedFromToken?.logoURI || ""}
            name={selectedFromToken?.name || ""}
            address={selectedFromToken?.address || ""}
            verified={selectedFromToken?.verified}
            variant="minimal"
            decimals={18}
            className="text-white bg-white rounded-full"
            tags={selectedFromToken?.tags}
          />
          <TokenModal
            open={open}
            setOpen={setOpen}
            searchedToken={searchedToken}
            setSearchKeyToken={setSearchKeyToken}
            searchkeyToken={searchkeyToken}
            onTokenSelect={handleFromTokenClick}
            selectedToken={selectedFromToken || null}
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
          selectedToken={selectedFromToken || null}
        />
      )}
      <ChevronDown className="w-4 h-4 text-white" />
    </div>
  );
}

export function SwapTo({
  selectedToken,
  onTokenSelect,
}: {
  selectedToken: IToken | null;
  onTokenSelect: (token: IToken) => void;
}) {
  const [openFrom, setOpenFrom] = useState<boolean>(false); // eslint-disable-line @typescript-eslint/no-unused-vars
  const [openTo, setOpenTo] = useState<boolean>(false);
  const [open, setOpen] = useState(false);
  const [searchkeyToken, setSearchKeyToken] = useState<string>("");
  const [searchedToken, setSearchedToken] = useState<IToken[]>(ACTIVE_TOKENS);
  // const [selectedToken, setSelectedToken] = useState<IToken>();

  const handleToTokenClick = (token: IToken) => {
    console.log("handling the token selection");
    onTokenSelect(token);
    console.log("selected Token:", token);
    setOpen(false);
    changeState("to");
    // console.log("Modal state:", open);
  };

  const changeState = (type: string) => {
    if (type === "from") {
      setOpenFrom((prev) => !prev);
    } else {
      setOpenTo((prev) => !prev);
    }
  };

  useEffect(() => {
    const filtered = searchTokens(searchkeyToken);
    setSearchedToken(filtered);
  }, [searchkeyToken]);
  return (
    <div className="flex items-center gap-2 rounded-full bg-black border border-[#00ff99]/50 px-4 py-2 text-sm font-bold text-white hover:border-[#00ff99] transition-all cursor-pointer">
      {selectedToken && validAddress(selectedToken?.address) ? (
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
            className="text-white bg-white rounded-full"
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
      <ChevronDown className="w-4 h-4 text-white" />
    </div>
  );
}