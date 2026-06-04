import { GoogleGenAI, Modality, Type, FunctionDeclaration } from "@google/genai";
import { GEMINI_API_KEY, GEMINI_MODEL } from "../config.js";
import { KnowledgeBaseModel } from "../models/KnowledgeBase.js";

// ─── Gemini Client ──────────────────────────────────────────────

export function getGeminiClient(): GoogleGenAI {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY environment variable is missing.");
  }
  return new GoogleGenAI({
    apiKey: GEMINI_API_KEY,
    httpOptions: { headers: { "User-Agent": "aistudio-build" } },
  });
}

// ─── System Instruction Builder ─────────────────────────────────

/**
 * Compiles the final system instruction by merging the base persona
 * instruction with any linked knowledge base documents.
 */
export async function getCompiledSystemInstruction(
  baseInstruction: string,
  knowledgeBaseId?: string
): Promise<string> {
  if (!knowledgeBaseId) return baseInstruction;

  try {
    const kb = await KnowledgeBaseModel.findOne({ id: knowledgeBaseId });
    if (!kb || !kb.documents || kb.documents.length === 0) {
      return baseInstruction;
    }

    const docSection = kb.documents
      .map((d) => `### ${d.title}\n${d.content}`)
      .join("\n\n---\n\n");

    return `${baseInstruction}\n\n--- KNOWLEDGE BASE: ${kb.name} ---\nThe following reference documents contain important factual information you should use when answering questions:\n\n${docSection}`;
  } catch (err) {
    console.error("[Gemini] Error loading knowledge base:", err);
    return baseInstruction;
  }
}

// ─── GoRan CRM & Agency Tools ─────────────────────────────────────

export const goranAgencyTools: FunctionDeclaration[] = [
  {
    name: "check_lead_status",
    description: "Looks up a business lead in our database by phone number or email to check if they have already engaged or have an active query.",
    parametersJsonSchema: {
      type: Type.OBJECT,
      properties: {
        phone: { type: Type.STRING, description: "Phone number of the lead (e.g. '+919999999999')" },
        email: { type: Type.STRING, description: "Email address of the lead" }
      }
    }
  },
  {
    name: "capture_lead_info",
    description: "Saves or updates qualified lead details in our database, including business type, challenges, team size, and email.",
    parametersJsonSchema: {
      type: Type.OBJECT,
      properties: {
        phone: { type: Type.STRING, description: "Lead's contact phone number" },
        email: { type: Type.STRING, description: "Lead's email address" },
        bizType: { type: Type.STRING, description: "Type of business (e.g., e-commerce, real estate, dental clinic)" },
        challenge: { type: Type.STRING, description: "Their primary business pain point or automation goal" },
        teamSize: { type: Type.STRING, description: "Approximate size of their team (e.g., '1-5', '5-20', '20+')" },
        score: { type: Type.STRING, description: "Your assessment of their readiness/qualification: 'high', 'medium', or 'low'" },
        scoreReason: { type: Type.STRING, description: "Short justification for the qualification score" }
      },
      required: ["phone"]
    }
  },
  {
    name: "get_service_info",
    description: "Queries the FAQ database/knowledge base for answers regarding GoRan AI services, pricing models, setup timelines, and past case studies.",
    parametersJsonSchema: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: "The specific question about our services, pricing, or case studies" }
      },
      required: ["query"]
    }
  }
];

// ─── Google Workspace Tools ───

export const googleWorkspaceTools: FunctionDeclaration[] = [
  {
    name: "list_upcoming_meetings",
    description: "Retrieves upcoming scheduled consultation/strategy calls from the calendar to check for scheduling conflicts.",
    parametersJsonSchema: {
      type: Type.OBJECT,
      properties: {
        maxResults: { type: Type.INTEGER, description: "Maximum number of events to return. Defaults to 5." }
      }
    }
  },
  {
    name: "schedule_meeting",
    description: "Books a free 15-minute AI strategy consultation event on Google Calendar, registering the lead's email and details.",
    parametersJsonSchema: {
      type: Type.OBJECT,
      properties: {
        summary: { type: Type.STRING, description: "Event title (e.g., 'GoRan AI Consultation - [Business Name]')" },
        description: { type: Type.STRING, description: "Detailed description listing business challenges and requirements discussed" },
        startTime: { type: Type.STRING, description: "ISO 8601 formatted start date-time (e.g. '2026-06-11T15:00:00+05:30')" },
        endTime: { type: Type.STRING, description: "ISO 8601 formatted end date-time (e.g. '2026-06-11T15:15:00+05:30')" },
        attendeeEmail: { type: Type.STRING, description: "Lead's email address to invite" }
      },
      required: ["summary", "startTime", "endTime", "attendeeEmail"]
    }
  },
  {
    name: "send_follow_up_email",
    description: "Sends a follow-up email summary containing proposed automation ideas, meeting details, and calendar link to the lead.",
    parametersJsonSchema: {
      type: Type.OBJECT,
      properties: {
        recipientEmail: { type: Type.STRING, description: "Email address of the recipient" },
        subject: { type: Type.STRING, description: "Subject line of the email" },
        body: { type: Type.STRING, description: "Email body text (plain text or HTML)" }
      },
      required: ["recipientEmail", "subject", "body"]
    }
  }
];

export const allToolDeclarations: FunctionDeclaration[] = [
  ...goranAgencyTools,
  ...googleWorkspaceTools,
];

export { GEMINI_MODEL };
export { Modality };
