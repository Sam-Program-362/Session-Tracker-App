import type { ButtonHTMLAttributes } from "react";

type Variant = "default" | "ghost";

interface CapsuleButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: "sm" | "md" | "lg";
  variant?: Variant;
}

export function CapsuleButton({
  size = "md",
  variant = "default",
  className = "",
  children,
  ...props
}: CapsuleButtonProps) {
  const sizeClasses = {
    sm: "px-4 py-2 text-sm",
    md: "px-5 py-2.5 text-sm",
    lg: "px-6 py-3 text-base",
  }[size];

  const variantClasses = variant === "ghost"
    ? "bg-transparent border border-border/60 text-foreground/80 hover:text-foreground hover:bg-border/10"
    : "bg-primary text-white shadow-sm hover:bg-primary-hover";

  return (
    <button
      type="button"
      className={`
        capsule-button
        inline-flex
        items-center
        justify-center
        gap-2
        rounded-full
        font-inter
        font-semibold
        no-underline
        transition
        active:scale-[0.96]
        shadow-sm
        ${sizeClasses}
        ${variantClasses}
        ${className}
      `.trim()}
      {...props}
    >
      {children}
    </button>
  );
}
