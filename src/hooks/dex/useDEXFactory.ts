import { useCallback } from 'react';
import { ethers } from 'ethers';

import { KALEIDOSWAP_FACTORY } from "@/constants/utils/addresses";

const FACTORY_ADDRESS = KALEIDOSWAP_FACTORY; 

const FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)"
];

export const useDEXFactory = () => {
    const getPairAddress = useCallback(async (tokenA: string, tokenB: string) => {
        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);
            const pair = await factory.getPair(tokenA, tokenB);
            if (pair === ethers.ZeroAddress) return null;
            return pair;
        } catch (error) {
            console.error("Error fetching pair:", error);
            return null;
        }
    }, []);

    return {
        getPairAddress,
        FACTORY_ADDRESS
    };
};
