"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useActiveAccount } from "thirdweb/react";
import Nav from "@/components/v2/Nav";
import { StatStrip, Stat } from "@/components/v2/StatStrip";
import { qty, pct } from "@/lib/format/figures";
import { adminMessage } from "@/lib/admin/auth";
import type { AdminMetrics } from "@/lib/analytics/admin";
import s from "../analytics.module.css";

/**
 * The admin-only analytics section — ops signals that don't belong on the public
 * page. Gated by a wallet signature: the admin signs a timestamped message, the
 * server verifies it against ADMIN_WALLETS. The signed proof is reused for
 * 30 minutes (see ADMIN_PROOF_TTL_MS) so refreshes don't re-prompt.
 */
type Proof = { address: string; signature: string; ts: number };

const secs = (ms: number | null | undefined) =>
  typeof ms === "number" ? `${(ms / 1000).toFixed(1)}s` : "—";

function Breakdown({ rows }: { rows: [string, number][] }) {
  return (
    <div className={s.breakdown}>
      {rows.map(([k, n]) => (
        <div key={k} className={s.brow}>
          <span className={s.blabel}>{k.replace(/_/g, " ")}</span>
          <span className={s.bvalue}>{qty(n)}</span>
        </div>
      ))}
    </div>
  );
}

export default function AdminAnalyticsPage() {
  const account = useActiveAccount();
  const [proof, setProof] = useState<Proof | null>(null);
  const [signErr, setSignErr] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);

  const verify = async () => {
    if (!account) return;
    setSigning(true);
    setSignErr(null);
    try {
      const ts = Date.now();
      const signature = await account.signMessage({ message: adminMessage(ts) });
      setProof({ address: account.address.toLowerCase(), signature, ts });
    } catch {
      setSignErr("Signature cancelled.");
    } finally {
      setSigning(false);
    }
  };

  const { data, error } = useQuery<AdminMetrics>({
    queryKey: ["admin-metrics", proof?.ts],
    enabled: !!proof,
    retry: false,
    refetchInterval: 60_000,
    queryFn: async () => {
      const res = await fetch("/api/analytics/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(proof),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error || `admin ${res.status}`);
      }
      return (await res.json()) as AdminMetrics;
    },
  });

  const h = data?.agentHealth;
  const q = data?.quota;

  return (
    <>
      <Nav />
      <main className={s.wrap}>
        <div className={s.head}>
          <h1 className={s.h1}>Analytics · Admin</h1>
          <p className={s.sub}>Ops signals · admin wallet only</p>
        </div>

        {!proof ? (
          <section className={s.section}>
            {!account ? (
              <p className={s.empty}>Connect your admin wallet to continue.</p>
            ) : (
              <button className={s.verifyBt} onClick={verify} disabled={signing}>
                {signing ? "Signing…" : "Verify admin access"}
              </button>
            )}
            {signErr ? <p className={s.empty}>{signErr}</p> : null}
          </section>
        ) : error ? (
          <section className={s.section}>
            <p className={s.empty}>
              {String((error as Error).message)}{" "}
              <button className={s.linkBt} onClick={() => setProof(null)}>
                Try another wallet
              </button>
            </p>
          </section>
        ) : (
          <>
            <section className={s.section}>
              <h2 className={s.h2}>Agent health</h2>
              <StatStrip>
                <Stat label="Turns" value={qty(h?.total ?? null)} />
                <Stat label="OK rate" value={pct(h ? h.okRate * 100 : null, 1)} />
                <Stat label="Error rate" value={pct(h ? h.errorRate * 100 : null, 1)} />
                <Stat label="Failover" value={pct(h ? h.failoverRate * 100 : null, 1)} />
              </StatStrip>
              <StatStrip>
                <Stat label="Avg latency" value={secs(h?.avgLatencyMs)} />
                <Stat label="p95 latency" value={secs(h?.p95LatencyMs)} />
              </StatStrip>
              {h ? (
                <>
                  <h2 className={s.h2}>By status</h2>
                  <Breakdown rows={Object.entries(h.byStatus).sort((a, b) => b[1] - a[1])} />
                  <h2 className={s.h2}>Provider mix</h2>
                  <Breakdown rows={Object.entries(h.providerMix).sort((a, b) => b[1] - a[1])} />
                </>
              ) : (
                <p className={s.empty}>Agent turns unavailable.</p>
              )}
            </section>

            <section className={s.section}>
              <h2 className={s.h2}>Quota · today</h2>
              <StatStrip>
                <Stat label="Requests" value={qty(q?.requestsToday ?? null)} />
                <Stat label="Active wallets" value={qty(q?.walletsToday ?? null)} />
              </StatStrip>
              {q && q.topWalletsToday.length > 0 ? (
                <Breakdown
                  rows={q.topWalletsToday.map((w) => [
                    `${w.wallet.slice(0, 6)}…${w.wallet.slice(-4)}`,
                    w.requests,
                  ])}
                />
              ) : (
                <p className={s.empty}>No requests recorded today.</p>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}
