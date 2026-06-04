import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Phone,
  PhoneOff,
  Clock,
  Volume2,
  MessageSquare,
  Sparkles,
  Calendar,
  ChevronLeft,
  ChevronRight,
  X,
  Loader2,
  CheckCircle,
  XCircle,
  HelpCircle,
} from "lucide-react";
import type { CallLogEntry, CallLogDetail } from "../types";

// ─── Format Helpers ─────────────────────────────────────────────

function formatDuration(sec: number | undefined): string {
  if (!sec || sec <= 0) return "0s";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

const statusColors: Record<string, string> = {
  completed: "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20",
  connected: "text-cyan-400 bg-cyan-500/10 border border-cyan-500/20",
  ringing: "text-amber-400 bg-amber-500/10 border border-amber-500/20",
  failed: "text-red-400 bg-red-500/10 border border-red-500/20",
  missed: "text-zinc-400 bg-zinc-500/10 border border-zinc-500/20",
};

export const ClientPortal: React.FC = () => {
  // ─── Active Call States (Outbound Dialer) ──────────────────────
  const [phoneNumber, setPhoneNumber] = useState("");
  const [callState, setCallState] = useState<"idle" | "dialing" | "ringing" | "connected" | "ended" | "failed">("idle");
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [dialerError, setDialerError] = useState("");
  
  // ─── Call History States ───────────────────────────────────────
  const [calls, setCalls] = useState<CallLogEntry[]>([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [selectedCall, setSelectedCall] = useState<CallLogDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // ─── Booking Confirmation States ────────────────────────────────
  const [scanning, setScanning] = useState(false);
  const [scanNotification, setScanNotification] = useState<string | null>(null);

  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Fetch Call History ────────────────────────────────────────
  const fetchCalls = useCallback(async (page = 1) => {
    try {
      setLoadingHistory(true);
      const res = await fetch(`/api/analytics/calls?page=${page}&limit=10`);
      const json = await res.json();
      if (json.success) {
        setCalls(json.data);
        setPagination(json.pagination);
      }
    } catch (err) {
      console.error("Failed to load call history:", err);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    fetchCalls(1);
    const interval = setInterval(() => fetchCalls(pagination.page), 25000);
    return () => clearInterval(interval);
  }, [fetchCalls, pagination.page]);

  // ─── Fetch Call Details ────────────────────────────────────────
  const handleViewDetails = async (callId: string) => {
    try {
      setLoadingDetail(true);
      const res = await fetch(`/api/analytics/calls/${callId}`);
      const json = await res.json();
      if (json.success) {
        setSelectedCall(json.data);
      }
    } catch (err) {
      console.error("Failed to load call details:", err);
    } finally {
      setLoadingDetail(false);
    }
  };

  // ─── Handle Dial Outbound Call via VoBiz ────────────────────────
  const handleInitiateCall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneNumber.trim()) return;

    setCallState("dialing");
    setDialerError("");
    setCallDuration(0);
    setActiveCallId(null);

    // Format phone number to E.164 if missing country code
    let formattedNumber = phoneNumber.trim();
    if (!formattedNumber.startsWith("+")) {
      formattedNumber = "+91" + formattedNumber.replace(/^0+/, "");
    }

    try {
      const res = await fetch("/api/outbound/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toNumber: formattedNumber,
          personaId: "arjun-outbound", // Default GoRan Outbound Representative
        }),
      });

      const json = await res.json();

      if (!json.success) {
        throw new Error(json.error || "Failed to trigger outbound call");
      }

      setActiveCallId(json.callId);
      setCallState("ringing");

      // Start duration stopwatch once answered
      let dur = 0;
      pollingTimerRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/outbound/status/${json.callId}`);
          const statusJson = await statusRes.json();
          if (statusJson.success) {
            const status = statusJson.status;
            if (status === "in-progress") {
              setCallState("connected");
              dur++;
              setCallDuration(dur);
            } else if (status === "completed") {
              handleTerminateActiveCallState();
              fetchCalls(1);
            } else if (status === "failed" || status === "busy" || status === "no-answer") {
              setCallState("failed");
              setDialerError(`Call failed: ${status}`);
              handleTerminateActiveCallState();
              fetchCalls(1);
            }
          }
        } catch (pollErr) {
          console.warn("Polling error:", pollErr);
        }
      }, 2000);

    } catch (err: any) {
      setCallState("idle");
      setDialerError(err?.message || "Outbound calling error.");
    }
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
            ? `Successfully scanned and triggered follow-up calls for ${data.triggeredCount} qualified lead(s) with no scheduled meeting.`
            : "Successfully scanned CRM leads. No qualified follow-ups pending."
        );
        fetchCalls(1);
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

  const handleTerminateActiveCallState = () => {
    if (pollingTimerRef.current) {
      clearInterval(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
    setCallState("idle");
    setActiveCallId(null);
  };

  const handleHangUp = async () => {
    if (!activeCallId) return;
    try {
      await fetch(`/api/outbound/hangup/${activeCallId}`, { method: "POST" });
    } catch (err) {
      console.error("Hangup failed:", err);
    }
    handleTerminateActiveCallState();
    fetchCalls(1);
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto py-4">
      {/* ─── Header Section ─── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-6">
        <div>
          <span className="text-[10px] font-mono text-emerald-400 font-bold uppercase tracking-[0.2em] bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-md">
            Lead Qualification Portal
          </span>
          <h2 className="text-3xl font-light tracking-tight text-white mt-3">
            GoRan AI Calling Dashboard
          </h2>
          <p className="text-xs text-zinc-500 font-mono tracking-widest mt-1 uppercase">
            Live Outbound Dialing & AI Call Audits
          </p>
        </div>
        <div className="flex items-center gap-1.5 border border-white/5 bg-white/[0.01] px-3.5 py-2.5 rounded-2xl">
          <span className="w-2.5 h-2.5 bg-green-500 rounded-full shadow-[0_0_12px_#22c55e] animate-pulse"></span>
          <span className="text-[10px] font-mono text-zinc-400 font-bold uppercase tracking-wider">
            Operational Hub
          </span>
        </div>
      </div>

      {/* ─── Top Row: Dialer Card & Active Call Status ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Outbound Dialer Card */}
        <div className="lg:col-span-2 bg-gradient-to-br from-white/[0.03] to-white/[0.01] backdrop-blur-2xl border border-white/5 rounded-3xl p-6 shadow-2xl relative overflow-hidden flex flex-col justify-between h-full">
          <div className="absolute top-[-30%] right-[-5%] w-[250px] h-[250px] bg-emerald-600/10 rounded-full blur-[80px] pointer-events-none"></div>
          <div>
            <h3 className="text-lg font-light tracking-tight text-white flex items-center gap-2 mb-2">
              <Phone className="w-4 h-4 text-emerald-400" /> Start Lead Call
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed font-serif italic mb-6">
              Connect our AI Representative (Arjun) directly to a client or lead's phone number instantly.
            </p>

            <form onSubmit={handleInitiateCall} className="space-y-4">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Enter lead phone number (e.g. 9812345678)"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  disabled={callState !== "idle"}
                  className="w-full bg-black/40 border border-white/5 focus:border-emerald-500/50 rounded-2xl px-5 py-4 text-sm font-mono text-white placeholder-zinc-600 outline-none transition duration-300 shadow-inner"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-mono text-zinc-600 uppercase tracking-widest pointer-events-none">
                  E.164 AUTO
                </span>
              </div>

              {dialerError && (
                <div className="bg-red-950/20 border border-red-500/10 px-4 py-3 rounded-2xl text-[11px] text-red-400 font-mono">
                  {dialerError}
                </div>
              )}

              {callState === "idle" ? (
                <button
                  type="submit"
                  disabled={!phoneNumber.trim()}
                  className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-medium py-4 px-6 rounded-2xl hover:scale-[101%] transition-all duration-300 shadow-lg shadow-emerald-500/10 text-xs font-mono uppercase tracking-wider text-center cursor-pointer disabled:opacity-20 disabled:scale-100 disabled:shadow-none disabled:cursor-not-allowed"
                >
                  Initiate Lead Call
                </button>
              ) : (
                <div className="flex gap-4">
                  <button
                    type="button"
                    onClick={handleHangUp}
                    className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-4 px-6 rounded-2xl transition duration-200 text-xs font-mono uppercase tracking-wider text-center cursor-pointer shadow-lg shadow-red-600/10 flex items-center justify-center gap-2"
                  >
                    <PhoneOff className="w-4 h-4" /> End active call
                  </button>
                </div>
              )}
            </form>
          </div>
        </div>

        {/* Active Call Live Status Monitor */}
        <div className="bg-white/[0.01] backdrop-blur-2xl border border-white/5 rounded-3xl p-6 shadow-2xl flex flex-col justify-between relative overflow-hidden h-full">
          <div className="absolute top-0 right-0 w-[120px] h-[120px] bg-orange-500/5 rounded-full blur-[40px] pointer-events-none"></div>
          <div>
            <h3 className="text-xs font-mono uppercase tracking-[0.2em] text-zinc-500 font-bold mb-4">
              Call Link Monitor
            </h3>
            
            <div className="py-8 flex flex-col items-center justify-center space-y-4">
              {callState === "idle" && (
                <>
                  <div className="w-16 h-16 rounded-full border border-white/5 bg-white/[0.02] flex items-center justify-center text-zinc-500">
                    <Phone className="w-6 h-6" />
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-zinc-400 font-serif italic">Trunk Line Idle</div>
                    <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest block mt-1">Ready for dialing</span>
                  </div>
                </>
              )}

              {callState === "dialing" && (
                <>
                  <div className="w-16 h-16 rounded-full border border-emerald-500/10 bg-emerald-500/5 flex items-center justify-center text-emerald-400">
                    <Loader2 className="w-6 h-6 animate-spin" />
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-emerald-400 font-mono uppercase tracking-widest animate-pulse">Contacting Carrier...</div>
                    <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest block mt-1">Routing outbound sip</span>
                  </div>
                </>
              )}

              {callState === "ringing" && (
                <>
                  <div className="w-16 h-16 rounded-full border border-amber-500/20 bg-amber-500/5 flex items-center justify-center text-amber-400 animate-pulse">
                    <Phone className="w-6 h-6 animate-bounce" />
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-amber-400 font-mono uppercase tracking-widest">Ringing Lead Phone</div>
                    <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest block mt-1">Awaiting answer</span>
                  </div>
                </>
              )}

              {callState === "connected" && (
                <>
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-white shadow-[0_0_30px_rgba(16,185,129,0.3)] ring-2 ring-emerald-400/20 animate-pulse">
                    <Phone className="w-6 h-6" />
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-green-400 font-mono uppercase tracking-widest">Link established</div>
                    <span className="text-xl font-bold font-mono text-white block mt-2">
                      {Math.floor(callDuration / 60)}:{(callDuration % 60).toString().padStart(2, "0")}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ─── Call History Table ─── */}
      <div className="bg-white/[0.01] backdrop-blur-2xl border border-white/5 rounded-3xl overflow-hidden shadow-2xl">
        <div className="px-6 py-5 border-b border-white/5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <h4 className="text-xs font-mono uppercase tracking-[0.2em] text-zinc-500 font-bold flex items-center gap-2">
            <Calendar className="w-4 h-4 text-emerald-400" /> Recent Call Audits
          </h4>
          <div className="flex items-center gap-3">
            <button
              onClick={handleTriggerFollowups}
              disabled={scanning}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500/20 to-teal-500/20 hover:from-emerald-500/30 hover:to-teal-500/30 border border-emerald-500/30 hover:border-emerald-500/50 text-emerald-400 hover:text-emerald-300 text-[10px] font-mono uppercase tracking-wider font-semibold transition duration-300 flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {scanning ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Scanning CRM Leads...
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  Scan & Dial Lead Follow-ups
                </>
              )}
            </button>
            <span className="text-[10px] font-mono text-zinc-500 font-bold bg-white/5 border border-white/5 px-2 py-1.5 rounded-xl">
              {pagination.total} records
            </span>
          </div>
        </div>

        {scanNotification && (
          <div className="px-6 py-4 bg-emerald-500/10 border-b border-emerald-500/20 text-emerald-400 text-xs font-mono flex items-center gap-3">
            <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{scanNotification}</span>
          </div>
        )}

        {loadingHistory ? (
          <div className="py-20 text-center text-zinc-500 font-mono text-xs flex flex-col items-center justify-center gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
            <span>Retrieving call audits from database...</span>
          </div>
        ) : calls.length === 0 ? (
          <div className="py-20 text-center">
            <Phone className="w-10 h-10 text-zinc-800 mx-auto mb-4" />
            <p className="text-sm text-zinc-500 font-serif italic">No call audits recorded yet.</p>
            <p className="text-xs text-zinc-600 mt-1 font-mono uppercase tracking-wider">Trigger a call above to start auditing</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[9px] text-zinc-500 uppercase tracking-widest border-b border-white/5">
                    <th className="px-6 py-4 text-left font-semibold">Agent Name</th>
                    <th className="px-4 py-4 text-left font-semibold">Lead Number</th>
                    <th className="px-4 py-4 text-left font-semibold">Duration</th>
                    <th className="px-4 py-4 text-left font-semibold">Link Status</th>
                    <th className="px-4 py-4 text-left font-semibold">Call Time</th>
                    <th className="px-6 py-4 text-right font-semibold">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {calls.map((call) => (
                    <tr
                      key={call.callId}
                      className="border-b border-white/[0.02] hover:bg-white/[0.01] transition-colors cursor-pointer"
                      onClick={() => handleViewDetails(call.callId)}
                    >
                      <td className="px-6 py-4">
                        <div className="font-medium text-zinc-200">{call.personaName}</div>
                      </td>
                      <td className="px-4 py-4 text-zinc-400 font-mono text-xs">
                        {call.callerNumber || "—"}
                      </td>
                      <td className="px-4 py-4 text-xs font-mono text-zinc-300">
                        {formatDuration(call.durationSeconds)}
                      </td>
                      <td className="px-4 py-4">
                        <span className={`text-[9px] font-mono uppercase tracking-widest px-2.5 py-0.5 rounded-md ${statusColors[call.status] || "text-zinc-400 bg-zinc-500/10 border border-zinc-500/20"}`}>
                          {call.status}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-xs text-zinc-500 font-mono">
                        <div>{formatDate(call.startedAt)}</div>
                        <div className="text-zinc-600 text-[10px] mt-0.5">{formatTime(call.startedAt)}</div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleViewDetails(call.callId);
                          }}
                          className="px-3.5 py-1.5 rounded-xl border border-white/5 hover:border-emerald-500/25 bg-white/[0.01] hover:bg-emerald-500/5 text-zinc-400 hover:text-emerald-400 text-xs font-mono uppercase tracking-wider transition duration-300"
                        >
                          Audit Details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {pagination.totalPages > 1 && (
              <div className="px-6 py-4 border-t border-white/5 flex items-center justify-between">
                <span className="text-[10px] text-zinc-600 font-mono uppercase tracking-widest">
                  Page {pagination.page} of {pagination.totalPages}
                </span>
                <div className="flex gap-2">
                  <button
                    disabled={pagination.page <= 1}
                    onClick={() => fetchCalls(pagination.page - 1)}
                    className="p-2 rounded-xl border border-white/5 hover:bg-white/[0.03] disabled:opacity-20 text-zinc-400 cursor-pointer disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    disabled={pagination.page >= pagination.totalPages}
                    onClick={() => fetchCalls(pagination.page + 1)}
                    className="p-2 rounded-xl border border-white/5 hover:bg-white/[0.03] disabled:opacity-20 text-zinc-400 cursor-pointer disabled:cursor-not-allowed"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ─── Detailed Audit Modal ─── */}
      {selectedCall && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedCall(null)}
        >
          <div
            className="bg-[#090605] border border-white/10 rounded-3xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col relative"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between shrink-0 bg-white/[0.01]">
              <div>
                <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest">
                  Lead Call Audit Detail
                </span>
                <h3 className="text-xl font-light tracking-tight text-white mt-1">
                  {selectedCall.personaName}
                </h3>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-[9px] font-mono uppercase tracking-widest px-2.5 py-0.5 rounded-md ${statusColors[selectedCall.status] || ""}`}>
                  {selectedCall.status}
                </span>
                <button
                  onClick={() => setSelectedCall(null)}
                  className="p-2 rounded-xl hover:bg-white/5 text-zinc-500 hover:text-zinc-300 transition duration-200 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Quick Meta Stats */}
            <div className="px-6 py-4 border-b border-white/5 bg-white/[0.005] grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs shrink-0 font-mono">
              <div>
                <span className="text-zinc-600 block text-[9px] uppercase tracking-wider">Duration</span>
                <span className="text-zinc-200 font-bold mt-1 block">{formatDuration(selectedCall.durationSeconds)}</span>
              </div>
              <div>
                <span className="text-zinc-600 block text-[9px] uppercase tracking-wider">Lead Phone</span>
                <span className="text-zinc-200 font-bold mt-1 block">{selectedCall.callerNumber || "—"}</span>
              </div>
              <div>
                <span className="text-zinc-600 block text-[9px] uppercase tracking-wider">Network Ping</span>
                <span className="text-zinc-200 font-bold mt-1 block">
                  {selectedCall.latencyMs != null ? `${selectedCall.latencyMs}ms` : "—"}
                </span>
              </div>
              <div>
                <span className="text-zinc-600 block text-[9px] uppercase tracking-wider">Call Timestamp</span>
                <span className="text-zinc-300 block text-[10px] mt-1 font-bold">
                  {formatDate(selectedCall.startedAt)} {formatTime(selectedCall.startedAt)}
                </span>
              </div>
            </div>

            {/* Body Scroll Section */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6 custom-scrollbar">
              
              {/* Premium Mixed Audio Recording Player */}
              {selectedCall.recordingUrl ? (
                <div className="bg-gradient-to-br from-emerald-500/5 to-teal-500/0 border border-emerald-500/10 p-5 rounded-2xl space-y-3 shadow-inner">
                  <h4 className="text-[10px] font-mono font-bold tracking-[0.2em] text-emerald-400 uppercase flex items-center gap-2">
                    <Volume2 className="w-4 h-4 text-emerald-400" /> Play Mixed Call Recording
                  </h4>
                  <p className="text-[10px] text-zinc-500 font-serif italic leading-relaxed">
                    This high-fidelity recording contains the chronologically mixed dual-channel audio from the caller and agent.
                  </p>
                  <audio
                    controls
                    src={selectedCall.recordingUrl}
                    className="w-full h-10 outline-none filter invert brightness-90 bg-transparent rounded-xl mt-2"
                  />
                </div>
              ) : (
                <div className="bg-zinc-950/40 border border-white/5 p-5 rounded-2xl flex items-center gap-3 text-zinc-600">
                  <HelpCircle className="w-5 h-5 shrink-0" />
                  <div className="text-[11px] font-mono uppercase tracking-wider">Call recording is not available for this session.</div>
                </div>
              )}

              {/* AI Call Summary */}
              <div className="bg-gradient-to-br from-orange-500/5 to-amber-500/0 border border-orange-500/10 p-5 rounded-2xl space-y-3">
                <h4 className="text-[10px] font-mono font-bold tracking-[0.2em] text-orange-400 uppercase flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-orange-400" /> AI Call Audit Summary
                </h4>
                {selectedCall.summary ? (
                  <div className="text-xs text-zinc-300 leading-relaxed font-mono whitespace-pre-line bg-black/30 border border-white/5 p-4 rounded-xl shadow-inner max-h-60 overflow-y-auto custom-scrollbar">
                    {selectedCall.summary}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-zinc-500 py-2">
                    <Loader2 className="w-4 h-4 animate-spin text-orange-400" />
                    <span className="text-[11px] font-mono uppercase tracking-widest animate-pulse">Generating AI Summary...</span>
                  </div>
                )}
              </div>

              {/* Dialogue Transcript Feed */}
              <div>
                <h4 className="text-[10px] font-mono font-bold tracking-[0.2em] text-zinc-500 uppercase mb-4 flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-cyan-400" /> Conversation Dialogue Transcript ({selectedCall.transcript?.length || 0} messages)
                </h4>
                
                {(!selectedCall.transcript || selectedCall.transcript.length === 0) ? (
                  <p className="text-xs text-zinc-600 italic font-serif">No conversation dialogue transcript recorded.</p>
                ) : (
                  <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                    {selectedCall.transcript.map((t, i) => (
                      <div
                        key={i}
                        className={`flex flex-col max-w-[85%] ${
                          t.role === "user" ? "ml-auto items-end" : "items-start"
                        }`}
                      >
                        <span className="text-[8px] font-mono text-zinc-600 uppercase tracking-widest mb-1 capitalize">
                          {t.role === "user" ? "👤 Client / Caller" : "🤖 Sales Agent / Representative"}
                        </span>
                        <div
                          className={`text-xs px-4 py-3 rounded-2xl shadow-md ${
                            t.role === "user"
                              ? "bg-indigo-500/10 border border-indigo-500/20 text-indigo-100 rounded-tr-none"
                              : "bg-emerald-500/10 border border-emerald-500/20 text-emerald-100 rounded-tl-none"
                          }`}
                        >
                          {t.text}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
