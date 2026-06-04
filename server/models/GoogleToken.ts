import mongoose, { Schema, Document } from "mongoose";

export interface IGoogleToken extends Document {
  phoneKey: string; // e.g. "default" or caller phone number
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
  scope?: string;
  token_type?: string;
  createdAt: Date;
}

const GoogleTokenSchema: Schema = new Schema({
  phoneKey: { type: String, required: true, unique: true },
  access_token: { type: String, required: true },
  refresh_token: { type: String },
  expiry_date: { type: Number },
  scope: { type: String },
  token_type: { type: String },
  createdAt: { type: Date, default: Date.now },
});

export const GoogleTokenModel = mongoose.model<IGoogleToken>("GoogleToken", GoogleTokenSchema);
