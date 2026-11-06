"use client";

import Image from "next/image";
import Link from "next/link";
import { Turnstile } from "@marsidev/react-turnstile";
import { useEffect, useMemo, useState } from "react";
import type { PublicBallot } from "@/lib/public-ballot";
import type { FormEvent } from "react";

type Props = { token: string; ballot: PublicBallot | null };
type Notice = { kind: "error" | "success" | "info"; text: string };
type PublicResults = { title: string; ballots: number; results: { category?: string; label: string; count: number }[] };

function groupPublicResults(rows: PublicResults["results"]) {
  const grouped = new Map<string, { label: string; count: number }[]>();
  for (const row of rows) {
    const separator = row.label.indexOf(": ");
    const group = row.category ?? (separator >= 0 ? row.label.slice(0, separator) : "Results");
    const label = row.category ? row.label : separator >= 0 ? row.label.slice(separator + 2) : row.label;
    grouped.set(group, [...(grouped.get(group) ?? []), { label, count: row.count }]);
  }
  return [...grouped].map(([title, items]) => ({
    title,
    items: [...items].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    total: items.reduce((sum, item) => sum + item.count, 0),
  }));
}

export function PublicBallotView({ token, ballot }: Props) {
  const [sessionStarted, setSessionStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [captchaToken, setCaptchaToken] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [publicResults, setPublicResults] = useState<PublicResults | null>(null);

  useEffect(() => {
    if (!ballot || ballot.eventType !== "poll" || !ballot.sessionDuplicateProtection) {
      return;
    }
    fetch(`/api/public/session?token=${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Voting session could not be started.");
        const status = await response.json() as { alreadyVoted: boolean };
        if (status.alreadyVoted) setHasVoted(true);
        setSessionStarted(true);
      })
      .catch(() => setNotice({ kind: "error", text: "Could not start a voting session. Refresh the page to try again." }));
  }, [ballot, token]);

  const isOpen = ballot?.isOpen ?? false;
  const sessionRequired = Boolean(ballot?.eventType === "poll" && ballot.sessionDuplicateProtection);
  const sessionReady = !sessionRequired || sessionStarted;
  const resultsAvailable = Boolean(ballot?.resultsPublic && ballot.status !== "open" && ballot.status !== "draft");
  const hasSelection = useMemo(() => {
    if (!ballot) return false;
    if (ballot.eventType === "poll") {
      return ballot.questions.length > 0 && ballot.questions.every((question) =>
        (selections[question.id]?.length ?? 0) >= question.minSelections &&
        (selections[question.id]?.length ?? 0) <= question.maxSelections,
      );
    }
    return ballot.positions.length > 0 && ballot.positions.every((position) =>
      (selections[position.id]?.length ?? 0) >= position.minSelections &&
      (selections[position.id]?.length ?? 0) <= position.maxSelections,
    );
  }, [ballot, selections]);

  function choose(groupId: string, value: string, maxSelections: number) {
    setSelections((current) => {
      const selected = current[groupId] ?? [];
      const next = selected.includes(value)
        ? selected.filter((item) => item !== value)
        : maxSelections === 1
          ? [value]
          : selected.length < maxSelections
            ? [...selected, value]
            : selected;
      return { ...current, [groupId]: next };
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ballot || !hasSelection) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/public/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          honeypot: (new FormData(event.currentTarget).get("website") as string | null) ?? "",
          captchaToken,
          ...(ballot.eventType === "poll"
            ? { answers: ballot.questions.map((question) => ({ questionId: question.id, optionIds: selections[question.id] ?? [] })) }
            : { candidateIds: Object.values(selections).flat() }),
        }),
      });
      const result = await response.json() as { message?: string };
      if (!response.ok) {
        setNotice({ kind: "error", text: result.message ?? "Your ballot could not be submitted." });
        if (ballot.botProtection) setCaptchaToken("");
        return;
      }
      setHasVoted(true);
      setNotice({ kind: "success", text: "Your ballot has been securely recorded. Thank you for taking part." });
    } catch {
      setNotice({ kind: "error", text: "Voting is temporarily unavailable. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  async function loadPublicResults() {
    try {
      const response = await fetch(`/api/public/results/${encodeURIComponent(token)}`, { cache: "no-store" });
      const result = await response.json() as PublicResults & { message?: string };
      if (!response.ok) throw new Error(result.message ?? "Published results are unavailable.");
      setPublicResults(result);
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Published results are unavailable." });
    }
  }

  return (
    <main className="public-shell">
      <header className="public-header">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">Q</span>
          <span>QURA<span className="brand-light"> Vote</span></span>
        </Link>
        <span className="secure-label"><span className="secure-dot" /> Secure voting link</span>
      </header>

      <div className="public-content">
        {!ballot ? (
          <section className="public-card public-empty">
            <span className="public-symbol" aria-hidden="true">!</span>
            <h1>Link unavailable</h1>
            <p>Check the link or contact the administrator.</p>
          </section>
        ) : (
          <>
            <section className="public-event-header">
              <span className="public-overline">{ballot.eventType === "poll" ? "SCHOOL POLL" : "FORMAL ELECTION"}</span>
              <h1>{ballot.title}</h1>
              {ballot.description && <p>{ballot.description}</p>}
              <div className="public-date">
                {isOpen
                  ? `Voting closes ${new Date(ballot.closesAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`
                  : ballot.status === "draft"
                    ? "Not open yet."
                    : ballot.status === "cancelled"
                      ? "Cancelled."
                      : !ballot.hasOpened
                        ? `Voting opens ${new Date(ballot.opensAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`
                        : "Closed."}
              </div>
            </section>

            {hasVoted || ballot.invitationUsed ? (
              <section className="public-card public-success">
                <span className="success-mark" aria-hidden="true">✓</span>
                <h2>{ballot.invitationUsed && !hasVoted ? "Invitation already used." : "Vote recorded."}</h2>
                <p>{ballot.invitationUsed && !hasVoted
                  ? "Contact the administrator if you need help."
                  : "Thank you for voting."}</p>
                {resultsAvailable && <button className="public-secondary-link" type="button" onClick={() => void loadPublicResults()}>View published results</button>}
                {publicResults && <PublicResultTable results={publicResults} />}
              </section>
            ) : !isOpen ? (
              <section className="public-card public-empty">
                <h2>Voting is closed</h2>
                <p>Use this link during the voting period.</p>
                {resultsAvailable && <button className="public-secondary-link" type="button" onClick={() => void loadPublicResults()}>View published results</button>}
                {publicResults && <PublicResultTable results={publicResults} />}
              </section>
            ) : (
              <form className="public-card public-ballot-form" onSubmit={submit}>
                <div className="public-form-heading">
                  <span className="eyebrow dark-eyebrow"><span className="eyebrow-line" /> YOUR BALLOT</span>
                  <p>{ballot.invitation
                    ? "One ballot per invitation."
                      : "Anyone with this poll link can vote."}</p>
                </div>

                {ballot.eventType === "poll" && ballot.questions.map((question) => (
                  <fieldset className="public-question" key={question.id}>
                    <legend>{question.prompt}</legend>
                    <p className="selection-hint">{question.maxSelections === 1 ? "Choose one" : `Choose up to ${question.maxSelections}`}</p>
                    <div className="public-options">
                      {question.options.map((option) => (
                        <label className={`public-option ${(selections[question.id] ?? []).includes(option.id) ? "public-option-selected" : ""}`} key={option.id}>
                          <input type={question.maxSelections === 1 ? "radio" : "checkbox"} name={question.id}
                            checked={(selections[question.id] ?? []).includes(option.id)}
                            onChange={() => choose(question.id, option.id, question.maxSelections)} />
                          <span>{option.label}</span><span className="radio-mark" />
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}

                {ballot.eventType === "election" && ballot.positions.map((position) => (
                  <fieldset className="public-question" key={position.id}>
                    <legend>{position.title}</legend>
                    <p className="selection-hint">{position.maxSelections === 1 ? "Choose one" : `Choose up to ${position.maxSelections}`}</p>
                    <div className="public-options">
                      {position.candidates.map((candidate) => (
                        <label className={`public-candidate ${(selections[position.id] ?? []).includes(candidate.id) ? "public-option-selected" : ""}`} key={candidate.id}>
                          <input type={position.maxSelections === 1 ? "radio" : "checkbox"} name={position.id}
                            checked={(selections[position.id] ?? []).includes(candidate.id)}
                            onChange={() => choose(position.id, candidate.id, position.maxSelections)} />
                          {candidate.photoUrl
                            ? <Image className="public-candidate-photo" src={candidate.photoUrl} width={52} height={52} alt="" unoptimized />
                            : <span className="public-candidate-initials" aria-hidden="true">{candidate.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span>}
                          <span className="public-candidate-copy"><strong>{candidate.name}</strong>{candidate.grade && <small>{candidate.grade}</small>}{candidate.statement && <span>{candidate.statement}</span>}</span>
                          <span className="radio-mark" />
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}

                <label className="honeypot-field" aria-hidden="true" tabIndex={-1}>
                  Leave this field empty<input name="website" autoComplete="off" tabIndex={-1} />
                </label>

                {ballot.botProtection && process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && (
                  <Turnstile siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} onSuccess={setCaptchaToken}
                    onExpire={() => setCaptchaToken("")} onError={() => setCaptchaToken("")} />
                )}
                {ballot.botProtection && !process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && (
                  <p className="public-warning">Anti-bot protection is not configured. This poll cannot accept votes until the administrator configures it.</p>
                )}
                <button className="primary-button" disabled={busy || !hasSelection || !sessionReady ||
                  (ballot.botProtection && (!captchaToken || !process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY))}>
                  {busy ? "Submitting ballot..." : "Submit ballot"} <span aria-hidden="true">→</span>
                </button>
                <p className="public-privacy">
                  {ballot.eventType === "election" || ballot.sessionDuplicateProtection
                    ? "Voter identity is separate from ballot choices."
                    : "Public links cannot guarantee one vote per person."}
                </p>
              </form>
            )}
            {notice && <p className={`notice notice-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>}
          </>
        )}
      </div>
      <footer className="public-footer">QURA Voting</footer>
    </main>
  );
}

function PublicResultTable({ results }: { results: PublicResults }) {
  const groups = groupPublicResults(results.results);
  return (
    <div className="public-results">
      <h3>Published results</h3>
      <p>{results.ballots} vote{results.ballots === 1 ? "" : "s"}</p>
      {groups.map((group) => (
        <section className="public-result-group" key={group.title}>
          <h4>{group.title}</h4>
          {group.items.map((result, index) => {
            const percentage = group.total ? Math.round((result.count / group.total) * 100) : 0;
            return (
              <div className="public-result-row" key={result.label}>
                <div className="public-result-heading"><span><small>{index + 1}</small>{result.label}</span><strong>{result.count} · {percentage}%</strong></div>
                <div className="public-result-track" role="img" aria-label={`${result.label}: ${result.count} votes, ${percentage}%`}>
                  <span style={{ width: `${percentage}%` }} />
                </div>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
