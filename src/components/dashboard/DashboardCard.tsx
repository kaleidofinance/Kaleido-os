import { DashboardCardProps } from '@/constants/types';

const DashboardCard: React.FC<DashboardCardProps> = ({ text, figure, extraCSS = "", icon }) => {
  return (
    <div className={`bg-black/20 backdrop-blur-xl rounded-xl border border-white/5 flex justify-between items-center w-full sm:w-[48%] lg:w-[32%] px-4 py-10 shadow-[0_8px_32px_0_rgba(0,0,0,0.8)] hover:border-[#00ff99]/30 transition-all ${extraCSS}`}
      data-tour={text.replace(/\s+/g, '-').toLowerCase()}
    >
      <div>
        <p className="text-xs text-white/50 pb-1">{text}</p>
        <h1 className="text-xl font-bold">{figure}</h1>
      </div>
      <div className="flex items-center justify-center bg-transparent mr-2">
        {icon}
      </div>
    </div>
  );
};

export default DashboardCard;
