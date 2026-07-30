"use client";

import { useState, useEffect } from "react";
import MktHeader from "@/components/market/MktHeader";
import OfferTable from "@/components/market/OfferTable";
import PleaseConnect from "@/components/shared/PleaseConnect";
import { Spinner } from "@radix-ui/themes";
import { useActiveAccount } from "thirdweb/react";
import { DataFiltersPanel } from "@/components/filter/DataFiltersPanel";
import Joyride from "react-joyride";
import { IoMdCompass } from "react-icons/io";

export default function MarketPlacePage() {
  const activeAccount = useActiveAccount();
  const address = activeAccount?.address;
  const [isClient, setIsClient] = useState(false);
  const [runTour, setRunTour] = useState(false);
  const [showTourDropdown, setShowTourDropdown] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setIsClient(true);
    setMounted(true);
  }, []);

  const marketplaceTourSteps = [
    {
      target: '[data-tour="filter-card"]',
      content:
        "Here you can control the display of available lend and borrow offers.",
      placement: "bottom",
      disableBeacon: true,
    },
    {
      target: '[data-tour="token-type-section"]',
      content: "Select your preferred token type here.",
      placement: "bottom",
      disableBeacon: true,
    },
    {
      target: '[data-tour="loan-status-section"]',
      content: "Select the current status of the loan to filter offers.",
      placement: "bottom",
      disableBeacon: true,
    },
    {
      target: '[data-tour="interest-section"]',
      content: "Adjust your preferred interest rate.",
      placement: "bottom",
      disableBeacon: true,
    },
    {
      target: '[data-tour="volume-section"]',
      content: "Select the volume of the lend or borrow offer.",
      placement: "bottom",
      disableBeacon: true,
    },
  ];

  if (!isClient) {
    return (
      <div className="my-64 flex justify-center text-accent">
        <Spinner size={"3"} />
      </div>
    );
  }

  return (
    <div className="mt-4 w-full px-2 md:mt-10 md:px-4">
      <div className="w-full px-0 md:px-1">
        <div className="mb-8">
          <MktHeader />
        </div>
        <div className="flex flex-col space-y-4">
          <div className="flex flex-col space-y-2">
            {/* <h2 className="text-lg font-semibold">Filter By</h2> */}
            <DataFiltersPanel />
          </div>
          <div>
            <OfferTable />
          </div>
        </div>
        {/* Floating Tour Button */}
        <div className="fixed bottom-28 right-5 z-50 flex flex-col items-end">
          <div className="group relative">
            <button
              className="mb-2 flex h-14 w-14 items-center justify-center rounded-full border border-edge bg-surface-raised text-xl text-content-secondary shadow-lg transition-colors hover:border-edge-strong hover:text-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              onClick={() => setShowTourDropdown((prev) => !prev)}
              aria-label="Open Tour Menu"
              aria-expanded={showTourDropdown}
              type="button"
            >
              <IoMdCompass />
            </button>
            {/* Tooltip on hover */}
            {!showTourDropdown && (
              <div className="absolute bottom-20 right-0 z-50 mb-2 hidden flex-col items-end group-hover:flex">
                <div className="mr-2 whitespace-nowrap rounded-lg border border-edge bg-surface-raised px-3 py-2 text-xs text-content-secondary shadow-lg">
                  Available page tours
                </div>
                <div className="mr-6 mt-[-6px] h-3 w-3 rotate-45 border-b border-r border-edge bg-surface-raised"></div>
              </div>
            )}
            {showTourDropdown && (
              <div className="absolute bottom-16 right-0 w-60 rounded-xl border border-edge bg-surface-raised py-1.5 shadow-2xl">
                <div className="select-none border-b border-edge px-5 py-2 text-[11px] uppercase tracking-[0.1em] text-content-muted">
                  Tours
                </div>
                <button
                  className="w-full px-5 py-3 text-left text-content-secondary transition-colors hover:bg-surface-hover hover:text-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  onClick={() => {
                    setRunTour(true);
                    setShowTourDropdown(false);
                  }}
                >
                  Marketplace tutorial
                </button>
              </div>
            )}
          </div>
        </div>
        {/* Joyride */}
        {mounted && (
          <Joyride
            steps={marketplaceTourSteps as any}
            run={runTour}
            continuous
            showSkipButton
            showProgress
            spotlightClicks={true}
            styles={{
              options: {
                zIndex: 10000,
                primaryColor: "var(--accent)",
                textColor: "var(--text-primary)",
                arrowColor: "var(--surface-raised)",
                backgroundColor: "var(--surface-raised)",
                overlayColor: "rgba(0,0,0,0.6)",
              },
              buttonNext: {
                backgroundColor: "var(--accent)",
                color: "var(--text-on-accent)",
                fontWeight: 600,
                borderRadius: "7px",
                padding: "8px 14px",
              },
              buttonBack: { color: "var(--text-secondary)" },
              buttonSkip: { color: "var(--text-muted)" },
              tooltip: {
                fontSize: "0.95rem",
                color: "var(--text-primary)",
                backgroundColor: "var(--surface-raised)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "10px",
                boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
              },
              tooltipTitle: {
                fontWeight: 700,
                color: "var(--text-primary)",
              },
            }}
            locale={{
              last: "Finish",
            }}
            callback={(data) => {
              if (data.status === "finished" || data.status === "skipped")
                setRunTour(false);
            }}
          />
        )}
      </div>
    </div>
  );
}
