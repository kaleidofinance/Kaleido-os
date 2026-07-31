"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Nav from "@/components/v2/Nav";
import s from "./pool.module.css";

/**
 * Pool shell. Positions list is the default; New Position is its own route
 * (/v2/pool/new) — same routed-sub-page pattern as Trade and Stable, but
 * here it's a list-vs-form split rather than parallel modes.
 */
export default function PoolLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const onNew = pathname === "/v2/pool/new";

  return (
    <>
      <Nav />
      <main className={s.wrap}>
        <div className={s.head}>
          <h1 className={s.h1}>{onNew ? "New position" : "Your positions"}</h1>
          {onNew ? (
            <Link href="/v2/pool" className={s.bt}>
              Cancel
            </Link>
          ) : (
            <Link href="/v2/pool/new" className={`${s.bt} ${s.btWhite}`}>
              + New position
            </Link>
          )}
        </div>
        {children}
      </main>
    </>
  );
}
