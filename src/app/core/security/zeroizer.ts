/**
 * Best-effort memory hygiene utilities for typed byte arrays.
 *
 * NOTE ON JAVASCRIPT MEMORY:
 * JavaScript engines (V8 / JSC) manage memory through garbage collection.
 * V8 strings are immutable and cannot be zeroed in-place.
 * However, typed binary buffers (Uint8Array, ArrayBuffer) CAN be explicitly
 * overwritten with zeros in-place to reduce the exposure window in memory.
 */

export function wipeBuffer(buffer: Uint8Array | ArrayBuffer | DataView | null | undefined): void {
  if (!buffer) return;

  if (buffer instanceof Uint8Array) {
    buffer.fill(0);
  } else if (buffer instanceof ArrayBuffer) {
    new Uint8Array(buffer).fill(0);
  } else if (buffer instanceof DataView) {
    new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength).fill(0);
  }
}

export function wipeBuffers(...buffers: Array<Uint8Array | ArrayBuffer | DataView | null | undefined>): void {
  for (const buf of buffers) {
    wipeBuffer(buf);
  }
}
