import { initials } from "@/lib/format";

const SIZES = { xs: "h-6 w-6 text-[10px]", sm: "h-8 w-8 text-xs", md: "h-10 w-10 text-sm", lg: "h-14 w-14 text-lg", xl: "h-24 w-24 text-3xl" };

export function Avatar({
  name,
  color = "#2D8CFF",
  size = "md",
  online,
  className = "",
}: {
  name: string;
  color?: string;
  size?: keyof typeof SIZES;
  online?: boolean;
  className?: string;
}) {
  return (
    <span className={`relative inline-flex shrink-0 ${className}`}>
      <span
        className={`grid place-items-center rounded-full font-semibold text-white ${SIZES[size]}`}
        style={{ backgroundColor: color }}
        title={name}
      >
        {initials(name)}
      </span>
      {online !== undefined && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface ${
            online ? "bg-zoom-green" : "bg-ink-300"
          }`}
        />
      )}
    </span>
  );
}
