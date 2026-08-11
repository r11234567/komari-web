type KomariBrandProps = {
  size?: "sm" | "md";
  className?: string;
};

const sizeClasses = {
  sm: "text-xl",
  md: "text-2xl",
};

export default function KomariBrand({
  size = "md",
  className = "",
}: KomariBrandProps) {
  return (
    <span
      className={`${sizeClasses[size]} whitespace-nowrap font-bold leading-none ${className}`}
      aria-label="Komari"
    >
      Komari
    </span>
  );
}
