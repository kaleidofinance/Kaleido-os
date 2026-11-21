import {
  LuArrowDownUp,
  LuBookOpen,
  LuChartNoAxesCombined,
  LuCircleDollarSign,
  LuCoins,
  LuCompass,
  LuExternalLink,
  LuGift,
  LuGithub,
  LuLandmark,
  LuLayers,
  LuMap,
  LuNetwork,
  LuReceipt,
  LuRocket,
  LuSparkles,
  LuWallet,
} from "react-icons/lu";

export const appUrl = "https://app.kaleidofi.xyz";

export const navigationGroups = [
  {
    title: "Products",
    links: [
      { label: "Swap", href: `${appUrl}/trade/swap`, description: "Compare routes and exchange tokens.", Icon: LuArrowDownUp },
      { label: "Liquidity", href: `${appUrl}/pool`, description: "Explore pools and manage positions.", Icon: LuLayers },
      { label: "Lend", href: `${appUrl}/lend`, description: "Explore peer-to-peer lending offers.", Icon: LuCoins },
      { label: "Borrow", href: `${appUrl}/borrow`, description: "Borrow against your collateral.", Icon: LuLandmark },
      { label: "Stablecoins", href: `${appUrl}/stable`, description: "Access Kaleido’s stablecoin tools.", Icon: LuCircleDollarSign },
      { label: "Stake", href: `${appUrl}/stake`, description: "Open the KLD staking market.", Icon: LuCoins },
    ],
  },
  {
    title: "Explore",
    links: [
      { label: "Luca", href: `${appUrl}/trade/agent`, description: "Turn a request into a transaction plan.", Icon: LuSparkles },
      { label: "Portfolio", href: `${appUrl}/portfolio`, description: "View balances and positions.", Icon: LuWallet },
      { label: "Analytics", href: `${appUrl}/analytics`, description: "Explore activity across Kaleido.", Icon: LuChartNoAxesCombined },
      { label: "Rewards", href: `${appUrl}/rewards`, description: "See tasks and track your points.", Icon: LuGift },
    ],
  },
  {
    title: "Protocol",
    links: [
      { label: "Overview", href: "/docs/overview", description: "See how Kaleido’s products fit together.", Icon: LuCompass },
      { label: "Architecture", href: "/docs/architecture", description: "Understand the protocol’s design.", Icon: LuNetwork },
      { label: "Deployments", href: "/docs/deployments", description: "Find networks and contract addresses.", Icon: LuMap },
      { label: "Fees", href: "/docs/fees", description: "See where protocol fees apply.", Icon: LuReceipt },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Docs", href: "/docs", description: "Browse the Kaleido documentation.", Icon: LuBookOpen },
      { label: "Getting started", href: "/docs/getting-started", description: "Set up a wallet and get started.", Icon: LuRocket },
      { label: "GitHub", href: "https://github.com/kaleidofinance/Kaleido-os", description: "Explore the open-source codebase.", Icon: LuGithub },
      { label: "X", href: "https://x.com/kaleido_finance", description: "Follow Kaleido product updates.", Icon: LuExternalLink },
    ],
  },
];
