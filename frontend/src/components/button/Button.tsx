import React, { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonProps = {
  accentColor: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  variant?: 'filled' | 'icon';
} & ButtonHTMLAttributes<HTMLButtonElement>;

export const Button: React.FC<ButtonProps> = ({
  accentColor,
  children,
  className,
  disabled,
  variant = 'filled',
  ...allProps
}) => {
  const buttonStyle = variant === 'icon' 
    ? `bg-white text-${accentColor}-500 border border-gray-300 dark:bg-gray-900 dark:border-gray-800`
    : `bg-${accentColor}-500 text-white`;

  return (
    <button
      className={`flex flex-row ${
        disabled ? "pointer-events-none opacity-50" : ""
      } text-sm justify-center items-center ${buttonStyle} px-3 py-1 rounded-md ${className}`}
      {...allProps}
    >
      {children}
    </button>
  );
};
