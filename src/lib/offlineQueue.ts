"use client";

import type { AttendanceStatus } from "@/lib/sheets";

// Local queue for attendance submissions that failed because the device
// was offline. Entries live in localStorage so they survive a page reload
// or the app being closed and reopened later in the day.

const QUEUE_KEY = "yumego.offlineQueue";

export type QueuedAttendance = {
  id: string;
  createdAt: string;
  payload: {
    date: string;
    className: string;
    records: { studentId: string; status: AttendanceStatus; reason: string }[];
  };
};

export function getQueue(): QueuedAttendance[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedAttendance[]) : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedAttendance[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function enqueue(payload: QueuedAttendance["payload"]): QueuedAttendance {
  const entry: QueuedAttendance = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    payload,
  };
  const queue = getQueue();
  queue.push(entry);
  saveQueue(queue);
  return entry;
}

function removeFromQueue(id: string) {
  saveQueue(getQueue().filter((entry) => entry.id !== id));
}

/**
 * Try to send every queued submission. Entries that succeed are removed;
 * entries that still fail (still offline) stay queued for next time.
 */
export async function flushQueue(): Promise<{ sent: number; remaining: number }> {
  const queue = getQueue();
  let sent = 0;

  for (const entry of queue) {
    try {
      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry.payload),
      });
      if (res.ok) {
        removeFromQueue(entry.id);
        sent++;
      }
    } catch {
      // still offline — leave it queued and stop trying the rest for now
      break;
    }
  }

  return { sent, remaining: getQueue().length };
}
