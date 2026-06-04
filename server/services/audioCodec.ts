const BIAS = 0x84;
const CLIP = 32635;

/** Decode a single μ-law byte to a signed 16-bit PCM sample. */
export function decodeMulaw(uLawByte: number): number {
  uLawByte = ~uLawByte;
  const sign = (uLawByte & 0x80) ? -1 : 1;
  const exponent = (uLawByte & 0x70) >> 4;
  const mantissa = uLawByte & 0x0F;
  let sample = (mantissa << 3) + 132;
  sample <<= exponent;
  sample -= 132;
  return sign * sample;
}

/** Encode a signed 16-bit PCM sample to a μ-law byte. */
export function encodeMulaw(sample: number): number {
  const sign = (sample < 0) ? 0x80 : 0;
  if (sample < 0) sample = -sample;
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;
  let exponent = 7;
  for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {}
  const mantissa = (sample >> (exponent + 3)) & 0x0F;
  const uval = (exponent << 4) | mantissa;
  return ~(sign | uval) & 0xFF;
}

/** Decode a Base64 string of little-endian Int16 PCM to an Int16Array. */
export function base64ToInt16Array(base64: string): Int16Array {
  const buffer = Buffer.from(base64, "base64");
  if (buffer.byteOffset % 2 === 0) {
    return new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2);
  } else {
    const alignedBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length);
    return new Int16Array(alignedBuffer);
  }
}

/** Decode a Base64 string of Int16 PCM to a normalized Float32Array. */
export function base64ToFloat32(base64: string): Float32Array {
  const int16Array = base64ToInt16Array(base64);
  const float32Array = new Float32Array(int16Array.length);
  for (let i = 0; i < int16Array.length; i++) {
    float32Array[i] = int16Array[i] / 32768.0;
  }
  return float32Array;
}

/** Encode an Int16Array back to a Base64 string. */
export function int16ArrayToBase64(samples: Int16Array): string {
  return Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength).toString("base64");
}

/**
 * Resample Int16 PCM data between sample rates using linear interpolation.
 * e.g. 8kHz → 16kHz, 24kHz → 16kHz, etc.
 */
export function resampleInt16Pcm(input: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate === toRate) {
    return input;
  }

  const outputLength = Math.max(1, Math.floor(input.length * toRate / fromRate));
  const output = new Int16Array(outputLength);
  const ratio = fromRate / toRate;

  for (let i = 0; i < outputLength; i++) {
    const sourceIndex = i * ratio;
    const leftIndex = Math.floor(sourceIndex);
    const rightIndex = Math.min(leftIndex + 1, input.length - 1);
    const fraction = sourceIndex - leftIndex;
    const sample = input[leftIndex] * (1 - fraction) + input[rightIndex] * fraction;
    output[i] = Math.max(-32768, Math.min(32767, Math.round(sample)));
  }

  return output;
}
