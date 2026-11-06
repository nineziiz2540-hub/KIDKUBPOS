-- Round C2, phase two.
-- APPLY ONLY AFTER THE C2 DEPLOY IS LIVE: until then the deployed app still calls order_create.
-- createOrder now calls order_record (20261105120000_order_record.sql), which covers every
-- order_create behaviour with p_offline = null.
drop function public.order_create(uuid, uuid, uuid, jsonb, jsonb, uuid, int, jsonb);
