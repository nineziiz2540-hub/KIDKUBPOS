"use client";
import { forwardRef, useEffect } from "react";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";

type Props = {
  onSuccess: (token: string) => void;
  onExpire: () => void;
  onError: () => void;
};

export const TurnstileWidget = forwardRef<TurnstileInstance, Props>(function TurnstileWidget(
  { onSuccess, onExpire, onError },
  ref
) {
  // @marsidev/react-turnstile tracks Cloudflare's script-load state as a page-load-scoped
  // singleton (window.turnstile plus a one-time "script ready" callback). That assumption
  // breaks across a Next.js client-side/soft navigation that remounts this widget without a
  // full page reload (e.g. logout redirecting back to /login, or a session-expiry redirect
  // triggered by clicking a Link elsewhere in the app): window.turnstile is already set from
  // the earlier mount, so the library's own ready-signal never fires again for the new
  // instance, and the widget renders as an empty, permanently unclickable shell. If we detect
  // that on mount, force one real reload to land back on the known-good fresh-script-load path.
  useEffect(() => {
    if (window.turnstile) {
      window.location.reload();
    }
  }, []);

  return (
    <Turnstile
      ref={ref}
      siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""}
      onSuccess={onSuccess}
      onExpire={onExpire}
      onError={onError}
      // onError above only covers the widget's own error-callback (a rendered challenge that
      // failed). It does NOT fire if Cloudflare's script itself never loads (blocked network,
      // ad-blocker, missing/invalid site key) — that's a separate failure channel the underlying
      // script tag's onerror handler catches, wired here so both paths reach the same handler.
      scriptOptions={{ onError }}
    />
  );
});
