import ChainIcon from "@/components/v2/ChainIcon";
import { CHAINS_BY_ID } from "@/constants/chains";

import s from "../pool.module.css";

/**
 * Which chain a pool is on — the logo and the chain's short name.
 *
 * Load-bearing rather than decorative, and it arrived with the sweep that made it
 * necessary: both enumerators now read every chain the protocol is deployed to, so
 * two rows in one table can be the same pair at the same fee on two different
 * chains. Without this the reader has no way to tell them apart, and picking the
 * wrong one means a swap against a pool their wallet cannot reach.
 *
 * The logo *and* the name, not the logo alone. A 14px mark is recognisable to
 * someone who already knows the chain and is a coloured smudge to everyone else,
 * and these two are Sepolia and Base Sepolia — both blue circles at this size. The
 * name is the part that actually disambiguates; the logo is what makes the row
 * scannable once you know it.
 *
 * `iconId` is unresolvable for a chain web3icons has no asset for (Hyperliquid
 * today), so the fallback is a dot in the chain's own colour — the same convention
 * `TokenIcon`'s private ChainBadge uses. A chain missing from `CHAINS_BY_ID`
 * entirely cannot happen for a pool that came from `discoveryChains()`, which
 * resolves the same map; it still renders the raw id rather than nothing, because
 * an unlabelled row is the failure this component exists to prevent.
 *
 * Imports the section stylesheet rather than taking a className, like `PairIcon`
 * beside it: the tag is a fixed part of a row's identity line, not a slot.
 */
export default function ChainTag({ chainId }: { chainId: number }) {
  const meta = CHAINS_BY_ID[chainId];

  return (
    <span className={s.chainTag} title={meta?.name ?? `Chain ${chainId}`}>
      <ChainIcon
        id={meta?.iconId}
        size={14}
        variant="branded"
        fallback={
          <i
            className={s.chainDot}
            style={meta ? { background: meta.color } : undefined}
          />
        }
      />
      {meta?.shortName ?? `Chain ${chainId}`}
    </span>
  );
}
