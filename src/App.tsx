import { useState, useRef, useEffect } from "react";
import { Persona, CallState, ChatMessage } from "./types";
import { AVAILABLE_PERSONAS } from "./data/defaultPersonas";
import { PersonaList } from "./components/PersonaList";
import { DialPad } from "./components/DialPad";
import { CallConsole } from "./components/CallConsole";
import { TranscriptList } from "./components/TranscriptList";
import { CallStats } from "./components/CallStats";
import { AgentCreator } from "./components/AgentCreator";
import { KnowledgeBaseManager } from "./components/KnowledgeBaseManager";
import { AnalyticsDashboard } from "./components/AnalyticsDashboard";
import { OutboundCaller } from "./components/OutboundCaller";
import { ClientPortal } from "./components/ClientPortal";
import { float32ToInt16, arrayBufferToBase64, base64ToFloat32, startAmbientNoise } from "./utils/audio";
import { 
  Phone, CheckCircle, Flame, Shield, Server, ArrowUpRight, 
  Users, Plus, PhoneCall, Database, Sparkles, Trash2, Edit, AlertCircle, Info, Volume2, BarChart3, PhoneOutgoing
} from "lucide-react";

type PageID = "dashboard" | "creator" | "call" | "knowledge" | "analytics" | "outbound";

function resampleFloat32(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) {
    return input;
  }
  const outputLength = Math.max(1, Math.floor(input.length * toRate / fromRate));
  const output = new Float32Array(outputLength);
  const ratio = fromRate / toRate;
  for (let i = 0; i < outputLength; i++) {
    const sourceIndex = i * ratio;
    const leftIndex = Math.floor(sourceIndex);
    const rightIndex = Math.min(leftIndex + 1, input.length - 1);
    const fraction = sourceIndex - leftIndex;
    output[i] = input[leftIndex] * (1 - fraction) + input[rightIndex] * fraction;
  }
  return output;
}

