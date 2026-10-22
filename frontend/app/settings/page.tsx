'use client';

import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import { useLocalStorage } from "@/lib/useLocalStorage";
import { DEFAULT_SETTINGS, DENSITY_KEY, SETTINGS_KEY, isValidRpcUrl, type Settings } from "@/lib/settings";

type Density = "cards" | "compact";

const inputClass = "w-full bg-[#0a0f18] border border-[#1a2535] rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-600 transition-colors";
const fieldsetClass = "p-5 rounded-xl bg-[#0d1520] border border-[#1a2535] flex flex-col gap-4";

export default function SettingsPage() {
  const { value: stored, setValue: store, isLoaded } = useLocalStorage<Settings>(SETTINGS_KEY, DEFAULT_SETTINGS);
  const [rpcUrl, setRpcUrl] = useState(DEFAULT_SETTINGS.rpcUrl);
  const [notifyStatusChanges, setNotifyStatusChanges] = useState(DEFAULT_SETTINGS.notifyStatusChanges);
  const [density, setDensity] = useState<Density>("cards");
  const [rpcInvalid, setRpcInvalid] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (!isLoaded) return;
    setRpcUrl(stored.rpcUrl);
    setNotifyStatusChanges(stored.notifyStatusChanges);
  }, [isLoaded, stored]);

  // Density lives under the key ProposalList already reads, so the list picks up
  // a change without a second source of truth.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(DENSITY_KEY);
      if (saved === "cards" || saved === "compact") setDensity(saved);
    } catch { /* localStorage unavailable */ }
  }, []);

  if (!isLoaded) {
    return <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12" />;
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const valid = isValidRpcUrl(rpcUrl);
    setRpcInvalid(!valid);
    setJustSaved(false);
    if (!valid) return;

    store({ rpcUrl: rpcUrl.trim(), notifyStatusChanges });
    try {
      window.localStorage.setItem(DENSITY_KEY, density);
    } catch { /* localStorage unavailable */ }
    setJustSaved(true);
  };

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <h1 className="text-3xl font-bold text-white mb-2">{t("settings.title")}</h1>
      <p className="text-slate-400 mb-8">{t("settings.intro")}</p>

      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-6">
        <fieldset className={fieldsetClass}>
          <legend className="font-semibold text-white mb-1">{t("settings.network")}</legend>
          <div>
            <label htmlFor="rpc-url" className="text-sm text-slate-400 mb-1.5 block">{t("settings.rpcLabel")}</label>
            <input
              id="rpc-url"
              type="url"
              value={rpcUrl}
              onChange={event => { setRpcUrl(event.target.value); setJustSaved(false); }}
              placeholder="https://"
              aria-invalid={rpcInvalid}
              aria-describedby={rpcInvalid ? "rpc-url-hint rpc-url-error" : "rpc-url-hint"}
              className={`${inputClass} font-mono text-xs ${rpcInvalid ? "border-red-600 focus:border-red-500" : ""}`}
            />
            <p id="rpc-url-hint" className="mt-1.5 text-xs text-slate-500">{t("settings.rpcHint")}</p>
            {rpcInvalid && <p id="rpc-url-error" role="alert" className="mt-1.5 text-xs text-red-400">{t("settings.rpcInvalid")}</p>}
          </div>
        </fieldset>

        <fieldset className={fieldsetClass}>
          <legend className="font-semibold text-white mb-1">{t("settings.notifications")}</legend>
          <label className="flex items-center gap-3 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={notifyStatusChanges}
              onChange={event => { setNotifyStatusChanges(event.target.checked); setJustSaved(false); }}
              className="h-4 w-4 accent-blue-600"
            />
            {t("settings.notifyStatus")}
          </label>
        </fieldset>

        <fieldset className={fieldsetClass}>
          <legend className="font-semibold text-white mb-1">{t("settings.display")}</legend>
          <div>
            <label htmlFor="density" className="text-sm text-slate-400 mb-1.5 block">{t("settings.density")}</label>
            <select
              id="density"
              value={density}
              onChange={event => { setDensity(event.target.value as Density); setJustSaved(false); }}
              className={inputClass}
            >
              <option value="cards">{t("settings.cards")}</option>
              <option value="compact">{t("settings.compact")}</option>
            </select>
          </div>
        </fieldset>

        <div className="flex flex-col gap-3">
          <button type="submit" className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-semibold transition-colors">
            {t("settings.save")}
          </button>
          <div role="status" aria-live="polite" className="text-sm text-emerald-400 text-center min-h-5">
            {justSaved ? t("settings.saved") : ""}
          </div>
        </div>
      </form>
    </div>
  );
}
