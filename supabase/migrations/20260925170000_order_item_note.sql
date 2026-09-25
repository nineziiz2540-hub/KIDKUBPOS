-- Free-text per-cup note ("ไม่ใส่หลอด", "ใส่แก้วลูกค้า", …) captured at the POS. Null when none.
alter table public.order_items
  add column note text,
  add constraint order_items_note_length check (note is null or char_length(note) <= 200);
