import { DashboardCardProps } from "@/constants/types";

const DashboardCard: React.FC<DashboardCardProps> = ({
  text,
  figure,
  extraCSS = "",
  icon,
}) => {
  return (
    <div
      className={`flex w-full min-w-0 items-center justify-between rounded-xl border border-edge bg-surface px-5 py-6 transition-colors hover:border-edge-strong sm:px-6 sm:py-7 md:w-[48%] lg:w-[32%] ${extraCSS}`}
      data-tour={text.replace(/\s+/g, "-").toLowerCase()}
    >
      <div className="min-w-0">
        <p className="pb-2 text-[11px] uppercase tracking-[0.08em] text-content-muted">
          {text}
        </p>
        <h1 className="truncate font-mono text-2xl tabular-nums tracking-tight text-content sm:text-xl">
          {figure}
        </h1>
      </div>
      <div className="ml-4 flex shrink-0 items-center justify-center opacity-80">
        {icon}
      </div>
    </div>
  );
};

export default DashboardCard;
