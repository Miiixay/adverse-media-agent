"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function MonitorToggle({ personId, monitored }: { personId: string; monitored: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function toggle() {
    setPending(true);
    setFailed(false);
    try {
      const response = await fetch(`/api/watchlist/${personId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ monitored: !monitored }),
      });
      if (response.ok) router.refresh();
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button type="button" className="toggle" onClick={toggle} disabled={pending}>
        {monitored ? "Suspend" : "Monitor"}
      </button>
      {failed && <span className="field-error"> not saved</span>}
    </>
  );
}
