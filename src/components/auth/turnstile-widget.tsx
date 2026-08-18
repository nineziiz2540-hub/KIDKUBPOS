"use client";
import { forwardRef } from "react";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";

type Props = {
  onSuccess: (token: string) => void;
  onExpireOrError: () => void;
};

export const TurnstileWidget = forwardRef<TurnstileInstance, Props>(function TurnstileWidget(
  { onSuccess, onExpireOrError },
  ref
) {
  return (
    <Turnstile
      ref={ref}
      siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""}
      onSuccess={onSuccess}
      onExpire={onExpireOrError}
      onError={onExpireOrError}
    />
  );
});
