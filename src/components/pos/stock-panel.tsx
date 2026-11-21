"use client";
// The POS "สต๊อก" panel (round D2a, Task 11): three 64 px buttons — "บันทึกของเสีย", "รับของเข้า" and
// "ปิด/เปิดขายเมนู". Offline the buttons are faded and untappable with "ใช้ไม่ได้ตอนเน็ตหลุด" (they all need
// the server). "รับของเข้า" is Task 12's: it shows only when the POS hands in `onReceive`.
import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import type { StockCatalog } from "@/lib/stock/stock-core";
import type { PauseResult } from "@/lib/stock/pos-states";
import type { WasteMaterial } from "@/lib/stock/waste-input";
import type { ModifierWithOptions, PosCategory, PosProduct } from "@/types/app";
import { DisabledReason } from "./disabled-reason";
import { PauseList } from "./pause-list";
import { WasteFlow } from "./waste-flow";

export const STOCK_OFFLINE = "ใช้ไม่ได้ตอนเน็ตหลุด";

type Props = {
  online: boolean;
  products: PosProduct[];
  categories: PosCategory[];
  catalog: StockCatalog;
  materials: WasteMaterial[];
  modifiersFor: (productId: string) => ModifierWithOptions[];
  productsWithOptions: Set<string>;
  pausedIds: Set<string>;
  /** The bounded pause call of the POS (toast and fresh levels included). */
  onChangePause: (product: PosProduct, paused: boolean) => Promise<PauseResult>;
  /** Fresh levels (the heartbeat's checkNow) after a waste or an undo. */
  onChanged: () => void;
  /** Task 12 fills this; absent = no "รับของเข้า" button. */
  onReceive?: () => void;
  onClose: () => void;
};

const BIG = "h-16 w-full rounded-xl px-4 text-xl font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40";

export function StockPanel(props: Props) {
  const { online, onClose, onReceive } = props;
  const [view, setView] = useState<"home" | "waste" | "pause">("home");
  const title = view === "waste" ? "บันทึกของเสีย" : view === "pause" ? "ปิด/เปิดขายเมนู" : "สต๊อก";

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Popup
          className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-start sm:p-4 sm:pt-[4dvh]"
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <div className="flex h-[92dvh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:h-[88dvh] sm:max-w-[860px] sm:rounded-2xl">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 pb-3 pt-4 sm:px-5">
              <Dialog.Title className="text-xl font-bold leading-tight text-sidebar">{title}</Dialog.Title>
              <div className="flex gap-2">
                {view !== "home" && (
                  <button
                    type="button"
                    onClick={() => setView("home")}
                    className="h-12 rounded-lg border border-input bg-white px-4 text-base font-semibold text-sidebar hover:bg-muted"
                  >
                    สต๊อก
                  </button>
                )}
                <Dialog.Close className="h-12 rounded-lg border border-input bg-white px-4 text-base font-semibold text-sidebar hover:bg-muted">
                  ปิด
                </Dialog.Close>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col px-4 py-3 sm:px-5">
              {view === "home" && (
                <div className="space-y-3">
                  <button type="button" disabled={!online} onClick={() => setView("waste")} className={`${BIG} bg-accent text-white hover:bg-accent/90`}>
                    บันทึกของเสีย
                  </button>
                  {onReceive && (
                    <button type="button" disabled={!online} onClick={onReceive} className={`${BIG} border-2 border-input bg-white text-sidebar hover:bg-muted`}>
                      รับของเข้า
                    </button>
                  )}
                  <button type="button" disabled={!online} onClick={() => setView("pause")} className={`${BIG} border-2 border-input bg-white text-sidebar hover:bg-muted`}>
                    ปิด/เปิดขายเมนู
                  </button>
                  {!online && (
                    <DisabledReason
                      what={["บันทึกของเสีย", ...(onReceive ? ["รับของเข้า"] : []), "ปิด/เปิดขายเมนู"]}
                      reason={STOCK_OFFLINE}
                    />
                  )}
                </div>
              )}
              {view === "waste" && (
                <WasteFlow
                  products={props.products}
                  categories={props.categories}
                  catalog={props.catalog}
                  materials={props.materials}
                  modifiersFor={props.modifiersFor}
                  productsWithOptions={props.productsWithOptions}
                  onChanged={props.onChanged}
                  onDone={onClose}
                />
              )}
              {view === "pause" && (
                <PauseList products={props.products} pausedIds={props.pausedIds} onChange={props.onChangePause} />
              )}
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
