/**
 * Why a control can't be used right now (round C2, e.g. "ใช้ไม่ได้ตอนเน็ตหลุด"), in the mockup's
 * grey style. `what` names the controls, joined as "A · B — reason".
 */
export function DisabledReason({
  what,
  reason,
  className = "",
}: {
  what?: string[];
  reason: string;
  className?: string;
}) {
  const text = what && what.length > 0 ? `${what.join(" · ")} — ${reason}` : reason;
  return (
    <p
      className={`rounded-lg bg-muted px-2 py-1.5 text-center text-xs font-medium text-muted-foreground ${className}`}
    >
      {text}
    </p>
  );
}
