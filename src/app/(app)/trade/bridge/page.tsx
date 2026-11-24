"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { toast } from "sonner";
import {
  useActiveWallet,
  useActiveWalletChain,
  useConnectModal,
  useSwitchActiveWalletChain,
} from "thirdweb/react";
import { defineChain } from "thirdweb/chains";
import ChainIcon from "@/components/v2/ChainIcon";
import TokenIcon from "@/components/v2/TokenIcon";
import Chevron from "@/components/v2/Chevron";
import Portal from "@/components/v2/Portal";
import m from "@/components/v2/NetworkSelector.module.css";
import { client } from "@/config/client";
import { WALLETS } from "@/config/wallets";
import {
  ZERO_AUTOBRIDGE_ABI,
  ZERO_CHAIN_ID,
  ZERO_FEE_BPS,
  ZERO_LAUNCH_DATE,
  ZERO_SOURCE_BY_ID,
  ZERO_SOURCE_CHAINS,
  ZRO_OFT_ABI,
  ZRO_OFT_ADDRESS,
  buildZeroSendParam,
} from "@/lib/bridge/zero";
import t from "../trade.module.css";
import b from "../../bridge/bridge.module.css";

interface ChainStatus {
  key: string;
  chainId: number;
  name: string;
  shortName: string;
  nativeSymbol: string;
  open: boolean;
  nativeFeeWei: string | null;
  nativeFeeFormatted: string | null;
  autoBridgeAddress: string | null;
  queueLength: number | null;
}

interface StatusResponse {
  updatedAt: string;
  zeroChainId: number;
  zeroDstEid: number;
  zeroRpc: string | null;
  zroAddress: string;
  feeBps: number;
  launchDate: string;
  openCount: number;
  chains: ChainStatus[];
}

interface HistoryResponse {
  address: string;
  zeroRpc: string | null;
  liveBalanceZro: string | null;
  deliveredTotalZro: string;
  inflightTotalZro: string;
  transfers: {
    guid: string;
    srcTxHash: string;
    srcChainName: string;
    status: string;
    amountZro: string | null;
    created: string | null;
    scanUrl: string;
  }[];
}

interface QueuedOrder {
  amount: bigint;
  deposit: bigint;
  validUntil: number;
}

interface SwapQuote {
  tool: string;
  toAmount: string;
  toAmountMin: string;
  approvalAddress: string | null;
  transactionRequest: {
    to: string;
    data: string;
    value: string;
    gasLimit?: string;
  };
}

const CHAIN_ICON_ID: Record<number, string> = {
  1: "ethereum",
  8453: "base",
  42161: "arbitrum-one",
  56: "binance-smart-chain",
  10: "optimism",
  137: "polygon",
  43114: "avalanche",
};

const ERC20_MIN_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];

async function getBrowserSigner(): Promise<ethers.Signer> {
  const eth = (window as unknown as { ethereum?: ethers.Eip1193Provider }).ethereum;
  if (!eth) {
    throw new Error("No injected EVM wallet detected (install MetaMask or Rabby).");
  }
  const provider = new ethers.BrowserProvider(eth);
  return provider.getSigner();
}

