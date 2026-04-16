"use client";
import { useSearchParams } from "next/navigation";
import { Root as TabsRoot, List as TabsList, Trigger as TabsTrigger, Content as TabsContent } from "@radix-ui/react-tabs";
import React, { Suspense } from "react";
import CreateLiquidity from "@/components/liquidity/createLiquidity";
import { ManageLiquidityBanner } from "@/components/banner/manageLiquidity";
import RemoveLiquidity from "@/components/liquidity/removeLiquidity";
import Loading from "@/components/ui/loading";

function PoolDetails() {
  const searchParams = useSearchParams();
  const symbolA = searchParams.get("symbolA");
  const symbolB = searchParams.get("symbolB");

  return (
    <div>
      <ManageLiquidityBanner />
      <div className="text-white justify-center items-center flex lg:p-12 sm:p-6">
        <div className="flex flex-col space-y-4">
          <div className="flex flex-row space-x-2">
            <p className="text-gray-400"> Earn / </p>
            <p className="text-white font-normal">
              {symbolA}-{symbolB}
            </p>
          </div>
          <div className="flex flex-col ">
            <p className="text-gray-400">
              Remove or add liquidity for the selected pool
            </p>
          </div>

          <div className="sm:w-full lg:w-[600px] flex flex-col bg-black/90 backdrop-blur-sm h-full py-4 rounded-lg border border-[#00ff99]/40">
            <TabsRoot defaultValue="add-liquidity" className="">
              <TabsList className="flex space-x-4">
                <TabsTrigger
                  value="add-liquidity"
                  className="px-4 py-3 text-gray-400 data-[state=active]:text-white data-[state=active]:border-b-2 data-[state=active]:border-[#00ff99]"
                >
                  Add
                </TabsTrigger>
                <TabsTrigger
                  value="remove-liquidity"
                  className="px-4 py-3 text-gray-400 data-[state=active]:text-white data-[state=active]:border-b-2 data-[state=active]:border-[#00ff99]"
                >
                  Remove
                </TabsTrigger>
              </TabsList>
              <div className="hidden lg:block border-b border-[#00ff99]/20 w-full" />
              <TabsContent value="add-liquidity" className="mt-4">
                <CreateLiquidity
                  tokenA={symbolA || ""}
                  tokenB={symbolB || ""}
                />
              </TabsContent>
              <TabsContent value="remove-liquidity" className="mt-4">
                <RemoveLiquidity style={true} />
              </TabsContent>
            </TabsRoot>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PoolDetailsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <PoolDetails />
    </Suspense>
  );
}
