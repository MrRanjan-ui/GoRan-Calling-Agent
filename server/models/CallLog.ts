import mongoose, { Schema, Document } from "mongoose";

export interface ITranscriptEntry {
  role: "user" | "agent" | "system";
  text: string;
  timestamp: Date;
}

export interface IToolCallRecord {
  name: string;
  args: any;
  result: any;
  timestamp: Date;
}

export interface ICallLog extends Document {
  callId: string;
  personaId: string;
  personaName: string;
  callerNumber: string;
  direction: "inbound" | "outbound";
  provider: "browser" | "vobiz" | "twilio";
  status: string;
  startedAt: Date;
  connectedAt?: Date;
  endedAt?: Date;
  durationSeconds?: number;
  transcript: ITranscriptEntry[];
  toolCallsUsed: IToolCallRecord[];
  audioPacketsReceived: number;
  audioPacketsSent: number;
  latencyMs?: number;
  jitterMs?: number;
  packetLossPercent?: number;
  recordingUrl?: string;
  errorMessage?: string;
  summary?: string;
  leadScore?: string;
  actionItems?: string[];
  createdAt: Date;
}

const CallLogSchema: Schema = new Schema({
  callId: { type: String, required: true, unique: true },
  personaId: { type: String, required: true },
  personaName: { type: String, required: true },
  callerNumber: { type: String, required: true },
  direction: { type: String, enum: ["inbound", "outbound"], required: true },
  provider: { type: String, enum: ["browser", "vobiz", "twilio"], required: true },
  status: { type: String, required: true },
  startedAt: { type: Date, required: true },
  connectedAt: { type: Date },
  endedAt: { type: Date },
  durationSeconds: { type: Number },
  transcript: [
    {
      role: { type: String, enum: ["user", "agent", "system"], required: true },
      text: { type: String, required: true },
      timestamp: { type: Date, default: Date.now },
    },
  ],
  toolCallsUsed: [
    {
      name: { type: String, required: true },
      args: { type: Schema.Types.Mixed },
      result: { type: Schema.Types.Mixed },
      timestamp: { type: Date, default: Date.now },
    },
  ],
  audioPacketsReceived: { type: Number, default: 0 },
  audioPacketsSent: { type: Number, default: 0 },
  latencyMs: { type: Number },
  jitterMs: { type: Number },
  packetLossPercent: { type: Number },
  recordingUrl: { type: String },
  errorMessage: { type: String },
  summary: { type: String },
  leadScore: { type: String },
  actionItems: [{ type: String }],
  createdAt: { type: Date, default: Date.now },
});

export const CallLogModel = mongoose.model<ICallLog>("CallLog", CallLogSchema);
