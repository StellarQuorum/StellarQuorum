'use client';

import { useState } from "react";
import { Plus } from "lucide-react";

const CATEGORIES = ["Financial", "Technical", "Treasury", "Governance", "Security"];
const DURATIONS = ["3 days", "7 days", "14 days"];

interface FormState {
  title: string;
  category: string;
  description: string;
  duration: string;
  contractAddress: string;
  functionName: string;
  actionDescription: string;
}

export default function CreatePage() {
  const [form, setForm] = useState<FormState>({
    title: "",
    category: "Governance",
    description: "",
    duration: "7 days",
    contractAddress: "",
    functionName: "",
    actionDescription: "",
  });
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
  }

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const inputClass = "w-full bg-[#0a0f18] border border-[#1a2535] rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-600 transition-colors";

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <h1 className="text-3xl font-bold text-white mb-2">Create Proposal</h1>
      <p className="text-slate-400 mb-8">Submit a new governance proposal to the Quorum community.</p>

      {submitted ? (
        <div className="p-8 rounded-xl bg-[#0d1520] border border-emerald-800/50 text-center">
          <div className="text-4xl mb-3">✓</div>
          <h2 className="text-xl font-bold text-emerald-400 mb-2">Proposal Submitted</h2>
          <p className="text-slate-400 mb-4">
            Your proposal <strong className="text-white">&ldquo;{form.title}&rdquo;</strong> has been submitted to the Stellar testnet in simulation mode.
          </p>
          <p className="text-sm text-slate-500">Connect a Freighter wallet for live mainnet submissions.</p>
          <button onClick={() => setSubmitted(false)} className="mt-6 px-6 py-2 bg-blue-700 hover:bg-blue-600 text-white rounded-lg text-sm font-medium transition-colors">
            Create Another
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <div className="p-5 rounded-xl bg-[#0d1520] border border-[#1a2535] flex flex-col gap-5">
            <h2 className="font-semibold text-white">Proposal Details</h2>

            <div>
              <label className="text-sm text-slate-400 mb-1.5 block">Title *</label>
              <input required value={form.title} onChange={set("title")} placeholder="e.g. Increase Protocol Fee to 0.05%" className={inputClass} />
            </div>

            <div>
              <label className="text-sm text-slate-400 mb-1.5 block">Category *</label>
              <select value={form.category} onChange={set("category")} className={inputClass}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div>
              <label className="text-sm text-slate-400 mb-1.5 block">Description *</label>
              <textarea required value={form.description} onChange={set("description")} rows={6} placeholder="Describe your proposal in detail. Include motivation, implementation plan, and expected outcomes." className={`${inputClass} resize-none leading-relaxed`} />
            </div>

            <div>
              <label className="text-sm text-slate-400 mb-1.5 block">Voting Duration</label>
              <select value={form.duration} onChange={set("duration")} className={inputClass}>
                {DURATIONS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>

          <div className="p-5 rounded-xl bg-[#0d1520] border border-[#1a2535] flex flex-col gap-5">
            <div className="flex items-center gap-2">
              <Plus size={16} className="text-blue-400" />
              <h2 className="font-semibold text-white">On-chain Action</h2>
              <span className="text-xs text-slate-500">(optional)</span>
            </div>

            <div>
              <label className="text-sm text-slate-400 mb-1.5 block">Action Description</label>
              <input value={form.actionDescription} onChange={set("actionDescription")} placeholder="e.g. Update fee parameter in FeeController contract" className={inputClass} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-slate-400 mb-1.5 block">Contract Address</label>
                <input value={form.contractAddress} onChange={set("contractAddress")} placeholder="CC..." className={`${inputClass} font-mono text-xs`} />
              </div>
              <div>
                <label className="text-sm text-slate-400 mb-1.5 block">Function Name</label>
                <input value={form.functionName} onChange={set("functionName")} placeholder="set_param" className={`${inputClass} font-mono text-xs`} />
              </div>
            </div>
          </div>

          {/* Preview */}
          {form.title && (
            <div className="p-5 rounded-xl bg-[#080c10] border border-[#162032]">
              <h3 className="text-sm font-semibold text-slate-400 mb-3 uppercase tracking-wider">Preview</h3>
              <div className="text-lg font-bold text-white mb-1">{form.title}</div>
              <div className="text-xs text-slate-500 mb-3">{form.category} &middot; {form.duration} voting window</div>
              {form.description && <p className="text-sm text-slate-300 leading-relaxed line-clamp-3">{form.description}</p>}
            </div>
          )}

          <div className="flex flex-col gap-3">
            <button type="submit" className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-semibold transition-colors">
              Submit Proposal
            </button>
            <p className="text-xs text-slate-500 text-center">Submitting requires a Freighter wallet and QUORUM tokens. Live mainnet submission coming soon.</p>
          </div>
        </form>
      )}
    </div>
  );
}
