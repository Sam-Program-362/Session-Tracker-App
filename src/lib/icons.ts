// Icons.
//
// Category icons are Lucide line icons, imported as components and bundled with
// the app, so they render offline (nothing is fetched at runtime) and all share
// one weight and one 24x24 grid.
//
// A category's `icon` field is a plain string that syncs untouched, and it
// holds either an icon name — e.g. "briefcase" — or, later on, an emoji. Values
// written by older versions were raw SVG path data; LEGACY_ICON_PATHS maps each
// of those to the icon that replaced it, so no stored record breaks.

import {
  BookOpen,
  Briefcase,
  Clock,
  Dumbbell,
  Lightbulb,
  ListChecks,
  Music,
  Palette,
} from "lucide-react";

/** The icons a category can wear. Keys are what gets stored. */
export const CATEGORY_ICONS = {
  briefcase: Briefcase,
  "book-open": BookOpen,
  palette: Palette,
  lightbulb: Lightbulb,
  clock: Clock,
  "list-checks": ListChecks,
  dumbbell: Dumbbell,
  music: Music,
} as const;

export type CategoryIconName = keyof typeof CATEGORY_ICONS;

/** The order the picker shows them in. */
export const CATEGORY_ICON_NAMES = [
  "briefcase",
  "book-open",
  "palette",
  "lightbulb",
  "clock",
  "list-checks",
  "dumbbell",
  "music",
] as const satisfies readonly CategoryIconName[];

/** What a brand new category starts with. */
export const DEFAULT_CATEGORY_ICON: CategoryIconName = "briefcase";

/** What an unrecognisable stored value falls back to. */
export const FALLBACK_CATEGORY_ICON: CategoryIconName = "clock";

/**
 * Every icon value older versions could have written, mapped to its
 * replacement. These are the exact strings that used to live in the icon
 * field, so an existing device keeps showing the right picture.
 */
const LEGACY_ICON_PATHS: Record<string, CategoryIconName> = {
  "M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20.923V4a2 2 0 012-2h12a2 2 0 012 2v16a2 2 0 01-2 2H7a2 2 0 01-2-2v-9":
    "briefcase",
  "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253":
    "book-open",
  "M11 4a2 2 0 114 0v7c0 1.104.896 2 2 2s2-.896 2-2v-7c0-2.206-1.794-4-4-4zm4 12a2 2 0 11-4 0m4-8a2 2 0 100-4 2 2 0 000 4zm-6 8a2 2 0 11-4 0 2 2 0 014 0zm6-4a2 2 0 100-4 2 2 0 000 4z":
    "palette",
  "M9.663 17h9.677M9 21h6m-3.5-19.5A4.5 4.5 0 0115.5 6a4.5 4.5 0 013.5 7.5c-.6.6-.9 1.1-1 1.8v.2H6v-.2c-.1-.7-.4-1.2-1-1.8A4.5 4.5 0 018.5 6a4.5 4.5 0 013-4.5z":
    "lightbulb",
  "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z": "clock",
  "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11":
    "list-checks",
};

export function isCategoryIconName(value: string): value is CategoryIconName {
  return Object.prototype.hasOwnProperty.call(CATEGORY_ICONS, value);
}

/** The icon an older stored value became, or null if it is not a legacy path. */
export function legacyCategoryIconName(value: string): CategoryIconName | null {
  return LEGACY_ICON_PATHS[value] ?? null;
}

/** An emoji is stored in the same icon field, behind this flag. */
const EMOJI_PREFIX = "emoji:";

export type ParsedCategoryIcon =
  | { kind: "icon"; name: CategoryIconName }
  | { kind: "emoji"; emoji: string };

/** The storable value for an emoji: "emoji:" followed by the emoji itself. */
export function emojiIconValue(emoji: string): string {
  return `${EMOJI_PREFIX}${emoji}`;
}

/**
 * Read a stored icon value.
 *
 * Unknown values (and a missing one) fall back to a clock rather than drawing
 * nothing, so a category can never be left without a picture.
 */
export function parseCategoryIcon(
  value: string | null | undefined
): ParsedCategoryIcon {
  const raw = (value ?? "").trim();

  if (raw.startsWith(EMOJI_PREFIX)) {
    const emoji = raw.slice(EMOJI_PREFIX.length).trim();
    if (emoji) return { kind: "emoji", emoji };
  }

  return {
    kind: "icon",
    name: isCategoryIconName(raw)
      ? raw
      : (legacyCategoryIconName(raw) ?? FALLBACK_CATEGORY_ICON),
  };
}

/**
 * The icon name a stored value resolves to, or null when it is an emoji.
 * Used to compare records (an emoji is nobody's built-in category).
 */
export function categoryIconName(
  value: string | null | undefined
): CategoryIconName | null {
  const parsed = parseCategoryIcon(value);
  return parsed.kind === "icon" ? parsed.name : null;
}

/** Split text the way a keyboard sees it: one grapheme per emoji. */
function graphemes(text: string): string[] {
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    return Array.from(
      new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text),
      (part) => part.segment
    );
  }
  return Array.from(text);
}

/**
 * Read what was typed into the emoji box.
 *
 * Returns the storable value when the text is exactly one emoji, and null
 * otherwise — so half-typed text and plain words are simply not accepted yet.
 */
export function toEmojiIconValue(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  if (/[0-9A-Za-z]/.test(text)) return null;
  const parts = graphemes(text);
  if (parts.length !== 1) return null;
  return emojiIconValue(parts[0]);
}

// ---------------------------------------------------------------------------
// Chrome icons — the buttons and labels around the category pictures. These
// are drawn from path data inside a 24x24 viewBox, exactly as before.
// ---------------------------------------------------------------------------

export const ICONS = {
  add: "M12 4v16m8-8H4",
  close: "M6 18L18 6M6 6l12 12",
  note: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 102.828 2.828L11.828 11H9v-2.828l8.586-8.586z",
  tasks: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11",
  clock: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  check: "M5 13l4 4L19 7",
} as const;

export type ChromeIconName = keyof typeof ICONS;
