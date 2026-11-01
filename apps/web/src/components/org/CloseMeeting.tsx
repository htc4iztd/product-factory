"use client";
import { useTransition } from "react";
import { closeMeeting } from "@/app/(app)/p/[id]/org-actions";

export function CloseMeeting({ pid, mid }: { pid: string; mid: number }) {
  const [pending, start] = useTransition();
  return <button className="btn-primary" disabled={pending} onClick={() => start(async () => { await closeMeeting(pid, mid); })}>会議を終える</button>;
}
