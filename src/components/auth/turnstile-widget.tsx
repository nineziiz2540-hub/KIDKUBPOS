"use client";
import { forwardRef } from "react";
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
