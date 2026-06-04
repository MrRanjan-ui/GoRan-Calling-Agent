import { Router } from "express";
import { KnowledgeBaseModel } from "../models/KnowledgeBase.js";
import { logger } from "../utils.js";

const router = Router();

function validateKnowledgeBase(kb: any) {
  if (!kb.id || typeof kb.id !== "string" || !kb.id.trim()) {
    return "id is required and must be a non-empty string";
  }
  if (!kb.name || typeof kb.name !== "string" || !kb.name.trim()) {
    return "name is required and must be a non-empty string";
  }
  if (!kb.documents || !Array.isArray(kb.documents)) {
    return "documents must be a valid array";
  }
  for (const d of kb.documents) {
    if (!d.title || typeof d.title !== "string" || !d.title.trim()) {
      return "each document must have a valid non-empty title";
    }
    if (!d.content || typeof d.content !== "string" || !d.content.trim()) {
      return "each document must have a valid non-empty content";
    }
  }
  return null;
}

// GET /api/knowledge-bases — List all knowledge bases
router.get("/", async (_req, res) => {
  try {
    const kbs = await KnowledgeBaseModel.find({});
    res.json({ success: true, data: kbs });
  } catch (err: any) {
    logger.error("Error fetching knowledge bases:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/knowledge-bases — Create or update a knowledge base
router.post("/", async (req, res) => {
  const kb = req.body;
  const validationError = validateKnowledgeBase(kb);
  if (validationError) {
    return res.status(400).json({ success: false, message: validationError });
  }

  const sanitizedDocs = kb.documents.map((d: any) => ({
    title: d.title.trim(),
    content: d.content.trim(),
  }));

  const sanitizedKb = {
    id: kb.id.trim(),
    name: kb.name.trim(),
    documents: sanitizedDocs,
  };

  try {
    const updated = await KnowledgeBaseModel.findOneAndUpdate(
      { id: sanitizedKb.id },
      sanitizedKb,
      { upsert: true, new: true }
    );
    logger.info(`Saved/Updated knowledge base: ${updated.name}`);
    res.json({ success: true, data: updated });
  } catch (err: any) {
    logger.error("Error saving knowledge base:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/knowledge-bases/:id — Delete a knowledge base
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await KnowledgeBaseModel.deleteOne({ id });
    logger.info(`Deleted knowledge base ID: ${id}`);
    res.json({ success: true, message: `Knowledge base ${id} deleted successfully.` });
  } catch (err: any) {
    logger.error("Error deleting knowledge base:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
