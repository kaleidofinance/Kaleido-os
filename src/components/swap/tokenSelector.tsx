import React, { Fragment } from "react";
import { SwapFrom, SwapTo } from "./swapPanel";
import { IToken } from "@/constants/types/dex";

export default function TokenSelector({
  label,
  selectedToken,
  onTokenSelect,
}: {
  label: string;
  selectedToken?: IToken | null;
  onTokenSelect: (token: IToken) => void;
}) {
  return (
    <Fragment>
      {label === "from" ? (
        <SwapFrom
          selectedToken={selectedToken || null}
          onTokenSelect={onTokenSelect}
        />
      ) : (
        <SwapTo
          selectedToken={selectedToken || null}
          onTokenSelect={onTokenSelect}
        />
      )}
    </Fragment>
  );
}
