import React, { useState } from "react";
import { Phone, Delete, HelpCircle } from "lucide-react";
import { Persona } from "../types";

interface DialPadProps {
  onStartCallWithNumber: (number: string) => void;
  personas: Persona[];
  onSelectPersonaByPhone: (persona: Persona) => void;
  callState: "idle" | "calling" | "connected" | "ended" | "error";
}

export const DialPad: React.FC<DialPadProps> = ({
  onStartCallWithNumber,
  personas,
  onSelectPersonaByPhone,
  callState,
}) => {
  const [phoneNumber, setPhoneNumber] = useState("");
  const isCallActive = callState === "calling" || callState === "connected";

  const handleKeyPress = (num: string) => {
    if (isCallActive) return;
    if (phoneNumber.length < 18) {
      setPhoneNumber((prev) => prev + num);
    }
  };

  const handleBackspace = () => {
    if (isCallActive) return;
    setPhoneNumber((prev) => prev.slice(0, -1));
  };

  const handleClear = () => {
    if (isCallActive) return;
    setPhoneNumber("");
  };

  const executeCall = () => {
    if (isCallActive) return;
    if (!phoneNumber) return;

    // Check if the number dialed corresponds to any known persona
    const foundPersona = personas.find(
      (p) =>
        p.phoneNumber && (
          p.phoneNumber.replace(/[^\d+]/g, "") === phoneNumber.replace(/[^\d+]/g, "") ||
          phoneNumber.includes(p.phoneNumber.split("-").pop() || "NON_EXIST")
        )
    );

    if (foundPersona) {
      onSelectPersonaByPhone(foundPersona);
    }
    
    onStartCallWithNumber(phoneNumber);
  };

  const handlePresetClick = (presetNum: string) => {
    if (isCallActive) return;
    setPhoneNumber(presetNum);
  };

  const keys = [
    { num: "1", letters: " " },
    { num: "2", letters: "ABC" },
    { num: "3", letters: "DEF" },
    { num: "4", letters: "GHI" },
    { num: "5", letters: "JKL" },
    { num: "6", letters: "MNO" },
    { num: "7", letters: "PQRS" },
    { num: "8", letters: "TUV" },
    { num: "9", letters: "WXYZ" },
    { num: "*", letters: "" },
    { num: "0", letters: "+" },
    { num: "#", letters: "" },
  ];

  return (
    <div className="bg-white/[0.02] backdrop-blur-2xl border border-white/5 rounded-3xl p-6 shadow-2xl shadow-black/80 flex flex-col h-full justify-between">
      <div>
        <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-zinc-400 mb-4">
          Keypad Dialer
        </h2>

        {/* Display screen */}
        <div className="bg-[#0a0502]/60 border border-white/10 rounded-2xl p-4 mb-4 flex flex-col items-center justify-center min-h-[72px] relative group overflow-hidden">
          <div className="absolute top-2 left-3 flex gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500/50"></span>
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500/20"></span>
          </div>
          <div className="text-xl font-mono text-zinc-100 tracking-widest truncate max-w-full px-2 mt-1">
            {phoneNumber || <span className="text-zinc-600 select-none">Enter Phone Number</span>}
          </div>
          {phoneNumber && (
            <div className="text-[9px] font-mono text-orange-400 mt-1 uppercase tracking-widest">
              Digital Trunk Line Standby
            </div>
          )}
        </div>

        {/* Dynamic Hints/Shortcuts */}
        <div className="mb-5">
          <p className="text-[11px] text-zinc-500 mb-2 flex items-center gap-1 font-serif italic">
            Select a preset routing line to initiate:
          </p>
          <div className="flex flex-wrap gap-2">
            {personas.filter(p => p.phoneNumber && p.phoneNumber.trim()).map((p) => (
              <button
                key={p.id}
                onClick={() => handlePresetClick(p.phoneNumber)}
                disabled={isCallActive}
                className="text-[10px] font-mono bg-white/[0.01] hover:bg-white/5 text-zinc-400 hover:text-white border border-white/5 hover:border-white/10 px-2 py-1 rounded-md cursor-pointer transition-all duration-200 disabled:opacity-30"
              >
                {p.name.split(" ").pop()}: {p.phoneNumber.split(" ").pop()}
              </button>
            ))}
          </div>
        </div>

        {/* Grid keys */}
        <div className="grid grid-cols-3 gap-3 max-w-[280px] mx-auto">
          {keys.map((key) => (
            <button
              key={key.num}
              onClick={() => handleKeyPress(key.num)}
              disabled={isCallActive}
              className={`h-14 rounded-2xl flex flex-col items-center justify-center border transition-all duration-200 cursor-pointer ${
                isCallActive
                  ? "bg-white/[0.01]/40 border-white/[0.02] text-zinc-700 cursor-not-allowed"
                  : "bg-white/[0.02] hover:bg-white/[0.06] border-white/5 hover:border-white/10 active:scale-95 text-zinc-100"
              }`}
            >
              <span className="text-lg font-semibold font-mono tracking-wide">
                {key.num}
              </span>
              <span className="text-[9px] text-zinc-500 uppercase tracking-widest select-none -mt-0.5 font-mono">
                {key.letters || "\u00A0"}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Control Actions Row */}
      <div className="mt-6 flex items-center justify-between gap-4">
        {/* Backspace Button */}
        <button
          onClick={handleBackspace}
          disabled={isCallActive || !phoneNumber}
          className="p-3.5 rounded-2xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.06] text-zinc-400 hover:text-white transition disabled:opacity-20 disabled:cursor-not-allowed cursor-pointer"
          title="Backspace"
        >
          <Delete className="w-5 h-5" />
        </button>

        {/* Main Glowing Call Button */}
        <button
          onClick={executeCall}
          disabled={isCallActive || !phoneNumber}
          className={`flex-1 py-3.5 rounded-2xl font-mono text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition duration-300 shadow-lg cursor-pointer ${
            isCallActive || !phoneNumber
              ? "bg-white/5 text-zinc-600 border border-white/5 cursor-not-allowed shadow-none"
              : "bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-400 hover:to-amber-500 text-white font-semibold shadow-[0_4px_20px_rgba(249,115,22,0.25)] hover:shadow-[0_4px_25px_rgba(249,115,22,0.35)] active:scale-[98%]"
          }`}
        >
          <Phone className="w-4 h-4 fill-current" />
          DIAL ROUTE
        </button>

        {/* Clear All button */}
        <button
          onClick={handleClear}
          disabled={isCallActive || !phoneNumber}
          className="px-3 py-3.5 rounded-2xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.06] text-zinc-400 hover:text-white transition text-xs font-mono disabled:opacity-20 disabled:cursor-not-allowed cursor-pointer"
          title="Clear"
        >
          CLR
        </button>
      </div>
    </div>
  );
};
