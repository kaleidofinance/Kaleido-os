import React from "react";
import { LucideIcon } from "lucide-react";

interface PageBannerProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  gradient?: string;
  children?: React.ReactNode;
}

export default function PageBanner({
  title,
  description,
  icon: Icon,
  gradient = "from-[#1a2f1a] via-[#0d1b0d] to-[#0a140a]",
  children,
}: PageBannerProps) {
  return (
    <div
      className={`relative overflow-hidden bg-gradient-to-br ${gradient} py-16 px-6 border-b border-[#00ff99]/20`}
    >
      {/* Animated background glows */}
      <div className="absolute inset-0 opacity-5">
        <div className="absolute top-10 left-10 w-32 h-32 bg-[#00ff99] rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute top-20 right-20 w-24 h-24 bg-[#00ff99] rounded-full blur-2xl animate-pulse delay-700"></div>
        <div className="absolute bottom-10 left-1/3 w-20 h-20 bg-[#00ff99] rounded-full blur-2xl animate-pulse delay-1000"></div>
      </div>

      {/* Enhanced background pattern */}
      <div
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%2300ff99' fill-opacity='0.3'%3E%3Ccircle cx='30' cy='30' r='2'/%3E%3Ccircle cx='15' cy='15' r='1'/%3E%3Ccircle cx='45' cy='15' r='1'/%3E%3Ccircle cx='15' cy='45' r='1'/%3E%3Ccircle cx='45' cy='45' r='1'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }}
      />

      {/* Hexagon pattern overlay for variety */}
      <div
        className="absolute inset-0 opacity-5"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='80' height='80' viewBox='0 0 80 80' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%2300ff99' fill-opacity='0.2'%3E%3Cpath d='M40 20l15 8.66v17.32L40 55 25 46.34V29.02L40 20z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          backgroundSize: "80px 80px",
        }}
      />

      <div className="relative max-w-7xl mx-auto text-center">
        <div className="flex flex-col items-center justify-center mb-6">
          {Icon && (
            <div className="w-20 h-20 bg-gradient-to-br from-[#00ff99]/20 to-[#00ff99]/20 backdrop-blur-sm border border-[#00ff99]/30 rounded-2xl flex items-center justify-center mb-4 shadow-2xl shadow-[#00ff99]/20">
              <Icon className="w-10 h-10 text-[#00ff99]" />
            </div>
          )}
          <h1 className="text-4xl md:text-6xl font-bold text-white tracking-tight">
            {title}
          </h1>
        </div>

        {description && (
          <p className="text-xl text-gray-300 mb-8 max-w-2xl mx-auto leading-relaxed">
            {description}
          </p>
        )}

        {children}
      </div>
    </div>
  );
}