export default function TradeBridgePage() {
  const wallet = useActiveWallet();
  const activeChain = useActiveWalletChain();
  const switchChain = useSwitchActiveWalletChain();
  const { connect } = useConnectModal();
  const address = wallet?.getAccount()?.address ?? null;

  const [selectedChainId, setSelectedChainId] = useState<number>(8453);
  const [showChainPicker, setShowChainPicker] = useState<boolean>(false);
  const [showTokenPicker, setShowTokenPicker] = useState<boolean>(false);

  const sourceChain = useMemo(
    () => ZERO_SOURCE_BY_ID[selectedChainId] ?? ZERO_SOURCE_CHAINS[0],
    [selectedChainId],
  );
  const [selectedTokenSymbol, setSelectedTokenSymbol] = useState<string>("ZRO");
  const selectedToken = useMemo(
    () =>
      sourceChain.popularTokens.find((tok) => tok.symbol === selectedTokenSymbol) ??
      sourceChain.popularTokens[0],
    [sourceChain, selectedTokenSymbol],
  );

  const [amountInput, setAmountInput] = useState<string>("");
  const [tokenBalance, setTokenBalance] = useState<bigint>(0n);
  const [queueDepositInput, setQueueDepositInput] = useState<string>(
    sourceChain.defaultQueueDeposit,
  );
  const [queuedOrder, setQueuedOrder] = useState<QueuedOrder | null>(null);
  const [statusData, setStatusData] = useState<StatusResponse | null>(null);
  const [historyData, setHistoryData] = useState<HistoryResponse | null>(null);
  const [swapQuote, setSwapQuote] = useState<SwapQuote | null>(null);
  const [quotingSwap, setQuotingSwap] = useState<boolean>(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);

  useEffect(() => {
    setQueueDepositInput(sourceChain.defaultQueueDeposit);
    if (!sourceChain.popularTokens.some((tok) => tok.symbol === selectedTokenSymbol)) {
      setSelectedTokenSymbol("ZRO");
    }
    setSwapQuote(null);
  }, [sourceChain, selectedTokenSymbol]);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/bridge/zero/status", { cache: "no-store" });
      if (res.ok) setStatusData((await res.json()) as StatusResponse);
    } catch {
      /* ignore transient */
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 15_000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  const fetchHistory = useCallback(async () => {
    if (!address) {
      setHistoryData(null);
      return;
    }
    try {
      const res = await fetch(`/api/bridge/zero/history?address=${address}`, {
        cache: "no-store",
      });
      if (res.ok) setHistoryData((await res.json()) as HistoryResponse);
    } catch {
      /* ignore */
    }
  }, [address]);

  useEffect(() => {
    fetchHistory();
    const id = setInterval(fetchHistory, 20_000);
    return () => clearInterval(id);
  }, [fetchHistory]);

  const currentChainStatus = useMemo(
    () => statusData?.chains.find((c) => c.chainId === selectedChainId) ?? null,
    [statusData, selectedChainId],
  );

  const refreshBalancesAndOrder = useCallback(async () => {
    if (!address) {
      setTokenBalance(0n);
      setQueuedOrder(null);
      return;
    }
    const rpc = sourceChain.rpcUrls[0];
    if (!rpc) return;
    try {
      const provider = new ethers.JsonRpcProvider(rpc, sourceChain.chainId, {
        staticNetwork: true,
      });
      if (selectedToken.isNative) {
        setTokenBalance(await provider.getBalance(address));
      } else {
        const erc = new ethers.Contract(selectedToken.address, ERC20_MIN_ABI, provider);
        setTokenBalance(BigInt(await erc.balanceOf(address)));
      }

      if (currentChainStatus?.autoBridgeAddress) {
        const ab = new ethers.Contract(
          currentChainStatus.autoBridgeAddress,
          ZERO_AUTOBRIDGE_ABI,
          provider,
        );
        const o = await ab.orders(address);
        if (Number(o.queuePos ?? o[5]) > 0) {
          setQueuedOrder({
            amount: BigInt(o.amount ?? o[0]),
            deposit: BigInt(o.deposit ?? o[1]),
            validUntil: Number(o.validUntil ?? o[4]),
          });
        } else {
          setQueuedOrder(null);
        }
      } else {
        setQueuedOrder(null);
      }
    } catch {
      /* non-fatal */
    }
  }, [address, sourceChain, selectedToken, currentChainStatus?.autoBridgeAddress]);

  useEffect(() => {
    refreshBalancesAndOrder();
  }, [refreshBalancesAndOrder]);

  const parsedAmount = useMemo(() => {
    if (!amountInput || Number(amountInput) <= 0) return 0n;
    try {
      return ethers.parseUnits(amountInput, selectedToken.decimals);
    } catch {
      return 0n;
    }
  }, [amountInput, selectedToken.decimals]);

  useEffect(() => {
    if (selectedToken.symbol === "ZRO" || parsedAmount <= 0n || !address) {
      setSwapQuote(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setQuotingSwap(true);
      try {
        const res = await fetch("/api/bridge/zero/swap-quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chainId: selectedChainId,
            fromToken: selectedToken.address,
            fromAmount: parsedAmount.toString(),
            fromAddress: address,
          }),
        });
        if (!cancelled && res.ok) setSwapQuote((await res.json()) as SwapQuote);
        else if (!cancelled) setSwapQuote(null);
      } catch {
        if (!cancelled) setSwapQuote(null);
      } finally {
        if (!cancelled) setQuotingSwap(false);
      }
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [selectedToken, parsedAmount, address, selectedChainId]);

  const ensureSelectedChain = async () => {
    if (!wallet) {
      await connect({ client, wallets: WALLETS, size: "compact" });
      return false;
    }
    if (activeChain?.id !== selectedChainId) {
      await switchChain(
        defineChain({
          id: selectedChainId,
          name: sourceChain.name,
          rpc: sourceChain.rpcUrls[0],
          nativeCurrency: {
            name: sourceChain.nativeSymbol,
            symbol: sourceChain.nativeSymbol,
            decimals: 18,
          },
        }),
      );
    }
    return true;
  };

  const handleSwapToZro = async () => {
    if (!swapQuote || !address) return;
    try {
      if (!(await ensureSelectedChain())) return;
      setBusyLabel("Swapping to ZRO…");
      const signer = await getBrowserSigner();
      if (!selectedToken.isNative && swapQuote.approvalAddress) {
        const erc = new ethers.Contract(selectedToken.address, ERC20_MIN_ABI, signer);
        const curAllow = BigInt(await erc.allowance(address, swapQuote.approvalAddress));
        if (curAllow < parsedAmount) {
          setBusyLabel(`Approving ${selectedToken.symbol}…`);
          const appTx = await erc.approve(swapQuote.approvalAddress, parsedAmount);
          await appTx.wait();
        }
      }
      setBusyLabel(`Swapping ${selectedToken.symbol} → ZRO…`);
      const tx = await signer.sendTransaction({
        to: swapQuote.transactionRequest.to,
        data: swapQuote.transactionRequest.data,
        value: BigInt(swapQuote.transactionRequest.value || "0"),
      });
      await tx.wait();
      toast.success("Swapped to ZRO! Ready to bridge or queue to Zero.");
      setSelectedTokenSymbol("ZRO");
      setAmountInput(Number(ethers.formatEther(BigInt(swapQuote.toAmountMin))).toFixed(4));
      await refreshBalancesAndOrder();
    } catch (e) {
      toast.error(e instanceof Error ? e.message.slice(0, 140) : "Swap failed");
    } finally {
      setBusyLabel(null);
    }
  };

  const handleDirectBridge = async () => {
    if (!address || parsedAmount <= 0n) return;
    try {
      if (!(await ensureSelectedChain())) return;
      const signer = await getBrowserSigner();
      const autoBridgeAddr = currentChainStatus?.autoBridgeAddress;

      if (autoBridgeAddr) {
        const zro = new ethers.Contract(ZRO_OFT_ADDRESS, ZRO_OFT_ABI, signer);
        const allow = BigInt(await zro.allowance(address, autoBridgeAddr));
        if (allow < parsedAmount) {
          setBusyLabel("Approving ZRO…");
          const txA = await zro.approve(autoBridgeAddr, parsedAmount);
          await txA.wait();
        }
        const ab = new ethers.Contract(autoBridgeAddr, ZERO_AUTOBRIDGE_ABI, signer);
        setBusyLabel("Quoting LayerZero fee…");
        const q = await ab.quoteBridge(address, parsedAmount);
        const nativeFee = BigInt(q.nativeFee ?? q[0]);
        setBusyLabel("Bridging ZRO to Zero…");
        const tx = await ab.bridgeDirect(parsedAmount, { value: nativeFee });
        await tx.wait();
      } else {
        const oft = new ethers.Contract(ZRO_OFT_ADDRESS, ZRO_OFT_ABI, signer);
        const sp = buildZeroSendParam(address, parsedAmount);
        setBusyLabel("Quoting LayerZero fee…");
        const mf = await oft.quoteSend(sp, false);
        const nativeFee = BigInt(mf.nativeFee ?? mf[0]);
        setBusyLabel("Bridging ZRO to Zero…");
        const tx = await oft.send(sp, { nativeFee, lzTokenFee: 0n }, address, {
          value: nativeFee,
        });
        await tx.wait();
      }
      toast.success("ZRO bridged to Zero! Track delivery below.");
      setAmountInput("");
      await Promise.all([refreshBalancesAndOrder(), fetchHistory()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message.slice(0, 140) : "Bridge failed");
    } finally {
      setBusyLabel(null);
    }
  };

  const handleJoinQueue = async () => {
    if (!address || parsedAmount <= 0n || !currentChainStatus?.autoBridgeAddress) return;
    try {
      if (!(await ensureSelectedChain())) return;
      const signer = await getBrowserSigner();
      const abAddr = currentChainStatus.autoBridgeAddress;
      const zro = new ethers.Contract(ZRO_OFT_ADDRESS, ZRO_OFT_ABI, signer);

      const allow = BigInt(await zro.allowance(address, abAddr));
      if (allow < parsedAmount) {
        setBusyLabel("1/2 · Approving ZRO…");
        const appTx = await zro.approve(abAddr, parsedAmount);
        await appTx.wait();
      }

      const depositWei = ethers.parseEther(queueDepositInput || sourceChain.defaultQueueDeposit);
      const maxNativeFeeWei = ethers.parseEther(sourceChain.defaultMaxNativeFee);
      const validUntil = Math.floor(Date.now() / 1000) + 14 * 86400;

      setBusyLabel("2/2 · Enrolling in Auto-Queue…");
      const ab = new ethers.Contract(abAddr, ZERO_AUTOBRIDGE_ABI, signer);
      const tx = await ab.enroll(parsedAmount, maxNativeFeeWei, 0n, validUntil, {
        value: depositWei,
      });
      await tx.wait();
      toast.success("Queued! Keeper bridges your ZRO the second LayerZero opens the route.");
      await Promise.all([refreshBalancesAndOrder(), fetchStatus()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message.slice(0, 140) : "Queue enroll failed");
    } finally {
      setBusyLabel(null);
    }
  };

  const handleCancelQueue = async () => {
    if (!address || !currentChainStatus?.autoBridgeAddress) return;
    try {
      if (!(await ensureSelectedChain())) return;
      setBusyLabel("Cancelling & reclaiming deposit…");
      const signer = await getBrowserSigner();
      const ab = new ethers.Contract(
        currentChainStatus.autoBridgeAddress,
        ZERO_AUTOBRIDGE_ABI,
        signer,
      );
      const tx = await ab.cancel();
      await tx.wait();
      toast.success("Queue cancelled — 100% of your gas deposit has been refunded.");
      await Promise.all([refreshBalancesAndOrder(), fetchStatus()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message.slice(0, 140) : "Cancel failed");
    } finally {
      setBusyLabel(null);
    }
  };

  const handleAddZeroToWallet = async () => {
    const rpc = statusData?.zeroRpc;
    if (!rpc) return;
    const eth = (window as unknown as { ethereum?: ethers.Eip1193Provider }).ethereum;
    if (!eth) return toast.error("Install MetaMask or Rabby to add Zero.");
    try {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: `0x${ZERO_CHAIN_ID.toString(16)}`,
            chainName: "Zero",
            nativeCurrency: { name: "LayerZero", symbol: "ZRO", decimals: 18 },
            rpcUrls: [rpc],
            blockExplorerUrls: ["https://layerzeroscan.com"],
          },
        ],
      });
      toast.success("Zero network added to your wallet.");
    } catch {
      toast.error("Wallet rejected adding Zero.");
    }
  };

  const setPercent = (pct: number) => {
    if (tokenBalance <= 0n) return;
    const val = (tokenBalance * BigInt(pct)) / 100n;
    const formatted = Number(ethers.formatUnits(val, selectedToken.decimals));
    setAmountInput(formatted > 0 ? formatted.toFixed(6).replace(/\.?0+$/, "") : "");
  };

  const isRouteOpen = Boolean(currentChainStatus?.open);
  const needsSwapFirst = selectedToken.symbol !== "ZRO";
  const feePct = (ZERO_FEE_BPS / 100).toFixed(2);

  const estimatedZroOut = useMemo(() => {
    if (parsedAmount <= 0n) return "";
    if (needsSwapFirst) {
      if (quotingSwap) return "…";
      if (!swapQuote) return "";
      const net = (BigInt(swapQuote.toAmount) * BigInt(10_000 - ZERO_FEE_BPS)) / 10_000n;
      return Number(ethers.formatEther(net)).toFixed(4).replace(/\.?0+$/, "");
    }
    const fee = currentChainStatus?.autoBridgeAddress
      ? (parsedAmount * BigInt(ZERO_FEE_BPS)) / 10_000n
      : 0n;
    return Number(ethers.formatEther(parsedAmount - fee)).toFixed(4).replace(/\.?0+$/, "");
  }, [parsedAmount, needsSwapFirst, quotingSwap, swapQuote, currentChainStatus?.autoBridgeAddress]);

  return (
    <div className={t.card}>
      {/* Top-right percentage chips — exact Swap position */}
      <div className={t.settings}>
        <div className={t.quick}>
          {[25, 50, 100].map((p) => (
            <button
              key={p}
              type="button"
              className={t.qk}
              disabled={tokenBalance <= 0n}
              onClick={() => setPercent(p)}
            >
              {p === 100 ? "Max" : `${p}%`}
            </button>
          ))}
        </div>
      </div>

      {/* FROM WELL — exact Swap .box.deep */}
      <div className={`${t.box} ${t.deep}`}>
        <div className={t.bl}>
          <span className={b.chainRow}>
            <span>From</span>
            <button
              type="button"
              className={b.selectBtn}
              onClick={() => setShowChainPicker(true)}
            >
              <ChainIcon id={CHAIN_ICON_ID[sourceChain.chainId]} size={16} />
              {sourceChain.shortName}
              <Chevron size={11} />
            </button>
          </span>
        </div>

        <div className={t.amt}>
          <input
            className={t.inp}
            type="text"
            inputMode="decimal"
            placeholder="0"
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value.replace(/[^0-9.]/g, ""))}
          />
          <button
            type="button"
            className={t.pill}
            onClick={() => setShowTokenPicker(true)}
          >
            <span className={`${t.tki} ${t.tkiArt}`}>
              <TokenIcon symbol={selectedToken.symbol} size={26} />
            </span>
            {selectedToken.symbol}
            <Chevron size={12} className={t.cv} />
          </button>
        </div>

        <div className={t.sub}>
          <span>
            {needsSwapFirst ? `Swaps to ZRO via LI.FI` : `Canonical LayerZero OFT`}
          </span>
          <span>
            Balance:{" "}
            <b onClick={() => setPercent(100)}>
              {Number(ethers.formatUnits(tokenBalance, selectedToken.decimals)).toFixed(4)}
            </b>
          </span>
        </div>
      </div>

      {/* CENTER ARROW DIVIDER — exact Swap .linkRow + .arw */}
      <div className={t.linkRow}>
        <div className={t.arw} aria-hidden="true">
          ↓
        </div>
      </div>

      {/* TO WELL — exact Swap .box.raised locked to Zero */}
      <div className={`${t.box} ${t.raised}`}>
        <div className={t.bl}>
          To · Zero Mainnet (Trading Day 1 · {ZERO_LAUNCH_DATE})
        </div>

        <div className={t.amt}>
          <input
            className={t.inp}
            type="text"
            readOnly
            placeholder="0"
            value={estimatedZroOut}
          />
          <span className={`${t.pill} ${b.zeroPillLocked}`}>
            <span className={`${t.tki} ${t.tkiArt}`}>
              <ChainIcon id="zero" size={26} />
            </span>
            ZRO
          </span>
        </div>

        <div className={t.sub}>
          <span>
            {address
              ? `To ${address.slice(0, 6)}…${address.slice(-4)} on Zero`
              : "Delivered to your same address on Zero"}
          </span>
          <span>Native gas</span>
        </div>
      </div>

      {/* Refundable gas deposit input when queuing */}
      {!isRouteOpen && currentChainStatus?.autoBridgeAddress && !needsSwapFirst && (
        <div className={b.depositRow}>
          <span>Refundable gas deposit ({sourceChain.nativeSymbol})</span>
          <input
            className={b.depositInput}
            type="text"
            inputMode="decimal"
            value={queueDepositInput}
            onChange={(e) => setQueueDepositInput(e.target.value.replace(/[^0-9.]/g, ""))}
          />
        </div>
      )}

      {/* Primary CTA — exact Swap .cta */}
      {!wallet ? (
        <button
          type="button"
          className={t.cta}
          onClick={() => connect({ client, wallets: WALLETS, size: "compact" })}
        >
          Connect Wallet
        </button>
      ) : needsSwapFirst ? (
        <button
          type="button"
          className={t.cta}
          disabled={!swapQuote || Boolean(busyLabel)}
          onClick={handleSwapToZro}
        >
          {busyLabel ||
            (quotingSwap
              ? "Quoting swap…"
              : parsedAmount <= 0n
                ? "Enter an amount"
                : `Step 1 · Swap ${selectedToken.symbol} → ZRO`)}
        </button>
      ) : isRouteOpen ? (
        <button
          type="button"
          className={t.cta}
          disabled={parsedAmount <= 0n || Boolean(busyLabel)}
          onClick={handleDirectBridge}
        >
          {busyLabel ||
            (parsedAmount <= 0n ? "Enter an amount" : `Bridge ${amountInput} ZRO to Zero`)}
        </button>
      ) : (
        <button
          type="button"
          className={t.cta}
          disabled={
            parsedAmount <= 0n ||
            !currentChainStatus?.autoBridgeAddress ||
            Boolean(busyLabel)
          }
          onClick={handleJoinQueue}
        >
          {busyLabel ||
            (parsedAmount <= 0n
              ? "Enter an amount"
              : currentChainStatus?.autoBridgeAddress
                ? "Approve ZRO & Join Auto-Queue"
                : `Route Closed · Auto-Queue deploying on ${sourceChain.shortName}`)}
        </button>
      )}

      {/* Active queue cancel button if user is already enrolled */}
      {queuedOrder && (
        <button
          type="button"
          className={b.cancelBtn}
          disabled={Boolean(busyLabel)}
          onClick={handleCancelQueue}
        >
          Cancel {Number(ethers.formatEther(queuedOrder.amount)).toFixed(2)} ZRO Queue &amp;
          Reclaim 100% Deposit
        </button>
      )}

      {/* Compact 1-line quote / route status footer */}
      <div className={t.quote}>
        <span>
          Route:{" "}
          <b>
            {isRouteOpen
              ? `OPEN (${currentChainStatus?.nativeFeeFormatted ?? "~"} ${sourceChain.nativeSymbol})`
              : "CLOSED · Auto-Queue"}
          </b>
        </span>
        <span>
          Fee: <b>{feePct}% · Ownerless</b>
        </span>
      </div>

      {/* Compact pre-RPC one-way warning */}
      {!statusData?.zeroRpc && (
        <div className={b.notice}>
          <strong>One-way until {ZERO_LAUNCH_DATE}:</strong> Zero has no public RPC yet. Bridged
          $ZRO lands at your same address as native gas coin until mainnet &amp; RPC launch.
        </div>
      )}

      {/* Your ZRO on Zero — directly underneath the Bridge card */}
      <div className={`${t.box} ${t.raised}`} style={{ marginTop: 10 }}>
        <div className={t.kv} style={{ paddingTop: 0 }}>
          <span className={b.chainRow}>
            <ChainIcon id="zero" size={18} />
            <b>Your ZRO on Zero</b>
          </span>
          <span className={b.routeMeta}>LayerZero Scan</span>
        </div>

        <div className={b.statRow}>
          <div className={b.statTile}>
            <span className={b.statLabel}>Delivered on Zero</span>
            <span className={b.statVal}>
              {historyData?.liveBalanceZro ?? historyData?.deliveredTotalZro ?? "0"} ZRO
            </span>
          </div>
          <div className={b.statTile}>
            <span className={b.statLabel}>In-Flight</span>
            <span className={b.statVal}>{historyData?.inflightTotalZro ?? "0"} ZRO</span>
          </div>
        </div>

        <button
          type="button"
          className={t.cta}
          style={{ marginTop: 0, marginBottom: 10, padding: "12px 14px", fontSize: 14 }}
          disabled={!statusData?.zeroRpc}
          onClick={handleAddZeroToWallet}
        >
          {statusData?.zeroRpc
            ? `Add Zero (Chain ID ${ZERO_CHAIN_ID}) to Wallet`
            : `Add Zero to Wallet · Unlocks ${ZERO_LAUNCH_DATE}`}
        </button>

        <div className={b.routeList}>
          {!address ? (
            <div className={b.empty}>Connect your wallet to see Zero transfers.</div>
          ) : historyData && historyData.transfers.length > 0 ? (
            historyData.transfers.slice(0, 8).map((tx) => (
              <a
                key={tx.guid}
                href={tx.scanUrl}
                target="_blank"
                rel="noreferrer"
                className={b.txLink}
              >
                <span>
                  {tx.srcChainName} → Zero {tx.amountZro ? `· ${tx.amountZro} ZRO` : ""}
                </span>
                <span className={tx.status === "DELIVERED" ? b.badgeOpen : b.badgeClosed}>
                  {tx.status} ↗
                </span>
              </a>
            ))
          ) : (
            <div className={b.empty}>
              No Zero transfers yet for {address.slice(0, 6)}…{address.slice(-4)}.
            </div>
          )}
        </div>
      </div>

      {/* Live LayerZero Routes — directly underneath */}
      <div className={`${t.box} ${t.raised}`} style={{ marginTop: 6 }}>
        <div className={t.kv} style={{ paddingTop: 0 }}>
          <b>Live LayerZero Routes ({statusData?.openCount ?? 0}/7 open)</b>
          <button type="button" className={t.qk} onClick={fetchStatus}>
            Refresh
          </button>
        </div>
        <div className={b.routeList}>
          {(statusData?.chains ?? ZERO_SOURCE_CHAINS.map((c) => ({
            key: c.key,
            chainId: c.chainId,
            name: c.name,
            shortName: c.shortName,
            nativeSymbol: c.nativeSymbol,
            open: false,
            nativeFeeWei: null,
            nativeFeeFormatted: null,
            autoBridgeAddress: null,
            queueLength: null,
          }))).map((row) => (
            <button
              key={row.chainId}
              type="button"
              className={`${b.routeRow} ${row.chainId === selectedChainId ? b.routeRowActive : ""}`}
              onClick={() => setSelectedChainId(row.chainId)}
            >
              <span className={b.chainRow}>
                <ChainIcon id={CHAIN_ICON_ID[row.chainId]} size={20} />
                {row.name}
              </span>
              <span className={b.routeRight}>
                <span className={b.routeMeta}>
                  {row.open && row.nativeFeeFormatted
                    ? `${row.nativeFeeFormatted} ${row.nativeSymbol}`
                    : row.queueLength !== null
                      ? `${row.queueLength} queued`
                      : "—"}
                </span>
                <span className={row.open ? b.badgeOpen : b.badgeClosed}>
                  {row.open ? "OPEN" : "CLOSED"}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Source Network Modal */}
      {showChainPicker && (
        <Portal>
          <div
            className={m.overlay}
            onClick={() => setShowChainPicker(false)}
            role="presentation"
          >
            <div
              className={m.modal}
              role="dialog"
              aria-modal="true"
              aria-label="Select source network"
              onClick={(e) => e.stopPropagation()}
            >
              <div className={m.mh}>
                <span className={m.mt}>Select source network</span>
                <button
                  type="button"
                  className={m.mx}
                  onClick={() => setShowChainPicker(false)}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
              <div className={m.mb}>
                <div className={m.list}>
                  {ZERO_SOURCE_CHAINS.map((c) => {
                    const st = statusData?.chains.find((x) => x.chainId === c.chainId);
                    const isSelected = c.chainId === selectedChainId;
                    return (
                      <button
                        key={c.chainId}
                        type="button"
                        className={m.row}
                        onClick={() => {
                          setSelectedChainId(c.chainId);
                          setShowChainPicker(false);
                        }}
                      >
                        <span className={m.tki}>
                          <ChainIcon id={CHAIN_ICON_ID[c.chainId]} size={22} />
                        </span>
                        <div className={m.rb}>
                          <div className={m.rn}>{c.name}</div>
                          <div className={m.rs}>
                            {st?.open
                              ? `Route open · ${st.nativeFeeFormatted ?? "~"} ${c.nativeSymbol}`
                              : "Route closed · Auto-Queue"}
                          </div>
                        </div>
                        {isSelected ? (
                          <span className={m.current}>Selected</span>
                        ) : st?.open ? (
                          <span className={m.current}>Open</span>
                        ) : (
                          <span className={m.soon}>Closed</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* Source Token Modal */}
      {showTokenPicker && (
        <Portal>
          <div
            className={m.overlay}
            onClick={() => setShowTokenPicker(false)}
            role="presentation"
          >
            <div
              className={m.modal}
              role="dialog"
              aria-modal="true"
              aria-label="Select token"
              onClick={(e) => e.stopPropagation()}
            >
              <div className={m.mh}>
                <span className={m.mt}>Select token on {sourceChain.shortName}</span>
                <button
                  type="button"
                  className={m.mx}
                  onClick={() => setShowTokenPicker(false)}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
              <div className={m.mb}>
                <div className={m.list}>
                  {sourceChain.popularTokens.map((tok) => {
                    const isSelected = tok.symbol === selectedToken.symbol;
                    return (
                      <button
                        key={tok.symbol}
                        type="button"
                        className={m.row}
                        onClick={() => {
                          setSelectedTokenSymbol(tok.symbol);
                          setShowTokenPicker(false);
                        }}
                      >
                        <span className={m.tki}>
                          <TokenIcon symbol={tok.symbol} size={22} />
                        </span>
                        <div className={m.rb}>
                          <div className={m.rn}>{tok.symbol}</div>
                          <div className={m.rs}>
                            {tok.symbol === "ZRO"
                              ? "Direct LayerZero OFT → Zero"
                              : `${tok.name} · Swaps to ZRO via LI.FI`}
                          </div>
                        </div>
                        {isSelected && <span className={m.current}>Selected</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}
