import { google } from "googleapis";
import { GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_CALENDAR_ID } from "../config.js";
import { logger } from "../utils.js";

const calendar = google.calendar("v3");

// Replace escaped newlines in keys if they are stored in .env as single strings
const privateKey = (GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
const calendarId = GOOGLE_CALENDAR_ID || "primary";

// Authenticate Google APIs client with JWT (Service Account)
const auth = new google.auth.JWT({
  email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: privateKey,
  scopes: ["https://www.googleapis.com/auth/calendar"],
});

export interface CreateEventParams {
  summary: string;
  description: string;
  startIso: string;
  endIso: string;
  attendeeEmail: string;
}

/**
 * Creates an event on the configured Google Calendar via Google Calendar API.
 * Returns the calendar event HTML link on success, or null if disabled.
 */
export async function createCalendarEvent(params: CreateEventParams): Promise<string | null> {
  // If credentials are placeholder defaults, treat as disabled/empty
  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !privateKey || privateKey.includes("YOUR_") || GOOGLE_SERVICE_ACCOUNT_EMAIL.includes("your-")) {
    logger.warn("[CALENDAR-SERVICE] Google Service Account credentials are not configured. Skipping event creation.");
    return null;
  }

  try {
    const event = {
      summary: params.summary,
      description: params.description,
      start: {
        dateTime: params.startIso,
        timeZone: "Asia/Kolkata", // Set to Indian Standard Time (IST) by default
      },
      end: {
        dateTime: params.endIso,
        timeZone: "Asia/Kolkata",
      },
      reminders: {
        useDefault: true,
      },
    };

    const response = await calendar.events.insert({
      auth: auth,
      calendarId: calendarId,
      requestBody: event,
      sendUpdates: "none",
    });

    const eventLink = response.data.htmlLink || "success";
    logger.info(`[CALENDAR-SERVICE] Created calendar event. Link: ${eventLink}`);
    return eventLink;
  } catch (error: any) {
    logger.error("[CALENDAR-SERVICE] Failed to create Google Calendar event:", error.message || error);
    throw error;
  }
}

/**
 * Lists upcoming strategy calls/consultations on the Google Calendar.
 */
export async function listUpcomingMeetings(maxResults: number = 5): Promise<any[]> {
  // If credentials are placeholder defaults, treat as empty
  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !privateKey || privateKey.includes("YOUR_") || GOOGLE_SERVICE_ACCOUNT_EMAIL.includes("your-")) {
    logger.warn("[CALENDAR-SERVICE] Google Service Account credentials are not configured. Skipping listing meetings.");
    return [];
  }

  try {
    const res = await calendar.events.list({
      auth: auth,
      calendarId: calendarId,
      timeMin: new Date().toISOString(),
      maxResults: maxResults,
      singleEvents: true,
      orderBy: "startTime",
    });

    return res.data.items?.map(e => ({
      summary: e.summary,
      start: e.start?.dateTime || e.start?.date,
      end: e.end?.dateTime || e.end?.date,
    })) || [];
  } catch (error: any) {
    logger.error("[CALENDAR-SERVICE] Failed to list Google Calendar events:", error.message || error);
    throw error;
  }
}
