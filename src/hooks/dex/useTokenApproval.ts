import { useCallback, useState, useEffect } from 'react';
import { useActiveAccount } from "thirdweb/react";
import { ethers } from 'ethers';

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)"
];

export const useTokenApproval = (
    tokenAddress: string | undefined, 
    spenderAddress: string, 
    amountToApprove: string,
    decimals: number = 18
) => {
    const activeAccount = useActiveAccount();
    const [isApproved, setIsApproved] = useState(false);
    const [isApproving, setIsApproving] = useState(false);

    const checkAllowance = useCallback(async () => {
        if (typeof window === "undefined" || !window.ethereum) return;
        if (!activeAccount || !tokenAddress || !spenderAddress) return;

        // Native ETH check (0xEeee...)
        if (tokenAddress === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE") {
            setIsApproved(true);
            return;
        }

        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
            const allowance = await tokenContract.allowance(activeAccount.address, spenderAddress);
            
            const amountWei = amountToApprove && !isNaN(parseFloat(amountToApprove)) 
                ? ethers.parseUnits(amountToApprove, decimals) 
                : BigInt(0);

            setIsApproved(allowance >= amountWei); 
        } catch (error) {
            console.error("Error checking allowance:", error);
        }
    }, [activeAccount, tokenAddress, spenderAddress, amountToApprove, decimals]);

    useEffect(() => {
        checkAllowance();
        const interval = setInterval(checkAllowance, 10000); // Poll every 10s
        return () => clearInterval(interval);
    }, [checkAllowance]);

    const approve = useCallback(async () => {
        if (typeof window === "undefined" || !window.ethereum) return;
        if (!activeAccount || !tokenAddress || !spenderAddress) return;
        setIsApproving(true);
        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
            
            // Use MaxUint256 for "Infinite Approval" to save gas and UX clicks
            const maxAmount = ethers.MaxUint256;

            const tx = await tokenContract.approve(spenderAddress, maxAmount); 
            await tx.wait();
            await checkAllowance();
        } catch (error) {
            console.error("Error approving token:", error);
        } finally {
            setIsApproving(false);
        }
    }, [activeAccount, tokenAddress, spenderAddress, checkAllowance]);

    return {
        isApproved,
        isApproving,
        approve,
        checkAllowance
    };
};
