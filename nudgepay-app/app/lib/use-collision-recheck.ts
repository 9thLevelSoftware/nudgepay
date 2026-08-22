import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Collision } from "./collision";

/** Recheck /api/collision immediately before a Focus send/log. */
export function useCollisionRecheck(caseId: string, seed: Collision | null) {
  const [collision, setCollision] = useState<Collision | null>(seed);
  const [showConfirm, setShowConfirm] = useState(false);
  const [checking, setChecking] = useState(false);
  const passRef = useRef(false);

  useEffect(() => {
    setCollision(seed);
    setShowConfirm(false);
    passRef.current = false;
  }, [caseId, seed]);

  const guardSubmit = (e: FormEvent<HTMLFormElement>) => {
    if (passRef.current) return;
    e.preventDefault();
    const form = e.currentTarget;
    if (showConfirm) {
      passRef.current = true;
      form.requestSubmit();
      return;
    }
    setChecking(true);
    void fetch(`/api/collision?caseId=${encodeURIComponent(caseId)}`)
      .then(async (r) => {
        if (!r.ok) return seed;
        const body = (await r.json()) as { collision?: Collision };
        return body.collision ?? seed;
      })
      .catch(() => seed)
      .then((next) => {
        const live = next ?? seed;
        setCollision(live);
        setChecking(false);
        if (live && live.level !== "none") {
          setShowConfirm(true);
          return;
        }
        passRef.current = true;
        form.requestSubmit();
      });
  };

  return { collision, showConfirm, checking, guardSubmit };
}
