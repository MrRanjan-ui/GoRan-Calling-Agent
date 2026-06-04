import fs from "fs";
import path from "path";

/**
 * Writes a standard 44-byte WAV header followed by raw 16-bit mono PCM samples to a file.
 */
export function writeWavFile(filePath: string, pcmData: Int16Array, sampleRate = 16000): void {
  const buffer = Buffer.alloc(44 + pcmData.byteLength);

  // RIFF identifier
  buffer.write("RIFF", 0);
  // File length minus RIFF header length (8 bytes)
  buffer.writeUInt32LE(36 + pcmData.byteLength, 4);
  // RIFF type
  buffer.write("WAVE", 8);
  // Format chunk identifier
  buffer.write("fmt ", 12);
  // Format chunk length
  buffer.writeUInt32LE(16, 16);
  // Sample format (raw PCM = 1)
  buffer.writeUInt16LE(1, 20);
  // Channel count (mono = 1)
  buffer.writeUInt16LE(1, 22);
  // Sample rate
  buffer.writeUInt32LE(sampleRate, 24);
  // Byte rate = sampleRate * channelCount * bytesPerSample
  buffer.writeUInt32LE(sampleRate * 1 * 2, 28);
  // Block align = channelCount * bytesPerSample
  buffer.writeUInt16LE(1 * 2, 32);
  // Bits per sample
  buffer.writeUInt16LE(16, 34);
  // Data chunk identifier
  buffer.write("data", 36);
  // Data chunk length
  buffer.writeUInt32LE(pcmData.byteLength, 40);

  // Copy PCM data
  const pcmBuffer = Buffer.from(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength);
  pcmBuffer.copy(buffer, 44);

  // Ensure parent directories exist
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, buffer);
}
