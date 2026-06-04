import { v4 as uuidv4 } from "uuid";
import { CallLogModel, type ICallLog } from "../models/CallLog.js";
import { writeWavFile } from "./audioRecorder.js";
import path from "path";
import { logger } from "../utils.js";

/**
 * Tracks a single call lifecycle and persists it to MongoDB.
 * Created at call start, updated throughout, and saved at call end.
 */
export class CallLogger {
  private log: any;
  private dirty = false;
  private saveTimer: ReturnType<typeof setInterval> | null = null;
  private audioChunks: Array<{ role: "user" | "agent"; timestamp: number; pcm: Int16Array }> = [];

  constructor(
    personaId: string,
    personaName: string,
    callerNumber: string,
    provider: "browser" | "twilio" | "vobiz",
    direction: "inbound" | "outbound" = "inbound"
  ) {
    this.log = {
      callId: `call_${uuidv4().replace(/-/g, "").substring(0, 12)}`,
      personaId,
      personaName,
      callerNumber,
      provider,
      direction,
      status: "ringing",
      startedAt: new Date(),
      transcript: [],
      toolCallsUsed: [],
      audioPacketsReceived: 0,
      audioPacketsSent: 0,
    };

    // Auto-save every 15 seconds during active calls
    this.saveTimer = setInterval(() => {
      if (this.dirty) {
        this.persist().catch(err => logger.error("[CallLogger] Auto-save error:", err));
      }
    }, 15000);
  }

  getCallId(): string {
    return this.log.callId;
  }

  getStartedAt(): Date {
    return this.log.startedAt;
  }

  getStatus(): string {
    return this.log.status;
  }

  getPacketCounts() {
    return {
      received: this.log.audioPacketsReceived,
      sent: this.log.audioPacketsSent,
    };
  }

  getDurationSeconds(): number {
    if (this.log.durationSeconds != null && this.log.durationSeconds > 0) {
      return this.log.durationSeconds;
    }
    const start = this.log.connectedAt || this.log.startedAt;
    return Math.floor((Date.now() - start.getTime()) / 1000);
  }

  markConnected(): void {
    this.log.status = "connected";
    this.log.connectedAt = new Date();
    this.dirty = true;
  }

  addTranscript(role: "user" | "agent", text: string): void {
    if (!text || text.trim().length === 0) return;
    this.log.transcript.push({
      role,
      text: text.trim(),
      timestamp: new Date(),
    });
    this.dirty = true;
  }

  addToolCall(name: string, args: any, result: any): void {
    this.log.toolCallsUsed.push({
      name,
      args,
      result,
      timestamp: new Date(),
    });
    this.dirty = true;
  }

  incrementPackets(direction: "in" | "out", count = 1): void {
    if (direction === "in") {
      this.log.audioPacketsReceived += count;
    } else {
      this.log.audioPacketsSent += count;
    }
    // Don't set dirty for every packet — let auto-save handle it
  }

  addAudioChunk(role: "user" | "agent", pcm: Int16Array): void {
    this.audioChunks.push({
      role,
      timestamp: Date.now(),
      pcm,
    });
  }

  setTelemetry(latencyMs: number, jitterMs: number): void {
    this.log.latencyMs = latencyMs;
    this.log.jitterMs = jitterMs;
    this.log.packetLossPercent = 0; // TCP-based WebSocket stream has 0% packet loss
    this.dirty = true;
  }

  markCompleted(reason?: string): void {
    this.log.status = "completed";
    this.log.endedAt = new Date();
    const start = this.log.connectedAt || this.log.startedAt;
    this.log.durationSeconds = Math.floor((this.log.endedAt.getTime() - start.getTime()) / 1000);
    if (reason) {
      this.log.errorMessage = reason;
    }
    this.dirty = true;
    this.cleanup();
  }

  markFailed(error: string): void {
    this.log.status = "failed";
    this.log.endedAt = new Date();
    this.log.errorMessage = error;
    const start = this.log.connectedAt || this.log.startedAt;
    this.log.durationSeconds = Math.floor((this.log.endedAt.getTime() - start.getTime()) / 1000);
    this.dirty = true;
    this.cleanup();
  }

  /** Final save and cleanup intervals. */
  async finalize(): Promise<void> {
    this.cleanup();
    await this.persist();
  }

  /** Mix collected audio chunks chronologically. */
  private mixAudioChunks(): Int16Array | null {
    if (this.audioChunks.length === 0) return null;

    const start = this.log.connectedAt || this.log.startedAt;
    const startTimeMs = start.getTime();

    let maxSampleIndex = 0;
    const chunksWithOffsets = this.audioChunks.map(chunk => {
      const offsetMs = Math.max(0, chunk.timestamp - startTimeMs);
      const startSampleIndex = Math.floor(offsetMs * 16); // 16 samples per millisecond for 16kHz
      const endSampleIndex = startSampleIndex + chunk.pcm.length;
      if (endSampleIndex > maxSampleIndex) {
        maxSampleIndex = endSampleIndex;
      }
      return {
        ...chunk,
        startSampleIndex,
      };
    });

    if (maxSampleIndex === 0) return null;

    const outputBuffer = new Int16Array(maxSampleIndex);

    for (const chunk of chunksWithOffsets) {
      for (let i = 0; i < chunk.pcm.length; i++) {
        const destIndex = chunk.startSampleIndex + i;
        if (destIndex < maxSampleIndex) {
          let mixedSample = outputBuffer[destIndex] + chunk.pcm[i];
          if (mixedSample > 32767) mixedSample = 32767;
          else if (mixedSample < -32768) mixedSample = -32768;
          outputBuffer[destIndex] = mixedSample;
        }
      }
    }

    return outputBuffer;
  }

  /** Persist current state to MongoDB. */
  async persist(): Promise<void> {
    try {
      if (this.audioChunks.length > 0) {
        const pcmData = this.mixAudioChunks();
        if (pcmData && pcmData.length > 0) {
          const recordingFilename = `${this.log.callId}.wav`;
          const recordingPath = path.join(process.cwd(), "recordings", recordingFilename);
          writeWavFile(recordingPath, pcmData, 16000);
          this.log.recordingUrl = `/recordings/${recordingFilename}`;
        }
      }

      await CallLogModel.findOneAndUpdate(
        { callId: this.log.callId },
        this.log,
        { upsert: true, new: true }
      );
      this.dirty = false;
    } catch (err) {
      logger.error("[CallLogger] Persist error:", err);
    }
  }

  /** Get a plain object snapshot (e.g. for WebSocket status messages). */
  toJSON() {
    return {
      callId: this.log.callId,
      personaId: this.log.personaId,
      personaName: this.log.personaName,
      provider: this.log.provider,
      status: this.log.status,
      startedAt: this.log.startedAt,
      connectedAt: this.log.connectedAt,
      durationSeconds: this.getDurationSeconds(),
      audioPacketsReceived: this.log.audioPacketsReceived,
      audioPacketsSent: this.log.audioPacketsSent,
    };
  }

  private cleanup(): void {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }
  }
}
