"use client";
// The one question a "หมด?" or "ปิดขาย" tile (or a "หมด?" chip in the option window) asks before it
// goes on (round D2a, spec §7.6). It never refuses a sale: "ยังมีของ ขายต่อ" and "ขายแก้วนี้" always
// go on with one tap. A base-ui Dialog, so opened from the option window it nests above it.
import { useRef, useState, type ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import type { PauseResult } from "@/lib/stock/pos-states";
import { DisabledReason } from "./disabled-reason";

const OFFLINE_REOPEN = "เปิดขายได้เมื่อต่อเน็ต";
const OFFLINE_PAUSE = "ปิดขายได้เมื่อต่อเน็ต";

type Props = { menuName: string; onCancel: () => void } & (
  | {
      kind: "out";
      materialName: string;
      /** "ยังมีของ ขายต่อ": the caller stops asking, flags, and goes on as a normal tap. */
      onSell: () => void;
      /** The tile's "ไม่มีแล้ว ปิดขาย"; absent for a chip in the option window. */
      pause?: { run: () => Promise<PauseResult>; disabledReason: string | null };
    }
  | {
      kind: "paused";
      online: boolean;
      /** "เปิดขายแล้วสั่ง": on success the caller closes this and goes on as a normal tap. */
      onReopen: () => Promise<PauseResult>;
      /** "ขายแก้วนี้": goes on without reopening (D2-8). */
      onSellOnce: () => void;
    }
);

const BUTTON = "h-14 w-full rounded-xl px-3 text-lg font-semibold transition-colors disabled:cursor-not-allowed";
const PRIMARY = `${BUTTON} bg-accent text-white hover:bg-accent/90 active:scale-[0.98] disabled:bg-accent/40`;
const SECONDARY = `${BUTTON} border-2 border-input bg-white text-sidebar hover:bg-muted disabled:text-muted-foreground`;

export function StockStateDialog(props: Props) {
  const { menuName, onCancel } = props;
  const [pending, setPending] = useState<"pause" | "reopen" | null>(null);
  const [pauseError, setPauseError] = useState<string | null>(null);
  // Reopening failed while online: the dialog becomes the offline one (R-D2a-22), never a dead end.
  const [reopenFailed, setReopenFailed] = useState<string | null>(null);
  // One action per dialog, and one call at a time: a fast double tap must not add the cup twice.
  const doneRef = useRef(false);
  const busyRef = useRef(false);

  function once(action: () => void) {
    if (doneRef.current || busyRef.current) return;
    doneRef.current = true;
    action();
  }

  /**
   * Runs the pause/reopen call. The caller bounds it (settlePauseCall, PAUSE_DEADLINE_MS), so the
   * buttons are off for a few seconds at most. On success the caller has already closed the dialog;
   * a pause with no answer is closed by the caller too, with a toast.
   */
  async function run(kind: "pause" | "reopen", call: () => Promise<PauseResult>, onFail: (message: string) => void) {
    if (doneRef.current || busyRef.current) return;
    busyRef.current = true;
    setPending(kind);
    let res: PauseResult;
    try {
      res = await call();
    } catch {
      res = { offline: true };
    }
    busyRef.current = false;
    setPending(null);
    if ("ok" in res) doneRef.current = true;
    else onFail("error" in res ? res.error : kind === "pause" ? OFFLINE_PAUSE : OFFLINE_REOPEN);
  }

  function cancel() {
    if (!busyRef.current) onCancel();
  }

  let title: string;
  let body: string | null;
  let buttons: ReactNode;
  if (props.kind === "out") {
    const { pause } = props;
    title = `${menuName}: ระบบคิดว่า${props.materialName}หมด`;
    body = "ยังมีของอยู่?";
    buttons = (
      <>
        <button type="button" className={PRIMARY} disabled={pending !== null} onClick={() => once(props.onSell)}>
          ยังมีของ ขายต่อ
        </button>
        {pause && (
          <div className="space-y-1">
            <button
              type="button"
              className={SECONDARY}
              disabled={pending !== null || pause.disabledReason !== null}
              onClick={() => {
                setPauseError(null);
                void run("pause", pause.run, setPauseError);
              }}
            >
              {pending === "pause" ? "กำลังปิดขาย…" : "ไม่มีแล้ว ปิดขาย"}
            </button>
            {pause.disabledReason !== null && <DisabledReason reason={pause.disabledReason} />}
          </div>
        )}
      </>
    );
  } else {
    const offlineBody = reopenFailed ?? (props.online ? null : OFFLINE_REOPEN);
    const { onReopen, onSellOnce } = props;
    title = `${menuName} ปิดขายอยู่`;
    body = offlineBody;
    buttons =
      offlineBody === null ? (
        <button type="button" className={PRIMARY} disabled={pending !== null} onClick={() => void run("reopen", onReopen, setReopenFailed)}>
          {pending === "reopen" ? "กำลังเปิดขาย…" : "เปิดขายแล้วสั่ง"}
        </button>
      ) : (
        <button type="button" className={PRIMARY} onClick={() => once(onSellOnce)}>
          ขายแก้วนี้
        </button>
      );
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) cancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[70] bg-black/50" />
        <Dialog.Popup
          className="fixed inset-0 z-[80] flex items-center justify-center p-4"
          onClick={(e) => {
            // the popup fills the screen to centre its box: a tap on the empty space around it cancels
            if (e.target === e.currentTarget) cancel();
          }}
        >
          <div className="w-full max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-xl sm:p-6">
            <div className="space-y-1.5 text-center">
              <Dialog.Title className="text-xl font-bold leading-snug text-sidebar">{title}</Dialog.Title>
              {body !== null && <Dialog.Description className="text-lg text-sidebar">{body}</Dialog.Description>}
            </div>
            {pauseError !== null && (
              <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-center text-base font-medium text-destructive">
                {pauseError}
              </p>
            )}
            <div className="space-y-2">
              {buttons}
              <button type="button" className={SECONDARY} disabled={pending !== null} onClick={cancel}>
                ยกเลิก
              </button>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
