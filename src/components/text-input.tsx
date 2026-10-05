import { useId } from "react";
import type { ChangeEventHandler } from "react";

interface TextInputProps {
  label: string;
  value?: string;
  onChange?: ChangeEventHandler<HTMLInputElement>;
  placeholder?: string;
  type?: "text" | "color";
  color?: string;
  onColorChange?: ChangeEventHandler<HTMLInputElement>;
  autoFocus?: boolean;
}

export function TextInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  color,
  onColorChange,
  autoFocus = false,
}: TextInputProps) {
  const generatedId = useId();
  const inputId = `stt-text-input-${generatedId.replace(/:/g, "")}`;
  const labelId = `${inputId}-label`;

  return (
    <div className="flex flex-col gap-1.5">
      <label
        id={labelId}
        className="text-sm font-medium text-foreground/80"
      >
        {label}
      </label>
      {type === "color" ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-foreground/60">Color</span>
          <input
            id={inputId}
            type="color"
            value={color}
            onChange={onColorChange}
            className="h-10 w-16 cursor-pointer rounded-xl border border-input/70 bg-white p-0.5 shadow-sm outline-none transition focus:border-input/80 focus:ring-2 focus:ring-ring/30"
          />
          <span className="text-xs text-foreground/60">
            or enter a hex
          </span>
          <input
            aria-label="Hex color code"
            value={color}
            onChange={onColorChange}
            placeholder="#24292E"
            className="flex-1 rounded-xl border border-input/70 bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-input/80 focus:ring-2 focus:ring-ring/30"
          />
        </div>
      ) : (
        <input
          id={inputId}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          type="text"
          autoFocus={autoFocus}
          className="w-full rounded-xl border border-input/70 bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-input/80 focus:ring-2 focus:ring-ring/30"
        />
      )}
    </div>
  );
}
