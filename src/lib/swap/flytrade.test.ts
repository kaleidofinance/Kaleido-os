import {
  flyTradeNetwork,
  flyTradeRouter,
  hasFlyTrade,
  isKnownFlyTradeRouter,
} from "./flytrade";

const check = (name: string, value: boolean) => {
  if (!value) throw new Error(`FAIL ${name}`);
  console.log(`  ok   ${name}`);
};

const ROUTER = "0x20f6ee51340adeed01a59b0e65cb3703f3dc860c";
check("BSC uses Fly's bsc network", flyTradeNetwork(56) === "bsc");
check("Arc uses Fly's arc network", flyTradeNetwork(5042) === "arc");
check("Robinhood uses Fly's outlaw network", flyTradeNetwork(4663) === "outlaw");
check("Elysium is fail-closed until Fly publishes support", !hasFlyTrade(99801));
check("the reviewed Fly router is pinned", flyTradeRouter(56) === ROUTER);
check("the router allow-list is case-insensitive", isKnownFlyTradeRouter(5042, ROUTER.toUpperCase()));
check("a router on the wrong chain is refused", !isKnownFlyTradeRouter(99801, ROUTER));
