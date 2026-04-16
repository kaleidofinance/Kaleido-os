"use client"
import { AbstractWalletProvider } from "@abstract-foundation/agw-react";
import { abstractTestnet, abstract } from "viem/chains"; // Use abstract for mainnet

export const AbstractContext = ({children}: {children:React.ReactNode}) => {
  return (
    <AbstractWalletProvider chain={abstractTestnet} >
        {children}
    </AbstractWalletProvider>
  );
};


