import { DashboardCardProps } from "@/constants/types";

const DashboardCard: React.FC<DashboardCardProps> = ({
  text,
  figure,
  extraCSS = "",
  icon,
}) => {
  return (
    <div
      className={`bg-black/20 backdrop-blur-xl rounded-xl border border-white/5 flex justify-between items-center min-w-0 w-full md:w-[48%] lg:w-[32%] px-5 py-8 sm:px-6 sm:py-10 shadow-[0_8px_32px_0_rgba(0,0,0,0.8)] hover:border-[#00ff99]/30 transition-all ${extraCSS}`}
      data-tour={text.replace(/\s+/g, "-").toLowerCase()}
    >
      <div className="min-w-0">
        <p className="pb-1 text-sm text-white/50 sm:text-xs">{text}</p>
        <h1 className="truncate text-2xl font-bold sm:text-xl">{figure}</h1>
      </div>
      <div className="flex items-center justify-center mr-1 shrink-0 bg-transparent sm:mr-2">
        {icon}
      </div>
    </div>
  );
};

export default DashboardCard;
