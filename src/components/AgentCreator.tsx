import React, { useState, useEffect } from "react";
import { Persona, KnowledgeBase } from "../types";
import { Wrench, Sparkles, Wand2, Phone, Save, RotateCcw, ArrowLeft, Volume2 } from "lucide-react";

interface AgentCreatorProps {
  onSaveAgent: (newAgent: Persona) => void;
  onCancel: () => void;
  editingPersona?: Persona | null;
}

// Accent palette definitions
const ACCENT_COLORS = [
  { id: "emerald", label: "Emerald Green", class: "bg-emerald-500 border-emerald-400", hex: "#10b981" },
  { id: "amber", label: "Solar Amber", class: "bg-amber-500 border-amber-400", hex: "#f59e0b" },
  { id: "indigo", label: "Quantum Indigo", class: "bg-indigo-500 border-indigo-400", hex: "#6366f1" },
  { id: "rose", label: "Cyber Rose", class: "bg-rose-500 border-rose-400", hex: "#f43f5e" },
  { id: "cyan", label: "Neon Cyan", class: "bg-cyan-500 border-cyan-400", hex: "#06b6d4" },
  { id: "pink", label: "Bubblegum Pink", class: "bg-pink-500 border-pink-400", hex: "#ec4899" },
  { id: "green", label: "Forest Green", class: "bg-green-500 border-green-400", hex: "#22c55e" },
];

// Presets representing emojis
const AVATAR_PRESETS = [
  "🌸", "🧘‍♀️", "👩‍💻", "💼", "✨", 
  "🤖", "🐱", "🧙‍♂️", "🎙️", "👽", 
  "🍕", "🛡️", "🔥", "🦄", "🎯",
  "🤠", "🦁", "🦖", "🕶️", "🧠"
];

// Available voices in Realtime Live
const VOICE_PRESETS = [
  { id: "Zephyr", gender: "Male", desc: "Bright, energetic, modern tone with excellent clarity" },
  { id: "Puck", gender: "Female", desc: "Cheerful, warm, empathetic and highly clear voice" },
  { id: "Charon", gender: "Male", desc: "Deep, serious, steady low voice suited for logical guides" },
  { id: "Kore", gender: "Female", desc: "Intelligent, bright, standard assistant tone" },
  { id: "Fenrir", gender: "Male", desc: "Husky, dramatic, dense cinematic vocal profile" },
  { id: "Aoede", gender: "Female", desc: "Warm, melodic, expressive and relaxing vocal profile" },
];

// Template presets for easy configuration
const PRESET_TEMPLATES = [
  {
    title: "Support Desk Buddy",
    avatar: "🤖",
    role: "Support Tech Assistant",
    description: "A friendly corporate technician to walk you through troubleshooting server errors.",
    systemInstruction: "You are Support Buddy, an upbeat, extremely polite system support specialist. Help the caller with their technical setups, using lighthearted humor and clear step-by-step instructions. Keep messages concise and easy to understand over live VoIP.",
    initialGreeting: "Hello! This is Support Desk. How can I help resolve your system issues today?",
    accentColor: "cyan"
  },
  {
    title: "Sarcastic Buddy",
    avatar: "🕶️",
    role: "Full-time Heckler",
    description: "A witty, sarcastic companion with dry humor who loves playful jokes.",
    systemInstruction: "You are Gex, a sarcastic, sharp-tongued but ultimately friendly companion. Address the caller with high-grade witty humor, playful counters, and dry remarks. Do not be genuinely mean, but treat everything with friendly irony.",
    initialGreeting: "Oh, it's you. I was hoping the phone was ringing for someone else. What's on your mind?",
    accentColor: "rose"
  },
  {
    title: "Eldritch Oracle",
    avatar: "🧙‍♂️",
    role: "Mystic Overseer",
    description: "An ancient cosmic seer speaking in deep riddles and enigmatic timelines.",
    systemInstruction: "You are the Cosmic Oracle of the Core Node. You speak in cryptic, epic, and highly theatrical prose. You refer to stars, cosmic streams, and general digital eternity. Guide the caller's destiny with mysterious but insightful responses.",
    initialGreeting: "Mortal caller, you have traversed the cosmic noise streams. What mysteries of the digital cosmos do you seek?",
    accentColor: "indigo"
  },
  {
    title: "Spanish Tutor",
    avatar: "👩‍🏫",
    role: "Language Coach",
    description: "A patient, bilingual conversational specialist for relaxing Spanish dialogue.",
    systemInstruction: "You are Coach Alejandro, a super patient, friendly conversational Spanish teacher. Speak 50% in basic conversational Spanish and 50% in English. Encourage the caller, give gentle vocabulary tips, and keep things highly motivating.",
    initialGreeting: "¡Hola amigo! I am Alejandro, your conversational tutor. Ready to practice speaking some Spanish today? ¿Cómo estás?",
    accentColor: "emerald"
  },
  {
    title: "Contemplative Thinker",
    avatar: "🧠",
    role: "Philosophical Guide",
    description: "Deep, reflective wisdom, questioning assumptions with profound insights.",
    systemInstruction: "You are Hrisha, a contemplative guide who matches peaceful curiosity with deep philosophical analysis. Question the caller's premises gently, use metaphors, and inspire thoughtful meditation over the session.",
    initialGreeting: "Welcome to the thinking space. Today, what fundamental questions about reality or choice shall we study together?",
    accentColor: "amber"
  }
];

