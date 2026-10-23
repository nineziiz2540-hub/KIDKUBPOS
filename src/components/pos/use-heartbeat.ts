"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { BUILD_VERSION } from "@/lib/build-version";
import {
  classifyHeartbeat,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  INITIAL_CONNECTIVITY,
  isNewVersion,
  nextConnectivity,
  type Connectivity,
} from "@/lib/connectivity";

/**
 * Asks /api/heartbeat on mount, every HEARTBEAT_INTERVAL_MS while the page is visible, as soon as
 * it becomes visible again (an iPad waking up), when the browser reports being back online, and
 * whenever checkNow() is called (a payment that got no answer). promptpayId is undefined until
 * the first answer, so the caller keeps the value its page was rendered with.
 */
export function useHeartbeat(): {
  connectivity: Connectivity;
  newVersionAvailable: boolean;
  promptpayId: string | null | undefined;
  checkNow: () => void;
} {
  const [connectivity, setConnectivity] = useState<Connectivity>(INITIAL_CONNECTIVITY);
  const [newVersionAvailable, setNewVersionAvailable] = useState(false);
  const [promptpayId, setPromptpayId] = useState<string | null | undefined>(undefined);
  const inFlight = useRef(false);

  const checkNow = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEARTBEAT_TIMEOUT_MS);
    try {
      const res = await fetch("/api/heartbeat", { cache: "no-store", signal: controller.signal });
      const kind = classifyHeartbeat({
        ok: res.ok,
        redirected: res.redirected,
        contentType: res.headers.get("content-type"),
      });
      if (kind === "failure") {
        setConnectivity((s) => nextConnectivity(s, "failure"));
        return;
      }
      setConnectivity((s) => nextConnectivity(s, "success"));
      if (kind === "online") {
        const body = (await res.json()) as { version?: unknown; promptpayId?: unknown };
        if (typeof body.version === "string" && isNewVersion(BUILD_VERSION, body.version)) {
          setNewVersionAvailable(true);
        }
        setPromptpayId(typeof body.promptpayId === "string" ? body.promptpayId : null);
      }
    } catch {
      setConnectivity((s) => nextConnectivity(s, "failure"));
    } finally {
      clearTimeout(timer);
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    const check = () => void checkNow();
    check();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") check();
    }, HEARTBEAT_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    const onOffline = () => setConnectivity((s) => nextConnectivity(s, "browser-offline"));
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", check);
    window.addEventListener("offline", onOffline);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", check);
      window.removeEventListener("offline", onOffline);
    };
  }, [checkNow]);

  return { connectivity, newVersionAvailable, promptpayId, checkNow: () => void checkNow() };
}
