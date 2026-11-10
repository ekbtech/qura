"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

type Props = { electionId: string; verificationEnabled: boolean };

export function ElectionAccessView({ electionId, verificationEnabled }: Props) {
  const router = useRouter();
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [code, setCode] = useState("");
  const [codeRequested, setCodeRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  async function requestAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/public/elections/${electionId}/code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registrationNumber }),
      });
      const result = await response.json() as { token?: string; verificationRequired?: boolean; message?: string };
      if (!response.ok) throw new Error(result.message ?? "Could not verify voter eligibility.");
      if (result.token) {
        router.replace(`/vote/${encodeURIComponent(result.token)}`);
        return;
      }
      if (result.verificationRequired) {
        setCodeRequested(true);
        setNotice({ kind: "info", text: result.message ?? "If your registration number is eligible, a code has been sent to its registered email address." });
      } else {
        setNotice({ kind: "info", text: result.message ?? "If your registration number is eligible, you may continue to the ballot." });
      }
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not verify voter eligibility." });
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/public/elections/${electionId}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registrationNumber, code }),
      });
      const result = await response.json() as { token?: string; message?: string };
      if (!response.ok || !result.token) throw new Error(result.message ?? "That code could not be verified.");
      router.replace(`/vote/${encodeURIComponent(result.token)}`);
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Verification is temporarily unavailable." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="public-card public-verify-card">
      <span className="public-overline">{verificationEnabled ? "VOTER VERIFICATION" : "VOTER ACCESS"}</span>
      {!codeRequested ? (
        <form className="public-verify-card" onSubmit={(event) => void requestAccess(event)}>
          <h2>{verificationEnabled ? "Enter your school registration number" : "Enter your school registration number to continue"}</h2>
          <p>{verificationEnabled
            ? "We’ll send a one-time verification code to the email address registered to this number."
            : "Registered voters can continue directly to the ballot. No email code is required right now."}</p>
          <label htmlFor="registration-number">School registration number</label>
          <input
            id="registration-number"
            className="text-input"
            autoComplete="username"
            maxLength={100}
            required
            value={registrationNumber}
            onChange={(event) => setRegistrationNumber(event.target.value)}
          />
          <button className="primary-button" disabled={busy || registrationNumber.trim().length < 2}>
            {busy ? (verificationEnabled ? "Sending code…" : "Checking voter…") : (verificationEnabled ? "Send verification code" : "Continue to ballot")} <span aria-hidden="true">→</span>
          </button>
        </form>
      ) : (
        <form className="public-verify-card" onSubmit={(event) => void verifyCode(event)}>
          <h2>Enter the email code</h2>
          <p>If this number is eligible, a six-digit code was sent to its registered email address. The code expires in 10 minutes. If it does not arrive, contact the election administrator.</p>
          <label htmlFor="email-code">Verification code</label>
          <input
            id="email-code"
            className="text-input"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
          />
          <button className="primary-button" disabled={busy || code.length !== 6}>
            {busy ? "Verifying…" : "Verify and continue"} <span aria-hidden="true">→</span>
          </button>
          <button className="public-secondary-link" type="button" disabled={busy} onClick={() => { setCodeRequested(false); setCode(""); setNotice(null); }}>
            Use a different registration number
          </button>
        </form>
      )}
      {notice && <p className={`notice notice-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>}
      <p className="public-privacy">Each eligible voter can submit one ballot. Your registration number is not stored with your vote.</p>
    </section>
  );
}
