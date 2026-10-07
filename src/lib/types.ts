// Types shared across the whole app.
//
// IMPORTANT FOR LATER SYNC: every record carries a device-generated UUID id
// plus createdAt / updatedAt / deleted so a future backend can merge records
// without relying on auto-increment ids.

export type Category = {
  id: string;
  /** Better Auth account that owns this record; null until the first sign-in. */
  userId: string | null;
  name: string;
  /** SVG path data drawn inside a 24x24 viewBox. */
  icon: string;
  color: string;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
};

export type SessionStatus = "running" | "stopped";

export type SessionLog = {
  id: string;
  /** Better Auth account that owns this record; null until the first sign-in. */
  userId: string | null;
  categoryId: string;
  categoryName: string;
  status: SessionStatus;
  /** Epoch ms when the session started. The timer is derived from this. */
  startedAt: number;
  /** Epoch ms when it ended; 0 while still running. */
  endedAt: number;
  note: string;
  summary: string;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
};

export type CategoryTask = {
  id: string;
  categoryId: string;
  text: string;
  done: boolean;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
};

export type Retention = 1 | 2 | 3;