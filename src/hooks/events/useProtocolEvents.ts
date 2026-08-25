"use client";

/**
 * Chain-event subscriptions for the things that happen to a user *without* the
 * user doing anything.
 *
 * Replaces `useRequestEvents`, `useListingEvent` and `useCollateralEvent`, which
 * were all orphaned — nothing imported any of them — and none of which could have
 * fired a notification if they had been mounted:
 *
 *  1. Every filter was scoped to the wrong party. `RequestServiced` was filtered
 *     on `_lender`, `RequestLiquidated` on `lenderAddress`, `LoanRepayment` on the
 *     repaying `sender` — and then each guard required that same indexed address
 *     *not* be the connected wallet. The filter can only deliver logs where it is,
 *     so the guard was unreachable by construction: every branch was dead.
 *  2. They used the ethers-v5 listener idiom on a v6 repo. v6 spreads the decoded
 *     args and appends the payload, so a one-parameter `(e) => e.log.blockNumber`
 *     binds `e` to the *first event argument* — a bigint. The listener threw on
 *     its own first line.
 *  3. `useListingEvent` passed a wallet address as the value for
 *     `uint96 indexed listingId`. ethers pads a filter value to 32 bytes without a
 *     range check, so that produced a well-formed topic matching nothing, forever,
 *     with no error.
 *  4. No cleanup, and the filters were rebuilt on every render, so the effect's
 *     deps changed every render and it stacked another set of listeners each time.
 *
 * What is subscribed here is only what the user cannot learn any other way. Their
 * own transactions already toast on receipt, so `RequestCreated` is not here.
 *
 * Everything a counterparty can be told about, they are now told about. The last
 * gap was that **a lender was never told their loan was repaid** —
 * `LoanRepayment(address indexed sender, uint96 id, uint256 amount)` indexed only
 * the borrower doing the repaying, so no filter could select "repayments of loans
 * I funded" even though `_request.lender` was in scope at the emit site. The event
 * was widened rather than worked around: `lender` is now indexed, and `outstanding`
 * is carried so a partial payment can be told from a closing one without a
 * follow-up read. Both required regenerating `src/abi/ProtocolFacet.json`.
 */

import { useEffect } from "react";
import type { ContractEventName, Listener } from "ethers";
import { useActiveAccount } from "thirdweb/react";

import { getKaleidoContract } from "@/config/contracts";
import { getWssProvider, READ_ONLY_CHAIN_ID } from "@/config/provider";
import {
  sendLiquidationNotification,
  sendLoanRepaidNotification,
  sendRequestFundedNotification,
} from "@/lib/notifications/emit";

const useProtocolEvents = () => {
  const activeAccount = useActiveAccount();
  const address = activeAccount?.address;

  useEffect(() => {
    if (!address) return;

    /* Null when NEXT_PUBLIC_WEBSOCKET_RPC is unset. No socket, no events — and
     * the health-factor poll still covers the alert that matters most. */
    const wss = getWssProvider();
    if (!wss) return;

    /* getKaleidoContract throws when no diamond is recorded for the chain. This
     * hook is mounted in a layout, so letting that escape would replace the app
     * with an error boundary over a notification subscription. Wrapped in an IIFE
     * rather than a `let` so the closures below capture a typed Contract — an
     * evolving `let` is `any` inside a closure, which is exactly where the two
     * calls whose signatures matter (`on`, `off`) are made.
     *
     * READ_ONLY_CHAIN_ID, not the wallet's chain: getWssProvider pins its socket
     * to that chain id, and the contract address has to be the one on the chain
     * the socket is dialing or we would subscribe to a foreign address and never
     * see a log. */
    const contract = (() => {
      try {
        return getKaleidoContract(wss, READ_ONLY_CHAIN_ID);
      } catch (err) {
        console.warn("[protocol-events] not subscribing:", err);
        return null;
      }
    })();
    if (!contract) return;

    /* Each filter selects the side the *counterparty* acted on, so there is no
     * guard to get backwards: if a log arrives, it is about this wallet.
     *
     * RequestServiced(uint96 indexed _requestId, address indexed _lender,
     *                 address indexed _borrower, uint256 _amount, address token)
     * RequestLiquidated(uint96 indexed requestId, address indexed lenderAddress,
     *                   address indexed borrowerAddress, uint256 totalRepayment)
     * LoanRepayment(address indexed sender, address indexed lender, uint96 id,
     *               uint256 amount, uint256 outstanding)
     *
     * Positions matter: ethers maps filter values across *all* event inputs, not
     * just the indexed ones, so the nulls are placeholders, not padding. */
    const subs: Array<[ContractEventName, Listener]> = [
      [
        contract.filters.RequestServiced(null, null, address),
        (requestId: bigint) => sendRequestFundedNotification(String(requestId)),
      ],
      [
        contract.filters.RequestLiquidated(null, null, address),
        (requestId: bigint) =>
          sendLiquidationNotification("borrower", String(requestId)),
      ],
      [
        contract.filters.RequestLiquidated(null, address),
        (requestId: bigint) =>
          sendLiquidationNotification("lender", String(requestId)),
      ],
      /* The only listener here that needs an argument past the first, so it is
       * the only one that has to name the ones it skips. `outstanding` is the
       * post-payment balance, so 0 means this payment closed the loan. */
      [
        contract.filters.LoanRepayment(null, address),
        (
          _sender: string,
          _lender: string,
          id: bigint,
          _amount: bigint,
          outstanding: bigint,
        ) => sendLoanRepaidNotification(String(id), outstanding === BigInt(0)),
      ],
    ];

    const detach = () => {
      for (const [filter, listener] of subs) {
        contract.off(filter, listener).catch(() => {});
      }
    };

    /* contract.on resolves the filter's topics over the network, so it can settle
     * after unmount. Detach again in that case — off() on a listener that was
     * never attached is a no-op, so the double call is safe. */
    let cancelled = false;
    Promise.all(subs.map(([filter, listener]) => contract.on(filter, listener)))
      .then(() => {
        if (cancelled) detach();
      })
      .catch((err) => {
        console.warn("[protocol-events] subscribe failed:", err);
      });

    return () => {
      cancelled = true;
      detach();
    };
  }, [address]);
};

export default useProtocolEvents;
