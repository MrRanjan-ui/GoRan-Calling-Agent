import mongoose, { Schema, Document } from "mongoose";

export interface IKBDocument {
  title: string;
  content: string;
}

export interface IKnowledgeBase extends Document {
  id: string;
  name: string;
  documents: IKBDocument[];
  createdAt: Date;
}

const KnowledgeBaseSchema: Schema = new Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  documents: [
    {
      title: { type: String, required: true },
      content: { type: String, required: true },
    },
  ],
  createdAt: { type: Date, default: Date.now },
});

export const KnowledgeBaseModel = mongoose.model<IKnowledgeBase>("KnowledgeBase", KnowledgeBaseSchema);
