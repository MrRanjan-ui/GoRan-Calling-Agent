import mongoose, { Schema, Document } from "mongoose";

export interface ILead extends Document {
  phone: string;
  bizType?: string;
  challenge?: string;
  process?: string;
  teamSize?: string;
  email?: string;
  meetingTime?: string;
  meetingLink?: string;
  score?: string;
  scoreReason?: string;
  summaryBlock?: string;
  questionsAsked?: string[];
  timestamp: string;
}

const LeadSchema: Schema = new Schema({
  phone: { type: String, required: true },
  bizType: { type: String, default: "" },
  challenge: { type: String, default: "" },
  process: { type: String, default: "" },
  teamSize: { type: String, default: "" },
  email: { type: String, default: "" },
  meetingTime: { type: String, default: "" },
  meetingLink: { type: String, default: "" },
  score: { type: String, default: "" },
  scoreReason: { type: String, default: "" },
  summaryBlock: { type: String, default: "" },
  questionsAsked: { type: [String], default: [] },
  timestamp: { type: String, default: () => new Date().toISOString() },
});

export const LeadModel = mongoose.model<ILead>("Lead", LeadSchema, "leads");
