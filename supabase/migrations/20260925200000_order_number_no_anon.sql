-- generate_order_number is SECURITY DEFINER and was executable by PUBLIC/anon. Its tenant guard only
-- runs when auth.uid() is set, so an unauthenticated caller with the public anon key could call it
-- through the Data API for ANY tenant id and advance that shop's order_sequence (skipped bill
-- numbers; no data exposure). Its only caller is createOrder, running as the signed-in user, so
-- EXECUTE is limited to authenticated + service_role — same as next_queue_number.
revoke execute on function public.generate_order_number(uuid) from public, anon;
grant execute on function public.generate_order_number(uuid) to authenticated, service_role;
