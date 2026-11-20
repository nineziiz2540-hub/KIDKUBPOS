"use client";
// The POS option window (round D1, spec §8.1): rows in the order the customer says them — bean or
// matcha (house row + special row, one pick), ความหวาน, หวานด้วย, the menu's other options, then a
// folded "+ หมายเหตุ". Every row starts on its default, so a plain cup is menu → เพิ่มลงตะกร้า.
// Opened on a cart line it starts on that line's picks and saving replaces the line.
// The rules live in src/lib/stock/option-window.ts (pure, tested); this file only draws them.
import { Fragment, useId, useMemo, useState, type ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { formatPrice } from "@/lib/cash";
import type { StockCatalog } from "@/lib/stock/stock-core";
import {
  buildLine,
  footerText,
  initialWindowState,
  missingHint,
  missingRequired,
  modifierHint,
  optionRows,
  pickLevel,
  pickShot,
  pickSlot,
  pickSweetener,
  priceTag,
  shotRows,
  shownSweetener,
  sweetenerHint,
  sweetenerLocked,
  tapSpecial,
  toggleOption,
  type WindowState,
} from "@/lib/stock/option-window";
import type { CartItem, ModifierWithOptions, PosProduct } from "@/types/app";
import { NoteEditor } from "./note-editor";

type Props = {
  product: PosProduct;
  modifiers: ModifierWithOptions[];
  catalog: StockCatalog;
  /** The cart line being edited: the window opens on its picks and saving replaces it. */
  editing?: CartItem | null;
  /** The line to add (its cartItemKey is "" — the cart gives it one) or the edited line (its own key). */
  onSave: (item: CartItem) => void;
  onClose: () => void;
};

export function OptionWindow({ product, modifiers, catalog, editing = null, onSave, onClose }: Props) {
  const rows = useMemo(() => optionRows(product.id, catalog), [product.id, catalog]);
  const [state, setState] = useState<WindowState>(() =>
    initialWindowState(product.id, catalog, modifiers, editing ?? undefined)
  );
  const [note, setNote] = useState(editing?.note ?? "");
  const [noteOpen, setNoteOpen] = useState(false);
  const noteId = useId();

  const mode = editing ? "edit" : "add";
  const line = buildLine({
    product,
    modifiers,
    catalog,
    state,
    note,
    quantity: editing?.quantity ?? 1,
    key: editing?.cartItemKey ?? "",
    editing,
  });
  const missing = missingRequired(state, modifiers);
  // "ช็อตเพิ่มใช้เมล็ดร้าน" rows: only on a special cup with a ticked extra shot, under that option's row
  const shots = shotRows(rows, line);
  const locked = sweetenerLocked(state, rows);
  const sweetener = shownSweetener(state, rows);

  function handleSave() {
    if (missing.length > 0) return;
    onSave(line);
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-black/50 z-40" />
        <Dialog.Popup
          className="fixed inset-0 z-50 flex items-end sm:items-start justify-center p-0 sm:p-4 sm:pt-[4dvh]"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-[720px] h-[92dvh] sm:h-auto max-h-[92dvh] flex flex-col">
            {/* Header */}
            <div className="flex items-baseline justify-between gap-3 px-4 sm:px-5 pt-4 pb-3 border-b shrink-0">
              <Dialog.Title className="min-w-0 font-bold text-sidebar text-xl leading-tight">
                {product.name}
              </Dialog.Title>
              <p className="shrink-0 text-base text-muted-foreground tabular-nums">
                ฿{formatPrice(product.price)}
                {editing ? ` · ${editing.quantity} ชิ้น` : ""}
              </p>
            </div>

            {/* Rows */}
            <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-3 space-y-2.5">
              {rows.slots.map((slot) => (
                <Fragment key={slot.groupId}>
                  {slot.house.length > 0 && (
                    <ChipRow title={slot.houseTitle}>
                      {slot.house.map((c) => (
                        <ChoiceChip
                          key={c.id}
                          label={c.label}
                          price={priceTag(c.priceDelta)}
                          selected={state.slots[slot.groupId] === c.id}
                          onClick={() => setState((s) => pickSlot(s, slot.groupId, c.id))}
                        />
                      ))}
                    </ChipRow>
                  )}
                  {slot.special.length > 0 && (
                    <ChipRow title={slot.specialTitle}>
                      {slot.special.map((c) => {
                        const selected = state.slots[slot.groupId] === c.id;
                        return (
                          <ChoiceChip
                            key={c.id}
                            label={c.label}
                            price={priceTag(c.priceDelta)}
                            special
                            selected={selected}
                            // tap again = ×2 (one more dose), a third tap = ×1
                            count={selected && state.counts[slot.groupId] === 2 ? 2 : null}
                            onClick={() => setState((s) => tapSpecial(s, slot.groupId, c.id))}
                          />
                        );
                      })}
                    </ChipRow>
                  )}
                </Fragment>
              ))}

              {rows.sweetness && (
                <ChipRow title="ความหวาน">
                  {rows.sweetness.levels.map((l) => (
                    <ChoiceChip
                      key={l.id}
                      label={l.name}
                      price={null}
                      selected={state.levelId === l.id}
                      onClick={() => setState((s) => pickLevel(s, l.id))}
                    />
                  ))}
                </ChipRow>
              )}
              {rows.sweetness && rows.sweetness.sweeteners.length > 0 && (
                <ChipRow title="หวานด้วย" hint={sweetenerHint(state, rows)} reserveHint>
                  {rows.sweetness.sweeteners.map((c) => (
                    <ChoiceChip
                      key={c.id}
                      label={c.label}
                      price={null}
                      selected={sweetener === c.id}
                      disabled={locked}
                      onClick={() => setState((s) => pickSweetener(s, rows, c.id))}
                    />
                  ))}
                </ChipRow>
              )}

              {modifiers.map((modifier) => (
                <Fragment key={modifier.id}>
                  <ChipRow title={modifier.name} hint={modifierHint(modifier)}>
                    {modifier.options.map((option) => (
                      <ChoiceChip
                        key={option.id}
                        label={option.name}
                        price={priceTag(option.priceDelta)}
                        selected={(state.options[modifier.id] ?? []).includes(option.id)}
                        onClick={() => setState((s) => toggleOption(s, modifier, option.id))}
                      />
                    ))}
                  </ChipRow>
                  {shots
                    .filter((row) => row.afterModifierId === modifier.id)
                    .map((row) => (
                      <ChipRow key={`shot-${row.groupId}`} title={row.title}>
                        {row.chips.map((c) => (
                          <ChoiceChip
                            key={c.id}
                            label={c.label}
                            price={null}
                            selected={row.selectedId === c.id}
                            onClick={() => setState((s) => pickShot(s, row.groupId, c.id))}
                          />
                        ))}
                      </ChipRow>
                    ))}
                </Fragment>
              ))}

              <div>
                <button
                  type="button"
                  onClick={() => setNoteOpen((open) => !open)}
                  aria-expanded={noteOpen}
                  aria-controls={noteId}
                  className="inline-flex max-w-full items-center h-12 px-4 rounded-lg border border-input bg-white text-base font-semibold text-sidebar hover:border-accent hover:text-accent transition-colors"
                >
                  <span className="truncate">
                    {noteOpen
                      ? "− หมายเหตุ (ไม่บังคับ)"
                      : note.trim() === ""
                        ? "+ หมายเหตุ"
                        : `หมายเหตุ: ${note.trim()}`}
                  </span>
                </button>
                <div id={noteId} hidden={!noteOpen} className="mt-2">
                  <NoteEditor value={note} onChange={setNote} />
                </div>
              </div>
            </div>

            {/* Footer — always visible */}
            <div className="px-4 sm:px-5 py-3 border-t shrink-0 space-y-2">
              {missing.length > 0 && (
                <p className="text-base font-medium text-sidebar">{missingHint(missing)}</p>
              )}
              <div className="flex gap-3">
                <Dialog.Close className="w-28 sm:w-32 shrink-0 inline-flex items-center justify-center h-14 rounded-lg border border-input bg-white px-3 text-base font-semibold text-sidebar hover:bg-muted transition-colors">
                  ยกเลิก
                </Dialog.Close>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={missing.length > 0}
                  className={`flex-1 h-14 rounded-lg px-3 text-lg font-bold text-white tabular-nums transition-colors ${
                    missing.length > 0
                      ? "bg-accent/40 cursor-not-allowed"
                      : "bg-accent hover:bg-accent/90 active:scale-[0.98]"
                  }`}
                >
                  {footerText(mode, line)}
                </button>
              </div>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * A row: its words on the left (above on a phone), chips 4 across (one column on a phone).
 * `reserveHint` keeps the hint's line even when it is empty, so the chips never move when it comes
 * and goes (on a phone the words sit above the chips).
 */
function ChipRow({
  title,
  hint = null,
  reserveHint = false,
  children,
}: {
  title: string;
  hint?: string | null;
  reserveHint?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="sm:grid sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
      <div className="mb-1.5 sm:mb-0 sm:min-h-14 flex flex-col justify-center">
        <p className="text-base font-semibold text-sidebar leading-tight">{title}</p>
        {(hint !== null || reserveHint) && (
          <p className="text-sm text-muted-foreground leading-tight mt-0.5" aria-hidden={hint === null ? true : undefined}>
            {hint ?? "\u00a0"}
          </p>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">{children}</div>
    </div>
  );
}

/**
 * 56 px tall, 18 px text. Selected = solid accent, white text and a corner ✓ (seen from arm's length). A
 * special bean/matcha has an accent frame and an accent "+20"; doubled it reads "เคนยา +20 ×2". Disabled =
 * faded and untappable, never hidden.
 */
function ChoiceChip({
  label,
  price,
  selected,
  count = null,
  disabled = false,
  special = false,
  onClick,
}: {
  label: string;
  price: string | null;
  selected: boolean;
  /** 2 = a doubled special: "×2" after the price, part of the button's accessible name */
  count?: 2 | null;
  disabled?: boolean;
  special?: boolean;
  onClick: () => void;
}) {
  const look = selected
    ? "border-accent bg-accent text-white"
    : disabled
      ? "border-input bg-white text-sidebar opacity-40 cursor-not-allowed"
      : special
        ? "border-accent bg-white text-sidebar hover:bg-accent/5"
        : "border-input bg-white text-sidebar hover:border-accent";
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      // flex-wrap: when the name and its price don't fit on one line, the price drops under the
      // name as a whole instead of the name being split mid-word ("เพิ่ม/ช็อต").
      className={`relative min-h-14 w-full rounded-lg border-2 px-2 py-1 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 text-center text-lg font-semibold leading-tight transition-colors ${
        disabled ? "" : "active:scale-[0.98]"
      } ${look}`}
    >
      {/* The ✓ sits in the corner so a picked chip's words take the same width as an unpicked one. */}
      {selected && (
        <span aria-hidden="true" className="absolute top-0.5 left-1.5 text-sm leading-none">
          ✓
        </span>
      )}
      <span className="min-w-0 break-words">{label}</span>
      {(price || count === 2) && (
        <span className={`shrink-0 whitespace-nowrap tabular-nums ${selected ? "text-white" : "text-accent"}`}>
          {[price, count === 2 ? "×2" : null].filter((w) => w !== null).join(" ")}
        </span>
      )}
    </button>
  );
}
