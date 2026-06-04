import React, { useState, useEffect } from "react";
import { KnowledgeBase, KnowledgeDocument } from "../types";
import { 
  Database, BookOpen, Plus, Trash2, Save, FileText, ArrowLeft, 
  Sparkles, AlertCircle, Edit, CheckCircle, Info, FolderOpen
} from "lucide-react";

interface KnowledgeBaseManagerProps {
  onBack: () => void;
}

export const KnowledgeBaseManager: React.FC<KnowledgeBaseManagerProps> = ({ onBack }) => {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [selectedKb, setSelectedKb] = useState<KnowledgeBase | null>(null);
  
  // Form states for creating/editing a Knowledge Base
  const [isCreatingKb, setIsCreatingKb] = useState(false);
  const [kbName, setKbName] = useState("");
  const [kbDescription, setKbDescription] = useState("");
  
  // Document editor states
  const [activeDoc, setActiveDoc] = useState<KnowledgeDocument | null>(null);
  const [docTitle, setDocTitle] = useState("");
  const [docContent, setDocContent] = useState("");
  
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Fetch all Knowledge Bases
  const fetchKBs = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/knowledge-bases");
      const json = await res.json();
      if (json.success && json.data) {
        setKnowledgeBases(json.data);
      }
    } catch (err) {
      console.error("Error fetching knowledge bases:", err);
      showStatus("error", "Failed to retrieve knowledge bases from server.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchKBs();
  }, []);

  const showStatus = (type: "success" | "error", text: string) => {
    setStatusMessage({ type, text });
    setTimeout(() => setStatusMessage(null), 4000);
  };

  // Create a new Knowledge Base card
  const handleCreateKb = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!kbName.trim()) {
      alert("Knowledge Base name is required!");
      return;
    }

    const newKb: KnowledgeBase = {
      id: `kb_${Date.now()}`,
      name: kbName.trim(),
      description: kbDescription.trim() || "No description provided.",
      documents: []
    };

    setIsLoading(true);
    try {
      const res = await fetch("/api/knowledge-bases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newKb)
      });
      const json = await res.json();
      if (json.success) {
        setKnowledgeBases((prev) => [...prev, newKb]);
        setKbName("");
        setKbDescription("");
        setIsCreatingKb(false);
        showStatus("success", `Knowledge Base "${newKb.name}" created successfully!`);
      } else {
        showStatus("error", json.message || "Failed to create knowledge base.");
      }
    } catch (err) {
      console.error("Error creating KB:", err);
      showStatus("error", "Server communication failed.");
    } finally {
      setIsLoading(false);
    }
  };

  // Delete a Knowledge Base card
  const handleDeleteKb = async (id: string, name: string) => {
    if (!confirm(`Are you absolutely sure you want to delete "${name}"? All associated documents will be permanently lost.`)) {
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(`/api/knowledge-bases/${id}`, {
        method: "DELETE"
      });
      const json = await res.json();
      if (json.success) {
        setKnowledgeBases((prev) => prev.filter((kb) => kb.id !== id));
        if (selectedKb?.id === id) {
          setSelectedKb(null);
          setActiveDoc(null);
        }
        showStatus("success", `Knowledge Base "${name}" deleted.`);
      } else {
        showStatus("error", "Failed to delete knowledge base from server.");
      }
    } catch (err) {
      console.error("Error deleting KB:", err);
      showStatus("error", "Server communication failed.");
    } finally {
      setIsLoading(false);
    }
  };

  // Save changes to current KB (such as when documents are added/edited/deleted)
  const saveKbChanges = async (updatedKb: KnowledgeBase) => {
    try {
      const res = await fetch("/api/knowledge-bases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedKb)
      });
      const json = await res.json();
      if (json.success) {
        setKnowledgeBases((prev) => prev.map((k) => k.id === updatedKb.id ? updatedKb : k));
        setSelectedKb(updatedKb);
        return true;
      } else {
        showStatus("error", json.message || "Failed to save document updates.");
        return false;
      }
    } catch (err) {
      console.error("Error saving KB updates:", err);
      showStatus("error", "Failed to save updates to the database.");
      return false;
    }
  };

  // Select a Knowledge Base to explore
  const handleSelectKb = (kb: KnowledgeBase) => {
    setSelectedKb(kb);
    setActiveDoc(null);
    setDocTitle("");
    setDocContent("");
  };

  // Prepare to create a new document in selected KB
  const handleNewDoc = () => {
    setActiveDoc({
      id: `doc_${Date.now()}`,
      title: "",
      content: ""
    });
    setDocTitle("");
    setDocContent("");
  };

  // Select an existing document to edit
  const handleSelectDoc = (doc: KnowledgeDocument) => {
    setActiveDoc(doc);
    setDocTitle(doc.title);
    setDocContent(doc.content);
  };

  // Save the currently active document
  const handleSaveDoc = async () => {
    if (!selectedKb || !activeDoc) return;
    if (!docTitle.trim() || !docContent.trim()) {
      alert("Document Title and Content are both required!");
      return;
    }

    const updatedDoc: KnowledgeDocument = {
      ...activeDoc,
      title: docTitle.trim(),
      content: docContent.trim()
    };

    const isNew = !selectedKb.documents.some((d) => d.id === activeDoc.id);
    let updatedDocs: KnowledgeDocument[];

    if (isNew) {
      updatedDocs = [...selectedKb.documents, updatedDoc];
    } else {
      updatedDocs = selectedKb.documents.map((d) => d.id === activeDoc.id ? updatedDoc : d);
    }

    const updatedKb: KnowledgeBase = {
      ...selectedKb,
      documents: updatedDocs
    };

    setIsLoading(true);
    const success = await saveKbChanges(updatedKb);
    if (success) {
      setActiveDoc(updatedDoc);
      showStatus("success", `Document "${updatedDoc.title}" saved successfully.`);
    }
    setIsLoading(false);
  };

  // Delete a document from the current KB
  const handleDeleteDoc = async (docId: string, title: string) => {
    if (!selectedKb) return;
    if (!confirm(`Are you sure you want to delete the document "${title}"?`)) {
      return;
    }

    const updatedDocs = selectedKb.documents.filter((d) => d.id !== docId);
    const updatedKb: KnowledgeBase = {
      ...selectedKb,
      documents: updatedDocs
    };

    setIsLoading(true);
    const success = await saveKbChanges(updatedKb);
    if (success) {
      if (activeDoc?.id === docId) {
        setActiveDoc(null);
        setDocTitle("");
        setDocContent("");
      }
      showStatus("success", `Document "${title}" removed.`);
    }
    setIsLoading(false);
  };

  return (
    <div className="bg-white/[0.02] backdrop-blur-2xl border border-white/5 rounded-3xl p-6 lg:p-8 shadow-2xl flex flex-col h-[700px] overflow-hidden max-w-5xl mx-auto text-zinc-100">
      
      {/* Top Banner Row */}
      <div className="flex items-center justify-between pb-4 border-b border-white/15 mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={selectedKb ? () => setSelectedKb(null) : onBack}
            className="p-2.5 rounded-xl border border-white/10 bg-white/[0.01] hover:bg-white/10 text-zinc-400 hover:text-white transition duration-200 cursor-pointer"
            title="Go Back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h2 className="text-base sm:text-lg font-mono uppercase tracking-[0.2em] text-zinc-200 flex items-center gap-2">
              <Database className="w-5 h-5 text-orange-400 animate-pulse" />
              {selectedKb ? `KB: ${selectedKb.name}` : "Knowledge Base Studio"}
            </h2>
            <p className="text-xs text-zinc-500 font-serif italic mt-0.5">
              {selectedKb 
                ? selectedKb.description 
                : "Manage documents and factual support guides linked directly to your custom voice agents."}
            </p>
          </div>
        </div>

        {/* Global Loading Spinner / Status Toast */}
        <div className="flex items-center gap-3">
          {isLoading && (
            <div className="flex items-center gap-1.5 px-3 py-1 bg-white/5 rounded-lg border border-white/5">
              <span className="w-2.5 h-2.5 rounded-full border-2 border-orange-500 border-t-transparent animate-spin"></span>
              <span className="text-[9px] font-mono text-zinc-400 uppercase tracking-wider">Syncing...</span>
            </div>
          )}
          {statusMessage && (
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[10px] font-mono uppercase tracking-wider ${
              statusMessage.type === "success" 
                ? "bg-green-500/10 border-green-500/20 text-green-400" 
                : "bg-red-500/10 border-red-500/20 text-red-400"
            }`}>
              {statusMessage.type === "success" ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
              <span>{statusMessage.text}</span>
            </div>
          )}
        </div>
      </div>

      {/* DASHBOARD VIEW: LIST ALL KNOWLEDGE BASES */}
      {!selectedKb && (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Create New KB Accordion / Mini Form */}
          {isCreatingKb ? (
            <form onSubmit={handleCreateKb} className="bg-white/[0.03] border border-white/10 rounded-2xl p-5 mb-6 space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-white/5">
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-orange-400">Initialize New Knowledge Base</span>
                <button
                  type="button"
                  onClick={() => setIsCreatingKb(false)}
                  className="text-xs font-mono text-zinc-500 hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-widest text-zinc-450 mb-1.5">KB Reference Name *</label>
                  <input
                    type="text"
                    required
                    value={kbName}
                    onChange={(e) => setKbName(e.target.value)}
                    placeholder="e.g. Refund Policy FAQ"
                    className="w-full bg-[#110b07] border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-orange-500/50"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-widest text-zinc-450 mb-1.5">Description</label>
                  <input
                    type="text"
                    value={kbDescription}
                    onChange={(e) => setKbDescription(e.target.value)}
                    placeholder="Reference material for products, rules, or guidelines."
                    className="w-full bg-[#110b07] border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-orange-500/50"
                  />
                </div>
              </div>
              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={isLoading}
                  className="px-5 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-400 text-white text-xs font-mono uppercase tracking-wider font-semibold shadow-lg shadow-orange-500/10 flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Create Base
                </button>
              </div>
            </form>
          ) : (
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Available Knowledge Repositories</span>
              <button
                onClick={() => setIsCreatingKb(true)}
                className="px-4 py-2 border border-orange-500/20 text-orange-400 bg-orange-500/5 hover:bg-orange-500/10 hover:text-orange-350 rounded-xl text-xs font-mono uppercase tracking-wider flex items-center gap-1.5 cursor-pointer transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Knowledge Base
              </button>
            </div>
          )}

          {/* List KBs Grid */}
          <div className="flex-1 overflow-y-auto custom-scrollbar pr-1.5">
            {knowledgeBases.length === 0 ? (
              <div className="h-44 border border-dashed border-white/10 rounded-2xl flex flex-col items-center justify-center text-zinc-500 text-center p-6 space-y-2">
                <FolderOpen className="w-8 h-8 text-zinc-650" />
                <p className="text-xs font-mono uppercase tracking-wider">No Knowledge Bases Found</p>
                <p className="text-[11px] text-zinc-600 font-serif italic max-w-sm">
                  "Initialize your first knowledge base to upload documents. Then link it to custom agents to inject custom facts."
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {knowledgeBases.map((kb) => (
                  <div
                    key={kb.id}
                    className="group bg-white/[0.01] hover:bg-white/[0.03] border border-white/5 hover:border-white/10 p-5 rounded-2xl flex flex-col justify-between h-40 transition duration-300 shadow-md"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <div className="w-8 h-8 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-orange-400">
                          <BookOpen className="w-4 h-4" />
                        </div>
                        <span className="text-[9px] font-mono uppercase tracking-widest text-zinc-500">
                          {kb.documents.length} {kb.documents.length === 1 ? "document" : "documents"}
                        </span>
                      </div>
                      <h3 className="text-sm font-semibold text-white group-hover:text-orange-400 transition-colors mt-3">
                        {kb.name}
                      </h3>
                      <p className="text-[11px] text-zinc-400 line-clamp-2 mt-1 leading-normal font-sans">
                        {kb.description}
                      </p>
                    </div>

                    <div className="border-t border-white/5 pt-3 flex items-center justify-between mt-auto">
                      <button
                        onClick={() => handleSelectKb(kb)}
                        className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[10px] font-mono uppercase tracking-widest text-zinc-300 hover:text-white cursor-pointer transition flex items-center gap-1.5"
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                        Open Repo
                      </button>
                      <button
                        onClick={() => handleDeleteKb(kb.id, kb.name)}
                        className="p-1.5 rounded-lg hover:bg-red-500/10 text-zinc-500 hover:text-red-400 cursor-pointer transition"
                        title="Delete Knowledge Base"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* DETAILED VIEW: MANAGE DOCUMENTS INSIDE SELECTED KB */}
      {selectedKb && (
        <div className="flex-1 flex gap-6 min-h-0">
          {/* Left panel: Documents list */}
          <div className="w-2/5 border-r border-white/5 pr-4 flex flex-col h-full min-h-0">
            <div className="flex items-center justify-between mb-3 shrink-0">
              <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 flex items-center gap-1">
                <FileText className="w-3.5 h-3.5 text-orange-400" />
                Doc Directory ({selectedKb.documents.length})
              </span>
              <button
                onClick={handleNewDoc}
                className="px-3 py-1 border border-orange-500/20 text-orange-400 bg-orange-500/5 hover:bg-orange-500/10 rounded-lg text-[10px] font-mono uppercase tracking-wider flex items-center gap-1 cursor-pointer transition-all"
              >
                <Plus className="w-3 h-3" />
                Add Doc
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 space-y-2">
              {selectedKb.documents.length === 0 ? (
                <div className="h-32 border border-dashed border-white/5 rounded-xl flex flex-col items-center justify-center text-zinc-650 text-center p-4">
                  <AlertCircle className="w-6 h-6 mb-1" />
                  <p className="text-[10px] font-mono uppercase tracking-wider">Base is Empty</p>
                  <p className="text-[9px] font-serif italic mt-0.5">Click "Add Doc" to populate reference files.</p>
                </div>
              ) : (
                selectedKb.documents.map((doc) => {
                  const isEditingThis = activeDoc?.id === doc.id;
                  return (
                    <div
                      key={doc.id}
                      onClick={() => handleSelectDoc(doc)}
                      className={`group p-3.5 rounded-xl border text-left cursor-pointer transition-all ${
                        isEditingThis 
                          ? "bg-white/10 border-orange-500/40" 
                          : "bg-white/[0.01] border-white/5 hover:bg-white/[0.02]"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className={`text-[11px] font-semibold truncate ${isEditingThis ? "text-orange-400" : "text-zinc-250 group-hover:text-white"}`}>
                          {doc.title}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteDoc(doc.id, doc.title);
                          }}
                          className="p-1 rounded opacity-30 hover:opacity-100 text-zinc-400 hover:text-red-400 cursor-pointer transition shrink-0"
                          title="Delete Document"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <p className="text-[10px] text-zinc-550 line-clamp-2 mt-1 leading-normal font-sans">
                        {doc.content}
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right panel: Active document editor */}
          <div className="flex-1 flex flex-col h-full min-h-0 bg-white/[0.01] border border-white/5 p-5 rounded-2xl shadow-inner">
            {activeDoc ? (
              <div className="flex-1 flex flex-col min-h-0 space-y-4">
                <div className="flex items-center justify-between shrink-0 pb-2 border-b border-white/5">
                  <div className="flex items-center gap-1.5 text-xs font-mono text-zinc-300 font-bold uppercase">
                    <Edit className="w-4 h-4 text-orange-400" />
                    <span>Document Editor</span>
                  </div>
                  <button
                    onClick={handleSaveDoc}
                    disabled={isLoading}
                    className="px-4 py-2 bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-400 hover:to-amber-500 text-white rounded-xl text-xs font-mono uppercase tracking-wider font-semibold active:scale-95 transition flex items-center gap-1.5 shadow-lg shadow-orange-500/5 cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" />
                    Save Doc
                  </button>
                </div>

                <div className="shrink-0">
                  <label className="block text-[10px] font-mono uppercase tracking-widest text-zinc-450 mb-1.5">Document Title *</label>
                  <input
                    type="text"
                    required
                    value={docTitle}
                    onChange={(e) => setDocTitle(e.target.value)}
                    placeholder="e.g. Standard Return Window FAQ"
                    className="w-full bg-[#110b07] border border-white/10 rounded-xl p-3.5 text-xs text-white focus:outline-none focus:border-orange-500/50"
                  />
                </div>

                <div className="flex-1 flex flex-col min-h-0">
                  <label className="block text-[10px] font-mono uppercase tracking-widest text-zinc-450 mb-1.5 shrink-0">Document Content *</label>
                  <textarea
                    required
                    value={docContent}
                    onChange={(e) => setDocContent(e.target.value)}
                    placeholder="Paste reference text here. Keep it descriptive (up to 20,000 characters). This material will guide the voice agent's dialogue directly..."
                    className="flex-1 w-full bg-[#110b07] border border-white/10 rounded-xl p-4 text-xs font-sans leading-relaxed text-zinc-205 focus:outline-none focus:border-orange-500/50 resize-none overflow-y-auto custom-scrollbar"
                  />
                </div>

                <div className="shrink-0 flex items-center gap-1.5 bg-orange-500/5 border border-orange-500/10 p-3 rounded-xl text-[10px] text-zinc-400 leading-normal font-sans">
                  <Info className="w-4 h-4 text-orange-400 shrink-0" />
                  <span>
                    💡 <strong>Pro Tip:</strong> Link this Knowledge Base in your custom agent settings to sync this reference data into their setup configuration payload!
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex-grow flex flex-col items-center justify-center text-zinc-500 p-6 text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400">
                  <FileText className="w-6 h-6 text-orange-400/50" />
                </div>
                <h3 className="text-xs font-mono uppercase tracking-wider">No Active Document selected</h3>
                <p className="text-[11px] text-zinc-500 font-serif italic max-w-sm">
                  "Select an existing document from the left directory to modify its contents, or click 'Add Doc' to build a new reference card."
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
