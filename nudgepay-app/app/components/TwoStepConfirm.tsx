// TwoStepConfirm — universal inline destructive-confirm pattern.
//
// First render shows a single button (`idleLabel`). Clicking reveals a
// confirm/cancel pair that auto-reverts after `timeoutMs`. This replaces the
// four divergent destructive idioms with one styled, keyboard-friendly step.

import { useEffect, useRef, useState } from "react";
import { Button, cx } from "./ui";

/** Controlled two-step state for inline confirms: flip `confirming` on/off. */
export function useTwoStep(timeoutMs = 5000) {
  const [confirming, setConfirming] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function arm() {
    setConfirming(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setConfirming(false), timeoutMs);
  }
  function disarm() {
    setConfirming(false);
    if (timer.current) clearTimeout(timer.current);
  }
  return { confirming, arm, disarm };
}


export function TwoStepConfirm({
  idleLabel,
  confirmLabel,
  message,
  onConfirm,
  timeoutMs = 5000,
  tone = "destructive",
  size = "sm",
  disabled = false,
  className = "",
}: {
  idleLabel: string;
  confirmLabel: string;
  /** Optional explanatory line shown once armed. */
  message?: string;
  onConfirm: () => void;
  /** Auto-revert delay while armed (ms). */
  timeoutMs?: number;
  tone?: "destructive" | "primary";
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function arm() {
    setArmed(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setArmed(false), timeoutMs);
  }

  function confirm() {
    if (timer.current) clearTimeout(timer.current);
    setArmed(false);
    onConfirm();
  }

  function cancel() {
    if (timer.current) clearTimeout(timer.current);
    setArmed(false);
  }

  if (!armed) {
    return (
      <Button
        type="button"
        variant={tone}
        size={size}
        disabled={disabled}
        className={className}
        onClick={arm}
      >
        {idleLabel}
      </Button>
    );
  }

  return (
    <div className={cx("flex flex-col gap-1.5", className)} role="alert">
      {message ? <p className="text-xs font-sans text-text">{message}</p> : null}
      <div className="flex items-center gap-2">
        <Button type="button" variant={tone} size={size} onClick={confirm}>
          {confirmLabel}
        </Button>
        <Button type="button" variant="secondary" size={size} onClick={cancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
