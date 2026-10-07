import { CATEGORY_ICONS, parseCategoryIcon } from "@/lib/icons";

/**
 * The picture for a category, wherever one is shown: the session hub, the
 * running stopwatch, the logs, the pickers.
 *
 * `value` is the raw `icon` field as stored, so a new icon name, an older SVG
 * path value and a stored emoji all draw.
 */
export function CategoryIcon({
  value,
  className = "h-5 w-5",
  strokeWidth = 1.8,
}: {
  value: string | null | undefined;
  className?: string;
  strokeWidth?: number;
}) {
  const parsed = parseCategoryIcon(value);

  if (parsed.kind === "emoji") {
    return (
      <span
        aria-hidden="true"
        className={`${className} flex select-none items-center justify-center leading-none`}
      >
        {parsed.emoji}
      </span>
    );
  }

  const Icon = CATEGORY_ICONS[parsed.name];
  return <Icon aria-hidden="true" className={className} strokeWidth={strokeWidth} />;
}
