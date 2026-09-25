"use client";
import { MAX_NOTE_LENGTH, QUICK_NOTES, hasQuickNote, toggleQuickNote } from "@/lib/notes";

type Props = { value: string; onChange: (value: string) => void };

/** Quick-note chips + free text, shared by the modifier modal and the cart's note modal. */
export function NoteEditor({ value, onChange }: Props) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {QUICK_NOTES.map((chip) => {
          const active = hasQuickNote(value, chip);
          return (
            <button
              key={chip}
              type="button"
              onClick={() => onChange(toggleQuickNote(value, chip).slice(0, MAX_NOTE_LENGTH))}
              className={`h-10 px-4 rounded-full border text-base font-medium transition-colors ${
                active
                  ? "border-accent bg-accent text-white"
                  : "border-input bg-white text-sidebar hover:border-accent hover:text-accent"
              }`}
            >
              {chip}
            </button>
          );
        })}
      </div>
      <input
        type="text"
        value={value}
        maxLength={MAX_NOTE_LENGTH}
        onChange={(e) => onChange(e.target.value)}
        placeholder="หรือพิมพ์หมายเหตุเอง"
        aria-label="หมายเหตุ"
        className="w-full h-12 rounded-lg border border-input px-3 text-base"
      />
    </div>
  );
}
