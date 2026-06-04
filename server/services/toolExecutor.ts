import { google } from "googleapis";
import { GoogleTokenModel } from "../models/GoogleToken.js";
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } from "../config.js";
import { checkLeadStatus, captureLeadInfo, getServiceInfo } from "./goranService.js";
import { createCalendarEvent, listUpcomingMeetings } from "./calendar.js";
import { sendEmail } from "./mailer.js";
import { logger } from "../utils.js";

interface FunctionCall {
  id: string;
  name: string;
  args: any;
}

interface FunctionResponse {
  id: string;
  name: string;
  response: any;
}

/**
 * Creates a per-request OAuth2 client with stored tokens for a caller.
 */
async function getAuthenticatedOAuth2(callerPhoneKey: string) {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    logger.warn("Google OAuth credentials (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET) are missing.");
    return null;
  }

  const oAuth = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );

  // Fallback to "default" token if phoneKey-specific token isn't found
  let stored = await GoogleTokenModel.findOne({ phoneKey: callerPhoneKey });
  if (!stored) {
    stored = await GoogleTokenModel.findOne({ phoneKey: "default" });
  }

  if (!stored || !stored.access_token) {
    logger.warn(`No stored Google OAuth tokens found for caller key: ${callerPhoneKey}`);
    return null;
  }

  oAuth.setCredentials({
    access_token: stored.access_token,
    refresh_token: stored.refresh_token,
    expiry_date: stored.expiry_date,
    scope: stored.scope,
    token_type: stored.token_type,
  });

  return oAuth;
}

/**
 * Unified tool call execution handler — executes local GoRan CRM/FAQ tools
 * and Google Workspace tools via OAuth if connected.
 */
export async function executeToolCalls(
  functionCalls: FunctionCall[],
  callerPhoneKey: string,
  callLogger?: any
): Promise<FunctionResponse[]> {
  const functionResponses: FunctionResponse[] = [];

  if (!functionCalls || functionCalls.length === 0) {
    return functionResponses;
  }

  for (const fc of functionCalls) {
    logger.info(`[ToolExecutor] Executing: ${fc.name}`, fc.args);

    try {
      let response: any;

      switch (fc.name) {
        // ─── Google Workspace Tools ───
        case "list_upcoming_meetings": {
          const max = fc.args?.maxResults || 5;
          try {
            const events = await listUpcomingMeetings(max);
            response = { events };
          } catch (err: any) {
            response = { error: `Failed to list upcoming meetings: ${err.message || err}` };
          }
          break;
        }

        case "schedule_meeting": {
          const { summary, description, startTime, endTime, attendeeEmail } = fc.args;
          try {
            const htmlLink = await createCalendarEvent({
              summary,
              description,
              startIso: startTime,
              endIso: endTime,
              attendeeEmail
            });

            if (htmlLink) {
              response = { success: true, htmlLink };
              
              // Try to update the lead's scheduled meeting details
              if (callerPhoneKey && callerPhoneKey !== "browser-user") {
                try {
                  await captureLeadInfo({
                    phone: callerPhoneKey,
                    meetingTime: startTime,
                    meetingLink: htmlLink
                  });
                } catch (leadErr) {
                  logger.warn(`Failed to update meeting details on lead record:`, leadErr);
                }
              }
            } else {
              response = { error: "Google Calendar service account is not configured." };
            }
          } catch (err: any) {
            response = { error: `Failed to create calendar event: ${err.message || err}` };
          }
          break;
        }

        case "send_follow_up_email": {
          const { recipientEmail, subject, body } = fc.args;
          const result = await sendEmail({
            to: recipientEmail,
            subject: subject,
            body: body
          });
          if (result.success) {
            response = { success: true, messageId: result.messageId };
          } else {
            response = { error: result.error };
          }
          break;
        }

        // ─── GoRan AI Agency Custom CRM/FAQ Tools ───
        case "check_lead_status": {
          const { phone, email } = fc.args;
          response = await checkLeadStatus(phone, email);
          break;
        }

        case "capture_lead_info": {
          const { phone, email, bizType, challenge, teamSize, score, scoreReason } = fc.args;
          response = await captureLeadInfo({
            phone: phone || callerPhoneKey,
            email,
            bizType,
            challenge,
            teamSize,
            score,
            scoreReason
          });
          break;
        }

        case "get_service_info": {
          const { query } = fc.args;
          response = await getServiceInfo(query);
          break;
        }

        default:
          response = { error: `Tool '${fc.name}' is not implemented on the server.` };
          break;
      }

      // Format response as a JSON object as required by Gemini Live
      let formattedResponse: Record<string, any>;
      if (response && typeof response === "object" && !Array.isArray(response)) {
        formattedResponse = response;
      } else {
        formattedResponse = { output: response };
      }

      functionResponses.push({ id: fc.id, name: fc.name, response: formattedResponse });
      
      if (callLogger && typeof callLogger.addToolCall === "function") {
        callLogger.addToolCall(fc.name, fc.args, response);
      }
    } catch (err: any) {
      logger.error(`[ToolExecutor] Error executing ${fc.name}:`, err?.message || err);
      const response = { error: `Failed to execute '${fc.name}': ${err?.message || err}` };
      functionResponses.push({ id: fc.id, name: fc.name, response });
      
      if (callLogger && typeof callLogger.addToolCall === "function") {
        callLogger.addToolCall(fc.name, fc.args, response);
      }
    }
  }

  return functionResponses;
}
