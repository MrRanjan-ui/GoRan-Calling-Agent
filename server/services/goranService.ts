import { LeadModel } from "../models/Lead.js";
import { KnowledgeBaseModel } from "../models/KnowledgeBase.js";
import { logger } from "../utils.js";

// Static FAQ for GoRan AI Agency (fallback if DB Knowledge Base doesn't have matches)
const STATIC_FAQ = [
  {
    keywords: ["service", "what do you do", "offer", "products"],
    answer: "GoRan AI Agency builds custom AI automation for businesses. Our primary services are: 1) WhatsApp Automation (lead qualification, support, and CRM syncing), 2) Inbound/Outbound voice calling agents (for booking meetings, confirming details, or customer follow-ups), and 3) Custom workflows integrating Google Calendar, Gmail, and CRM databases."
  },
  {
    keywords: ["price", "pricing", "cost", "how much", "charges"],
    answer: "Our WhatsApp automation packages start around $500 one-time setup fee, and voice calling agent setups start around $1000, depending on the complexity of integrations and tools needed. Ongoing costs include server hosting and direct LLM API usage. We also offer custom monthly retainer models."
  },
  {
    keywords: ["time", "timeline", "duration", "how long", "weeks"],
    answer: "Typically, a WhatsApp bot is built, tested, and deployed in 1 to 2 weeks. Custom voice calling agents with database integrations take about 2 to 3 weeks."
  },
  {
    keywords: ["case study", "portfolio", "success", "clients", "example"],
    answer: "We have successfully automated operations for several clients: Anaaj AI (automated grain supplier marketplace inquiries), HerbsEra (automated direct-to-consumer order confirmations), Hadoti Farms (voice calling scheduling), and GreenWrench (leads routing for local mechanics)."
  },
  {
    keywords: ["team", "who are you", "owner", "founded"],
    answer: "GoRan AI was founded by Ashish Ranjan to bridge the gap between advanced generative AI models and daily business operations, creating bespoke voice and chat workflows that save human hours."
  }
];

export async function checkLeadStatus(phone?: string, email?: string) {
  try {
    const query: any = {};
    if (phone) query.phone = phone;
    if (email) query.email = email;
    
    if (Object.keys(query).length === 0) {
      return { status: "unknown", message: "Please provide a phone number or email address." };
    }

    const lead = await LeadModel.findOne({
      $or: [
        ...(phone ? [{ phone }] : []),
        ...(email ? [{ email }] : [])
      ]
    });

    if (lead) {
      return {
        status: "found",
        phone: lead.phone,
        email: lead.email,
        bizType: lead.bizType,
        challenge: lead.challenge,
        score: lead.score,
        meetingTime: lead.meetingTime,
        message: `Found an existing lead records. User has discussed challenges: ${lead.challenge || "none"}. Meeting scheduled: ${lead.meetingTime || "none"}.`
      };
    } else {
      return { status: "not_found", message: "No existing lead record found in database." };
    }
  } catch (err: any) {
    logger.error("Error in checkLeadStatus:", err);
    return { status: "error", message: err.message };
  }
}

export async function captureLeadInfo(leadData: any) {
  try {
    const { phone, email, bizType, challenge, teamSize, score, scoreReason } = leadData;
    
    if (!phone) {
      return { success: false, error: "Phone number is required." };
    }

    const updateFields: any = {};
    if (email !== undefined) updateFields.email = email;
    if (bizType !== undefined) updateFields.bizType = bizType;
    if (challenge !== undefined) updateFields.challenge = challenge;
    if (teamSize !== undefined) updateFields.teamSize = teamSize;
    if (score !== undefined) updateFields.score = score;
    if (scoreReason !== undefined) updateFields.scoreReason = scoreReason;
    updateFields.timestamp = new Date().toISOString();

    const result = await LeadModel.findOneAndUpdate(
      { phone },
      { $set: updateFields },
      { upsert: true, new: true }
    );

    logger.info(`Saved lead information in database for phone: ${phone}`);
    return { success: true, lead: result };
  } catch (err: any) {
    logger.error("Error in captureLeadInfo:", err);
    return { success: false, error: err.message };
  }
}

export async function getServiceInfo(query: string) {
  try {
    const searchStr = query.toLowerCase();
    
    // First try to look up in MongoDB KnowledgeBase collection
    const kbDocs = await KnowledgeBaseModel.find({});
    if (kbDocs && kbDocs.length > 0) {
      for (const kb of kbDocs) {
        for (const doc of kb.documents) {
          if (
            doc.title.toLowerCase().includes(searchStr) ||
            doc.content.toLowerCase().includes(searchStr)
          ) {
            return {
              source: `KnowledgeBase (${kb.name})`,
              title: doc.title,
              content: doc.content
            };
          }
        }
      }
    }

    // Fallback to static GoRan AI FAQ matching
    for (const faq of STATIC_FAQ) {
      if (faq.keywords.some(k => searchStr.includes(k))) {
        return {
          source: "Static FAQ",
          content: faq.answer
        };
      }
    }

    return {
      source: "General knowledge",
      content: "GoRan AI Agency constructs specialized chat and voice solutions. We specialize in WhatsApp API integrations, real-time voice dialing agents, Google Workspace links, and custom CRM synchronizations. Let the user know we can design custom integrations."
    };
  } catch (err: any) {
    logger.error("Error in getServiceInfo:", err);
    return { error: err.message };
  }
}
