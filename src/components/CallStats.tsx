import React, { useState, useEffect } from "react";
import { Persona } from "../types";
import { Activity, ShieldCheck, Clock, HardDriveDownload } from "lucide-react";

interface CallStatsProps {
  callState: "idle" | "calling" | "connected" | "ended" | "error";
  persona: Persona;
  packetCount: number;
  callStartTime?: number | null;
}

export const CallStats: React.FC<CallStatsProps> = ({
  callState,
  persona,
  packetCount,
  callStartTime,
}) => {
  const [elapsed, setElapsed] = useState(0);

  // Live duration counter
  useEffect(() => {
    if (callState !== "connected" || !callStartTime) {
      setElapsed(0);
      return;
    }
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - callStartTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [callState, callStartTime]);

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60).toString().padStart(2, "0");
    const s = (sec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  return (
    <div className="bg-white/[0.02] backdrop-blur-2xl border border-white/5 rounded-3xl p-5 shadow-2xl shadow-black/85">
      <h3 className="text-[10px] font-semibold tracking-[0.2em] text-zinc-500 uppercase mb-3 flex items-center gap-2 font-mono">
        <Activity className="w-3.5 h-3.5 text-orange-400" /> Live Call Telemetry
      </h3>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Codec */}
        <div className="bg-[#0a0502]/60 p-4 rounded-2xl border border-white/5 font-mono">
          <span className="text-[9px] text-zinc-500 uppercase tracking-widest block">Trunk Codec</span>
          <span className="text-xs font-semibold text-zinc-200 mt-1 block">
            {callState === "connected" ? "PCM Mono 16kHz" : "Awaiting Dial..."}
          </span>
        </div>

        {/* Model */}
        <div className="bg-[#0a0502]/60 p-4 rounded-2xl border border-white/5 font-mono">
          <span className="text-[9px] text-zinc-500 uppercase tracking-widest block">AI Model</span>
          <span className="text-xs font-semibold text-zinc-200 mt-1 block flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-green-400 inline shrink-0" />
            <span>{callState === "connected" ? "Realtime-3.1-Live" : "Standby"}</span>
          </span>
        </div>

        {/* Duration */}
        <div className="bg-[#0a0502]/60 p-4 rounded-2xl border border-white/5 font-mono">
          <span className="text-[9px] text-zinc-500 uppercase tracking-widest block flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-cyan-400" /> Call Duration
          </span>
          <span className={`text-xs font-bold mt-1 block ${callState === "connected" ? "text-cyan-400" : "text-zinc-500"}`}>
            {callState === "connected" ? formatDuration(elapsed) : "00:00"}
          </span>
        </div>

        {/* Packets */}
        <div className="bg-[#0a0502]/60 p-4 rounded-2xl border border-white/5 font-mono">
          <span className="text-[9px] text-zinc-400 uppercase tracking-widest block flex items-center gap-1.5">
            <HardDriveDownload className="w-3 h-3 text-orange-400" /> Audio Packets
          </span>
          <span className="text-xs font-bold text-orange-400 mt-1 block">
            {packetCount > 0 ? `${packetCount.toLocaleString()} streamed` : "0 frames"}
          </span>
        </div>
      </div>
    </div>
  );
};
