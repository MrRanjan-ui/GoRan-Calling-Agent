import React, { useEffect, useRef } from "react";
import { CallState, Persona } from "../types";
import { Mic, MicOff, PhoneOff, ShieldCheck, Wifi, UserCheck, AlertOctagon } from "lucide-react";

interface CallConsoleProps {
  callState: CallState;
  persona: Persona;
  isMuted: boolean;
  onToggleMute: () => void;
  onEndCall: () => void;
  errorMessage?: string;
  activeVoiceDetect: boolean; // True if the user is transmitting mic audio
  activeSpeakerDetect: boolean; // True if the agent is outputting speaker audio
  latencyMs?: number;
}

export const CallConsole: React.FC<CallConsoleProps> = ({
  callState,
  persona,
  isMuted,
  onToggleMute,
  onEndCall,
  errorMessage,
  activeVoiceDetect,
  activeSpeakerDetect,
  latencyMs,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const phaseRef = useRef<number>(0);

  // Bezier Ambient wave drawing logic on HTML5 Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = (canvas.width = canvas.offsetWidth * 1.5);
    let height = (canvas.height = canvas.offsetHeight * 1.5);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = canvas.offsetWidth * 1.5;
      height = canvas.height = canvas.offsetHeight * 1.5;
    };
    window.addEventListener("resize", handleResize);

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      // Determine colors based on persona
      let primaryColor = "#10b981"; // emerald default
      let secondaryColor = "rgba(16, 185, 129, 0.2)";
      if (persona.accentColor === "amber") {
        primaryColor = "#f59e0b";
        secondaryColor = "rgba(245, 158, 11, 0.2)";
      } else if (persona.accentColor === "indigo") {
        primaryColor = "#6366f1";
        secondaryColor = "rgba(99, 102, 241, 0.2)";
      } else if (persona.accentColor === "rose") {
        primaryColor = "#f43f5e";
        secondaryColor = "rgba(244, 63, 94, 0.2)";
      } else if (persona.accentColor === "cyan") {
        primaryColor = "#06b6d4";
        secondaryColor = "rgba(6, 182, 212, 0.2)";
      } else if (persona.accentColor === "pink") {
        primaryColor = "#ec4899";
        secondaryColor = "rgba(236, 72, 153, 0.2)";
      } else if (persona.accentColor === "green") {
        primaryColor = "#22c55e";
        secondaryColor = "rgba(34, 197, 94, 0.2)";
      }

      // Phase update for waves moving left-to-right
      phaseRef.current += 0.05;

      const waves = 4;
      const points = 60;
      const p = phaseRef.current;

      // Base amplitude scales depending on whether anyone is talking
      let speakerAmp = 4;
      if (callState === "calling") {
        speakerAmp = 8; // gentle ringing wave
      } else if (callState === "connected") {
        if (activeSpeakerDetect) {
          speakerAmp = 28; // High wave when the agent speaks
        } else if (activeVoiceDetect) {
          speakerAmp = 18; // Medium wave when user speaking
        } else {
          speakerAmp = 6; // idle ambient breathing wave
        }
      } else {
        speakerAmp = 1; // flatline
      }

      for (let i = 0; i < waves; i++) {
        ctx.beginPath();
        ctx.lineWidth = i === 0 ? 3 : 1.2;
        // Fade lines as they sit in the back
        ctx.strokeStyle = i === 0 ? primaryColor : secondaryColor;

        const offsetMultiplier = i * 0.4;
        const speedFactor = (i + 1) * 0.7;

        for (let j = 0; j <= points; j++) {
          const x = (j / points) * width;
          // Apply a sine distribution to clamp wave heights at edges
          const bellClamp = Math.sin((j / points) * Math.PI);
          
          // Generate wave height combining multiple frequencies
          const sinValue = Math.sin(j * 0.12 - p * speedFactor + offsetMultiplier);
          const y = height / 2 + sinValue * speakerAmp * bellClamp;

          if (j === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener("resize", handleResize);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [callState, persona, activeVoiceDetect, activeSpeakerDetect]);

  return (
    <div className="bg-white/[0.02] backdrop-blur-2xl border border-white/5 rounded-3xl p-6 shadow-2xl shadow-black/80 flex flex-col justify-between h-full relative overflow-hidden">
      
      {/* Visual background atmospheric overlays */}
      <div className={`absolute top-0 right-0 w-48 h-48 rounded-full blur-[100px] pointer-events-none transition-all duration-700 bg-orange-500/10`}></div>

      {/* Top Banner Status */}
      <div className="flex items-center justify-between z-10">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
              callState === "connected" ? "bg-green-400" : callState === "calling" ? "bg-orange-400 animate-pulse" : "bg-zinc-500"
            }`}></span>
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
              callState === "connected" ? "bg-green-500" : callState === "calling" ? "bg-orange-500" : "bg-zinc-600"
            }`}></span>
          </span>
          <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-zinc-400 font-bold">
            {callState === "idle" && "Trunk Standby"}
            {callState === "calling" && "Dialing..."}
            {callState === "connected" && "Active Link"}
            {callState === "ended" && "Disconnected"}
            {callState === "error" && "Port Error"}
          </span>
        </div>
        
        {callState === "connected" && (
          <div className="flex items-center gap-1.5 text-zinc-400 font-mono text-[9px] bg-[#0a0502]/80 px-2 py-0.5 rounded-md border border-white/5">
            <Wifi className="w-3 h-3 text-orange-400" />
            <span>LATENCY: {latencyMs ? `${latencyMs}ms` : "Measuring..."}</span>
          </div>
        )}
      </div>

      {/* Center Concentric Glowing Orb Section */}
      <div className="my-auto py-8 flex flex-col items-center justify-center z-10">
        <div className="relative flex items-center justify-center w-[230px] h-[230px]">
          
          {/* Concentric Glow Layers (Immersive UI theme) */}
          <div className={`absolute w-[210px] h-[210px] rounded-full border border-white/5 scale-[1.35] transition-transform duration-500 pointer-events-none ${
            callState === "connected" && activeSpeakerDetect ? "scale-[1.45] border-orange-500/10" : ""
          }`}></div>
          <div className={`absolute w-[210px] h-[210px] rounded-full border border-orange-500/10 scale-115 transition-all duration-700 pointer-events-none ${
            callState === "connected" && (activeSpeakerDetect || activeVoiceDetect) ? "border-orange-500/20 shadow-[0_0_30px_rgba(249,115,22,0.1)]" : ""
          }`}></div>
          
          {/* Main Visualizer Globe */}
          <div className={`w-[210px] h-[210px] rounded-full bg-gradient-to-br from-orange-500 via-orange-600 to-amber-950 flex items-center justify-center transition-all duration-500 relative overflow-hidden shadow-[0_0_60px_rgba(249,115,22,0.2)] ${
            callState === "connected" && activeSpeakerDetect 
              ? "shadow-[0_0_80px_rgba(249,115,22,0.45)] ring-2 ring-orange-400/20 scale-[102%]" 
              : ""
          }`}>
            <div className="w-[185px] h-[185px] rounded-full bg-[#0a0502] flex flex-col items-center justify-center overflow-hidden relative">
              
              {/* Voice Canvas fitted internally inside coordinates */}
              <div className="absolute inset-x-0 bottom-6 top-8 opacity-70">
                <canvas ref={canvasRef} className="w-full h-full block" />
              </div>

              {/* Floating Avatar core */}
              <div className="text-4xl relative z-20 drop-shadow-[0_0_15px_rgba(255,255,255,0.1)] transition-transform duration-300 hover:scale-110">
                {persona.avatar || "🤖"}
              </div>

              {/* Status Indicator over canvas */}
              <div className="absolute top-2 right-2 z-20">
                {callState === "connected" && (activeSpeakerDetect || activeVoiceDetect) ? (
                  <span className="flex h-1.5 w-1.5 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-orange-500"></span>
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        {/* Name and Designation */}
        <div className="text-center mt-8">
          <h1 className="text-3xl font-light tracking-tight text-white mb-1">{persona.name}</h1>
          <p className="text-orange-400/80 font-mono tracking-widest uppercase text-[10px]">
            {persona.role} {persona.phoneNumber ? `• ${persona.phoneNumber}` : ""}
          </p>
        </div>

        {/* Dynamic speech state details */}
        <div className="mt-4 text-center px-4 max-w-sm h-12 flex items-center justify-center">
          {callState === "calling" && (
            <p className="text-xs text-orange-400 font-mono tracking-widest animate-pulse uppercase">
              Establishing server connection...
            </p>
          )}
          {callState === "connected" && (
            <div className="flex flex-col items-center">
              <span className="text-[9px] uppercase font-mono text-zinc-500 tracking-widest">
                Real-time Duplex Open
              </span>
              <p className="text-sm font-serif italic text-zinc-300 mt-1">
                {activeSpeakerDetect ? "Agent is speaking..." : activeVoiceDetect ? "Speak now, I'm listening..." : "Awaiting your voice input..."}
              </p>
            </div>
          )}
          {callState === "ended" && (
            <p className="text-xs text-zinc-500 font-serif italic">
              Line hung up. Redial above to connect.
            </p>
          )}
          {callState === "error" && (
            <div className="bg-red-950/20 border border-red-500/20 px-3 py-1.5 rounded-lg max-w-full">
              <p className="text-[11px] text-red-400 font-mono leading-tight">
                {errorMessage || "Handshake failed"}
              </p>
            </div>
          )}
          {callState === "idle" && (
            <p className="text-sm text-zinc-400 max-w-xs font-serif italic leading-relaxed text-center">
              Awaiting session. Select one from the directory to start a secure voice call.
            </p>
          )}
        </div>
      </div>

      {/* VoIP Hardware Controls (Immersive UI buttons layout) */}
      <div className="flex items-center justify-center gap-10 z-10 border-t border-white/5 pt-5">
        {/* Mute Button */}
        <button
          onClick={onToggleMute}
          disabled={callState !== "connected"}
          className={`group flex flex-col items-center gap-2 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed`}
          title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
        >
          <div className={`w-14 h-14 rounded-full border flex items-center justify-center transition-all duration-300 ${
            isMuted
              ? "bg-red-500/20 border-red-500/40 text-red-400"
              : "bg-white/5 border-white/10 text-zinc-400 group-hover:bg-white/10 group-hover:border-white/20 group-hover:text-zinc-200"
          }`}>
            {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </div>
          <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-mono">
            {isMuted ? "Muted" : "Mute"}
          </span>
        </button>

        {/* Hang Up Action Button (Large glowing circle) */}
        <button
          onClick={onEndCall}
          disabled={callState === "idle" || callState === "ended"}
          className="w-18 h-18 rounded-full bg-red-600 flex items-center justify-center shadow-[0_0_30px_rgba(220,38,38,0.3)] hover:bg-red-700 active:scale-95 transition-all duration-300 cursor-pointer disabled:opacity-20 disabled:scale-100 disabled:shadow-none"
          title="Disconnect Line"
        >
          <PhoneOff className="w-8 h-8 text-white transform rotate-[135deg]" />
        </button>
      </div>
    </div>
  );
};
