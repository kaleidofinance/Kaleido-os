import React from "react";

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "neon";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  loading?: boolean;
  fullWidth?: boolean;
  startIcon?: React.ReactNode;
  endIcon?: React.ReactNode;
}

const Button: React.FC<ButtonProps> = ({
  variant = "primary",
  size = "md",
  className = "",
  children,
  onClick,
  disabled = false,
  type = "button",
  loading = false,
  fullWidth = false,
  startIcon,
  endIcon,
}) => {
  const baseClasses = "flex items-center justify-center rounded-lg h-12 px-6 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed";

  const variantClasses = {
    primary: "bg-[#00ff99] text-black text-base font-bold tracking-wide hover:bg-[#2fa05e]",
    secondary: "bg-black hover:bg-[#36b169] text-white focus:ring-[#00ff99]",
    outline: "bg-transparent border-[#00ff99]/30 text-[#00ff99] border text-[15px] hover:bg-[#00ff99]/10 focus:ring-[#00ff99]",
    ghost: "text-[#00ff99] hover:bg-black focus:ring-[#00ff99]",
    danger: "bg-red-600 hover:bg-red-700 text-white focus:ring-red-500",
    neon: "bg-[#00ff99] text-black font-black hover:shadow-[0_0_20px_#00ff99]",
  };

  const sizeClasses = {
    sm: "h-9 px-3 text-xs",
    md: "h-12 px-6 text-base",
    lg: "h-14 px-8 text-lg",
  };

  const widthClass = fullWidth ? "w-full" : "";

  const buttonClasses = [
    baseClasses,
    variantClasses[variant],
    sizeClasses[size],
    widthClass,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type={type}
      className={buttonClasses}
      onClick={onClick}
      disabled={disabled || loading}
      aria-disabled={disabled || loading}
    >
      {loading ? (
        <svg className="animate-spin h-4 w-4 mr-2 text-current" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      ) : (
        startIcon && <span className="mr-2">{startIcon}</span>
      )}

      <span>{children}</span>

      {!loading && endIcon && <span className="ml-2">{endIcon}</span>}
    </button>
  );
};

export default Button;
