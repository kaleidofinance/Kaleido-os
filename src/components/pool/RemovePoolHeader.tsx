import BaseHeader from "../shared/BaseHeader";
import MktIcons from "../market/MktIcons";

const RemovePoolHeader = () => {
  return (
    <BaseHeader
      title="Remove Liquidity"
      description="Withdraw your liquidity from Abstract Chain's AMM pools and claim your earned rewards."
      showStats={false}
      backgroundImage="/banners/poolheaderbg.png"
      backgroundOverlay={false}
    >
      {/* Icons - Hidden on mobile */}
      <div className="relative mt-6 hidden lg:ml-6 lg:mt-0 lg:block">
        <MktIcons />
      </div>
    </BaseHeader>
  );
};

export default RemovePoolHeader;