export default function App() {
  const [activePage, setActivePage] = useState<PageID>("dashboard");
  const [sipTutorialTab, setSipTutorialTab] = useState<"sip" | "vobiz" | "asterisk" | "twilio">("sip");
  const [editingPersona, setEditingPersona] = useState<Persona | null>(null);

  // Dynamic state for list of personas loaded from MongoDB
  const [personas, setPersonas] = useState<Persona[]>(AVAILABLE_PERSONAS);
  interface GoogleConnection {
    phoneKey: string;
    connected: boolean;
    expiryDate?: number;
  }
  const [googleConnections, setGoogleConnections] = useState<GoogleConnection[]>([]);
  const [dbStatus, setDbStatus] = useState<"connecting" | "connected" | "error">("connecting");

  const fetchServerPersonas = async () => {
    try {
      const res = await fetch("/api/personas");
      const json = await res.json();
      if (json.success && json.data && json.data.length > 0) {
        setPersonas(json.data);
        setSelectedPersona(json.data[0]);
      }
    } catch (err) {
      console.warn("Could not sync with server-side database. Using offline fallback.", err);
    }
  };

  const fetchGoogleStatus = async () => {
    try {
      const res = await fetch("/api/auth/google/status");
      const json = await res.json();
      if (json.success && json.connections) {
        setGoogleConnections(json.connections);
        setDbStatus("connected");
      }
    } catch (err) {
      console.error("Error fetching Google OAuth status:", err);
      setDbStatus("error");
    }
  };

  // Pull personas and connection statuses on startup and poll integrations
  useEffect(() => {
    fetchServerPersonas();
    fetchGoogleStatus();
    const interval = setInterval(() => {
      fetchGoogleStatus();
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const [selectedPersona, setSelectedPersona] = useState<Persona>(AVAILABLE_PERSONAS[0]);
  const [callState, setCallState] = useState<CallState>("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [packetCount, setPacketCount] = useState(0);
  const [callStartTime, setCallStartTime] = useState<number | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | undefined>(undefined);

  // Sound activity states
  const [activeVoiceDetect, setActiveVoiceDetect] = useState(false);
  const [activeSpeakerDetect, setActiveSpeakerDetect] = useState(false);

  // Audio Context & WebSocket refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const ambientNoiseRef = useRef<{ stop: () => void } | null>(null);
  const silenceCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastActivityTimeRef = useRef<number>(0);

  // Coordinated muting & telemetry tracking refs
  const isToolActiveRef = useRef(false);
  const latencyTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const telemetryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pingMapRef = useRef<Map<number, number>>(new Map());
  const lastPacketTimeRef = useRef<number | null>(null);
  const lastDeltaRef = useRef<number | null>(null);
  const jitterSumRef = useRef<number>(0);
  const jitterCountRef = useRef<number>(0);
  const latencyHistoryRef = useRef<number[]>([]);

  // Callback / Timer references to bypass react closure issues in asynchronous event streams
  const isMutedRef = useRef(isMuted);
  const speakerTimerRef = useRef<NodeJS.Timeout | null>(null);
  const voiceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const activeVoiceDetectRef = useRef(false);
  const activeSpeakerDetectRef = useRef(false);

  // Keep mute status updated in raw stream callbacks
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  // Clean resources on unmount or on hanging up
  const cleanupCallResources = () => {
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch (err) {}
      wsRef.current = null;
    }

    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }

    if (micProcessorRef.current) {
      try {
        micProcessorRef.current.disconnect();
      } catch (err) {}
      micProcessorRef.current = null;
    }

    activeSourcesRef.current.forEach((source) => {
      try {
        source.stop();
      } catch (err) {}
    });
    activeSourcesRef.current = [];
    nextStartTimeRef.current = 0;

    if (ambientNoiseRef.current) {
      try {
        ambientNoiseRef.current.stop();
      } catch (err) {}
      ambientNoiseRef.current = null;
    }

    if (silenceCheckIntervalRef.current) {
      clearInterval(silenceCheckIntervalRef.current);
      silenceCheckIntervalRef.current = null;
    }

    if (latencyTimerRef.current) {
      clearInterval(latencyTimerRef.current);
      latencyTimerRef.current = null;
    }
    if (telemetryTimerRef.current) {
      clearInterval(telemetryTimerRef.current);
      telemetryTimerRef.current = null;
    }

    pingMapRef.current.clear();
    lastPacketTimeRef.current = null;
    lastDeltaRef.current = null;
    jitterSumRef.current = 0;
    jitterCountRef.current = 0;
    latencyHistoryRef.current = [];
    isToolActiveRef.current = false;
    setLatencyMs(undefined);

    if (speakerTimerRef.current) clearTimeout(speakerTimerRef.current);
    if (voiceTimerRef.current) clearTimeout(voiceTimerRef.current);

    activeVoiceDetectRef.current = false;
    activeSpeakerDetectRef.current = false;
    setActiveSpeakerDetect(false);
    setActiveVoiceDetect(false);
  };

  useEffect(() => {
    return () => {
      cleanupCallResources();
    };
  }, []);

  // Update selection if the selected persona gets deleted/edited
  useEffect(() => {
    const exists = personas.some((p) => p.id === selectedPersona.id);
    if (!exists) {
      setSelectedPersona(personas[0]);
    } else {
      const match = personas.find((p) => p.id === selectedPersona.id);
      if (match) setSelectedPersona(match);
    }
  }, [personas]);

  // Handle incoming transcripts
  const addTranscriptMessage = (role: "user" | "agent", text: string) => {
    setMessages((prev) => {
      if (prev.length === 0) {
        return [{ id: Math.random().toString(), role, text, timestamp: new Date() }];
      }

      const last = prev[prev.length - 1];
      // Append if same speaker spoke within last 12 seconds
      if (last.role === role && Date.now() - last.timestamp.getTime() < 12000) {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...last,
          text: last.text.endsWith(" ") || text.startsWith(" ") ? last.text + text : last.text + " " + text,
          timestamp: new Date()
        };
        return updated;
      }

      return [
        ...prev,
        { id: Math.random().toString(), role, text, timestamp: new Date() }
      ];
    });
  };

  // Connect to VoIP service
  const startCommunicating = async (personaConfig: Persona) => {
    cleanupCallResources();
    setCallState("calling");
    setErrorMessage("");
    setPacketCount(0);
    setCallStartTime(null);
    setMessages([]);

    try {
      // 1. Authorize micromedia standard streams
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      // 2. Audio playback context setup at 16kHz
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;
      
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }

      // 3. Initiate Proxy VoIP websocket connection on backend
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/api/live`;
      console.log(`[App] Spawning VoIP route: ${wsUrl}`);
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log(`[App] Established VoIP link. Dispatching setup payload...`);
        ws.send(JSON.stringify({
          type: "setup",
          voice: personaConfig.voice,
          systemInstruction: personaConfig.systemInstruction,
          knowledgeBaseId: personaConfig.knowledgeBaseId,
          temperature: personaConfig.temperature,
          personaId: personaConfig.id,
          personaName: personaConfig.name,
        }));
      };

      ws.onmessage = (event) => {
        setPacketCount((p) => p + 1);
        try {
          const payload = JSON.parse(event.data);

          if (payload.type === "pong") {
            const sendTime = pingMapRef.current.get(payload.id);
            if (sendTime) {
              const rtt = Date.now() - sendTime;
              setLatencyMs(rtt);
              latencyHistoryRef.current.push(rtt);
              pingMapRef.current.delete(payload.id);
            }
            return;
          }

          if (payload.type === "status") {
            if (payload.message === "connected") {
              setCallState("connected");
              setCallStartTime(Date.now());
              console.log("[App] Voice line confirmed secure.");

              // Start ambient background noise loops if configured
              if (audioCtxRef.current && personaConfig.ambientSound && personaConfig.ambientSound !== "none") {
                console.log(`[App] Starting ambient noise loop: ${personaConfig.ambientSound}`);
                try {
                  ambientNoiseRef.current = startAmbientNoise(audioCtxRef.current, personaConfig.ambientSound);
                } catch (e) {
                  console.error("Failed to start ambient noise:", e);
                }
              }

              // Initialize silence timer
              lastActivityTimeRef.current = Date.now();
              const timeoutSec = personaConfig.silenceTimeout || 30;
              console.log(`[App] Silence check interval started. Timeout: ${timeoutSec}s`);
              if (silenceCheckIntervalRef.current) clearInterval(silenceCheckIntervalRef.current);
              silenceCheckIntervalRef.current = setInterval(() => {
                const elapsed = (Date.now() - lastActivityTimeRef.current) / 1000;
                if (elapsed >= timeoutSec) {
                  console.log(`[App] Silence timeout exceeded (${elapsed.toFixed(1)}s >= ${timeoutSec}s). Hanging up...`);
                  handleEndCall();
                }
              }, 1000);

              // Latency measurement loop (WebSocket RTT RTT measurement)
              let pingId = 0;
              latencyTimerRef.current = setInterval(() => {
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                  const id = pingId++;
                  pingMapRef.current.set(id, Date.now());
                  wsRef.current.send(JSON.stringify({ type: "ping", id }));
                }
              }, 4000);

              // Periodic Telemetry Reporting loop (every 5 seconds)
              telemetryTimerRef.current = setInterval(() => {
                if (wsRef.current?.readyState === WebSocket.OPEN && latencyHistoryRef.current.length > 0) {
                  const avgLat = Math.round(latencyHistoryRef.current.reduce((a, b) => a + b, 0) / latencyHistoryRef.current.length);
                  const avgJitter = jitterCountRef.current > 0
                    ? Math.round(jitterSumRef.current / jitterCountRef.current)
                    : 0;

                  wsRef.current.send(JSON.stringify({
                    type: "telemetry",
                    latencyMs: avgLat,
                    jitterMs: avgJitter,
                  }));

                  // Reset trackers
                  latencyHistoryRef.current = [];
                  jitterSumRef.current = 0;
                  jitterCountRef.current = 0;
                }
              }, 5000);
            }

            if (payload.message === "tool-active") {
              isToolActiveRef.current = true;
            }
            if (payload.message === "tool-inactive") {
              isToolActiveRef.current = false;
            }
            return;
          }

          if (payload.type === "error") {
            setCallState("error");
            setErrorMessage(payload.message);
            cleanupCallResources();
            return;
          }

          if (payload.type === "output-transcription") {
            addTranscriptMessage("agent", payload.text);
            return;
          }
          if (payload.type === "input-transcription") {
            addTranscriptMessage("user", payload.text);
            return;
          }

          // Handle incoming audio stream packets (PCM)
          if (payload.type === "audio") {
            // Jitter tracking (RFC 3550 variance calculations)
            const now = Date.now();
            if (lastPacketTimeRef.current !== null) {
              const delta = now - lastPacketTimeRef.current;
              if (lastDeltaRef.current !== null) {
                const diff = Math.abs(delta - lastDeltaRef.current);
                jitterSumRef.current += diff;
                jitterCountRef.current++;
              }
              lastDeltaRef.current = delta;
            }
            lastPacketTimeRef.current = now;

            lastActivityTimeRef.current = Date.now(); // reset silence timer
            const rawAudio = payload.data;
            if (!rawAudio) return;

            const floatArr = base64ToFloat32(rawAudio);
            const audioBuffer = audioCtx.createBuffer(1, floatArr.length, 24000);
            audioBuffer.getChannelData(0).set(floatArr);

            const source = audioCtx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioCtx.destination);

            const currentTime = audioCtx.currentTime;
            let playTime = nextStartTimeRef.current;

            if (playTime < currentTime) {
              playTime = currentTime + 0.04;
            }

            source.start(playTime);
            nextStartTimeRef.current = playTime + audioBuffer.duration;

            activeSourcesRef.current.push(source);
            source.onended = () => {
              activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== source);
            };

            const bufferDurationMs = audioBuffer.duration * 1000;
            if (!activeSpeakerDetectRef.current) {
              activeSpeakerDetectRef.current = true;
              setActiveSpeakerDetect(true);
            }

            if (speakerTimerRef.current) clearTimeout(speakerTimerRef.current);
            speakerTimerRef.current = setTimeout(() => {
              if (audioCtx.currentTime >= nextStartTimeRef.current - 0.04) {
                activeSpeakerDetectRef.current = false;
                setActiveSpeakerDetect(false);
              }
            }, bufferDurationMs);
          }

          // Interruption event trigger
          if (payload.type === "interrupted") {
            console.log("[App] User speaking interrupted active playout. Stopping source playbacks.");
            activeSourcesRef.current.forEach((src) => {
              try {
                src.stop();
              } catch (err) {}
            });
            activeSourcesRef.current = [];
            nextStartTimeRef.current = 0;
            activeSpeakerDetectRef.current = false;
            setActiveSpeakerDetect(false);
          }

        } catch (err) {
          console.error("VoIP deserialization error:", err);
        }
      };

      ws.onerror = (err) => {
        console.error("[WebSocket Error]", err);
        setCallState("error");
        setErrorMessage("VoIP carrier network error. Please confirm credentials.");
      };

      ws.onclose = (event) => {
        console.log(`[VoIP Line Disconnected] Code: ${event.code}`);
        if (callState === "connected") {
          setCallState("ended");
        }
      };

      // 4. Input stream script processor
      const micSource = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(1024, 1, 1);
      micProcessorRef.current = processor;

      micSource.connect(processor);
      processor.connect(audioCtx.destination);

      processor.onaudioprocess = (e) => {
        if (isMutedRef.current || isToolActiveRef.current) return;
        if (wsRef.current?.readyState !== WebSocket.OPEN) return;

        let rawData = e.inputBuffer.getChannelData(0);
        const actualRate = e.inputBuffer.sampleRate;
        if (actualRate !== 16000) {
          rawData = resampleFloat32(rawData, actualRate, 16000) as Float32Array<ArrayBuffer>;
        }

        const pcmBuffer = float32ToInt16(rawData);
        const base64Code = arrayBufferToBase64(pcmBuffer);

        wsRef.current.send(JSON.stringify({
          type: "audio",
          data: base64Code
        }));

        let sum = 0;
        for (let i = 0; i < rawData.length; i++) {
          sum += rawData[i] * rawData[i];
        }
        const rms = Math.sqrt(sum / rawData.length);

        if (rms > 0.015) {
          lastActivityTimeRef.current = Date.now(); // reset silence timer
          if (!activeVoiceDetectRef.current) {
            activeVoiceDetectRef.current = true;
            setActiveVoiceDetect(true);
          }
          if (voiceTimerRef.current) clearTimeout(voiceTimerRef.current);
          voiceTimerRef.current = setTimeout(() => {
            activeVoiceDetectRef.current = false;
            setActiveVoiceDetect(false);
          }, 450);
        }
      };

    } catch (err: any) {
      console.error("[Microphone Error]", err);
      setCallState("error");
      setErrorMessage(err?.message || "Could not spin up carrier audio device. Authorize microphone permission.");
    }
  };

  const handleDialNumber = (number: string) => {
    startCommunicating(selectedPersona);
    setActivePage("call");
  };

  const handleStartCall = () => {
    startCommunicating(selectedPersona);
    setActivePage("call");
  };

  const handleSelectPersonaByPhone = (persona: Persona) => {
    setSelectedPersona(persona);
  };

  const handleToggleMute = () => {
    setIsMuted(!isMuted);
  };

  const handleEndCall = () => {
    cleanupCallResources();
    setCallState("ended");
  };

  // Create or Update Custom Agent in MongoDB
  const handleSaveAgent = (agent: Persona) => {
    fetch("/api/personas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(agent)
    })
    .then((res) => res.json())
    .then((json) => {
      if (json.success) {
        fetchServerPersonas();
      }
    })
    .catch((err) => console.error("[Sync] Error syncing agent with database:", err));

    setSelectedPersona(agent);
    setEditingPersona(null);
    setActivePage("dashboard");
  };

  // Delete Custom Agent from MongoDB
  const handleDeleteAgent = (id: string) => {
    fetch(`/api/personas/${id}`, {
      method: "DELETE"
    })
    .then((res) => res.json())
    .then((json) => {
      if (json.success) {
        fetchServerPersonas();
      }
    })
    .catch((err) => console.error("[Sync] Error deleting agent from database:", err));

    if (selectedPersona.id === id) {
      setSelectedPersona(personas[0] || AVAILABLE_PERSONAS[0]);
    }
  };

  const handleEditAgent = (agent: Persona) => {
    setEditingPersona(agent);
    setActivePage("creator");
  };

  const triggerCallForAgent = (persona: Persona) => {
    setSelectedPersona(persona);
    startCommunicating(persona);
    setActivePage("call");
  };

  const isClientPortal = window.location.pathname === "/client";

  if (isClientPortal) {
    return (
      <div className="min-h-screen bg-[#070301] text-white flex flex-col font-sans relative antialiased select-none">
        
        {/* Cinematic Ambient Glow Layers (Immersive UI specification) */}
        <div className="absolute inset-0 z-0 opacity-40 pointer-events-none">
          <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-emerald-600/20 rounded-full blur-[140px] opacity-25"></div>
          <div className="absolute bottom-[-10%] right-[-5%] w-[500px] h-[500px] bg-blue-900/30 rounded-full blur-[120px] opacity-30"></div>
        </div>

        {/* Brand Header */}
        <header className="border-b border-white/5 bg-white/[0.01] backdrop-blur-md sticky top-0 z-50 px-6 py-4 flex items-center justify-between shadow-2xl relative">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-600 flex items-center justify-center text-white font-bold tracking-tight shadow-md shadow-emerald-500/10">
              CP
            </div>
            <div>
              <h1 className="text-xs sm:text-sm font-semibold tracking-wide text-zinc-100 flex items-center gap-2 font-mono uppercase">
                GoRan AI <span className="text-[8px] font-mono font-bold uppercase py-0.5 px-2 rounded-md bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.1)]">Client Portal</span>
              </h1>
              <p className="text-[9px] font-mono text-zinc-500 tracking-widest mt-0.5 uppercase">White-Labeled AI Calling Operations</p>
            </div>
          </div>
        </header>

        {/* Main Body */}
        <main className="flex-1 w-full max-w-7xl mx-auto p-4 md:p-6 z-10 flex flex-col justify-center">
          <ClientPortal />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#070301] text-white flex flex-col font-sans relative antialiased select-none">
      
      {/* Cinematic Ambient Glow Layers (Immersive UI specification) */}
      <div className="absolute inset-0 z-0 opacity-40 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-orange-600/25 rounded-full blur-[140px] opacity-35"></div>
        <div className="absolute bottom-[-10%] right-[-5%] w-[500px] h-[500px] bg-blue-900/30 rounded-full blur-[120px] opacity-30"></div>
        <div className="absolute top-[40%] left-[30%] w-[300px] h-[300px] bg-white opacity-5 rounded-full blur-[100px]"></div>
      </div>

      {/* Top Navigation & Status Block */}
      <header className="border-b border-white/5 bg-white/[0.01] backdrop-blur-md sticky top-0 z-50 px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-2xl relative">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-orange-500 to-amber-600 flex items-center justify-center text-white font-bold tracking-tight shadow-md shadow-orange-500/10">
            AI
          </div>
          <div>
            <h1 className="text-xs sm:text-sm font-semibold tracking-wide text-zinc-100 flex items-center gap-2 font-mono uppercase">
              AI Voice Studio <span className="text-[8px] font-mono font-bold uppercase py-0.5 px-2 rounded-md bg-orange-500/15 text-orange-400 border border-orange-500/20 shadow-[0_0_10px_rgba(249,115,22,0.1)]">v3.1-Live</span>
            </h1>
            <p className="text-[9px] font-mono text-zinc-500 tracking-widest mt-0.5 uppercase">Low-Latency Duplex Customization Center</p>
          </div>
        </div>

        {/* Navigation Tabs - Supporting multipage workflow */}
        <div className="flex items-center gap-1.5 bg-black/60 border border-white/5 p-1 rounded-2xl">
          <button
            onClick={() => setActivePage("dashboard")}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono uppercase tracking-wider transition-all cursor-pointer ${
              activePage === "dashboard"
                ? "bg-white/10 text-white border border-white/10 shadow-lg"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            <Users className="w-3.5 h-3.5 text-orange-400" />
            <span>Agent Profile</span>
          </button>
          <button
            onClick={() => setActivePage("knowledge")}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono uppercase tracking-wider transition-all cursor-pointer ${
              activePage === "knowledge"
                ? "bg-white/10 text-white border border-white/10 shadow-lg"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            <Database className="w-3.5 h-3.5 text-orange-400" />
            <span>Knowledge Bases</span>
          </button>
          <button
            onClick={() => setActivePage("call")}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono uppercase tracking-wider transition-all relative cursor-pointer ${
              activePage === "call"
                ? "bg-white/10 text-white border border-white/10 shadow-lg"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            <PhoneCall className="w-3.5 h-3.5 text-orange-400" />
            <span>VoIP Calling Terminal</span>
            {callState === "connected" && (
              <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
              </span>
            )}
          </button>
          <button
            onClick={() => setActivePage("analytics")}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono uppercase tracking-wider transition-all cursor-pointer ${
              activePage === "analytics"
                ? "bg-white/10 text-white border border-white/10 shadow-lg"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5 text-orange-400" />
            <span>Analytics</span>
          </button>
          <button
            onClick={() => setActivePage("outbound")}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono uppercase tracking-wider transition-all cursor-pointer ${
              activePage === "outbound"
                ? "bg-white/10 text-white border border-white/10 shadow-lg"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            <PhoneOutgoing className="w-3.5 h-3.5 text-emerald-400" />
            <span>Outbound Call</span>
          </button>
        </div>

        {/* Global telemetry status lines */}
        <div className="hidden xl:flex items-center gap-4 text-[9px] font-mono text-zinc-400 uppercase tracking-widest leading-none">
          <div className="flex items-center gap-1.5 border border-white/5 bg-white/[0.01] px-2.5 py-1.5 rounded-lg">
            <span className="w-2 h-2 bg-green-500 rounded-full shadow-[0_0_8px_#22c55e]"></span>
            <span>Realtime Node Cluster</span>
          </div>
        </div>
      </header>

      {/* Main Container - Renders dynamic page views */}
      <main className="flex-1 w-full max-w-7xl mx-auto p-4 md:p-6 z-10 flex flex-col justify-center">

        {/* 1. AGENTS DIRECTORY BENTO-GRID DASHBOARD */}
        {activePage === "dashboard" && (
          <div className="space-y-6">
            
            {/* Active Agent Configuration Profile Card */}
            {selectedPersona && (
              <div className="relative overflow-hidden bg-gradient-to-r from-orange-950/30 via-amber-950/10 to-transparent border border-orange-500/10 rounded-3xl p-6 md:p-8 shadow-2xl">
                <div className="absolute top-[-30%] right-[-5%] w-[300px] h-[300px] bg-orange-600/10 rounded-full blur-[90px] pointer-events-none"></div>
                
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                  <div className="flex items-center gap-5">
                    <div className="w-20 h-20 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center text-4xl shadow-inner shadow-black/60 shrink-0">
                      {selectedPersona.avatar || "🤖"}
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono uppercase bg-orange-500/15 text-orange-400 border border-orange-500/20 px-2 py-0.5 rounded font-bold tracking-widest animate-pulse">
                          Active Agent
                        </span>
                        <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider">
                          Voice: {selectedPersona.voice}
                        </span>
                      </div>
                      <h2 className="text-2xl font-light tracking-tight text-white leading-none">
                        {selectedPersona.name}
                      </h2>
                      <p className="text-xs text-zinc-400 font-mono tracking-widest uppercase">
                        {selectedPersona.role}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 w-full md:w-auto">
                    <button
                      onClick={() => handleEditAgent(selectedPersona)}
                      className="flex-1 md:flex-none px-5 py-3 rounded-2xl border border-white/10 hover:border-white/20 bg-white/[0.02] hover:bg-white/[0.06] text-zinc-200 hover:text-white font-medium transition duration-200 text-xs font-mono uppercase tracking-wider text-center cursor-pointer"
                    >
                      Configure Agent
                    </button>
                    <button
                      onClick={() => triggerCallForAgent(selectedPersona)}
                      className="flex-1 md:flex-none px-6 py-3 rounded-2xl bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-400 hover:to-amber-500 text-white font-medium hover:scale-[102%] transition-all duration-300 shadow-xl shadow-orange-500/10 text-xs font-mono uppercase tracking-wider text-center cursor-pointer"
                    >
                      Start Call Test
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8 border-t border-white/5 pt-6">
                  <div className="md:col-span-2 space-y-2">
                    <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest block font-bold">System Instructions Prompt</span>
                    <p className="text-xs text-zinc-300 leading-relaxed font-mono bg-black/45 border border-white/5 p-4 rounded-2xl max-h-32 overflow-y-auto custom-scrollbar whitespace-pre-wrap">
                      {selectedPersona.systemInstruction}
                    </p>
                  </div>
                  <div className="space-y-4">
                    <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest block font-bold">Model Parameters</span>
                    <div className="bg-black/25 border border-white/5 rounded-2xl p-4 space-y-2.5 font-mono text-[11px] text-zinc-400">
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Temperature</span>
                        <span className="text-orange-400 font-bold">{(selectedPersona.temperature ?? 0.7).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Silence Timeout</span>
                        <span className="text-zinc-200 font-bold">{selectedPersona.silenceTimeout ?? 30}s</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Background Noise</span>
                        <span className="text-zinc-200 font-bold uppercase text-[9px]">{selectedPersona.ambientSound ?? "none"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Phone Mapping</span>
                        <span className="text-indigo-400 font-bold">{selectedPersona.phoneNumber ?? "N/A"}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Database & Google Workspace Integrations Status (Integrations Hub) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
              {/* Card 1: MongoDB Database Connection Status */}
              <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-6 shadow-2xl relative overflow-hidden flex flex-col justify-between">
                <div className="absolute top-0 right-0 w-[150px] h-[150px] bg-emerald-500/5 rounded-full blur-[40px] pointer-events-none"></div>
                <div>
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-mono font-bold uppercase tracking-wider rounded-xl mb-4">
                    <Database className="w-3.5 h-3.5" />
                    MongoDB Unified Data Layer
                  </div>
                  <h3 className="text-xl font-light tracking-tight text-white mb-2">
                    Centralized Configuration Database
                  </h3>
                  <p className="text-xs text-zinc-400 leading-relaxed mb-4">
                    All agents, dynamic prompts, knowledge base reference documents, and user OAuth credentials are synchronized in real-time.
                  </p>
                </div>
                
                <div className="flex items-center justify-between border-t border-white/5 pt-4 mt-4">
                  <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Database Node Health</span>
                  <div className="flex items-center gap-2">
                    {dbStatus === "connected" && (
                      <>
                        <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full shadow-[0_0_8px_#10b981] animate-pulse"></span>
                        <span className="text-xs font-mono text-emerald-450 uppercase tracking-wider">Connected (Atlas Cluster)</span>
                      </>
                    )}
                    {dbStatus === "connecting" && (
                      <>
                        <span className="w-2.5 h-2.5 bg-amber-500 rounded-full animate-bounce"></span>
                        <span className="text-xs font-mono text-amber-450 uppercase tracking-wider">Connecting...</span>
                      </>
                    )}
                    {dbStatus === "error" && (
                      <>
                        <span className="w-2.5 h-2.5 bg-red-500 rounded-full shadow-[0_0_8px_#ef4444]"></span>
                        <span className="text-xs font-mono text-red-450 uppercase tracking-wider">Connection Failure</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Card 2: Google Workspace OAuth Connections Manager */}
              <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-6 shadow-2xl relative overflow-hidden flex flex-col justify-between">
                <div className="absolute top-0 right-0 w-[150px] h-[150px] bg-indigo-500/5 rounded-full blur-[40px] pointer-events-none"></div>
                <div>
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-[10px] font-mono font-bold uppercase tracking-wider rounded-xl mb-4">
                    <Sparkles className="w-3.5 h-3.5" />
                    Google Workspace Integration
                  </div>
                  <h3 className="text-xl font-light tracking-tight text-white mb-2">
                    Gmail & Google Calendar Tools Linker
                  </h3>
                  <p className="text-xs text-zinc-400 leading-relaxed mb-4">
                    Allow calling agents to check upcoming meetings, schedule calendar events, read unread emails, and send Gmails directly on the caller's behalf.
                  </p>

                  {/* Connection list */}
                  <div className="space-y-2 max-h-32 overflow-y-auto mb-4 custom-scrollbar">
                    <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest block font-bold mb-1">Active Credentials Mapping</span>
                    {googleConnections.length === 0 ? (
                      <p className="text-[10px] text-zinc-500 italic font-mono uppercase">No active accounts linked. Authentication required to run tools.</p>
                    ) : (
                      googleConnections.map((conn) => (
                        <div key={conn.phoneKey} className="flex items-center justify-between bg-black/40 border border-white/5 px-3 py-2 rounded-xl text-xs font-mono">
                          <div className="flex items-center gap-2">
                            <CheckCircle className="w-3.5 h-3.5 text-emerald-450 shrink-0" />
                            <span className="text-zinc-200">Key: <strong className="text-orange-400">{conn.phoneKey}</strong></span>
                          </div>
                          <span className="text-[9px] text-zinc-500">Connected</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Form to link account */}
                <div className="border-t border-white/5 pt-4 mt-auto">
                  <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-[0.2em] block font-bold mb-2">Link New Google Account</span>
                  <form 
                    onSubmit={(e) => {
                      e.preventDefault();
                      const form = e.currentTarget;
                      const input = form.elements.namedItem("phoneKey") as HTMLInputElement;
                      const val = input.value.trim() || "default";
                      window.open(`/api/auth/google?phone=${encodeURIComponent(val)}`, "_blank");
                      input.value = "";
                    }}
                    className="flex gap-2"
                  >
                    <input 
                      name="phoneKey"
                      type="text" 
                      placeholder="Caller Phone Number or 'default'"
                      className="flex-1 bg-black/60 border border-white/10 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-indigo-500 transition placeholder:text-zinc-600"
                    />
                    <button 
                      type="submit"
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-[10px] font-mono uppercase tracking-widest font-bold transition whitespace-nowrap cursor-pointer"
                    >
                      Authenticate Account
                    </button>
                  </form>
                </div>
              </div>
            </div>

            {/* PSTN & Universal SIP Trunking Link Hub (Tabbed Integration Control Center) */}
            <div className="mt-8 bg-white/[0.02] border border-white/5 rounded-3xl p-6 md:p-8 shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-[200px] h-[200px] bg-indigo-500/5 rounded-full blur-[60px] pointer-events-none"></div>
              
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 border-b border-white/10 pb-6 mb-6">
                <div>
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-[10px] font-mono font-bold uppercase tracking-wider rounded-xl mb-3">
                    <PhoneCall className="w-3.5 h-3.5" />
                    PSTN & SIP Telecom Carrier Protocol Linker
                  </div>
                  <h3 className="text-xl font-light tracking-tight text-white mb-2">
                    Connect Any SIP Provider, PBX, or VoIP Number
                  </h3>
                  <p className="text-xs text-zinc-400 font-serif italic max-w-2xl leading-relaxed font-normal">
                    You can route standard G.711 μ-law (8kHz) PSTN voice streams into AI Voice Studio. Select your integration protocol path below to connect Zadarma, Telnyx, Asterisk, FreePBX, or Twilio directly to your active AI persona.
                  </p>
                </div>

                {/* Integration Path Selection Tabs */}
                <div className="flex flex-wrap items-center gap-1 bg-black/60 border border-white/5 p-1 rounded-2xl shrink-0">
                  <button
                    onClick={() => setSipTutorialTab("sip")}
                    className={`px-4 py-2 rounded-xl text-xs font-mono uppercase tracking-wider transition cursor-pointer select-none ${
                      sipTutorialTab === "sip" 
                        ? "bg-indigo-600 font-semibold text-white shadow-lg shadow-indigo-600/20" 
                        : "text-zinc-400 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    Universal SIP
                  </button>
                  <button
                    onClick={() => setSipTutorialTab("vobiz")}
                    className={`px-4 py-2 rounded-xl text-xs font-mono uppercase tracking-wider transition cursor-pointer select-none ${
                      sipTutorialTab === "vobiz" 
                        ? "bg-indigo-600 font-semibold text-white shadow-lg shadow-indigo-600/20" 
                        : "text-zinc-400 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    Vobiz SIP Trunk
                  </button>
                  <button
                    onClick={() => setSipTutorialTab("asterisk")}
                    className={`px-4 py-2 rounded-xl text-xs font-mono uppercase tracking-wider transition cursor-pointer select-none ${
                      sipTutorialTab === "asterisk" 
                        ? "bg-indigo-600 font-semibold text-white shadow-lg shadow-indigo-600/20" 
                        : "text-zinc-400 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    Asterisk & FreePBX
                  </button>
                  <button
                    onClick={() => setSipTutorialTab("twilio")}
                    className={`px-4 py-2 rounded-xl text-xs font-mono uppercase tracking-wider transition cursor-pointer select-none ${
                       sipTutorialTab === "twilio" 
                        ? "bg-indigo-600 font-semibold text-white shadow-lg shadow-indigo-600/20" 
                        : "text-zinc-400 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    Twilio SDK
                  </button>
                </div>
              </div>

              {/* TAB CONTENT 1: UNIVERSAL SIP (Zadarma, Telnyx, Plivo, Callcentric, etc) */}
              {sipTutorialTab === "sip" && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Step 1 */}
                    <div className="bg-black/40 border border-white/5 rounded-2xl p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="w-7 h-7 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-lg flex items-center justify-center font-mono text-xs font-bold">1</span>
                        <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest font-bold">SIP TRUNK/DID</span>
                      </div>
                      <h4 className="text-xs font-bold tracking-wider uppercase font-mono text-zinc-200">Assign Phone Number</h4>
                      <p className="text-[11px] text-zinc-400 leading-relaxed font-sans">
                        Purchase or configure a standard DID phone line in any provider (e.g., <strong>Zadarma, Telnyx, Plivo, or VoIP.ms</strong>).
                      </p>
                    </div>

                    {/* Step 2 */}
                    <div className="bg-black/40 border border-white/5 rounded-2xl p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="w-7 h-7 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-lg flex items-center justify-center font-mono text-xs font-bold">2</span>
                        <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest font-bold">STREAM SETTINGS</span>
                      </div>
                      <h4 className="text-xs font-bold tracking-wider uppercase font-mono text-zinc-200">Set media stream URL</h4>
                      <p className="text-[11px] text-zinc-400 leading-relaxed font-sans">
                        In your carrier's Call Flow control editor, enable standard <strong>RTP Streaming / WebRTC Hook</strong> directed to our universal streaming gateway address.
                      </p>
                    </div>

                    {/* Step 3 */}
                    <div className="bg-black/40 border border-white/5 rounded-2xl p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="w-7 h-7 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-lg flex items-center justify-center font-mono text-xs font-bold">3</span>
                        <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest font-bold">TARGET MAPPING</span>
                      </div>
                      <h4 className="text-xs font-bold tracking-wider uppercase font-mono text-zinc-200">Lock AI Persona ID</h4>
                      <p className="text-[11px] text-zinc-400 leading-relaxed font-sans">
                        Pass the <code>?personaId={selectedPersona.id}</code> query parameter to route calls to the active agent <strong>{selectedPersona.name}</strong>.
                      </p>
                    </div>
                  </div>

                  {/* Active Universal SIP Connection config details */}
                  <div className="bg-black/60 border border-white/5 rounded-2xl p-5 space-y-4">
                    <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-indigo-400">Universal SIP Gateway Stream Configurations</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Sub-block A */}
                      <div className="bg-black/50 border border-white/5 p-4 rounded-xl space-y-2">
                        <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider block font-bold">A. Raw SIP WebSocket URI (WebRTC Streams)</span>
                        <code className="text-[10px] md:text-xs font-mono text-emerald-400 bg-black/60 p-2 rounded-lg border border-white/5 block break-all">
                          {window.location.protocol === "https:" ? "wss:" : "ws:"}//{window.location.host}/api/sip/live?personaId={selectedPersona.id}
                        </code>
                        <p className="text-[11px] text-zinc-400 leading-relaxed font-sans">
                          Ideal for direct browser calling integrations using standard library handlers like <code>sip.js</code>, <code>JsSIP</code>, or raw SIP over VoIP gateways. Streams audio directly as G.711 μ-law.
                        </p>
                      </div>

                      {/* Sub-block B */}
                      <div className="bg-black/50 border border-white/5 p-4 rounded-xl space-y-2">
                        <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider block font-bold">B. SIP call routing Webhook XML Address</span>
                        <code className="text-[10px] md:text-xs font-mono text-orange-400 bg-black/60 p-2 rounded-lg border border-white/5 block break-all">
                          {window.location.origin}/api/sip/incoming-call?personaId={selectedPersona.id}
                        </code>
                        <p className="text-[11px] text-zinc-400 leading-relaxed font-sans">
                          Enter this in your Carrier's Incoming Webhook panel. For providers with XML stream builders (Zadarma, SignalWire, Plivo, Telnyx TeXML), this XML establishes the audio stream socket automatically.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB CONTENT 4: VOBIZ CARRIER TRUNKING PLATFORM */}
              {sipTutorialTab === "vobiz" && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Step 1 */}
                    <div className="bg-black/40 border border-white/5 rounded-2xl p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="w-7 h-7 bg-orange-500/10 text-orange-400 border border-orange-500/20 rounded-lg flex items-center justify-center font-mono text-xs font-bold">1</span>
                        <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest font-bold">TRUNK CONFIG</span>
                      </div>
                      <h4 className="text-xs font-bold tracking-wider uppercase font-mono text-zinc-200">Trunk Naming</h4>
                      <p className="text-[11px] text-zinc-400 leading-relaxed font-sans">
                        In Vobiz portal, set the <strong>Trunk Name</strong> to <code>AI Voice Studio Outbound</code> to identify your bidirectional AI telephony bridge.
                      </p>
                    </div>

                    {/* Step 2 */}
                    <div className="bg-black/40 border border-white/5 rounded-2xl p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="w-7 h-7 bg-orange-500/10 text-orange-400 border border-orange-500/20 rounded-lg flex items-center justify-center font-mono text-xs font-bold">2</span>
                        <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest font-bold font-bold">WEBHOOK ENTRY</span>
                      </div>
                      <h4 className="text-xs font-bold tracking-wider uppercase font-mono text-zinc-200">Add Endpoint URL</h4>
                      <p className="text-[11px] text-zinc-400 leading-relaxed font-sans">
                        Under the <strong>Webhooks</strong> section, select <code>POST</code> and paste our secure live telecom webhook into the <strong>Endpoint URL</strong> input.
                      </p>
                    </div>

                    {/* Step 3 */}
                    <div className="bg-black/40 border border-white/5 rounded-2xl p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="w-7 h-7 bg-orange-500/10 text-orange-400 border border-orange-500/20 rounded-lg flex items-center justify-center font-mono text-xs font-bold">3</span>
                        <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest font-bold">CREDS & ACL</span>
                      </div>
                      <h4 className="text-xs font-bold tracking-wider uppercase font-mono text-zinc-200">Secure Trunk Credentials</h4>
                      <p className="text-[11px] text-zinc-400 leading-relaxed font-sans">
                        Click on <code>+ Create New Credential</code> to generate secure SIP username and passwords, or attach your private PBX trunk's **IP Access Control List**.
                      </p>
                    </div>
                  </div>

                  {/* Vobiz Quick Setup Copy block */}
                  <div className="bg-black/60 border border-white/5 rounded-2xl p-5 space-y-4">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-orange-400">
                        Vobiz Webhook Live Integration Setup Parameters
                      </h4>
                      <span className="text-[9.5px] px-2 py-0.5 bg-orange-500/10 border border-orange-500/20 text-orange-400 font-mono tracking-widest uppercase rounded">
                        VOBIZ INTEGRATION READY
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-sans">
                      <div className="bg-black/50 border border-white/5 p-4 rounded-xl space-y-2">
                        <span className="text-[9px] font-mono text-zinc-400 uppercase tracking-widest block font-bold">WEBHOOK ENDPOINT METHOD</span>
                        <code className="text-xs font-mono text-emerald-400 block pb-1 border-b border-white/5">POST</code>
                        <p className="text-[11px] text-zinc-400 leading-relaxed font-sans">
                          Vobiz will issue standard HTTP POST status updates and request routing configurations via this protocol callback method.
                        </p>
                      </div>

                      <div className="bg-black/50 border border-white/5 p-4 rounded-xl space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-mono text-zinc-400 uppercase tracking-widest block font-bold">VOBIZ ENDPOINT WEBHOOK URL</span>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(`${window.location.origin}/api/twilio/incoming-call?personaId=${selectedPersona.id}`);
                              alert("Vobiz Endpoint Webhook URL copied successfully!");
                            }}
                            className="text-[9px] font-mono text-orange-400 hover:underline cursor-pointer select-none"
                          >
                            Copy Url
                          </button>
                        </div>
                        <code className="text-[10px] md:text-xs font-mono text-orange-400 bg-black/60 p-2 rounded-lg border border-white/5 block break-all">
                          {window.location.origin}/api/twilio/incoming-call?personaId={selectedPersona.id}
                        </code>
                        <p className="text-[11px] text-zinc-400 leading-relaxed font-sans">
                          Paste this exact target URL inside the <strong>Endpoint URL</strong> field in your Vobiz console to connect <strong>{selectedPersona.name} ({selectedPersona.role})</strong>.
                        </p>
                      </div>
                    </div>

                    <div className="border-t border-white/5 pt-4">
                      <p className="text-[11px] text-zinc-400 leading-relaxed font-sans">
                        💡 <strong>Call Recording & AI Transcription Setting:</strong> The Vobiz screen has checkboxes for *Call Recording* and *AI Transcription*. Feel free to toggle them according to your preferences. Since our AI Voice Studio processes natural language stream inputs in real-time, additional provider transcription is not strictly required but acts as an excellent historical audit-log.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB CONTENT 2: ASTERISK & FREEPBX IP-PBX PRIVATE TRUNKS */}
              {sipTutorialTab === "asterisk" && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Step 1 */}
                    <div className="bg-black/40 border border-white/5 rounded-2xl p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="w-7 h-7 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-lg flex items-center justify-center font-mono text-xs font-bold">1</span>
                        <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest font-bold">SIP DOT CONF</span>
                      </div>
                      <h4 className="text-xs font-bold tracking-wider uppercase font-mono text-zinc-200">Register Trunk</h4>
                      <p className="text-[11px] text-zinc-400 leading-relaxed font-sans">
                        In Asterisk (or FreePBX Custom Trunk), set up your inbound register context pointing to the standard incoming number trunk.
                      </p>
                    </div>

                    {/* Step 2 */}
                    <div className="bg-black/40 border border-white/5 rounded-2xl p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="w-7 h-7 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-lg flex items-center justify-center font-mono text-xs font-bold">2</span>
                        <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest font-bold">EXTENSIONS.CONF</span>
                      </div>
                      <h4 className="text-xs font-bold tracking-wider uppercase font-mono text-zinc-200">Add Dialplan Rule</h4>
                      <p className="text-[11px] text-zinc-400 leading-relaxed font-sans">
                        Insert a custom Asterisk dialplan rule to catch incoming calls and launch the Audiosocket / WebRTC stream link.
                      </p>
                    </div>

                    {/* Step 3 */}
                    <div className="bg-black/40 border border-white/5 rounded-2xl p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="w-7 h-7 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-lg flex items-center justify-center font-mono text-xs font-bold">3</span>
                        <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest font-bold">EAGI/AUDIOSOCKET</span>
                      </div>
                      <h4 className="text-xs font-bold tracking-wider uppercase font-mono text-zinc-200">Deploy WS Bridge</h4>
                      <p className="text-[11px] text-zinc-400 leading-relaxed font-sans">
                        Asterisk interfaces use <code>EAGI</code> or Audiosocket loops to pipe G.711 stream bytes straight into our WebSocket port 3000!
                      </p>
                    </div>
                  </div>

                  {/* Code snippet block */}
                  <div className="bg-black/60 border border-white/5 rounded-2xl p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-indigo-400">Asterisk / FreePBX Dialplan Instruction Code (extensions.conf)</h4>
                      <span className="text-[9px] font-mono text-zinc-500">Copy Dialplan Script</span>
                    </div>
                    <pre className="text-[10px] md:text-sm font-mono text-zinc-300 bg-black/80 p-4 rounded-xl border border-white/5 overflow-x-auto leading-relaxed max-h-48 overflow-y-auto">
{`; ====== Asterisk Inbound SIP to AI Voice Studio Dialplan Rule ======
[from-sip-trunk]
exten => _X.,1,NoOp("Incoming Call routed to AI Voice Agent: ${selectedPersona.name}")
 same => n,Answer()
 same => n,Playback(connecting-studio)
 ; Dial standard G.711 mu-law bridge over WebSocket
 same => n,Jack(connect-stream,url=wss://${window.location.host}/api/sip/live?personaId=${selectedPersona.id})
 same => n,Hangup()
`}
                    </pre>
                    <p className="text-[11px] text-zinc-400 leading-relaxed font-sans">
                      By streaming Asterisk calls via the <code>JACK</code> or <code>AudioSocket</code> modules, Asterisk transcodes raw SIP audio on-the-fly to G.711 μ-law and updates our high-speed socket handler synchronously.
                    </p>
                  </div>
                </div>
              )}

              {/* TAB CONTENT 3: TWILIO SDK */}
              {sipTutorialTab === "twilio" && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Step 1 */}
                    <div className="bg-black/40 border border-white/5 rounded-2xl p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="w-7 h-7 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-lg flex items-center justify-center font-mono text-xs font-bold">1</span>
                        <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest font-bold">TWILIO PORTAL</span>
                      </div>
                      <h4 className="text-xs font-bold tracking-wider uppercase font-mono text-zinc-200">Rent a Number</h4>
                      <p className="text-[11px] text-zinc-400 leading-relaxed font-sans">
                        Acquire a virtual phone number in your Twilio account console. Or use an existing SIP domain configuration.
                      </p>
                    </div>

                    {/* Step 2 */}
                    <div className="bg-black/40 border border-white/5 rounded-2xl p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="w-7 h-7 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-lg flex items-center justify-center font-mono text-xs font-bold">2</span>
                        <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest font-bold">WEBHOOK TRUNK</span>
                      </div>
                      <h4 className="text-xs font-bold tracking-wider uppercase font-mono text-zinc-200">Configure Webhook</h4>
                      <p className="text-[11px] text-zinc-400 leading-relaxed font-sans">
                        In Twilio voice configuration page, set <strong>A call comes in</strong> callback target URI to the XML webhook endpoint.
                      </p>
                    </div>

                    {/* Step 3 */}
                    <div className="bg-black/40 border border-white/5 rounded-2xl p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="w-7 h-7 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-lg flex items-center justify-center font-mono text-xs font-bold">3</span>
                        <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest font-bold">MEDIA STREAMS</span>
                      </div>
                      <h4 className="text-xs font-bold tracking-wider uppercase font-mono text-zinc-200">Bidirectional WS</h4>
                      <p className="text-[11px] text-zinc-400 leading-relaxed font-sans">
                        Upon receiving a call, Twilio establishes a WebSocket connection to stream bidirectional voice packets in actual μ-law.
                      </p>
                    </div>
                  </div>

                  {/* Webhook Endpoint block with copy link */}
                  <div className="bg-black/50 border border-white/5 p-4 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-[0.2em] block font-bold">Your Custom Twilio Voice Webhook Endpoint</span>
                      <code className="text-[10px] md:text-sm font-mono text-orange-400 bg-black/60 px-3 py-1.5 rounded-lg border border-white/5 block break-all">
                        {window.location.origin}/api/twilio/incoming-call?personaId={selectedPersona.id}
                      </code>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      <span className="px-2.5 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-[10px] font-mono uppercase tracking-widest font-bold">
                        PSTN Live
                      </span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(`${window.location.origin}/api/twilio/incoming-call?personaId=${selectedPersona.id}`);
                          alert("Twilio callback phone webhook URL successfully copied to clipboard.");
                        }}
                        className="px-4 py-2 border border-white/10 hover:bg-white/5 text-zinc-300 hover:text-white rounded-xl text-[10px] font-mono uppercase tracking-widest cursor-pointer transition select-none"
                      >
                        Copy Hook
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

          </div>
        )}

        {/* 2. AGENT BUILDER WIZARD */}
        {activePage === "creator" && (
          <div className="h-full">
            <AgentCreator
              onSaveAgent={handleSaveAgent}
              onCancel={() => {
                setEditingPersona(null);
                setActivePage("dashboard");
              }}
              editingPersona={editingPersona}
            />
          </div>
        )}

        {/* 3. IMMERSIVE DUPLEX CALLING WORKSPACE */}
        {activePage === "call" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            
            {/* Left Side: Directory of Personas (4 columns) */}
            {/* Left Side: Active Dial pad & call console (6 columns) */}
            <section className="lg:col-span-6 flex flex-col h-[650px]">
              {callState === "idle" || callState === "ended" ? (
                <DialPad
                  onStartCallWithNumber={handleDialNumber}
                  personas={personas}
                  onSelectPersonaByPhone={handleSelectPersonaByPhone}
                  callState={callState}
                />
              ) : (
                <CallConsole
                  callState={callState}
                  persona={selectedPersona}
                  isMuted={isMuted}
                  onToggleMute={handleToggleMute}
                  onEndCall={handleEndCall}
                  errorMessage={errorMessage}
                  activeSpeakerDetect={activeSpeakerDetect}
                  activeVoiceDetect={activeVoiceDetect}
                  latencyMs={latencyMs}
                />
              )}
            </section>

            {/* Right Side: Transcription chat feed (6 columns) */}
            <section className="lg:col-span-6 flex flex-col h-[650px]">
              <TranscriptList
                messages={messages}
                persona={selectedPersona}
                callState={callState}
              />
            </section>

            {/* Bottom Panel: Telemetry Dashboard (Full width - 12 columns) */}
            <section className="lg:col-span-12 mt-2">
              <CallStats
                callState={callState}
                persona={selectedPersona}
                packetCount={packetCount}
                callStartTime={callStartTime}
              />
            </section>
          </div>
        )}

        {/* 4. KNOWLEDGE BASE MANAGER */}
        {activePage === "knowledge" && (
          <div className="h-full">
            <KnowledgeBaseManager
              onBack={() => setActivePage("dashboard")}
            />
          </div>
        )}

        {/* 5. ANALYTICS DASHBOARD */}
        {activePage === "analytics" && (
          <AnalyticsDashboard />
        )}

        {/* 6. OUTBOUND CALLING */}
        {activePage === "outbound" && (
          <OutboundCaller />
        )}

      </main>

      {/* Humble Footer */}
      <footer className="border-t border-white/5 py-6 px-8 text-center text-xs text-zinc-500 bg-transparent z-10 flex flex-col sm:flex-row items-center justify-between gap-3 max-w-7xl mx-auto w-full font-sans">
        <p className="font-serif italic text-zinc-450 text-sm">"Designed for real-time natural dialogues."</p>
        <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-650">UTILITY PROTOCOL // SECURE HANDSHAKES ACTIVE</p>
      </footer>
    </div>
  );
}
