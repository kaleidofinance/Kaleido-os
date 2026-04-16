import Link from "next/link"
import * as Dialog from "@radix-ui/react-dialog"
import { FiZap, FiShield, FiCpu, FiActivity, FiArrowRight } from "react-icons/fi"
import { RiRobot2Fill } from "react-icons/ri"

const screens = [
  {
    headline: "The First Agentic DeFi OS 🪐",
    body: (
      <div className="flex flex-col space-y-4">
        <p className="text-gray-300">
          Welcome to the new frontier of <strong>Autonomous Finance.</strong> You are now initializing the first <strong>Agentic DeFi OS</strong>—built natively on Abstract to give you total control via AI-driven automation.
        </p>
        <div className="p-3 rounded-xl bg-[#36b169]/10 border border-[#36b169]/20 flex items-center gap-3">
          <div className="p-2 bg-[#36b169]/20 rounded-lg text-[#36b169]">
            <FiCpu className="text-xl" />
          </div>
          <div className="text-[10px] text-gray-400 font-bold uppercase tracking-widest text-left">Agentic AI Architecture Active</div>
        </div>
      </div>
    ),
    action: `Click '>' to meet your Autonomous Agent`,
  },
  {
    headline: "Luca: Your AI-Powered Co-Pilot 🤖",
    body: (
      <div className="flex flex-col space-y-4 text-left">
        <div>
           <strong className="text-[#36b169] block mb-1">True Agentic Capability</strong>
           <p className="text-sm text-gray-400">Luca understands natural language and parses it into complex on-chain actions. From multi-step sequence farming to instant swaps, Luca is your OS co-pilot for high-velocity DeFi.</p>
        </div>
        <div className="bg-[#121212] p-3 rounded-xl border border-white/5">
            <div className="flex items-center gap-2 mb-2">
                <RiRobot2Fill className="text-[#36b169]" />
                <span className="text-[10px] uppercase font-bold text-white tracking-tighter">AGENCY STATUS: STANDBY</span>
            </div>
            <p className="text-[11px] text-gray-500 italic">"Luca, execute a $1000 volume macro sequence."</p>
        </div>
      </div>
    ),
    action: `Learn about our real-time risk engine`,
  },
  {
    headline: "The Risk Sentinel 🛡️",
    body: (
      <div className="flex flex-col space-y-4">
        <p className="text-gray-300 text-sm">
          Our OS doesn't just display data—it monitors it. The <strong>AI-Powered Risk Sentinel</strong> watches your positions 24/7, calculating your Health Factor in real-time to ensure your P2P loans remain secure.
        </p>
        <div className="grid grid-cols-2 gap-2">
            <div className="p-3 bg-[#36b169]/5 rounded-xl border border-[#36b169]/20 text-center">
                <div className="text-[9px] text-gray-500 uppercase font-black tracking-widest mb-1">Safety Threshold</div>
                <div className="text-[#36b169] font-bold tracking-tighter">Active Monitoring</div>
            </div>
            <div className="p-3 bg-red-500/5 rounded-xl border border-red-500/20 text-center">
                <div className="text-[9px] text-gray-500 uppercase font-black tracking-widest mb-1">Sentry Alert</div>
                <div className="text-red-500 font-bold tracking-tighter">Risk Awareness</div>
            </div>
        </div>
      </div>
    ),
    action: `Discover Agentic P2P Lending`,
  },
  {
    headline: "Sovereign P2P Marketplace 🛸",
    body: (
      <div className="flex flex-col space-y-4 text-left">
        <p className="text-gray-300 text-sm">
          Experience total autonomy in the world's first AI-driven P2P marketplace. Configure lending pools with surgical precision and verify every transaction in the <strong>Protocol Ledger.</strong>
        </p>
        <div className="space-y-2">
            <div className="flex items-center gap-3 p-2 bg-white/5 rounded-lg border border-white/5">
                <FiZap className="text-[#ffd700]" />
                <span className="text-xs text-gray-400">Agentic Yield Harvesting</span>
            </div>
            <div className="flex items-center gap-3 p-2 bg-white/5 rounded-lg border border-white/5">
                <FiActivity className="text-[#00ccff]" />
                <span className="text-xs text-gray-400">Immutable Audit Ledger 📜</span>
            </div>
        </div>
      </div>
    ),
    action: `Ready to initialize the OS?`,
  },
  {
    headline: "Initialize Kaleido OS 🚀",
    body: (
      <div className="flex flex-col space-y-4 text-center">
        <div className="w-16 h-16 mx-auto bg-gradient-to-tr from-[#36b169] to-[#00ff99] rounded-full flex items-center justify-center shadow-[0_0_30px_rgba(54,177,105,0.4)]">
            <FiActivity className="text-black text-2xl" />
        </div>
        <p className="text-gray-300 font-medium">
          Step into the future of African Agentic DeFi.
        </p>
        <div className="flex items-center justify-center gap-4 pt-4">
            <Link href="https://x.com/kaleido_finance" target="_blank">
                <button className="px-4 py-2 bg-white/5 rounded-lg text-[10px] font-black uppercase text-gray-400 hover:bg-white/10 transition-all border border-white/10 tracking-widest">Twitter</button>
            </Link>
             <Link href="https://discord.com/invite/VcegZwwbcC" target="_blank">
                <button className="px-4 py-2 bg-white/5 rounded-lg text-[10px] font-black uppercase text-gray-400 hover:bg-white/10 transition-all border border-white/10 tracking-widest">Discord</button>
            </Link>
        </div>
      </div>
    ),
    action: (
      <div className="flex flex-col items-center justify-center space-y-2">
        <Dialog.Close asChild>
          <button className="flex items-center gap-3 rounded-xl bg-gradient-to-r from-[#36b169] to-[#00ff99] px-8 py-3 text-xs text-black font-black uppercase tracking-widest hover:scale-105 transition-all shadow-xl shadow-[#36b169]/20">
            Initialize Engine
          </button>
        </Dialog.Close>
      </div>
    ),
  },
]

export default screens;
