import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

export const PORT = process.env.PORT || 3000;
export const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/goran-calling-agent";
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash-exp";

// Google Workspace OAuth Credentials (for Calendar and Gmail tool execution)
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
export const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/api/auth/google/callback";

// VoBiz Telephony Config
export const VOBIZ_AUTH_ID = process.env.VOBIZ_AUTH_ID || "";
export const VOBIZ_AUTH_TOKEN = process.env.VOBIZ_AUTH_TOKEN || "";
export const VOBIZ_FROM_NUMBER = process.env.VOBIZ_FROM_NUMBER || "";
export const VOBIZ_SIP_DOMAIN = process.env.VOBIZ_SIP_DOMAIN || "";

// Twilio Telephony Config
export const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
export const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
export const TWILIO_TWIML_APP_SID = process.env.TWILIO_TWIML_APP_SID || "";

export async function connectDb() {
  try {
    console.log(`🔌 Connecting to MongoDB...`);
    await mongoose.connect(MONGODB_URI);
    console.log("✅ Successfully connected to MongoDB via Mongoose.");
  } catch (error) {
    console.error("❌ Failed to connect to MongoDB:", error);
    process.exit(1);
  }
}
