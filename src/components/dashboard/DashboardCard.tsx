import { DashboardCardProps } from '@/constants/types';

const DashboardCard: React.FC<DashboardCardProps> = ({ text, figure, extraCSS = "", icon }) => {
  return (
    <div className={`bg-black/20 backdrop-blur-xl rounded-xl border border-white/5 flex min-h-[132px] min-w-0 justify-between items-center gap-4 w-full sm:w-[48%] lg:w-[32%] px-4 py-7 sm:py-10 shadow-[0_8px_32px_0_rgba(0,0,0,0.8)] hover:border-[#00ff99]/30 transition-all ${extraCSS}`}
      data-tour={text.replace(/\s+/g, '-').toLowerCase()}
    >
      <div className="min-w-0">
        <p className="text-xs text-white/50 pb-1">{text}</p>
        <h1 className="break-words text-xl font-bold leading-tight">{figure}</h1>
      </div>
      <div className="mr-1 flex shrink-0 items-center justify-center bg-transparent sm:mr-2">
        {icon}
      </div>
    </div>
  );
};

export default DashboardCard;