export const AgentCreator: React.FC<AgentCreatorProps> = ({
  onSaveAgent,
  onCancel,
  editingPersona,
}) => {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [description, setDescription] = useState("");
  const [systemInstruction, setSystemInstruction] = useState("");
  const [voice, setVoice] = useState<"Zephyr" | "Puck" | "Charon" | "Kore" | "Fenrir" | "Aoede">("Zephyr");
  const [accentColor, setAccentColor] = useState("cyan");
  const [avatar, setAvatar] = useState("🌸");
  const [initialGreeting, setInitialGreeting] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [knowledgeBaseId, setKnowledgeBaseId] = useState<string>("");
  const [ambientSound, setAmbientSound] = useState<"none" | "office" | "cafe" | "airport">("none");
  const [silenceTimeout, setSilenceTimeout] = useState<number>(30);
  const [temperature, setTemperature] = useState<number>(0.7);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);

  // Fetch knowledge bases from server on mount
  useEffect(() => {
    async function fetchKBs() {
      try {
        const res = await fetch("/api/knowledge-bases");
        const json = await res.json();
        if (json.success && json.data) {
          setKnowledgeBases(json.data);
        }
      } catch (err) {
        console.error("Failed to fetch knowledge bases:", err);
      }
    }
    fetchKBs();
  }, []);

  // Populate form if editing
  useEffect(() => {
    if (editingPersona) {
      setName(editingPersona.name);
      setRole(editingPersona.role);
      setDescription(editingPersona.description || "");
      setSystemInstruction(editingPersona.systemInstruction);
      setVoice(editingPersona.voice);
      setAccentColor(editingPersona.accentColor);
      setAvatar(editingPersona.avatar || "🤖");
      setInitialGreeting(editingPersona.initialGreeting || "");
      setPhoneNumber(editingPersona.phoneNumber || "");
      setKnowledgeBaseId(editingPersona.knowledgeBaseId || "");
      setAmbientSound(editingPersona.ambientSound || "none");
      setSilenceTimeout(editingPersona.silenceTimeout || 30);
      setTemperature(editingPersona.temperature || 0.7);
    } else {
      // Auto generate random phone number & default values
      const randomPhone = `+1 (555) ${Math.floor(100 + Math.random() * 900)}-${Math.floor(1000 + Math.random() * 9000)}`;
      setPhoneNumber(randomPhone);
      setAvatar("🤖");
      setKnowledgeBaseId("");
      setAmbientSound("none");
      setSilenceTimeout(30);
      setTemperature(0.7);
    }
  }, [editingPersona]);

  // Apply a template
  const applyTemplate = (template: typeof PRESET_TEMPLATES[0]) => {
    setName(template.title);
    setRole(template.role);
    setDescription(template.description);
    setSystemInstruction(template.systemInstruction);
    setAccentColor(template.accentColor);
    setAvatar(template.avatar);
    setInitialGreeting(template.initialGreeting);
  };

  const handleReset = () => {
    if (editingPersona) {
      setName(editingPersona.name);
      setRole(editingPersona.role);
      setDescription(editingPersona.description || "");
      setSystemInstruction(editingPersona.systemInstruction);
      setVoice(editingPersona.voice);
      setAccentColor(editingPersona.accentColor);
      setAvatar(editingPersona.avatar || "🤖");
      setInitialGreeting(editingPersona.initialGreeting || "");
      setPhoneNumber(editingPersona.phoneNumber || "");
      setKnowledgeBaseId(editingPersona.knowledgeBaseId || "");
      setAmbientSound(editingPersona.ambientSound || "none");
      setSilenceTimeout(editingPersona.silenceTimeout || 30);
      setTemperature(editingPersona.temperature || 0.7);
    } else {
      setName("");
      setRole("");
      setDescription("");
      setSystemInstruction("");
      setVoice("Zephyr");
      setAccentColor("cyan");
      setAvatar("🌸");
      setInitialGreeting("");
      setPhoneNumber(`+1 (555) ${Math.floor(100 + Math.random() * 900)}-${Math.floor(1000 + Math.random() * 9000)}`);
      setKnowledgeBaseId("");
      setAmbientSound("none");
      setSilenceTimeout(30);
      setTemperature(0.7);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !role.trim() || !systemInstruction.trim()) {
      alert("Please fill in the Name, Role/Sub-title, and System Instructions!");
      return;
    }

    const BG_THEME_MAP: Record<string, string> = {
      emerald: "bg-emerald-500/10",
      amber: "bg-amber-500/10",
      indigo: "bg-indigo-500/10",
      rose: "bg-rose-500/10",
      cyan: "bg-cyan-500/10",
      pink: "bg-pink-500/10",
      green: "bg-green-500/10"
    };

    const BORDER_THEME_MAP: Record<string, string> = {
      emerald: "border-emerald-500/30",
      amber: "border-orange-500/30",
      indigo: "border-indigo-500/30",
      rose: "border-rose-500/30",
      cyan: "border-cyan-500/30",
      pink: "border-pink-500/30",
      green: "border-green-500/30"
    };

    const calculatedBg = BG_THEME_MAP[accentColor] || "bg-cyan-500/10";
    const calculatedBorder = BORDER_THEME_MAP[accentColor] || "border-cyan-500/30";

    const savedAgent: Persona = {
      id: editingPersona?.id || "agent_" + Date.now(),
      name: name.trim(),
      role: role.trim(),
      description: description.trim() || `A customized conversational AI agent configured with unique dialogue profiles.`,
      voice,
      systemInstruction: systemInstruction.trim(),
      accentColor,
      bgColor: calculatedBg,
      borderColor: calculatedBorder,
      avatar,
      initialGreeting: initialGreeting.trim() || "Hello! Connected and ready.",
      phoneNumber: phoneNumber.trim() || "+1 (555) VoIP-LINK",
      knowledgeBaseId: knowledgeBaseId || undefined,
      ambientSound,
      silenceTimeout,
      temperature
    };

    onSaveAgent(savedAgent);
  };

  return (
    <div className="bg-white/[0.02] backdrop-blur-2xl border border-white/5 rounded-3xl p-6 lg:p-8 shadow-2xl flex flex-col h-full overflow-y-auto custom-scrollbar max-w-4xl mx-auto">
      
      {/* Header Panel */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between pb-6 border-b border-white/10 mb-6 gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onCancel}
            className="p-2.5 rounded-xl border border-white/10 bg-white/[0.01] hover:bg-white/10 text-zinc-400 hover:text-white transition duration-200 cursor-pointer"
            title="Go Back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h2 className="text-lg font-mono uppercase tracking-[0.2em] text-zinc-200 flex items-center gap-2">
              <Wrench className="w-5 h-5 text-orange-400" />
              Configure Agent Profile
            </h2>
            <p className="text-xs text-zinc-500 font-serif italic mt-0.5">
              Customize real-time prompt parameters, voice acoustics, and interface visuals.
            </p>
          </div>
        </div>
      </div>

      {/* Main Configuration form */}
      <form onSubmit={handleSubmit} className="space-y-6 flex-1">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* LEFT PANEL: Basic Visual Specs */}
          <div className="space-y-6">
            
            {/* Name input */}
            <div>
              <label className="block text-xs font-mono uppercase tracking-widest text-zinc-400 mb-2">
                Agent Signature Name *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Mentor Jordan"
                className="w-full bg-[#110b07] border border-white/10 rounded-2xl p-3.5 text-sm text-white focus:outline-none focus:border-orange-500/50 transition duration-300 font-sans shadow-inner shadow-black/40"
              />
            </div>

            {/* Role input */}
            <div>
              <label className="block text-xs font-mono uppercase tracking-widest text-zinc-400 mb-2">
                Role / Sub-line *
              </label>
              <input
                type="text"
                required
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="e.g. AI Career Coach or Spanish Teacher"
                className="w-full bg-[#110b07] border border-white/10 rounded-2xl p-3.5 text-sm text-white focus:outline-none focus:border-orange-500/50 transition duration-300 font-sans shadow-inner shadow-black/40"
              />
            </div>

            {/* Phone Number simulated */}
            <div>
              <label className="block text-xs font-mono uppercase tracking-widest text-zinc-400 mb-2">
                Simulated Calling Route No.
              </label>
              <div className="relative">
                <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  type="text"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="+1 (555) 012-3456"
                  className="w-full bg-[#110b07] border border-white/10 rounded-2xl pl-10 pr-4 p-3.5 text-sm font-mono text-zinc-100 focus:outline-none focus:border-orange-500/50 transition duration-300"
                />
              </div>
            </div>

            {/* Accent Theme Select */}
            <div>
              <label className="block text-xs font-mono uppercase tracking-widest text-zinc-400 mb-3">
                Card Interface Highlight Palette
              </label>
              <div className="flex items-center gap-3 bg-[#110b07] p-3 rounded-2xl border border-white/5">
                {ACCENT_COLORS.map((color) => {
                  const isSelected = accentColor === color.id;
                  return (
                    <button
                      key={color.id}
                      type="button"
                      onClick={() => setAccentColor(color.id)}
                      className={`w-9 h-9 rounded-xl flex items-center justify-center cursor-pointer transition-all duration-300 ${color.class} ${
                        isSelected 
                          ? "ring-2 ring-white scale-110 shadow-lg shadow-black/50" 
                          : "opacity-45 hover:opacity-85"
                      }`}
                      title={color.label}
                    >
                      {isSelected && (
                        <span className="text-[10px] text-white">●</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Avatar Preset Grid */}
            <div>
              <label className="block text-xs font-mono uppercase tracking-widest text-zinc-400 mb-3">
                Agent Interface Avatar
              </label>
              <div className="bg-[#110b07] p-4 rounded-2xl border border-white/5 max-h-[160px] overflow-y-auto custom-scrollbar">
                <div className="grid grid-cols-6 gap-2">
                  {AVATAR_PRESETS.map((av) => {
                    const isSelected = avatar === av;
                    return (
                      <button
                        key={av}
                        type="button"
                        onClick={() => setAvatar(av)}
                        className={`h-11 rounded-xl text-xl flex items-center justify-center transition-all cursor-pointer ${
                          isSelected 
                            ? "bg-white/15 border border-white/20 scale-105" 
                            : "bg-white/[0.01] hover:bg-white/5 border border-transparent"
                        }`}
                      >
                        {av}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

          </div>

          {/* RIGHT PANEL: Voice & Instructions Setups */}
          <div className="space-y-6">
            
            {/* Voice select */}
            <div>
              <label className="block text-xs font-mono uppercase tracking-widest text-zinc-400 mb-2">
                Realtime Synthesizer Acoustics *
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[220px] overflow-y-auto custom-scrollbar border border-white/5 bg-[#110b07] p-3 rounded-2xl">
                {VOICE_PRESETS.map((v) => {
                  const isSelected = voice === v.id;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setVoice(v.id as any)}
                      className={`p-3 rounded-xl border text-left transition duration-200 cursor-pointer flex flex-col justify-between h-20 ${
                        isSelected
                          ? "bg-white/10 border-orange-500/50"
                          : "bg-white/[0.01] border-white/5 hover:bg-white/[0.03]"
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="text-xs font-bold font-mono text-zinc-200 truncate">{v.id}</span>
                        <span className="text-[9px] font-mono uppercase bg-white/5 px-1.5 py-0.5 rounded text-zinc-500">
                          {v.gender}
                        </span>
                      </div>
                      <p className="text-[10px] text-zinc-500 leading-tight line-clamp-2 mt-1">
                        {v.desc}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Description (Card Bio) */}
            <div>
              <label className="block text-xs font-mono uppercase tracking-widest text-zinc-400 mb-2">
                Brief Directory Card Biography
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="A gentle prompt trainer who coaches healthy mental clarity."
                rows={2}
                className="w-full bg-[#110b07] border border-white/10 rounded-2xl p-3.5 text-sm text-white focus:outline-none focus:border-orange-500/50 transition duration-300 font-sans shadow-inner shadow-black/40 resize-none"
              />
            </div>

            {/* Initial Greeting */}
            <div>
              <label className="block text-xs font-mono uppercase tracking-widest text-zinc-400 mb-2">
                Opening Greeting Trigger Line
              </label>
              <input
                type="text"
                value={initialGreeting}
                onChange={(e) => setInitialGreeting(e.target.value)}
                placeholder="नमस्ते! मैं आपका डिजिटल सहायक हूँ।"
                className="w-full bg-[#110b07] border border-white/10 rounded-2xl p-3.5 text-sm text-white focus:outline-none focus:border-orange-500/50 transition duration-300 font-sans"
              />
              <p className="text-[9px] font-mono text-zinc-500 uppercase mt-1">Used to hint the caller how to start conversation immediately</p>
            </div>

            {/* Knowledge Base Link */}
            <div>
              <label className="block text-xs font-mono uppercase tracking-widest text-zinc-400 mb-2">
                Link Knowledge Base
              </label>
              <select
                value={knowledgeBaseId}
                onChange={(e) => setKnowledgeBaseId(e.target.value)}
                className="w-full bg-[#110b07] border border-white/10 rounded-2xl p-3.5 text-sm text-zinc-300 focus:outline-none focus:border-orange-500/50 transition"
              >
                <option value="">None (No custom documents linked)</option>
                {knowledgeBases.map((kb) => (
                  <option key={kb.id} value={kb.id}>
                    {kb.name} ({kb.documents.length} docs)
                  </option>
                ))}
              </select>
            </div>

            {/* Ambient Sound Dropdown */}
            <div>
              <label className="block text-xs font-mono uppercase tracking-widest text-zinc-400 mb-2">
                Ambient Background Noise
              </label>
              <select
                value={ambientSound}
                onChange={(e) => setAmbientSound(e.target.value as any)}
                className="w-full bg-[#110b07] border border-white/10 rounded-2xl p-3.5 text-sm text-zinc-300 focus:outline-none focus:border-orange-500/50 transition"
              >
                <option value="none">None (Dead Silence)</option>
                <option value="office">Office AC Hum</option>
                <option value="cafe">Cafe Crowd Murmur & Clinks</option>
                <option value="airport">Airport Terminal Wash & Chimes</option>
              </select>
            </div>

            {/* Temperature Slider */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-mono uppercase tracking-widest text-zinc-400">
                  Model Temperature: <span className="text-orange-400 font-bold">{temperature.toFixed(2)}</span>
                </label>
                <span className="text-[10px] text-zinc-500">
                  {temperature <= 0.3 ? "Deterministic/Factual" : temperature <= 0.7 ? "Balanced" : "Creative/Playful"}
                </span>
              </div>
              <input
                type="range"
                min="0.0"
                max="1.5"
                step="0.05"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="w-full accent-orange-500 bg-white/15 h-1.5 rounded-lg cursor-pointer"
              />
            </div>

            {/* Silence Timeout Slider */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-mono uppercase tracking-widest text-zinc-400">
                  Silence Timeout: <span className="text-orange-400 font-bold">{silenceTimeout}s</span>
                </label>
              </div>
              <input
                type="range"
                min="5"
                max="120"
                step="5"
                value={silenceTimeout}
                onChange={(e) => setSilenceTimeout(parseInt(e.target.value))}
                className="w-full accent-orange-500 bg-white/15 h-1.5 rounded-lg cursor-pointer"
              />
            </div>

          </div>

        </div>

        {/* System Instructions Prompt Box (Spans full width) */}
        <div className="mt-8 border-t border-white/5 pt-6">
          <label className="block text-xs font-mono uppercase tracking-widest text-zinc-400 mb-2">
            System Backstory / Prompt Instructions (Core Brain) *
          </label>
          <textarea
            required
            value={systemInstruction}
            onChange={(e) => setSystemInstruction(e.target.value)}
            placeholder="Write the core instructions for the model behavior. Example: You are a bilingual teacher..."
            rows={5}
            className="w-full bg-[#110b07] border border-white/10 rounded-2xl p-4 text-xs font-mono leading-relaxed text-zinc-200 focus:outline-none focus:border-orange-500/50 transition duration-300 shadow-inner shadow-black/50"
          />
          <p className="text-[10px] text-zinc-500 font-serif italic mt-1.5">
            This represents the core system prompt payload. This exact text defines the agent's tone, constraints, and operational mission when establishing the VoIP stream.
          </p>
        </div>

        {/* Controls block */}
        <div className="flex items-center justify-end gap-4 border-t border-white/10 pt-6">
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-2 px-6 py-3 rounded-2xl border border-white/15 hover:bg-white/5 text-zinc-400 hover:text-white transition duration-200 cursor-pointer font-mono text-xs uppercase tracking-widest"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Form
          </button>
          <button
            type="submit"
            className="flex items-center gap-2 px-8 py-3.5 rounded-2xl bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-400 hover:to-amber-500 text-white font-semibold transition duration-200 shadow-lg shadow-orange-500/10 active:scale-95 cursor-pointer font-mono text-xs uppercase tracking-widest"
          >
            <Save className="w-4 h-4" />
            Save Agent
          </button>
        </div>

      </form>

    </div>
  );
};
