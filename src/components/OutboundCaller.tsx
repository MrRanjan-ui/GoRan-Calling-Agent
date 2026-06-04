import { useState, useEffect, useRef } from "react";
import { Phone, PhoneOff, Loader2, CheckCircle, XCircle, Clock, ArrowUpRight, Sparkles } from "lucide-react";

interface TranscriptLine {
  role: "user" | "agent";
  text: string;
  timestamp: string;
}

type OutboundStatus = "idle" | "initiating" | "initiated" | "ringing" | "in-progress" | "completed" | "failed" | "busy" | "no-answer";

export function OutboundCaller() {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [countryCode, setCountryCode] = useState("+91");
  const [status, setStatus] = useState<OutboundStatus>("idle");
  const [callId, setCallId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState("");

  const [scanning, setScanning] = useState(false);
  const [scanNotification, setScanNotification] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const durationRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (durationRef.current) clearInterval(durationRef.current);
    };
  }, []);

  const startPolling = (id: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/outbound/status/${id}`);
        const data = await res.json();
        if (data.success) {
          setStatus(data.status);
          setTranscript(data.transcript || []);
          setDuration(data.duration || 0);
          if (data.error) setError(data.error);

          // Stop polling on terminal states
          if (["completed", "failed", "busy", "no-answer"].includes(data.status)) {
            if (pollRef.current) clearInterval(pollRef.current);
            if (durationRef.current) clearInterval(durationRef.current);
          }
        }
      } catch {
        // Ignore polling errors
      }
    }, 2000);
  };

  const handleCall = async () => {
    const fullNumber = countryCode + phoneNumber.replace(/\D/g, "");
    if (phoneNumber.length < 6) {
      setError("Please enter a valid phone number.");
      return;
    }

    setStatus("initiating");
    setError("");
    setTranscript([]);
    setDuration(0);

    try {
      const res = await fetch("/api/outbound/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toNumber: fullNumber, personaId: "arjun-outbound" }),
      });
      const data = await res.json();

      if (data.success) {
        setCallId(data.callId);
        setStatus("initiated");
        startPolling(data.callId);

        // Duration counter
        durationRef.current = setInterval(() => {
          setDuration(d => d + 1);
        }, 1000);
      } else {
        setError(data.error || "Failed to initiate call.");
        setStatus("failed");
      }
    } catch (err: any) {
      setError(err?.message || "Network error.");
      setStatus("failed");
    }
  };

  const handleHangup = async () => {
    if (!callId) return;
    try {
      await fetch(`/api/outbound/hangup/${callId}`, { method: "POST" });
      setStatus("completed");
      if (pollRef.current) clearInterval(pollRef.current);
      if (durationRef.current) clearInterval(durationRef.current);
    } catch {
      // Ignore
    }
  };

  const handleReset = () => {
    setStatus("idle");
    setCallId(null);
    setTranscript([]);
    setDuration(0);
    setError("");
    if (pollRef.current) clearInterval(pollRef.current);
    if (durationRef.current) clearInterval(durationRef.current);
  };

  const handleTriggerFollowups = async () => {
    setScanning(true);
    setScanNotification(null);
    try {
      const res = await fetch("/api/leads/trigger-followups", {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        setScanNotification(
          data.triggeredCount > 0
            ? `Successfully triggered follow-up calls for ${data.triggeredCount} qualified lead(s) with no scheduled meeting.`
            : "Successfully scanned CRM leads. No qualified follow-ups pending."
        );
      } else {
        setScanNotification(`Failed to scan leads: ${data.error || "Unknown error"}`);
      }
    } catch (err: any) {
      setScanNotification(`Network error while scanning: ${err?.message || err}`);
    } finally {
      setScanning(false);
      // Auto-clear notification after 8 seconds
      setTimeout(() => {
        setScanNotification(null);
      }, 8000);
    }
  };

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  const isActive = ["initiating", "initiated", "ringing", "in-progress"].includes(status);
  const isTerminal = ["completed", "failed", "busy", "no-answer"].includes(status);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-white tracking-tight flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <ArrowUpRight className="w-5 h-5 text-white" />
            </div>
            Outbound Calling
          </h2>
          <p className="text-xs text-zinc-500 mt-1 font-mono uppercase tracking-widest">
            Initiate AI-powered calls via VoBiz SIP trunk
          </p>
        </div>
        <button
          onClick={handleTriggerFollowups}
          disabled={scanning}
          className="px-4 py-2.5 rounded-2xl bg-gradient-to-r from-emerald-500/10 to-teal-500/10 hover:from-emerald-500/20 hover:to-teal-500/20 border border-emerald-500/35 hover:border-emerald-500/50 text-emerald-400 hover:text-emerald-300 text-xs font-mono uppercase tracking-wider font-semibold transition duration-300 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed self-start sm:self-auto"
        >
          {scanning ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Scanning CRM Leads...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              Scan & Dial Lead Follow-ups
            </>
          )}
        </button>
      </div>

      {scanNotification && (
        <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono flex items-center gap-3">
          <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{scanNotification}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Dialer Card */}
        <div className="lg:col-span-5">
          <div className="rounded-3xl border border-white/[0.06] bg-white/[0.015] backdrop-blur-xl p-6 shadow-2xl relative overflow-hidden">
            {/* Ambient glow */}
            <div className="absolute -top-20 -right-20 w-48 h-48 bg-emerald-500/10 rounded-full blur-[80px] pointer-events-none"></div>
            <div className="absolute -bottom-16 -left-16 w-40 h-40 bg-teal-500/8 rounded-full blur-[60px] pointer-events-none"></div>

            <h3 className="text-sm font-mono uppercase tracking-widest text-zinc-400 mb-5 flex items-center gap-2">
              <Phone className="w-3.5 h-3.5 text-emerald-400" />
              Dial Number
            </h3>

            {/* Phone Input */}
            <div className="flex gap-2 mb-4">
              <select
                value={countryCode}
                onChange={e => setCountryCode(e.target.value)}
                disabled={isActive}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-3 text-sm text-white font-mono focus:outline-none focus:border-emerald-500/50 disabled:opacity-40 w-24"
              >
                <option value="+91">🇮🇳 +91</option>
                <option value="+1">🇺🇸 +1</option>
                <option value="+44">🇬🇧 +44</option>
                <option value="+61">🇦🇺 +61</option>
                <option value="+971">🇦🇪 +971</option>
                <option value="+65">🇸🇬 +65</option>
              </select>
              <input
                type="tel"
                value={phoneNumber}
                onChange={e => setPhoneNumber(e.target.value)}
                placeholder="98765 43210"
                disabled={isActive}
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-lg text-white font-mono tracking-wider placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50 disabled:opacity-40"
                maxLength={15}
              />
            </div>

            {/* Action Buttons */}
            {status === "idle" || isTerminal ? (
              <button
                onClick={isTerminal ? handleReset : handleCall}
                className="w-full py-3.5 rounded-2xl font-mono text-sm uppercase tracking-widest font-semibold transition-all cursor-pointer bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:shadow-lg hover:shadow-emerald-500/25 hover:scale-[1.01] active:scale-[0.99]"
              >
                {isTerminal ? "New Call" : "Call Now"}
              </button>
            ) : (
              <button
                onClick={handleHangup}
                className="w-full py-3.5 rounded-2xl font-mono text-sm uppercase tracking-widest font-semibold transition-all cursor-pointer bg-gradient-to-r from-red-500 to-rose-600 text-white hover:shadow-lg hover:shadow-red-500/25 animate-pulse"
              >
                <PhoneOff className="w-4 h-4 inline mr-2" />
                End Call
              </button>
            )}

            {/* Error Display */}
            {error && (
              <div className="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-mono flex items-start gap-2">
                <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Status Display */}
            <div className="mt-6 space-y-3">
              <div className="flex items-center justify-between text-xs font-mono text-zinc-500 uppercase tracking-widest">
                <span>Status</span>
                <StatusBadge status={status} />
              </div>

              {isActive && (
                <div className="flex items-center justify-between text-xs font-mono text-zinc-500 uppercase tracking-widest">
                  <span>Duration</span>
                  <span className="text-white tabular-nums">{formatDuration(duration)}</span>
                </div>
              )}

              {callId && (
                <div className="flex items-center justify-between text-xs font-mono text-zinc-600 uppercase tracking-widest">
                  <span>Call ID</span>
                  <span className="text-zinc-400 text-[10px]">{callId}</span>
                </div>
              )}
            </div>

            {/* Persona indicator */}
            <div className="mt-6 pt-4 border-t border-white/5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-600 flex items-center justify-center text-white text-xs font-bold">A</div>
                <div>
                  <p className="text-xs text-white font-medium">Arjun — GoRan AI Outbound Agent</p>
                  <p className="text-[10px] text-zinc-500 font-mono">AI agent will converse after call connects</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Live Transcript */}
        <div className="lg:col-span-7">
          <div className="rounded-3xl border border-white/[0.06] bg-white/[0.015] backdrop-blur-xl p-6 shadow-2xl h-[550px] flex flex-col">
            <h3 className="text-sm font-mono uppercase tracking-widest text-zinc-400 mb-4 flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-emerald-400" />
              Live Transcript
              {status === "in-progress" && (
                <span className="ml-auto flex items-center gap-1.5 text-emerald-400 text-[10px] uppercase">
                  <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span>
                  Live
                </span>
              )}
            </h3>

            <div className="flex-1 overflow-y-auto space-y-3 pr-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
              {transcript.length === 0 ? (
                <div className="flex items-center justify-center h-full text-zinc-600 text-sm font-mono">
                  {isActive
                    ? "Waiting for call to connect..."
                    : "Transcript will appear here during the call"
                  }
                </div>
              ) : (
                transcript.map((line, i) => (
                  <div
                    key={i}
                    className={`flex ${line.role === "agent" ? "justify-start" : "justify-end"}`}
                  >
                    <div
                      className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                        line.role === "agent"
                          ? "bg-white/5 border border-white/5 text-zinc-200 rounded-tl-md"
                          : "bg-emerald-500/15 border border-emerald-500/20 text-emerald-100 rounded-tr-md"
                      }`}
                    >
                      <p className="text-[9px] font-mono uppercase tracking-widest mb-1 opacity-50">
                        {line.role === "agent" ? "🤖 Arjun" : "👤 Caller"}
                      </p>
                      {line.text}
                    </div>
                  </div>
                ))
              )}
              <div ref={transcriptEndRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: OutboundStatus }) {
  const config: Record<OutboundStatus, { label: string; color: string; icon: React.ReactNode }> = {
    idle: { label: "Ready", color: "text-zinc-400 bg-zinc-500/10 border-zinc-500/20", icon: <Phone className="w-3 h-3" /> },
    initiating: { label: "Dialing...", color: "text-amber-400 bg-amber-500/10 border-amber-500/20", icon: <Loader2 className="w-3 h-3 animate-spin" /> },
    initiated: { label: "Ringing", color: "text-amber-400 bg-amber-500/10 border-amber-500/20", icon: <Loader2 className="w-3 h-3 animate-spin" /> },
    ringing: { label: "Ringing", color: "text-amber-400 bg-amber-500/10 border-amber-500/20", icon: <Loader2 className="w-3 h-3 animate-spin" /> },
    "in-progress": { label: "Connected", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", icon: <CheckCircle className="w-3 h-3" /> },
    completed: { label: "Completed", color: "text-blue-400 bg-blue-500/10 border-blue-500/20", icon: <CheckCircle className="w-3 h-3" /> },
    failed: { label: "Failed", color: "text-red-400 bg-red-500/10 border-red-500/20", icon: <XCircle className="w-3 h-3" /> },
    busy: { label: "Busy", color: "text-orange-400 bg-orange-500/10 border-orange-500/20", icon: <XCircle className="w-3 h-3" /> },
    "no-answer": { label: "No Answer", color: "text-orange-400 bg-orange-500/10 border-orange-500/20", icon: <XCircle className="w-3 h-3" /> },
  };

  const c = config[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono uppercase tracking-widest border ${c.color}`}>
      {c.icon}
      {c.label}
    </span>
  );
}
