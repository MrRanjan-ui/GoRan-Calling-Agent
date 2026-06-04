import { getGeminiClient } from "./gemini.js";
import { CallLogModel } from "../models/CallLog.js";
import { LeadModel } from "../models/Lead.js";
import { logger } from "../utils.js";

/**
 * Loads the transcript of a completed call, requests Google Gemini to summarize it,
 * extracts lead metrics, and stores the final summary directly in the CallLog document.
 */
export async function generateCallSummary(callId: string): Promise<string> {
  try {
    logger.info(`[Summary Service] Triggered AI call summarization for: ${callId}`);
    
    // 1. Fetch CallLog with transcript
    const call = await CallLogModel.findOne({ callId });
    if (!call) {
      logger.error(`[Summary Service] Call log not found for ID: ${callId}`);
      return "";
    }

    if (!call.transcript || call.transcript.length === 0) {
      logger.warn(`[Summary Service] Call ${callId} has an empty transcript. Skipping summary.`);
      return "No conversation recorded.";
    }

    // 2. Format transcript for prompt input
    const transcriptText = call.transcript
      .map((line) => `${line.role.toUpperCase()}: ${line.text}`)
      .join("\n");

    // 3. Formulate the summarization prompt
    const prompt = `
You are a highly efficient sales operations assistant for GoRan AI Agency. Review the phone call transcript below between a GoRan AI Representative ("AGENT") and a prospective business client ("USER").
Generate a concise, professional summary formatted with clear headers and bullet points.

Your output must consist of 4 distinct parts:
1. SUMMARY: A concise paragraph summarizing the conversation.
2. DETAILS: Bullet points listing the business name (if mentioned), caller's business type, team size, primary operational bottleneck or challenge discussed, email address, and meeting dates.
3. ACTION ITEMS: A list of tasks or follow-ups requested by the caller or needed from the GoRan team.
4. ASSESSMENT: Use the following exact single-line formats to declare lead value:
   LEAD_SCORE: [High / Medium / Low]
   LEAD_REASON: [Brief justification for the score]
   MEETING_BOOKED: [Yes / No / Uncertain]

Transcript:
${transcriptText}
`;

    // 4. Invoke Gemini API
    const ai = getGeminiClient();
    logger.info(`[Summary Service] Requesting Gemini summary using gemini-2.5-flash...`);
    
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const summaryText = response.text?.trim() || "Failed to generate call summary.";

    // 5. Parse lead score, reason, meeting status, and action items
    let leadScore = "Low";
    let scoreReason = "";
    const actionItems: string[] = [];

    // Simple parser for AI assessment output
    const lines = summaryText.split("\n");
    for (const line of lines) {
      if (line.toUpperCase().includes("LEAD_SCORE:")) {
        const parts = line.split(":");
        leadScore = parts[1]?.trim() || "Low";
      } else if (line.toUpperCase().includes("LEAD_REASON:")) {
        const parts = line.split(":");
        scoreReason = parts[1]?.trim() || "";
      } else if (line.trim().startsWith("- ") && line.toLowerCase().includes("follow") || line.trim().startsWith("-") && lines.indexOf(line) > lines.findIndex(l => l.toUpperCase().includes("ACTION ITEMS"))) {
        // Crude list capture for action items
        const item = line.replace(/^-\s*/, "").trim();
        if (item.length > 0 && actionItems.length < 5) {
          actionItems.push(item);
        }
      }
    }

    // 6. Update call log in MongoDB
    call.summary = summaryText;
    call.leadScore = leadScore;
    call.actionItems = actionItems.length > 0 ? actionItems : ["No explicit action items requested."];
    await call.save();
    
    logger.info(`[Summary Service] Successfully saved summary, score: ${leadScore} for call ${callId} to MongoDB.`);

    // 7. Update Lead record in MongoDB if caller number is a valid phone
    if (call.callerNumber && call.callerNumber !== "browser-user") {
      try {
        const updateFields: any = {
          score: leadScore,
          scoreReason: scoreReason || "Updated from call analysis summary",
          summaryBlock: summaryText
        };
        
        // Scan transcript text for email to capture
        const emailMatch = transcriptText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (emailMatch) {
          updateFields.email = emailMatch[0];
        }

        await LeadModel.findOneAndUpdate(
          { phone: call.callerNumber },
          { $set: updateFields },
          { upsert: true }
        );
        logger.info(`[Summary Service] Updated Lead record for ${call.callerNumber} with Call Summary & Lead Score`);
      } catch (dbErr) {
        logger.warn(`[Summary Service] Failed to sync call summary to Lead Model:`, dbErr);
      }
    }

    return summaryText;
  } catch (err: any) {
    logger.error(`[Summary Service] Error generating summary for call ${callId}:`, err);
    return "";
  }
}
