"use client";

type Props = {
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** In-app confirm for the iPad (the browser's confirm() looks foreign and is easy to mis-tap). */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = "ยกเลิก",
  destructive = false,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="bg-white rounded-xl p-6 w-full max-w-sm space-y-4 text-center"
      >
        <h2 id="confirm-dialog-title" className="text-lg font-bold text-sidebar">
          {title}
        </h2>
        {body && <p className="text-base text-muted-foreground">{body}</p>}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-12 rounded-xl border border-input bg-white text-base font-semibold text-sidebar hover:bg-muted"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`h-12 rounded-xl text-base font-semibold text-white ${
              destructive ? "bg-destructive hover:bg-destructive/90" : "bg-accent hover:bg-accent/90"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
