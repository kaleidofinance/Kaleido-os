"use client";
import RemovePoolHeader from "@/components/pool/RemovePoolHeader";
import FindPool from "@/components/pool/FindPool";
import React from "react";

export default function RemoveLiquidity() {
  return (
    <div className="flex flex-col gap-20 pt-24">
      <RemovePoolHeader />
        <div className="sm:p-4 lg:p-0 justify-center flex mb-20">
        <FindPool />
      </div>
    </div>
  );
}
