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
  parseHeartbeatBody,
  type Connectivity,
} from "@/lib/connectivity";
import type { QueueState } from "@/lib/offline/device-queue";

/** What one online answer actually carried; undefined = the server didn't read it. */
export type HeartbeatAnswer = {
  at: number;
  promptpayId: string | null | undefined;
  shiftId: string | null | undefined;
  queue: QueueState | undefined;
};

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
  /** The open shift (null = none); undefined until an answer carried it. */
  shiftId: string | null | undefined;
  /** Today's queue counter; undefined until an answer carried it. */
  queue: QueueState | undefined;
  /** When the last successful answer arrived (any kind); the outbox sender wakes on it. */
  lastSuccessAt: number | null;
  /** The last online answer, as sent (fields the server could not read stay undefined). */
  answer: HeartbeatAnswer | null;
  checkNow: () => void;
} {
  const [connectivity, setConnectivity] = useState<Connectivity>(INITIAL_CONNECTIVITY);
  const [newVersionAvailable, setNewVersionAvailable] = useState(false);
  const [promptpayId, setPromptpayId] = useState<string | null | undefined>(undefined);
  const [shiftId, setShiftId] = useState<string | null | undefined>(undefined);
  const [queue, setQueue] = useState<QueueState | undefined>(undefined);
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const [answer, setAnswer] = useState<HeartbeatAnswer | null>(null);
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
      setLastSuccessAt(Date.now());
      if (kind === "online") {
        const body = parseHeartbeatBody(await res.json());
        if (body.version !== undefined && isNewVersion(BUILD_VERSION, body.version)) {
          setNewVersionAvailable(true);
        }
        // Absent means the server couldn't read it: keep the last value, never blank the QR.
        if (body.promptpayId !== undefined) setPromptpayId(body.promptpayId);
        if (body.shiftId !== undefined) setShiftId(body.shiftId);
        if (body.queue !== undefined) setQueue(body.queue);
        setAnswer({
          at: Date.now(),
          promptpayId: body.promptpayId,
          shiftId: body.shiftId,
          queue: body.queue,
        });
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

  return {
    connectivity,
    newVersionAvailable,
    promptpayId,
    shiftId,
    queue,
    lastSuccessAt,
    answer,
    checkNow: () => void checkNow(),
  };
}
