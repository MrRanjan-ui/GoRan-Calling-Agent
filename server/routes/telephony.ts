import { Router } from "express";
import { getPublicAppUrl, logger, logToFile } from "../utils.js";
import { LeadModel } from "../models/Lead.js";
import {
  initiateOutboundCall,
  getCallState,
  hangupOutboundCall,
  updateCallStatus,
} from "../services/vobizService.js";

const router = Router();

// ─── Twilio TwiML Webhook (Inbound Call) ──────────────────────────

router.all("/twilio/incoming-call", (req, res) => {
  const appUrl = getPublicAppUrl(req);
  const streamUrl = appUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
  const targetId = req.query.personaId || "riya-inbound";
  const callerNumber = encodeURIComponent(req.body?.From || req.query.From || "");

  logger.info(`[Twilio Webhook] Inbound call received! Target Persona: ${targetId}, From: ${callerNumber}`);

  res.type("text/xml");
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Aditi">Connecting you to GoRan AI Sales Consultant. Please wait.</Say>
  <Connect>
    <Stream url="${streamUrl}/api/twilio/live?personaId=${targetId}&amp;callerNumber=${callerNumber}" />
  </Connect>
</Response>`);
});

// ─── VoBiz / SIP Webhook (Inbound Call) ──────────────────────────

function sendVobizStreamXml(req: any, res: any) {
  const appUrl = getPublicAppUrl(req);
  const streamUrl = appUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
  const targetId = req.query.personaId || "riya-inbound";
  const callerNumber = encodeURIComponent(req.body?.From || req.query.From || req.query.caller || "");
  const callId = req.query.callId || "";
  const direction = req.query.direction || "inbound";

  logger.info(`[VoBiz Webhook] Inbound SIP call! Target Persona: ${targetId}, From: ${callerNumber}`);

  res.type("text/xml");
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak>Connecting you to GoRan AI Sales Consultant. Please wait.</Speak>
  <Stream bidirectional="true" keepCallAlive="true" audioTrack="inbound" contentType="audio/x-l16;rate=16000">
    ${streamUrl}/api/sip/live?personaId=${targetId}&amp;callerNumber=${callerNumber}&amp;callId=${callId}&amp;direction=${direction}
  </Stream>
</Response>`);
}

router.all("/vobiz/incoming-call", sendVobizStreamXml);
router.all("/sip/incoming-call", sendVobizStreamXml);

router.all("/vobiz/hangup", (req, res) => {
  logger.info("[VoBiz Webhook] Hangup event received from telephony gateway.");
  res.status(200).json({ success: true });
});

// ─── Outbound Call: Answer Webhook ──────────────────────────────

router.all("/vobiz/outbound-answer", (req, res) => {
  const appUrl = getPublicAppUrl(req);
  const streamUrl = appUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
  const personaId = req.query.personaId || "arjun-outbound";
  const callId = (req.query.callId as string) || "";

  logToFile(`[VoBiz Webhook] Outbound answer webhook triggered. PersonaId: ${personaId}, CallId: ${callId}`);

  // Mark the outbound call as in-progress
  if (callId) {
    updateCallStatus(callId, "in-progress");
  }

  const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream bidirectional="true" keepCallAlive="true" audioTrack="inbound" contentType="audio/x-l16;rate=16000">
    ${streamUrl}/api/sip/live?personaId=${personaId}&amp;callerNumber=outbound&amp;callId=${callId}&amp;direction=outbound
  </Stream>
</Response>`;

  res.type("text/xml");
  res.send(xmlResponse);
});

// ─── REST API: Initiate Outbound Call ─────────────────────────

router.post("/outbound/call", async (req, res) => {
  try {
    const { toNumber, personaId } = req.body;

    if (!toNumber) {
      return res.status(400).json({ success: false, error: "Missing 'toNumber' in request body." });
    }

    const appUrl = getPublicAppUrl(req);
    logger.info(`[Outbound] Triggering outbound call: ${toNumber}, persona: ${personaId}, appUrl: ${appUrl}`);
    
    const callState = await initiateOutboundCall(
      toNumber,
      personaId || "arjun-outbound",
      appUrl
    );

    res.json({
      success: true,
      callId: callState.callId,
      callUUID: callState.callUUID,
      status: callState.status,
    });
  } catch (err: any) {
    logger.error("[Outbound] Failed to trigger outbound call:", err);
    res.status(500).json({ success: false, error: err.message || "Failed to trigger outbound call." });
  }
});

// ─── REST API: Poll Outbound Status ──────────────────────────────

router.get("/outbound/status/:callId", (req, res) => {
  const callState = getCallState(req.params.callId);
  if (!callState) {
    return res.status(404).json({ success: false, error: "Call not found." });
  }

  const duration = callState.answeredAt
    ? Math.floor((Date.now() - callState.answeredAt.getTime()) / 1000)
    : 0;

  res.json({
    success: true,
    callId: callState.callId,
    status: callState.status,
    toNumber: callState.toNumber,
    fromNumber: callState.fromNumber,
    duration,
    transcript: callState.transcript,
    error: callState.error,
  });
});

// ─── REST API: Hangup Outbound Call ────────────────────────────────

router.post("/outbound/hangup/:callId", async (req, res) => {
  const success = await hangupOutboundCall(req.params.callId);
  res.json({ success });
});

// ─── REST API: Trigger Follow-up Calls Scanner ──────────────────

router.post("/leads/trigger-followups", async (req, res) => {
  try {
    const appUrl = getPublicAppUrl(req);
    logger.info(`[Follow-up Scanner] Scanning leads for outbound follow-up calls...`);
    
    // Find leads qualified as High/Medium who do NOT have a scheduled meeting time
    const leads = await LeadModel.find({
      score: { $in: ["high", "medium"] },
      meetingTime: { $eq: "" }
    });

    const triggeredLeads: string[] = [];

    for (const lead of leads) {
      if (!lead.phone) continue;
      
      try {
        let formattedNumber = lead.phone.trim();
        if (!formattedNumber.startsWith("+")) {
          // Indian region formatting default fallback
          formattedNumber = "+91" + formattedNumber.replace(/^0+/, "");
        }

        logger.info(`[Follow-up Scanner] Triggering call to qualified lead: ${formattedNumber}`);
        await initiateOutboundCall(formattedNumber, "arjun-outbound", appUrl);
        triggeredLeads.push(lead.phone);
      } catch (err: any) {
        logger.error(`[Follow-up Scanner] Failed calling lead ${lead.phone}: ${err.message}`);
      }
    }

    res.json({
      success: true,
      triggeredCount: triggeredLeads.length,
      triggeredLeads,
      message: `Scanned and triggered ${triggeredLeads.length} outbound follow-up call(s).`,
    });
  } catch (err: any) {
    logger.error("[Follow-up Scanner] Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
