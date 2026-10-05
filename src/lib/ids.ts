// Generate a device-side UUID (no auto-increment IDs anywhere).
export function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for very old browsers: timestamp + Math.random bytes.
  const buf = new Uint8Array(16);
  if (typeof window !== "undefined" && window.crypto) {
    (window.crypto as Crypto).getRandomValues(buf);
  } else {
    // Never produces real security, but yields a unique-enough UUID.
    for (let i = 0; i < 16; i++) {
      buf[i] = (Math.random() * 256) | 0;
    }
  }
  // Microsoft browsers need the version/n clavish bits fixed.
  buf[6] = (buf[6] & 0x0f) | 0x40;
  buf[8] = (buf[8] & 0x3f) | 0x80;

  const hex = [];
  for (let i = 0; i < 16; i++) {
    hex.push(buf[i].toString(16).padStart(2, "0"));
  }
  // Insert hyphens at the standard v4 positions.
  return (
    hex[0] + hex[1] + hex[2] + hex[3] + "-" +
    hex[4] + hex[5] + "-" +
    hex[6] + hex[7] + "-" +
    hex[8] + hex[9] + "-" +
    hex[10] + hex[11] + hex[12] + hex[13] + hex[14] + hex[15]
  );
}

export function toIsoUtc(d: Date): string {
  return d.toISOString();
}

export function fromIsoUtc(s: string): Date {
  return new Date(s);
}
