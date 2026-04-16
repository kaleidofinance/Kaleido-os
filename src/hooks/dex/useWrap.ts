import { useCallback, useState } from 'react';
import { useActiveAccount } from "thirdweb/react";
import { ethers } from 'ethers';

const WETH_ABI = [
  "function deposit() public payable",
  "function withdraw(uint256 wad) public"
];

export const useWrap = (wethAddress: string | undefined) => {
    const activeAccount = useActiveAccount();
    const [loading, setLoading] = useState(false);

    const wrap = useCallback(async (amount: string) => {
        if (!activeAccount || !wethAddress) return { success: false, error: "No account or address" };
        setLoading(true);
        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const wethContract = new ethers.Contract(wethAddress, WETH_ABI, signer);
            
            const amountWei = ethers.parseEther(amount);
            const tx = await wethContract.deposit({ value: amountWei });
            await tx.wait();
            return { success: true, hash: tx.hash };
        } catch (error: any) {
            console.error("Wrap error:", error);
            const msg = error.message?.substring(0, 50) || "Unknown Error";
            return { success: false, error: msg };
        } finally {
            setLoading(false);
        }
    }, [activeAccount, wethAddress]);

    const unwrap = useCallback(async (amount: string) => {
        if (!activeAccount || !wethAddress) return { success: false, error: "No account or address" };
        setLoading(true);
        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const wethContract = new ethers.Contract(wethAddress, WETH_ABI, signer);
            
            const amountWei = ethers.parseEther(amount);
            const tx = await wethContract.withdraw(amountWei);
            await tx.wait();
             return { success: true, hash: tx.hash };
        } catch (error) {
            console.error("Unwrap error:", error);
             return { success: false, error };
        } finally {
            setLoading(false);
        }
    }, [activeAccount, wethAddress]);

    return { wrap, unwrap, loading };
};
