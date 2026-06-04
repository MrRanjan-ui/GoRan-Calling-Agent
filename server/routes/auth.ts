import { Router } from "express";
import { google } from "googleapis";
import { GoogleTokenModel } from "../models/GoogleToken.js";
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } from "../config.js";
import { logger } from "../utils.js";

const router = Router();

const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI
);

// GET /api/auth/google/status — Check connected Google accounts
router.get("/google/status", async (_req, res) => {
  try {
    const tokens = await GoogleTokenModel.find({});
    res.json({
      success: true,
      connections: tokens.map((t) => ({
        phoneKey: t.phoneKey,
        connected: !!t.refresh_token,
        expiryDate: t.expiry_date,
      })),
    });
  } catch (err: any) {
    logger.error("Error getting google auth status:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/auth/google — Start OAuth flow
router.get("/google", (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res
      .status(500)
      .send("Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env file.");
  }

  const phone = (req.query.phone as string) || "default";

  const scopes = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly"
  ];

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
    prompt: "consent",
    state: phone,
  });

  res.redirect(authUrl);
});

// GET /api/auth/google/callback — Handle OAuth callback
router.get("/google/callback", async (req, res) => {
  const { code, state: phone } = req.query;
  if (!code) {
    return res.status(400).send("Missing authentication code.");
  }

  try {
    const { tokens } = await oauth2Client.getToken(code as string);
    const phoneKey = (phone as string) || "default";

    const existing = await GoogleTokenModel.findOne({ phoneKey });
    const updatedToken = {
      phoneKey,
      access_token: tokens.access_token || existing?.access_token,
      refresh_token: tokens.refresh_token || existing?.refresh_token,
      expiry_date: tokens.expiry_date || existing?.expiry_date,
      scope: tokens.scope || existing?.scope,
      token_type: tokens.token_type || existing?.token_type,
    };

    await GoogleTokenModel.findOneAndUpdate(
      { phoneKey },
      updatedToken,
      { upsert: true, new: true }
    );

    res.send(`
      <html>
        <head>
          <title>Authentication Successful</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { background: #1e293b; padding: 2.5rem; border-radius: 12px; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3); text-align: center; max-width: 420px; }
            h1 { color: #10b981; font-size: 1.8rem; margin-top: 0; }
            p { color: #94a3b8; line-height: 1.5; font-size: 0.95rem; }
            .button { display: inline-block; background: #4f46e5; color: white; padding: 0.75rem 1.5rem; border-radius: 6px; text-decoration: none; margin-top: 1.5rem; font-weight: 500; }
            .button:hover { background: #4338ca; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Authentication Successful!</h1>
            <p>Your Google account has been connected to phone/session key: <strong>${phoneKey}</strong>.</p>
            <p>You can close this window now and start calling your voice agent.</p>
            <a href="/" class="button">Go back to Dashboard</a>
          </div>
        </body>
      </html>
    `);
  } catch (err: any) {
    logger.error("Failed to exchange code for tokens:", err);
    res.status(500).send(`Authentication failed: ${err.message}`);
  }
});

export default router;
