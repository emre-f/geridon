import { useRef, useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";

import {
  addPaletteColor,
  isHexColor,
  minPaletteColors,
  removePaletteColor,
  updatePaletteColor,
} from "@/lib/color-palette";
import { useDebouncedCommit } from "@/hooks/use-debounced-commit";
import { swatchControlClass } from "@/components/color-picker/styles";

const commitDelayMs = 400;

export function EditablePaletteSwatch({
  index,
  color,
  canDelete,
}: {
  index: number;
  color: string;
  canDelete: boolean;
}) {
  const [draftColor, setDraftColor] = useState<string | null>(null);
  const { schedule, flush } = useDebouncedCommit<string>(
    (nextColor) => updatePaletteColor(index, nextColor),
    commitDelayMs,
  );
  const displayColor = draftColor ?? color;

  return (
    <div className="relative">
      <label className={swatchControlClass} title={`Edit saved color ${displayColor}`}>
        <span
          className="border-border size-5 rounded-sm border"
          style={{ backgroundColor: displayColor }}
          aria-hidden="true"
        />
        <input
          type="color"
          value={displayColor}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label={`Edit saved color ${index + 1}`}
          onChange={(event) => {
            if (isHexColor(event.target.value)) {
              setDraftColor(event.target.value.toLowerCase());
              schedule(event.target.value.toLowerCase());
            }
          }}
          onBlur={flush}
        />
      </label>
      {canDelete ? (
        <button
          type="button"
          className="bg-destructive absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full text-white shadow-xs transition-transform hover:scale-110"
          aria-label={`Delete saved color ${displayColor}`}
          title="Delete saved color"
          onClick={() => removePaletteColor(index)}
        >
          <XIcon className="size-2.5" />
        </button>
      ) : null}
    </div>
  );
}

export function AddPaletteSwatch({
  initialColor,
  onPicked,
}: {
  initialColor: string;
  onPicked: (color: string) => void;
}) {
  const [draftColor, setDraftColor] = useState<string | null>(null);
  const addedIndexRef = useRef<number | null>(null);
  const { schedule, flush } = useDebouncedCommit<string>((color) => {
    if (addedIndexRef.current == null) {
      addedIndexRef.current = addPaletteColor(color);
    } else {
      updatePaletteColor(addedIndexRef.current, color);
    }
    onPicked(color);
  }, commitDelayMs);

  return (
    <label
      className={`${swatchControlClass} border-dashed`}
      title="Add a new saved color"
    >
      {draftColor ? (
        <span
          className="border-border size-5 rounded-sm border"
          style={{ backgroundColor: draftColor }}
          aria-hidden="true"
        />
      ) : (
        <PlusIcon className="text-muted-foreground size-4" aria-hidden="true" />
      )}
      <input
        type="color"
        value={draftColor ?? initialColor}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        aria-label="Add a new saved color"
        onChange={(event) => {
          if (isHexColor(event.target.value)) {
            setDraftColor(event.target.value.toLowerCase());
            schedule(event.target.value.toLowerCase());
          }
        }}
        onBlur={() => {
          flush();
          addedIndexRef.current = null;
          setDraftColor(null);
        }}
      />
    </label>
  );
}

export { minPaletteColors };
