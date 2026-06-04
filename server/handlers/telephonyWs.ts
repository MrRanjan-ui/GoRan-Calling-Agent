import { WebSocket } from "ws";
import type { LiveServerMessage } from "@google/genai";
import { getGeminiClient, getCompiledSystemInstruction, allToolDeclarations, GEMINI_MODEL, Modality } from "../services/gemini.js";
import { executeToolCalls } from "../services/toolExecutor.js";
import { CallLogger } from "../services/callLogger.js";
import { PersonaModel } from "../models/Persona.js";
import { LeadModel } from "../models/Lead.js";
import { addCallTranscript, updateCallStatus } from "../services/vobizService.js";
import { generateCallSummary } from "../services/summaryService.js";
import {
  decodeMulaw, encodeMulaw,
  base64ToInt16Array, int16ArrayToBase64,
  resampleInt16Pcm,
} from "../services/audioCodec.js";
import { logger, logToFile } from "../utils.js";

/**
 * Handles a telephony WebSocket connection at /api/sip/live (VoBiz) or /api/twilio/live.
 * Receives G.711 μ-law (Twilio) or L16 PCM (Vobiz) audio, transcodes, and pipes to Gemini Live.
 */
export async function handleTelephonyWebSocket(telephonyWs: WebSocket, request: any): Promise<void> {
  const upgradeUrl = new URL(request.url || "", `http://localhost`);
  const isVobizStream = upgradeUrl.pathname === "/api/sip/live";
  const providerName = isVobizStream ? "Vobiz" : "Twilio";
  const provider = isVobizStream ? "vobiz" : "twilio";

  logToFile(`[${providerName} WS] Connection initiated. Path: ${upgradeUrl.pathname}, Query: ${upgradeUrl.search}`);

  const personaId = upgradeUrl.searchParams.get("personaId") || "riya-inbound";
  const callerNumber = decodeURIComponent(upgradeUrl.searchParams.get("callerNumber") || "");
  const outboundCallId = upgradeUrl.searchParams.get("callId") || "";
  const direction = (upgradeUrl.searchParams.get("direction") || "inbound") as "inbound" | "outbound";

  logToFile(`[${providerName} WS] Connection details -> personaId: ${personaId}, callerNumber: ${callerNumber}, outboundCallId: ${outboundCallId}, direction: ${direction}`);

  // Resolve persona
  let persona = await PersonaModel.findOne({ id: personaId });
  if (!persona) persona = await PersonaModel.findOne({ isDefault: true });
  if (!persona) persona = await PersonaModel.findOne({});
  if (!persona) {
    logToFile(`[${providerName} WS] Error: No persona found in database. Closing WebSocket.`);
    telephonyWs.close();
    return;
  }

  logToFile(`[${providerName} WS] Routing to persona: ${persona.name} (${persona.role})`);

  // Initialize call logger
  const callLogger = new CallLogger(persona.id, persona.name, callerNumber || "unknown", provider as any, direction);

  let geminiSession: any = null;
  let streamSid = "";
  let isInitiated = false;
  let isToolCallPending = false;
  let startReceived = false;
  let greetingSent = false;
  let mediaFrameCount = 0;
  let outputAudioChunkCount = 0;
  let inboundEncoding = isVobizStream ? "audio/x-l16" : "audio/x-mulaw";
  let inboundSampleRate = isVobizStream ? 16000 : 8000;

  const sendGreeting = () => {
    if (greetingSent) return;
    if (isInitiated && geminiSession && (startReceived || isVobizStream)) {
      greetingSent = true;
      setTimeout(() => {
        try {
          const greetingText = direction === "outbound" 
            ? `Call connected. Introduce yourself immediately as ${persona?.name} from GoRan AI Agency. State the reason for calling politely and ask how they're doing.`
            : `Call connected. Greet the caller now warmly as ${persona?.name} from GoRan AI Agency, and ask how you can help them automate their business today.`;
            
          geminiSession.sendClientContent({
            turns: [
              {
                role: "user",
                parts: [{ text: greetingText }],
              },
            ],
            turnComplete: true,
          });
          logger.info(`[${providerName}] Greeting dispatched.`);
        } catch (err: any) {
          logger.error(`[${providerName}] Failed to send greeting:`, err?.message || err);
        }
      }, 500);
    }
  };

  try {
    const ai = getGeminiClient();
    const baseInstruction = persona.systemInstruction || "You are a helpful calling agent.";
    const compiledInstruction = await getCompiledSystemInstruction(baseInstruction, persona.knowledgeBaseId);
    
    // Inject client history context if they are an existing Lead in our database
    let customContextInstruction = "";
    if (callerNumber && callerNumber !== "outbound") {
      try {
        const lead = await LeadModel.findOne({ phone: callerNumber });
        if (lead) {
          logToFile(`[${providerName} WS] Found existing CRM lead record for caller: ${callerNumber}`);
          customContextInstruction = `\n\n### CRITICAL CLIENT HISTORY CONTEXT
We have existing records for this caller in our GoRan CRM:
- Email Address: ${lead.email || "Not yet captured"}
- Business Type: ${lead.bizType || "Not yet captured"}
- Primary Challenge: ${lead.challenge || "Not yet captured"}
- Team Size: ${lead.teamSize || "Not yet captured"}
- Lead Score: ${lead.score || "Low"}
- Scheduled Strategy Call: ${lead.meetingTime || "None scheduled yet"}

IMPORTANT: Use this information naturally. Do not ask for their business type or email if they are already recorded above, but confirm them if they ask or if scheduling a meeting.`;
        }
      } catch (leadErr) {
        logToFile(`[${providerName} WS] Error querying lead record: ${leadErr}`);
      }
    }

    const instruction = compiledInstruction + customContextInstruction;
    const temperature = typeof (persona as any).temperature === "number" ? (persona as any).temperature : 0.7;

    logger.info(`[${providerName}] Connecting Gemini Live. Voice: ${persona.voice}. Temp: ${temperature}`);

    geminiSession = await ai.live.connect({
      model: GEMINI_MODEL,
      callbacks: {
        onmessage: async (msg: LiveServerMessage) => {
          try {
            // Handle tool calls via shared executor
            if ((msg as any).toolCall?.functionCalls) {
              isToolCallPending = true;
              try {
                const callerKey = callerNumber.replace(/^\+/, "").trim() || "default";
                const responses = await executeToolCalls(
                  (msg as any).toolCall.functionCalls,
                  callerKey,
                  callLogger
                );

                if (responses.length > 0 && geminiSession) {
                  geminiSession.sendToolResponse({ functionResponses: responses });
                }
              } finally {
                isToolCallPending = false;
              }
            }

            // Handle interruptions
            if (msg.serverContent?.interrupted && streamSid) {
              if (telephonyWs.readyState === WebSocket.OPEN && !isVobizStream) {
                telephonyWs.send(JSON.stringify({ event: "clear", streamSid }));
              }
            }

            // Transcription logging
            if (msg.serverContent?.outputTranscription?.text) {
              const text = msg.serverContent.outputTranscription.text;
              callLogger.addTranscript("agent", text);
              if (outboundCallId) addCallTranscript(outboundCallId, "agent", text);
            }
            if (msg.serverContent?.inputTranscription?.text) {
              const text = msg.serverContent.inputTranscription.text;
              callLogger.addTranscript("user", text);
              if (outboundCallId) addCallTranscript(outboundCallId, "user", text);
            }

            // Forward audio to telephony channel
            const parts = msg.serverContent?.modelTurn?.parts;
            if (parts) {
              for (const part of parts) {
                if (part.inlineData?.data && (streamSid || isVobizStream)) {
                  const base64PCM = part.inlineData.data;
                  outputAudioChunkCount++;
                  callLogger.incrementPackets("out");

                  if (telephonyWs.readyState === WebSocket.OPEN) {
                    const pcm24k = base64ToInt16Array(base64PCM);
                    const pcm16k = resampleInt16Pcm(pcm24k, 24000, 16000);
                    callLogger.addAudioChunk("agent", pcm16k);

                    if (isVobizStream) {
                      // Gemini 24kHz → 16kHz L16 for Vobiz
                      telephonyWs.send(JSON.stringify({
                        event: "playAudio",
                        media: {
                          contentType: "audio/x-l16",
                          sampleRate: 16000,
                          payload: int16ArrayToBase64(pcm16k),
                        },
                      }));
                    } else {
                      // Gemini 24kHz → 8kHz μ-law for Twilio
                      const mulawCount = Math.floor(pcm24k.length / 3);
                      const mulawBytes = new Uint8Array(mulawCount);
                      for (let i = 0; i < mulawCount; i++) {
                        mulawBytes[i] = encodeMulaw(pcm24k[i * 3]);
                      }
                      const mulawBase64 = Buffer.from(mulawBytes.buffer, mulawBytes.byteOffset, mulawBytes.byteLength).toString("base64");
                      telephonyWs.send(JSON.stringify({
                        event: "media",
                        streamSid,
                        media: { payload: mulawBase64 },
                      }));
                    }
                  }
                }
              }
            }
          } catch (err) {
            logger.error(`[${providerName}] Transcoding error:`, err);
          }
        },
        onclose: () => {
          logger.info(`[${providerName}] Gemini connection completed.`);
          telephonyWs.close();
        },
        onerror: (err: any) => {
          logger.error(`[${providerName}] Gemini error:`, err);
          callLogger.markFailed(err?.message || "Gemini error");
          telephonyWs.close();
        },
      },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: persona.voice } },
        },
        systemInstruction: instruction,
        temperature,
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        tools: [{ functionDeclarations: allToolDeclarations }],
      },
    });

    isInitiated = true;
    callLogger.markConnected();
    logToFile(`[${providerName} WS] Successfully established Gemini Live session!`);
    sendGreeting();
  } catch (err: any) {
    logToFile(`[${providerName} WS] ERROR: Failed to establish Gemini session: ${err?.message || err}`);
    callLogger.markFailed(err?.message || "Connection failed");
    await callLogger.finalize();
    telephonyWs.close();
    return;
  }

  // Handle incoming audio from telephony gateway
  telephonyWs.on("message", (rawMessage) => {
    try {
      const data = JSON.parse(rawMessage.toString());

      if (data.event === "start") {
        streamSid = data.start?.streamSid || data.start?.streamId || data.streamSid || data.streamId || "";
        logToFile(`[${providerName} WS] Stream active event received. streamSid: ${streamSid}`);
        if (isVobizStream) {
          inboundEncoding = data.start?.mediaFormat?.encoding || inboundEncoding;
          inboundSampleRate = Number(data.start?.mediaFormat?.sampleRate || inboundSampleRate);
        }
        startReceived = true;
        sendGreeting();
        return;
      }

      if (data.event === "media") {
        if (!isInitiated || !geminiSession) return;
        if (isToolCallPending) {
          // Discard incoming packets during tool call execution to prevent Policy Violation
          return;
        }
        const payloadBase64 = data.media.payload;
        mediaFrameCount++;
        callLogger.incrementPackets("in");

        let pcm16Samples: Int16Array;
        if (inboundEncoding === "audio/x-l16") {
          const inboundPcm = base64ToInt16Array(payloadBase64);
          pcm16Samples = resampleInt16Pcm(inboundPcm, inboundSampleRate, 16000);
        } else {
          // μ-law 8kHz → PCM 16kHz via linear interpolation
          const mulawBuffer = Buffer.from(payloadBase64, "base64");
          pcm16Samples = new Int16Array(mulawBuffer.length * 2);
          for (let i = 0; i < mulawBuffer.length; i++) {
            const currentSample = decodeMulaw(mulawBuffer[i]);
            pcm16Samples[i * 2] = currentSample;
            if (i < mulawBuffer.length - 1) {
              const nextSample = decodeMulaw(mulawBuffer[i + 1]);
              pcm16Samples[i * 2 + 1] = Math.round((currentSample + nextSample) / 2);
            } else {
              pcm16Samples[i * 2 + 1] = currentSample;
            }
          }
        }

        const base64PCM = int16ArrayToBase64(pcm16Samples);
        callLogger.addAudioChunk("user", pcm16Samples);
        geminiSession.sendRealtimeInput({
          audio: { data: base64PCM, mimeType: "audio/pcm;rate=16000" },
        });
        return;
      }

      if (data.event === "stop") {
        logToFile(`[${providerName} WS] Stop event received. Caller hung up.`);
        telephonyWs.close();
        return;
      }
    } catch (err: any) {
      logToFile(`[${providerName} WS] ERROR parsing message: ${err?.message || err}`);
    }
  });

  telephonyWs.on("close", async () => {
    logToFile(`[${providerName} WS] Socket closed.`);
    if (geminiSession) {
      try { geminiSession.close(); } catch {}
    }
    callLogger.markCompleted(direction === "outbound" ? "Outbound call ended" : "Caller disconnected");
    if (outboundCallId) updateCallStatus(outboundCallId, "completed");
    await callLogger.finalize();

    // Trigger background AI summarization!
    void generateCallSummary(callLogger.getCallId());
  });
}
