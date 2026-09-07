import Link from "next/link";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "orange";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-zoom-blue text-white hover:bg-zoom-blue-dark",
  secondary: "border border-line bg-surface text-body hover:bg-surface-3",
  ghost: "text-body hover:bg-surface-3",
  danger: "bg-zoom-red text-white hover:brightness-110",
  orange: "bg-zoom-orange text-white hover:brightness-105",
};

const SIZES = { sm: "h-8 px-3 text-xs", md: "h-10 px-4 text-sm", lg: "h-11 px-5 text-sm" };

interface Common {
  variant?: Variant;
  size?: keyof typeof SIZES;
  className?: string;
  children: React.ReactNode;
}

function classes(variant: Variant, size: keyof typeof SIZES, className: string) {
  return `inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: Common & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={classes(variant, size, className)} />;
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className = "",
  href,
  children,
}: Common & { href: string }) {
  return (
    <Link href={href} className={classes(variant, size, className)}>
      {children}
    </Link>
  );
}
