import { ThirdwebProvider } from "thirdweb/react";
import React from "react";
import { AutoConnectProvider } from "./AutoConnectProvider";

export default function Web3Modal({ children }: { children: React.ReactNode }) {
  return (
    <ThirdwebProvider>
      <AutoConnectProvider>{children}</AutoConnectProvider>
    </ThirdwebProvider>
  );
}
