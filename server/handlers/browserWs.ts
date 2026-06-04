import type { WebSocket } from "ws";
import type { LiveServerMessage } from "@google/genai";
import { getGeminiClient, getCompiledSystemInstruction, allToolDeclarations, GEMINI_MODEL, Modality } from "../services/gemini.js";
import { executeToolCalls } from "../services/toolExecutor.js";
import { CallLogger } from "../services/callLogger.js";
import { PersonaModel } from "../models/Persona.js";
import { base64ToInt16Array, resampleInt16Pcm } from "../services/audioCodec.js";
import { generateCallSummary } from "../services/summaryService.js";
import { logger } from "../utils.js";

/**
 * Handles a browser WebSocket connection at /ws/browser.
 * Receives setup + raw PCM audio from the browser and pipes it to Gemini Live.
 */
/** Timeout (ms) for individual tool executions. If a tool doesn't return in this time, we return an error to Gemini. */
const TOOL_EXECUTION_TIMEOUT_MS = 12_000;

export async function handleBrowserWebSocket(clientWs: WebSocket): Promise<void> {
  logger.info("[WS] Client connected. Waiting for setup details...");

  let geminiSession: any = null;
  let isInitiated = false;
  let isToolCallPending = false;
  let sessionAlive = false;
  let callLogger: CallLogger | null = null;

  /** Safe wrapper: only sends if clientWs is still open. Prevents crashes during tool execution. */
  function safeSend(payload: object): boolean {
    try {
      if (clientWs.readyState === 1 /* WebSocket.OPEN */) {
        clientWs.send(JSON.stringify(payload));
        return true;
      }
    } catch (err) {
      logger.warn("[WS] safeSend failed:", (err as Error).message);
    }
    return false;
  }

  clientWs.on("message", async (data) => {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === "setup") {
        if (isInitiated) {
          clientWs.send(JSON.stringify({ type: "error", message: "Session already initiated." }));
          return;
        }

        let voice = message.voice || "Aoede";
        let baseInstruction = message.systemInstruction || "";
        let kbId = message.knowledgeBaseId;
        let temperature = typeof message.temperature === "number" ? message.temperature : 0.7;
        let googlePhoneKey = message.googlePhoneKey || "default";
        let personaId = message.personaId || "riya-inbound";
        let personaName = message.personaName || "Riya";

        // Fetch persona details dynamically from the database
        try {
          const persona = await PersonaModel.findOne({ id: personaId });
          if (persona) {
            voice = persona.voice;
            baseInstruction = persona.systemInstruction;
            kbId = persona.knowledgeBaseId;
            personaName = persona.name;
            logger.info(`[WS] Resolved database persona: ${personaName} (Voice: ${voice})`);
          } else {
            logger.warn(`[WS] Persona ${personaId} not found in database. Falling back to default.`);
            const defaultPersona = await PersonaModel.findOne({ isDefault: true }) || await PersonaModel.findOne({});
            if (defaultPersona) {
              voice = defaultPersona.voice;
              baseInstruction = defaultPersona.systemInstruction;
              kbId = defaultPersona.knowledgeBaseId;
              personaName = defaultPersona.name;
              personaId = defaultPersona.id;
            }
          }
        } catch (dbErr) {
          logger.error(`[WS] Error loading persona ${personaId} from DB:`, dbErr);
        }

        // Final fallback if instructions are still completely empty
        if (!baseInstruction) {
          baseInstruction = "You are a helpful calling agent.";
        }

        const instruction = await getCompiledSystemInstruction(baseInstruction, kbId);

        // Initialize call logger
        callLogger = new CallLogger(personaId, personaName, "browser-user", "browser", "outbound");

        logger.info(`[WS] Setting up Gemini. Voice: ${voice}. Instruction: ${instruction.length} chars. Temp: ${temperature}`);

        try {
          const ai = getGeminiClient();

          geminiSession = await ai.live.connect({
            model: GEMINI_MODEL,
            callbacks: {
              onmessage: async (msg: LiveServerMessage) => {
                try {
                  // Handle tool calls
                  if ((msg as any).toolCall?.functionCalls) {
                    isToolCallPending = true;
                    safeSend({ type: "status", message: "tool-active" });
                    try {
                      // Race the tool execution against a timeout to prevent Gemini from disconnecting
                      const toolPromise = executeToolCalls(
                        (msg as any).toolCall.functionCalls,
                        googlePhoneKey,
                        callLogger ?? undefined
                      );
                      const timeoutPromise = new Promise<never>((_, reject) =>
                        setTimeout(() => reject(new Error("Tool execution timed out")), TOOL_EXECUTION_TIMEOUT_MS)
                      );

                      let responses;
                      try {
                        responses = await Promise.race([toolPromise, timeoutPromise]);
                      } catch (timeoutErr) {
                        logger.error("[WS] Tool execution timed out, sending error response to Gemini");
                        // Construct error responses for every pending function call
                        responses = (msg as any).toolCall.functionCalls.map((fc: any) => ({
                          id: fc.id,
                          name: fc.name,
                          response: { error: "Tool execution timed out. Please inform the caller and try again." },
                        }));
                      }

                      if (responses.length > 0 && geminiSession && sessionAlive) {
                        try {
                          geminiSession.sendToolResponse({ functionResponses: responses });
                        } catch (sendErr) {
                          logger.error("[WS] Failed to send tool response to Gemini:", (sendErr as Error).message);
                        }
                      }
                    } finally {
                      isToolCallPending = false;
                      safeSend({ type: "status", message: "tool-inactive" });
                    }
                  }

                  // Forward audio + text content
                  const parts = msg.serverContent?.modelTurn?.parts;
                  if (parts) {
                    for (const part of parts) {
                      if (part.inlineData?.data) {
                        safeSend({ type: "audio", data: part.inlineData.data });
                        callLogger?.incrementPackets("out");

                        // Record agent audio chunk (24kHz -> 16kHz PCM mono)
                        const pcm24 = base64ToInt16Array(part.inlineData.data);
                        const pcm16 = resampleInt16Pcm(pcm24, 24000, 16000);
                        callLogger?.addAudioChunk("agent", pcm16);
                      }
                      if (part.text) {
                        safeSend({ type: "output-transcription", text: part.text });
                        callLogger?.addTranscript("agent", part.text);
                      }
                    }
                  }

                  if (msg.serverContent?.interrupted) {
                    safeSend({ type: "interrupted" });
                  }

                  // Transcription events
                  if (msg.serverContent?.outputTranscription?.text) {
                    const text = msg.serverContent.outputTranscription.text;
                    safeSend({ type: "output-transcription", text });
                    callLogger?.addTranscript("agent", text);
                  }
                  if (msg.serverContent?.inputTranscription?.text) {
                    const text = msg.serverContent.inputTranscription.text;
                    safeSend({ type: "input-transcription", text });
                    callLogger?.addTranscript("user", text);
                  }
                } catch (err: any) {
                  logger.error("[WS] Error forwarding message from Gemini:", err);
                }
              },
              onclose: () => {
                logger.info("[WS] Gemini connection closed.");
                sessionAlive = false;
                safeSend({ type: "status", message: "disconnected", detail: "Gemini connection closed" });
              },
              onerror: (err: any) => {
                logger.error("[WS] Gemini error:", err);
                sessionAlive = false;
                safeSend({ type: "error", message: err?.message || "Gemini Live API error" });
              },
            },
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
              },
              systemInstruction: instruction,
              temperature,
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              tools: [{ functionDeclarations: allToolDeclarations }],
            },
          });

          isInitiated = true;
          sessionAlive = true;
          callLogger.markConnected();
          safeSend({
            type: "status",
            message: "connected",
            callId: callLogger.getCallId(),
          });
          logger.info("[WS] Gemini Live session connected!");

          // Trigger agent to speak first immediately upon connection
          setTimeout(() => {
            try {
              if (geminiSession && sessionAlive) {
                const greetingText = `Call connected. Greet the caller now warmly as ${personaName} from GoRan AI Agency, and ask how you can help them automate their business today.`;
                geminiSession.sendClientContent({
                  turns: [
                    {
                      role: "user",
                      parts: [{ text: greetingText }],
                    },
                  ],
                  turnComplete: true,
                });
                logger.info("[WS] Greeting dispatched.");
              }
            } catch (err: any) {
              logger.error("[WS] Failed to send browser greeting:", err?.message || err);
            }
          }, 500);
        } catch (err: any) {
          logger.error("[WS] Failed to connect to Gemini Live:", err);
          callLogger?.markFailed(err?.message || "Connection failed");
          await callLogger?.finalize();
          clientWs.send(JSON.stringify({
            type: "error",
            message: err?.message || "Could not spin up Gemini Live session.",
          }));
        }
        return;
      }

      // Handle raw audio input
      if (message.type === "audio") {
        if (!isInitiated || !geminiSession || !sessionAlive) return;
        if (isToolCallPending) {
          // Discard incoming audio packets while a tool call is active to prevent Policy Violation
          return;
        }

        // Record user audio chunk (16kHz PCM mono)
        const pcm16 = base64ToInt16Array(message.data);
        callLogger?.addAudioChunk("user", pcm16);

        geminiSession.sendRealtimeInput({
          audio: { data: message.data, mimeType: "audio/pcm;rate=16000" },
        });
        callLogger?.incrementPackets("in");
        return;
      }

      if (message.type === "ping") {
        clientWs.send(JSON.stringify({ type: "pong", id: message.id }));
        return;
      }

      if (message.type === "telemetry") {
        if (callLogger) {
          callLogger.setTelemetry(message.latencyMs, message.jitterMs);
        }
        return;
      }

      if (message.type === "interrupt") {
        logger.info("[WS] Client requested interrupt.");
        return;
      }
    } catch (err: any) {
      logger.error("[WS] Error parsing client message:", err);
    }
  });

  clientWs.on("close", async () => {
    logger.info("[WS] Client disconnected. Cleaning up...");
    if (geminiSession) {
      try { geminiSession.close(); } catch {}
    }
    if (callLogger) {
      callLogger.markCompleted("Client disconnected");
      await callLogger.finalize();
      
      // Trigger background AI summarization
      void generateCallSummary(callLogger.getCallId());
    }
  });
}
