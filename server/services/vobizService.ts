import { VOBIZ_AUTH_ID, VOBIZ_AUTH_TOKEN, VOBIZ_FROM_NUMBER } from "../config.js";
import { logger } from "../utils.js";

const VOBIZ_API_BASE = "https://api.vobiz.ai/api/v1";

// ─── In-memory outbound call tracker ────────────────────────────

export interface OutboundCallState {
  callId: string;
  callUUID: string;
  personaId: string;
  toNumber: string;
  fromNumber: string;
  status: "initiated" | "ringing" | "in-progress" | "completed" | "failed" | "busy" | "no-answer";
  startedAt: Date;
  answeredAt?: Date;
  endedAt?: Date;
  transcript: Array<{ role: "user" | "agent"; text: string; timestamp: Date }>;
  error?: string;
}

/** Map of callId → OutboundCallState for active/recent outbound calls */
const activeCalls = new Map<string, OutboundCallState>();

/**
 * Generates a unique call ID for our tracking purposes.
 */
function generateCallId(): string {
  return `out_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Initiates an outbound call via the VoBiz REST API.
 * 
 * Flow:
 * 1. POST to VoBiz /Account/{auth_id}/Call/
 * 2. VoBiz rings the destination number
 * 3. When answered, VoBiz fetches our answer_url (webhook)
 * 4. Our webhook returns <Stream> XML pointing to our WebSocket
 * 5. The WebSocket handler connects to Gemini Live
 */
export async function initiateOutboundCall(
  toNumber: string,
  personaId: string,
  appUrl: string
): Promise<OutboundCallState> {
  if (!VOBIZ_AUTH_ID || !VOBIZ_AUTH_TOKEN) {
    throw new Error("VoBiz credentials not configured. Set VOBIZ_AUTH_ID and VOBIZ_AUTH_TOKEN in .env");
  }

  const fromNumber = VOBIZ_FROM_NUMBER;
  if (!fromNumber) {
    throw new Error("VOBIZ_FROM_NUMBER not configured in .env");
  }

  const callId = generateCallId();

  // Construct webhook URLs using the public app URL
  const answerUrl = `${appUrl}/api/vobiz/outbound-answer?personaId=${encodeURIComponent(personaId)}&callId=${encodeURIComponent(callId)}`;
  const hangupUrl = `${appUrl}/api/vobiz/hangup`;

  logger.info(`[VoBiz Outbound] Initiating call: ${fromNumber} → ${toNumber}`);
  logger.info(`[VoBiz Outbound] Answer URL: ${answerUrl}`);

  const requestBody = {
    from: fromNumber,
    to: toNumber,
    answer_url: answerUrl,
    answer_method: "POST",
    hangup_url: hangupUrl,
    hangup_method: "POST",
  };

  const response = await fetch(`${VOBIZ_API_BASE}/Account/${VOBIZ_AUTH_ID}/Call/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Auth-ID": VOBIZ_AUTH_ID,
      "X-Auth-Token": VOBIZ_AUTH_TOKEN,
    },
    body: JSON.stringify(requestBody),
  });

  const responseData = await response.json();

  if (!response.ok) {
    logger.error(`[VoBiz Outbound] API error:`, responseData);
    throw new Error(responseData?.error || responseData?.message || `VoBiz API returned ${response.status}`);
  }

  logger.info(`[VoBiz Outbound] Call initiated successfully:`, responseData);

  // Extract call UUID from VoBiz response
  const callUUID = responseData.request_uuid || responseData.call_uuid || responseData.uuid || "";

  const callState: OutboundCallState = {
    callId,
    callUUID,
    personaId,
    toNumber,
    fromNumber,
    status: "initiated",
    startedAt: new Date(),
    transcript: [],
  };

  activeCalls.set(callId, callState);

  // Auto-cleanup after 10 minutes
  setTimeout(() => {
    activeCalls.delete(callId);
  }, 10 * 60 * 1000);

  return callState;
}

/**
 * Updates the status of an active outbound call.
 */
export function updateCallStatus(
  callId: string,
  status: OutboundCallState["status"],
  extra?: Partial<OutboundCallState>
): void {
  const call = activeCalls.get(callId);
  if (!call) return;

  call.status = status;
  if (extra) {
    Object.assign(call, extra);
  }

  if (status === "in-progress" && !call.answeredAt) {
    call.answeredAt = new Date();
  }
  if (status === "completed" || status === "failed") {
    call.endedAt = new Date();
  }
}

/**
 * Adds a transcript line to an active outbound call.
 */
export function addCallTranscript(callId: string, role: "user" | "agent", text: string): void {
  const call = activeCalls.get(callId);
  if (!call) return;
  call.transcript.push({ role, text, timestamp: new Date() });
}

/**
 * Retrieves the current state of an outbound call.
 */
export function getCallState(callId: string): OutboundCallState | undefined {
  return activeCalls.get(callId);
}

/**
 * Lists all active outbound calls.
 */
export function listActiveCalls(): OutboundCallState[] {
  return Array.from(activeCalls.values());
}

/**
 * Terminates an outbound call via VoBiz API.
 */
export async function hangupOutboundCall(callId: string): Promise<boolean> {
  const call = activeCalls.get(callId);
  if (!call || !call.callUUID) return false;

  try {
    const response = await fetch(
      `${VOBIZ_API_BASE}/Account/${VOBIZ_AUTH_ID}/Call/${call.callUUID}/`,
      {
        method: "DELETE",
        headers: {
          "X-Auth-ID": VOBIZ_AUTH_ID,
          "X-Auth-Token": VOBIZ_AUTH_TOKEN,
        },
      }
    );
    logger.info(`[VoBiz Outbound] Hangup response: ${response.status}`);
    updateCallStatus(callId, "completed");
    return true;
  } catch (err) {
    logger.error(`[VoBiz Outbound] Hangup failed:`, err);
    return false;
  }
}
