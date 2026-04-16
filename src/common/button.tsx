import React from "react";

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
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
  const variantClasses = {
    primary:
      "flex items-center justify-center rounded-lg h-12 px-6 bg-[#38e07b] text-[#111714] text-base font-bold tracking-wide hover:bg-green-400 transition-colors",
    secondary: "bg-[#2a2a2a] hover:bg-[#2a2a2a] text-white focus:ring-gray-500",
    outline:
      "bg-transparent border-[rgba(34,197,94,0.3)] text-[#22c55e] border text-[15px] cursor-pointer rounded-[8px] hover:bg-[rgba(34,197,94,0.1)] focus:ring-green-500",
    ghost: "text-blue-600 hover:bg-blue-50 focus:ring-blue-500",
    danger: "bg-red-600 hover:bg-red-700 text-white focus:ring-red-500",
  };

  const sizeClasses = {
    sm: "px-3 py-1.5 text-sm",
    md: "px-4 py-2 text-base",
    lg: "px-6 py-3 text-lg",
  };

  const widthClass = fullWidth ? "w-full" : "";

  const buttonClasses = [
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
      {startIcon && <span className="mr-2">{startIcon}</span>}

      <span>{children}</span>

      {endIcon && <span className="ml-2">{endIcon}</span>}
    </button>
  );
};

export default Button;
