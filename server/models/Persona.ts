import mongoose, { Schema, Document } from "mongoose";

export interface IPersona extends Document {
  id: string;
  name: string;
  role: string;
  voice: string;
  systemInstruction: string;
  knowledgeBaseId?: string;
  isDefault: boolean;
  createdAt: Date;
}

const PersonaSchema: Schema = new Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  role: { type: String, required: true },
  voice: { type: String, required: true },
  systemInstruction: { type: String, required: true },
  knowledgeBaseId: { type: String },
  isDefault: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

export const PersonaModel = mongoose.model<IPersona>("Persona", PersonaSchema);
