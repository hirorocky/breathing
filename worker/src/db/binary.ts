/** UUID / バイナリハッシュの D1 BLOB 変換 */

export function uuidToBlob(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  if (hex.length !== 32) {
    throw new Error("invalid_uuid");
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function blobToUuid(blob: ArrayBuffer | Uint8Array): string {
  const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
  const hex = [...bytes]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function optionalUuidToBlob(
  uuid: string | null | undefined,
): Uint8Array | null {
  if (!uuid) return null;
  return uuidToBlob(uuid);
}

export function optionalBlobToUuid(
  blob: ArrayBuffer | Uint8Array | null | undefined,
): string | null {
  if (!blob) return null;
  return blobToUuid(blob);
}
