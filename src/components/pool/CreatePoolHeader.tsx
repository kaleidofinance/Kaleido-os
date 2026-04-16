import BaseHeader from "../shared/BaseHeader";
import MktIcons from "../market/MktIcons";

const CreatePoolHeader = () => {
  return (
    <BaseHeader
      title="Create Pool"
      description="Create new pool position and earn trading fees plus additional rewards."
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

export default CreatePoolHeader;
