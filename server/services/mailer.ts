import nodemailer from "nodemailer";
import { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SENDER_EMAIL } from "../config.js";
import { logger } from "../utils.js";

// Initialize SMTP transporter lazily
let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (transporter) return transporter;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || SMTP_PASS.includes("YOUR_") || SMTP_USER.includes("your-")) {
    logger.warn("[MAIL-SERVICE] SMTP mailer settings are not configured. Skipping transporter creation.");
    return null;
  }

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465, // true for 465, false for 587 (TLS/STARTTLS)
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });

  return transporter;
}

export interface SendEmailParams {
  to: string;
  subject: string;
  body: string;
}

/**
 * Sends an email using Nodemailer SMTP transporter.
 */
export async function sendEmail(params: SendEmailParams): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const mailTransporter = getTransporter();
  if (!mailTransporter) {
    logger.warn("[MAIL-SERVICE] Transporter not initialized due to missing credentials.");
    return { success: false, error: "SMTP credentials are not configured on the server." };
  }

  try {
    const isHtml = /<[a-z][\s\S]*>/i.test(params.body);

    const mailOptions = {
      from: SENDER_EMAIL || `"GoRan AI Agency" <${SMTP_USER}>`,
      to: params.to,
      subject: params.subject,
      [isHtml ? "html" : "text"]: params.body,
    };

    const info = await mailTransporter.sendMail(mailOptions);
    logger.info(`[MAIL-SERVICE] Email sent successfully to ${params.to}. MessageID: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error: any) {
    logger.error("[MAIL-SERVICE] Email dispatch failed:", error.message || error);
    return { success: false, error: error.message || String(error) };
  }
}
