import React from "react";
import { Persona } from "../types";
import { Phone, CheckCircle, Edit, Trash2 } from "lucide-react";

interface PersonaListProps {
  selectedPersona: Persona;
  onSelectPersona: (persona: Persona) => void;
  callState: "idle" | "calling" | "connected" | "ended" | "error";
  onStartCall: () => void;
  personas: Persona[];
  onEditPersona?: (persona: Persona) => void;
  onDeletePersona?: (id: string) => void;
}

export const PersonaList: React.FC<PersonaListProps> = ({
  selectedPersona,
  onSelectPersona,
  callState,
  onStartCall,
  personas,
  onEditPersona,
  onDeletePersona,
}) => {
  const isCallActive = callState === "calling" || callState === "connected";

  // Built-in systems shouldn't show delete triggers
  const isCustomAgent = (personaId: string) => {
    return personaId.startsWith("persona_");
  };

  return (
    <div className="flex flex-col h-full bg-white/[0.02] backdrop-blur-2xl border border-white/5 rounded-3xl overflow-hidden shadow-2xl shadow-black/80">
      {/* Title Header */}
      <div className="p-6 border-b border-white/10 bg-white/[0.01] flex items-center justify-between">
        <div>
          <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-zinc-400">
            Agent Directory
          </h2>
          <p className="text-xs text-zinc-500 font-serif italic mt-0.5">Select a contact below to dial</p>
        </div>
        <span className="px-3 py-1 rounded-full text-[9px] uppercase tracking-wider font-mono font-bold bg-green-500/10 text-green-400 border border-green-500/20 shadow-[0_0_10px_rgba(34,197,94,0.15)] animate-pulse">
          {personas.length} Loaded
        </span>
      </div>

      {/* Directory Content List */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar">
        {personas.map((persona) => {
          const isSelected = selectedPersona.id === persona.id;
          const toneColor = persona.accentColor;

          // Map persona accentColor to appropriate Tailwind ring/border/text classes
          const borderClass = isSelected
            ? toneColor === "emerald"
              ? "border-emerald-500/40 bg-emerald-500/[0.02]"
              : toneColor === "amber"
              ? "border-orange-500/40 bg-orange-500/[0.02]"
              : toneColor === "indigo"
              ? "border-indigo-500/40 bg-indigo-500/[0.02]"
              : toneColor === "rose"
              ? "border-rose-500/40 bg-rose-500/[0.02]"
              : toneColor === "pink"
              ? "border-pink-500/40 bg-pink-500/[0.02]"
              : toneColor === "green"
              ? "border-green-500/40 bg-green-500/[0.02]"
              : "border-cyan-500/40 bg-cyan-500/[0.02]"
            : "border-white/5 bg-white/[0.01] hover:bg-white/[0.03] hover:border-white/10";

          const textClass = toneColor === "emerald"
            ? "text-emerald-400"
            : toneColor === "amber"
            ? "text-orange-400"
            : toneColor === "indigo"
            ? "text-indigo-400"
            : toneColor === "rose"
            ? "text-rose-400"
            : toneColor === "pink"
            ? "text-pink-400"
            : toneColor === "green"
            ? "text-green-400"
            : "text-cyan-400";

          return (
            <div
              key={persona.id}
              className={`group w-full relative transition-all duration-300 rounded-2xl border ${borderClass} ${
                isCallActive && !isSelected ? "opacity-40" : ""
              }`}
            >
              {/* Left Accent Glow line */}
              {isSelected && (
                <div
                  className="absolute left-0 top-0 bottom-0 w-1 rounded-l-full bg-gradient-to-b from-orange-400 to-amber-600"
                />
              )}

              {/* Editing controls for custom agents */}
              {isCustomAgent(persona.id) && !isCallActive && (
                <div className="absolute top-4 right-4 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-30">
                  {onEditPersona && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditPersona(persona);
                      }}
                      className="p-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/15 text-zinc-400 hover:text-white transition cursor-pointer"
                      title="Edit Agent Backstory"
                    >
                      <Edit className="w-3 h-3" />
                    </button>
                  )}
                  {onDeletePersona && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Are you sure you want to retire Agent ${persona.name}?`)) {
                          onDeletePersona(persona.id);
                        }
                      }}
                      className="p-1.5 rounded-lg bg-red-950/20 border border-red-500/20 hover:bg-red-900/40 text-red-400 hover:text-red-300 transition cursor-pointer"
                      title="Decommission Agent"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={() => !isCallActive && onSelectPersona(persona)}
                disabled={isCallActive}
                className={`w-full text-left p-4 flex items-start gap-4 cursor-pointer relative overflow-hidden`}
              >
                {/* Avatar Bubble */}
                <div
                  className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0 border transition-all duration-300 ${
                    isSelected
                      ? `bg-white/10 border-white/20 text-white shadow-[0_0_15px_rgba(255,255,255,0.05)]`
                      : "bg-white/5 border-white/5 text-zinc-400 group-hover:text-white"
                  }`}
                >
                  {persona.avatar || "🤖"}
                </div>

                {/* Contact Info */}
                <div className="flex-1 min-w-0 pr-10">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-white truncate group-hover:text-white transition-colors">
                      {persona.name}
                    </h3>
                  </div>
                  <p className={`text-[10px] font-mono tracking-widest uppercase mt-0.5 ${textClass}`}>
                    {persona.role}
                  </p>
                  <p className="text-xs text-zinc-400 mt-2 line-clamp-2 leading-relaxed font-serif italic">
                    "{persona.description || "No description provided."}"
                  </p>

                  {/* Badges */}
                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                    <span className="px-2 py-0.5 rounded-md bg-[#0a0502]/50 border border-white/5 text-[9px] font-mono text-zinc-500 uppercase tracking-widest">
                      Voice: {persona.voice}
                    </span>
                    {persona.phoneNumber && (
                      <span className="px-2 py-0.5 rounded-md bg-[#0a0502]/50 border border-white/5 text-[9px] font-mono text-zinc-500 truncate max-w-[120px]">
                        {persona.phoneNumber}
                      </span>
                    )}
                    {isSelected && (
                      <span className="flex items-center gap-1 text-[9px] text-green-400 font-mono tracking-widest uppercase">
                        <CheckCircle className="w-3 h-3" /> Selected
                      </span>
                    )}
                  </div>
                </div>
              </button>
            </div>
          );
        })}
      </div>

      {/* Directory Quick Call bar */}
      <div className="p-5 border-t border-white/10 bg-white/[0.01]">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-[0.2em] block">
              Routing Destination
            </span>
            <span className="text-sm font-light text-zinc-200 truncate block mt-0.5">
              {selectedPersona.name}
            </span>
          </div>
          <button
            onClick={onStartCall}
            disabled={isCallActive}
            className={`flex items-center gap-2 px-5 py-3 rounded-2xl font-mono text-xs uppercase tracking-widest transition-all duration-300 shadow-lg cursor-pointer ${
              isCallActive
                ? "bg-white/5 text-zinc-600 border border-white/5 cursor-not-allowed opacity-40 shadow-none"
                : `bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-400 hover:to-amber-500 text-white shadow-[0_4px_20px_rgba(249,115,22,0.25)] hover:shadow-[0_4px_25px_rgba(249,115,22,0.35)] active:scale-95`
            }`}
          >
            <Phone className="w-3.5 h-3.5" />
            Connect
          </button>
        </div>
      </div>
    </div>
  );
};
