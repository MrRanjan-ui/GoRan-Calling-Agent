import { Router } from "express";
import { PersonaModel } from "../models/Persona.js";
import { logger } from "../utils.js";

const router = Router();

function validatePersona(persona: any) {
  if (!persona.id || typeof persona.id !== "string" || !persona.id.trim()) {
    return "id is required and must be a non-empty string";
  }
  if (!persona.name || typeof persona.name !== "string" || !persona.name.trim()) {
    return "name is required and must be a non-empty string";
  }
  if (!persona.role || typeof persona.role !== "string" || !persona.role.trim()) {
    return "role is required and must be a non-empty string";
  }
  if (!persona.voice || typeof persona.voice !== "string" || !persona.voice.trim()) {
    return "voice is required and must be a non-empty string";
  }
  if (!persona.systemInstruction || typeof persona.systemInstruction !== "string" || !persona.systemInstruction.trim()) {
    return "systemInstruction is required and must be a non-empty string";
  }
  return null;
}

// GET /api/personas — List all personas
router.get("/", async (_req, res) => {
  try {
    const allPersonas = await PersonaModel.find({});
    res.json({ success: true, data: allPersonas });
  } catch (err: any) {
    logger.error("Error fetching personas:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/personas — Create or update a persona
router.post("/", async (req, res) => {
  const agent = req.body;
  const validationError = validatePersona(agent);
  if (validationError) {
    return res.status(400).json({ success: false, message: validationError });
  }

  const sanitizedAgent = {
    id: agent.id.trim(),
    name: agent.name.trim(),
    role: agent.role.trim(),
    voice: agent.voice.trim(),
    systemInstruction: agent.systemInstruction.trim(),
    knowledgeBaseId: agent.knowledgeBaseId ? agent.knowledgeBaseId.trim() : undefined,
    isDefault: !!agent.isDefault,
  };

  try {
    const updated = await PersonaModel.findOneAndUpdate(
      { id: sanitizedAgent.id },
      sanitizedAgent,
      { upsert: true, new: true }
    );
    logger.info(`Saved/Updated persona: ${updated.name}`);
    res.json({ success: true, data: updated });
  } catch (err: any) {
    logger.error("Error saving persona:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/personas/:id — Delete a persona
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const persona = await PersonaModel.findOne({ id });
    if (persona && persona.isDefault) {
      return res.status(400).json({ success: false, message: "Cannot delete built-in default personas." });
    }
    await PersonaModel.deleteOne({ id });
    logger.info(`Deleted persona ID: ${id}`);
    res.json({ success: true, message: `Persona ${id} deleted successfully.` });
  } catch (err: any) {
    logger.error("Error deleting persona:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
