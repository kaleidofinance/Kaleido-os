"use client";
import AllPool from "@/components/pool/allPool";
import UserPool from "@/components/pool/userPool";
import V3PositionsList from "@/components/pool/V3PositionsList";
import React, { useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import PoolHeader from "@/components/pool/PoolHeader";
import Button from "@/components/shared/Button";
import { Grid, List, Plus, Minus, Search } from "lucide-react";
import Link from "next/link";

type ViewMode = 'card' | 'table';

export default function Pool() {
  const [activeTab, setActiveTab] = useState("all-pools");
  const [viewMode, setViewMode] = useState<ViewMode>('card');
  const [searchQuery, setSearchQuery] = useState("");
  
  return (
    <div className="flex flex-col space-y-10">
      <div className="pt-10">
        <PoolHeader />
      </div>
      <div className="text-white p-4 lg:p-10 sm:p-5">
        <Tabs.Root
          defaultValue="all-pools"
          value={activeTab}
          onValueChange={setActiveTab}
          className="mt-6"
        >
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center space-y-4 lg:space-y-0">
            <Tabs.List className="flex space-x-2 sm:space-x-4 overflow-x-auto w-full lg:w-auto pb-2 lg:pb-0">
                <Tabs.Trigger
                  value="all-pools"
                className="whitespace-nowrap px-4 py-2 sm:px-6 sm:py-3 rounded-lg font-medium transition-colors data-[state=active]:bg-green-500 data-[state=active]:text-black data-[state=inactive]:text-gray-400 data-[state=inactive]:hover:text-white text-sm sm:text-base"
                >
                  All Pools
                </Tabs.Trigger>
                <Tabs.Trigger
                  value="user-pools"
                className="whitespace-nowrap px-4 py-2 sm:px-6 sm:py-3 rounded-lg font-medium transition-colors data-[state=active]:bg-green-500 data-[state=active]:text-black data-[state=inactive]:text-gray-400 data-[state=inactive]:hover:text-white text-sm sm:text-base"
                >
                  Your V2 Pools
                </Tabs.Trigger>
                <Tabs.Trigger
                  value="v3-positions"
                  className="whitespace-nowrap px-4 py-2 sm:px-6 sm:py-3 rounded-lg font-medium transition-colors data-[state=active]:bg-green-500 data-[state=active]:text-black data-[state=inactive]:text-gray-400 data-[state=inactive]:hover:text-white text-sm sm:text-base flex items-center gap-2"
                >
                  <span className="flex h-2 w-2 rounded-full bg-[#00ff99] shadow-[0_0_8px_#00ff99]"></span>
                  V3 Positions
                </Tabs.Trigger>
            </Tabs.List>
            
            <div className="flex flex-col sm:flex-row w-full lg:w-auto items-stretch sm:items-center gap-4">
              {/* Search Box */}
              <div className="relative flex-1 lg:max-w-md w-full">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Search className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="text"
                  placeholder="Search pools..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="block w-full pl-10 pr-3 py-2 border border-[#00ff99]/30 rounded-lg bg-black/40 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#00ff99]/50 focus:border-[#00ff99]/50 transition-colors"
                />
              </div>
              
              {/* View Mode Toggle and Action Button */}
              <div className="flex items-center space-x-2 sm:space-x-4 justify-between sm:justify-start">
                <div className="flex space-x-2">
                  <button
                    onClick={() => setViewMode('card')}
                    className={`px-3 py-2 sm:px-4 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                      viewMode === 'card' 
                        ? 'bg-green-500 text-white' 
                        : 'border border-[#00ff99]/30 text-gray-400 hover:text-white hover:border-[#00ff99]/50'
                    }`}
                  >
                    <Grid size={18} />
                    <span className="hidden sm:inline">Cards</span>
                  </button>
                  <button
                    onClick={() => setViewMode('table')}
                    className={`px-3 py-2 sm:px-4 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                      viewMode === 'table' 
                        ? 'bg-green-500 text-white' 
                        : 'border border-[#00ff99]/30 text-gray-400 hover:text-white hover:border-[#00ff99]/50'
                    }`}
                  >
                    <List size={18} />
                    <span className="hidden sm:inline">Table</span>
                  </button>
                </div>
                
                {/* Conditional Action Button */}
                {activeTab === "all-pools" ? (
                  <Link href="/create-pool">
                      <Button
                      variant="primary"
                      startIcon={<Plus size={18} />}
                      size="sm"
                      className="bg-green-500 hover:bg-green-600 text-white whitespace-nowrap"
                      >
                        Create Pool
                      </Button>
                    </Link>
                ) : (
                  <Link href="/remove-pool">
                      <Button
                      variant="primary"
                      startIcon={<Minus size={18} />}
                      size="sm"
                      className="bg-red-500 hover:bg-red-600 text-white whitespace-nowrap"
                      >
                        Remove Pool
                      </Button>
                    </Link>
                )}
              </div>
            </div>
          </div>

          <Tabs.Content value="all-pools" className="mt-4">
            <AllPool viewMode={viewMode} searchQuery={searchQuery} />
          </Tabs.Content>

          <Tabs.Content value="user-pools" className="mt-4">
            <UserPool viewMode={viewMode} searchQuery={searchQuery} />
          </Tabs.Content>

          <Tabs.Content value="v3-positions" className="mt-4">
            <V3PositionsList />
          </Tabs.Content>
        </Tabs.Root>
      </div>
    </div>
  );
}