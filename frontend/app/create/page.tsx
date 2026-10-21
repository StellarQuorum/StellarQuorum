'use client';

import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { t } from "@/lib/i18n";
import { useLocalStorage } from "@/lib/useLocalStorage";
import MarkdownPreview from "@/components/MarkdownPreview";
import { isValidStellarAddress } from "@/lib/validators";

const CATEGORIES = ["financial", "technical", "treasury", "governance", "security", "community", "protocol"].map(key => t("create.categories." + key));
const DURATIONS = ["three", "five", "seven", "fourteen", "thirty"].map(key => t("create.durations." + key));
const QUORUM = t("create.quorumValue");
type Step = "edit" | "review" | "submitted";
interface FormState { title: string; category: string; description: string; duration: string; contractAddress: string; functionName: string; actionDescription: string }

const EMPTY_FORM: FormState = { title: "", category: t("create.categories.governance"), description: "", duration: t("create.durations.seven"), contractAddress: "", functionName: "", actionDescription: "" };
const DRAFT_KEY = "proposal-draft";

export default function CreatePage() {
  const { value: savedDraft, setValue: saveDraft, removeValue: clearDraft, isLoaded } = useLocalStorage<FormState>(DRAFT_KEY, EMPTY_FORM);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [step, setStep] = useState<Step>("edit");
  const [showDraftRestore, setShowDraftRestore] = useState(false);
  const [previewTab, setPreviewTab] = useState<"edit" | "preview">("edit");
  const [contractAddressError, setContractAddressError] = useState<string | null>(null);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    if (savedDraft.title || savedDraft.description) {
      setShowDraftRestore(true);
      setForm(savedDraft);
    } else {
      setForm(EMPTY_FORM);
    }
  }, [isLoaded, savedDraft]);

  const set = (key: keyof FormState) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const newForm = { ...form, [key]: event.target.value };
    setForm(newForm);
    if (key === "contractAddress") setContractAddressError(null);

    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }
    debounceTimeoutRef.current = setTimeout(() => {
      saveDraft(newForm);
    }, 1000);
  };

  const handleRestoreDraft = () => {
    setShowDraftRestore(false);
  };

  const handleDiscardDraft = () => {
    clearDraft();
    setForm(EMPTY_FORM);
    setShowDraftRestore(false);
  };

  const validateContractAddress = () => {
    const address = form.contractAddress.trim();
    const valid = !address || isValidStellarAddress(address);
    setContractAddressError(valid ? null : "Invalid Stellar contract address");
    return valid;
  };

  const handleSubmit = () => {
    clearDraft();
    setStep("submitted");
  };

  const inputClass = "w-full bg-[#0a0f18] border border-[#1a2535] rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-600 transition-colors";
  const hasAction = form.actionDescription || form.contractAddress || form.functionName;

  if (!isLoaded) {
    return <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12" />;
  }

  return <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
    <h1 className="text-3xl font-bold text-white mb-2">{t("create.title")}</h1>
    <p className="text-slate-400 mb-8">{t("create.intro")}</p>

    {showDraftRestore && (
      <div className="mb-6 p-4 rounded-lg bg-blue-900/20 border border-blue-800 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-blue-300 font-medium">{t("create.draftFound")}</p>
          <p className="text-xs text-blue-200">{t("create.restoreDraft")}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleRestoreDraft} className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded text-sm font-medium">{t("create.restore")}</button>
          <button onClick={handleDiscardDraft} className="px-3 py-1.5 border border-blue-700 text-blue-300 hover:bg-blue-900/20 rounded text-sm font-medium">{t("create.discard")}</button>
        </div>
      </div>
    )}

    {step === "submitted" ? <div className="p-8 rounded-xl bg-[#0d1520] border border-emerald-800/50 text-center">
      <div className="text-4xl mb-3">✓</div><h2 className="text-xl font-bold text-emerald-400 mb-2">{t("create.submitted")}</h2>
      <p className="text-slate-400 mb-4">{t("create.submittedMessage", { title: form.title })}</p>
      <p className="text-sm text-slate-500">{t("create.simulation")}</p>
      <button onClick={() => { setStep("edit"); setForm(EMPTY_FORM); }} className="mt-6 px-6 py-2 bg-blue-700 hover:bg-blue-600 text-white rounded-lg text-sm font-medium">{t("create.another")}</button>
    </div> : step === "review" ? <section aria-labelledby="review-heading" className="flex flex-col gap-6">
      <div><h2 id="review-heading" className="text-2xl font-bold text-white mb-2">{t("create.review")}</h2><p className="text-slate-400">{t("create.reviewHelp")}</p></div>
      <div className="p-5 rounded-xl bg-[#0d1520] border border-[#1a2535]">
        <div className="flex items-center gap-2 mb-4"><span className="text-xs px-2 py-0.5 rounded-full bg-[#162032] text-slate-400 border border-[#1e2d40]">{form.category}</span><span className="text-xs text-slate-500">{t("create.ready")}</span></div>
        <h1 className="text-3xl font-bold text-white mb-4">{form.title}</h1><h3 className="font-semibold text-white mb-3">{t("common.description")}</h3>
        <MarkdownPreview content={form.description} />
      </div>
      {hasAction && <div className="p-5 rounded-xl bg-[#0d1520] border border-[#1a2535]"><h3 className="font-semibold text-white mb-3">{t("create.action")}</h3>{form.actionDescription && <p className="text-sm text-slate-300 mb-2">{form.actionDescription}</p>}<div className="font-mono text-xs text-slate-500 break-all">{form.contractAddress || t("create.noContract")} → {form.functionName || t("create.noFunction")}()</div></div>}
      <dl className="grid sm:grid-cols-2 gap-4 p-5 rounded-xl bg-[#0d1520] border border-blue-800/40">
        <div><dt className="text-xs uppercase tracking-wider text-slate-500 mb-1">{t("create.votingWindow")}</dt><dd className="font-semibold text-white">{form.duration}</dd></div>
        <div><dt className="text-xs uppercase tracking-wider text-slate-500 mb-1">{t("create.quorumRequired")}</dt><dd className="font-semibold text-white">{QUORUM}</dd></div>
      </dl>
      <div className="flex flex-col-reverse sm:flex-row gap-3"><button type="button" onClick={() => setStep("edit")} className="flex-1 py-3 border border-[#1a2535] text-slate-300 rounded-lg font-semibold">{t("create.edit")}</button><button type="button" onClick={handleSubmit} className="flex-1 py-3 bg-blue-600 text-white rounded-lg font-semibold">{t("create.sign")}</button></div>
      <p className="text-xs text-slate-500 text-center">{t("create.fee")}</p>
    </section> : <form onSubmit={event => { event.preventDefault(); if (validateContractAddress()) setStep("review"); }} className="flex flex-col gap-6">
      <div className="p-5 rounded-xl bg-[#0d1520] border border-[#1a2535] flex flex-col gap-5">
        <h2 className="font-semibold text-white">{t("create.details")}</h2>
        <div><label htmlFor="proposal-title" className="text-sm text-slate-400 mb-1.5 block">{t("create.titleLabel")}</label><input id="proposal-title" required value={form.title} onChange={set("title")} placeholder={t("create.titlePlaceholder")} className={inputClass} /></div>
        <div><label htmlFor="proposal-category" className="text-sm text-slate-400 mb-1.5 block">{t("create.category")}</label><select id="proposal-category" value={form.category} onChange={set("category")} className={inputClass}>{CATEGORIES.map(category => <option key={category}>{category}</option>)}</select></div>
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <label htmlFor="proposal-description" className="text-sm text-slate-400">{t("create.descriptionLabel")}</label>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={() => setPreviewTab("edit")}
                className={`text-xs px-2 py-1 rounded ${previewTab === "edit" ? "bg-blue-700 text-white" : "text-slate-500 hover:text-slate-300"}`}
              >
                {t("create.edit")}
              </button>
              <button
                type="button"
                onClick={() => setPreviewTab("preview")}
                className={`text-xs px-2 py-1 rounded ${previewTab === "preview" ? "bg-blue-700 text-white" : "text-slate-500 hover:text-slate-300"}`}
              >
                {t("create.preview")}
              </button>
            </div>
          </div>
          {previewTab === "edit" ? (
            <textarea id="proposal-description" required value={form.description} onChange={set("description")} rows={6} placeholder={t("create.descriptionPlaceholder")} className={`${inputClass} resize-none leading-relaxed`} />
          ) : (
            <div className={`${inputClass} min-h-[152px] p-3 bg-[#080c10] overflow-y-auto rounded`}>
              {form.description ? (
                <MarkdownPreview content={form.description} />
              ) : (
                <p className="text-slate-600">{t("create.noPreview")}</p>
              )}
            </div>
          )}
        </div>
        <div><label htmlFor="proposal-duration" className="text-sm text-slate-400 mb-1.5 block">{t("create.duration")}</label><select id="proposal-duration" value={form.duration} onChange={set("duration")} className={inputClass}>{DURATIONS.map(duration => <option key={duration}>{duration}</option>)}</select></div>
      </div>
      <div className="p-5 rounded-xl bg-[#0d1520] border border-[#1a2535] flex flex-col gap-5">
        <div className="flex items-center gap-2"><Plus size={16} className="text-blue-400" /><h2 className="font-semibold text-white">{t("create.action")}</h2><span className="text-xs text-slate-500">{t("common.optional")}</span></div>
        <div><label htmlFor="action-description" className="text-sm text-slate-400 mb-1.5 block">{t("create.actionDescription")}</label><input id="action-description" value={form.actionDescription} onChange={set("actionDescription")} placeholder={t("create.actionPlaceholder")} className={inputClass} /></div>
        <div className="grid grid-cols-2 gap-4"><div><label htmlFor="contract-address" className="text-sm text-slate-400 mb-1.5 block">{t("create.contract")}</label><input id="contract-address" value={form.contractAddress} onChange={set("contractAddress")} onBlur={validateContractAddress} placeholder="CC..." aria-invalid={!!contractAddressError} aria-describedby={contractAddressError ? "contract-address-error" : undefined} className={`${inputClass} font-mono text-xs ${contractAddressError ? "border-red-600 focus:border-red-500" : ""}`} />{contractAddressError && <p id="contract-address-error" role="alert" className="mt-1.5 text-xs text-red-400">{contractAddressError}</p>}</div><div><label htmlFor="function-name" className="text-sm text-slate-400 mb-1.5 block">{t("create.function")}</label><input id="function-name" value={form.functionName} onChange={set("functionName")} placeholder="set_param" className={`${inputClass} font-mono text-xs`} /></div></div>
      </div>
      <div className="flex flex-col gap-3"><button type="submit" className="w-full py-3 bg-blue-600 text-white rounded-lg font-semibold">{t("create.review")}</button><p className="text-xs text-slate-500 text-center">{t("create.reviewBefore")}</p></div>
    </form>}
  </div>;
}
