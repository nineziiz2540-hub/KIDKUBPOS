"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NoteEditor } from "./note-editor";

type Props = {
  itemName: string;
  initialNote: string;
  onSave: (note: string) => void;
  onCancel: () => void;
};

export function NoteModal({ itemName, initialNote, onSave, onCancel }: Props) {
  const [note, setNote] = useState(initialNote);
  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="bg-white rounded-xl p-5 w-full max-w-md space-y-4">
        <div>
          <h2 className="text-lg font-bold text-sidebar">หมายเหตุ</h2>
          <p className="text-base text-muted-foreground">{itemName}</p>
        </div>
        <NoteEditor value={note} onChange={setNote} />
        <div className="flex gap-2">
          {initialNote !== "" && (
            <Button
              type="button"
              onClick={() => onSave("")}
              className="h-12 px-4 bg-destructive/10 text-destructive text-base hover:bg-destructive/20"
            >
              ลบหมายเหตุ
            </Button>
          )}
          <Button
            type="button"
            onClick={onCancel}
            className="flex-1 h-12 bg-white border border-input text-sidebar text-base hover:bg-muted"
          >
            ยกเลิก
          </Button>
          <Button
            type="button"
            onClick={() => onSave(note)}
            className="flex-1 h-12 bg-accent hover:bg-accent/90 text-white text-base"
          >
            บันทึก
          </Button>
        </div>
      </div>
    </div>
  );
}
