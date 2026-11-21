'use client';

import { FormEvent, useState } from "react";

const STORAGE_KEY = "quorum-email-digest";

export default function DigestSignup() {
  const [email, setEmail] = useState("");
  const [saved, setSaved] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) return;
    window.localStorage.setItem(STORAGE_KEY, email.trim().toLowerCase());
    setSaved(true);
  }

  return (
    <div className="rounded-xl border border-[#1a2535] bg-[#0d1520] p-5">
      <h2 className="font-semibold text-white">Proposal digest interest list</h2>
      <p className="mt-1 text-sm text-slate-400">Email digest subscriptions are coming soon. Save your interest on this device.</p>
      {saved ? (
        <p role="status" className="mt-4 text-sm text-emerald-400">Your interest was saved on this device. You are not subscribed to email updates.</p>
      ) : (
        <form className="mt-4 flex flex-col gap-2 sm:flex-row" onSubmit={submit}>
          <label className="sr-only" htmlFor="digest-email">Email address</label>
          <input id="digest-email" type="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" className="min-w-0 flex-1 rounded-md border border-[#1e2d40] bg-[#080c10] px-3 py-2 text-sm text-white outline-none focus:border-blue-500" />
          <button type="submit" className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500">Save interest</button>
        </form>
      )}
    </div>
  );
}
