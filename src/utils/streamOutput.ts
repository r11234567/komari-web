export function createStreamOutputDecoder() {
  const decoders = new Map<number, TextDecoder>();
  return {
    decode(stream: number, chunk: Uint8Array) {
      if (chunk.byteLength === 0) return "";
      let decoder = decoders.get(stream);
      if (!decoder) {
        decoder = new TextDecoder();
        decoders.set(stream, decoder);
      }
      return decoder.decode(chunk, { stream: true });
    },
    finish() {
      let tail = "";
      for (const decoder of decoders.values()) tail += decoder.decode();
      decoders.clear();
      return tail;
    },
  };
}
