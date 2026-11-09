"use client";

import Image from "next/image";
import QRCode from "qrcode";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";

type Admin = { id: string; email: string };
class AdminApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
type Candidate = {
  id: string; name: string; grade: string; statement: string;
  media_file_id: string | null; photoUrl: string | null;
};
type Position = {
  id: string; title: string; min_selections: number; max_selections: number;
  candidates: Candidate[];
};
type Election = {
  id: string; title: string; description: string; status: string;
  opens_at: string; closes_at: string; results_public: boolean; secret_ballots: boolean;
  eligibleCount: number; participationCount: number; ballotCount: number; positions: Position[];
};
type PollQuestion = {
  id: string; prompt: string; max_selections: number; options: { id: string; label: string }[];
};
type Poll = {
  id: string; title: string; description: string; status: string;
  opens_at: string; closes_at: string; results_public: boolean;
  session_duplicate_protection: boolean; rate_limit_per_minute: number;
  bot_protection: boolean; linkActive: boolean; ballotCount: number; questions: PollQuestion[];
};
type Audit = { id: string; action: string; created_at: string; event_type: string | null; details: Record<string, unknown> };
type DashboardData = { polls: Poll[]; elections: Election[]; audit: Audit[] };
type Notice = { kind: "success" | "error"; text: string };
type Results = { event: { title: string; status: string; resultsPublic: boolean }; ballots: number; participation: number; results: { label: string; count: number; category?: string }[] };
type AdminView = "dashboard" | "polls" | "elections" | "contestants" | "links" | "results" | "reports" | "settings" | "activity";
type Editor =
  | { kind: "election"; id: string; title: string; description: string }
  | { kind: "position"; eventId: string; positionId: string; title: string; minSelections: number; maxSelections: number }
  | { kind: "new-position"; eventId: string }
  | { kind: "candidate"; eventId: string; positionId: string; candidateId?: string; name: string; grade: string; statement: string }
  | { kind: "poll"; id: string; title: string; description: string }
  | { kind: "poll-question"; pollId: string; questionId: string; prompt: string; options: string; maxSelections: number };
type Confirmation = { message: string; successText: string; action: () => Promise<void> };

function groupResultRows(rows: Results["results"]) {
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

const adminNavigation: { id: AdminView; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "polls", label: "Polls" },
  { id: "elections", label: "Elections" },
  { id: "contestants", label: "Contestants" },
  { id: "links", label: "Voting links" },
  { id: "results", label: "Results" },
  { id: "reports", label: "Reports" },
  { id: "settings", label: "Settings" },
  { id: "activity", label: "Audit log" },
];

function NavigationIcon({ view }: { view: AdminView }) {
  const paths: Record<AdminView, ReactNode> = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    polls: <><path d="M5 5h14M5 10h14M5 15h9" /><circle cx="18" cy="17" r="2" /></>,
    elections: <><path d="M12 3 19 6v5c0 4.5-3 7.5-7 10-4-2.5-7-5.5-7-10V6l7-3Z" /><path d="m9 12 2 2 4-4" /></>,
    contestants: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-1a6 6 0 0 1 12 0v1M16 5.2a3 3 0 0 1 0 5.6M18 14a5 5 0 0 1 3 4.5V20" /></>,
    links: <><path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" /><path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20l1.1-1.1" /></>,
    results: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
    reports: <><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v6h6M10 13h6M10 17h6" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.8-.6a8 8 0 0 1-1.5.9l-.3 1.9h-2.8l-.3-1.9a8 8 0 0 1-1.5-.9l-1.8.6-1.4-2.4 1.4-1.1a7 7 0 0 1 0-1.8l-1.4-1.1 1.4-2.4 1.8.6a8 8 0 0 1 1.5-.9l.3-1.9h2.8l.3 1.9a8 8 0 0 1 1.5.9l1.8-.6 1.4 2.4-1.4 1.1a7 7 0 0 1-.1 1.7Z" /></>,
    activity: <><path d="M4 5h16M4 12h16M4 19h16" /><circle cx="2.5" cy="5" r=".5" /><circle cx="2.5" cy="12" r=".5" /><circle cx="2.5" cy="19" r=".5" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[view]}</svg>;
}

const viewCopy: Record<AdminView, { title: string; subtitle: string }> = {
  dashboard: { title: "Dashboard", subtitle: "Your voting activity at a glance." },
  polls: { title: "Polls", subtitle: "Create and manage public polls." },
  elections: { title: "Elections", subtitle: "Manage formal elections and eligibility." },
  contestants: { title: "Contestants", subtitle: "Update candidate profiles before voting opens." },
  links: { title: "Voting links", subtitle: "Prepare and distribute voter access links." },
  results: { title: "Results", subtitle: "Review results from closed voting events." },
  reports: { title: "Reports", subtitle: "Review and export closed-event results." },
  settings: { title: "Settings", subtitle: "Administrator account and access." },
  activity: { title: "Audit log", subtitle: "Recent administrator actions." },
};

const defaultOpen = () => {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  return localDateTime(date);
};
const defaultClose = () => localDateTime(new Date(Date.now() + 24 * 60 * 60 * 1000));
function localDateTime(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { message?: string };
    throw new AdminApiError(result.message ?? "Request failed. Please try again.", response.status);
  }
  return response.json() as Promise<T>;
}

export function AdminConsole() {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [eventType, setEventType] = useState<"poll" | "election">("election");
  const [link, setLink] = useState("");
  const [qr, setQr] = useState("");
  const [results, setResults] = useState<{ id: string; type: string; data: Results } | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [activeView, setActiveView] = useState<AdminView>("dashboard");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [eventPage, setEventPage] = useState(1);

  function showActionError(error: unknown, fallback: string) {
    if (error instanceof AdminApiError && error.status === 401) {
      setAdmin(null);
      setDashboard(null);
      setEditor(null);
      setConfirmation(null);
      setNotice({ kind: "error", text: "Your administrator session expired. Sign in again to continue." });
      return;
    }
    setNotice({ kind: "error", text: error instanceof Error ? error.message : fallback });
  }

  const loadDashboard = useCallback(async () => {
    setDashboardLoading(true);
    setDashboardError(null);
    try {
      const data = await api<DashboardData>("/api/admin/events");
      setDashboard(data);
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : "Could not load events.");
      throw error;
    } finally {
      setDashboardLoading(false);
    }
  }, []);

  useEffect(() => {
    api<{ admin: Admin | null }>("/api/admin/session", { signal: AbortSignal.timeout(15000) })
      .then(({ admin: activeAdmin }) => {
        setAdmin(activeAdmin);
        if (activeAdmin) void loadDashboard().catch(() => {});
      })
      .catch((error: unknown) => setNotice({
        kind: "error",
        text: error instanceof Error && error.name === "TimeoutError"
          ? "Administrator session check timed out. Please sign in or refresh the page."
          : error instanceof Error ? error.message : "Could not check administrator session.",
      }));
  }, [loadDashboard]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const result = await api<{ admin: Admin }>("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      await loadDashboard();
      setAdmin(result.admin);
      setPassword("");
    } catch (error) {
      setAdmin(null);
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Administrator sign-in failed." });
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/session", { method: "DELETE", cache: "no-store" });
      if (!response.ok) throw new Error("Could not end the administrator session.");
      setAdmin(null);
      setDashboard(null);
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not end the administrator session." });
    } finally {
      setBusy(false);
    }
  }

  async function runAction(action: () => Promise<void>, successText?: string) {
    setEventPage(1);
    setBusy(true);
    setNotice(null);
    try {
      await action();
      await loadDashboard();
      if (successText) setNotice({ kind: "success", text: successText });
    } catch (error) {
      showActionError(error, "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  async function submitEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    const form = new FormData(event.currentTarget);
    const jsonHeaders = { "Content-Type": "application/json" };
    const values = Object.fromEntries(form.entries());
    const selectedEditor = editor;
    void runAction(async () => {
        if (selectedEditor.kind === "election") {
          await api(`/api/admin/events/${selectedEditor.id}`, {
            method: "PATCH", headers: jsonHeaders,
            body: JSON.stringify({ type: "election", title: values.title, description: values.description }),
          });
        } else if (selectedEditor.kind === "position") {
          await api(`/api/admin/events/${selectedEditor.eventId}/positions`, {
            method: "PATCH", headers: jsonHeaders,
            body: JSON.stringify({
              positionId: selectedEditor.positionId,
              title: values.title,
              minSelections: Number(values.minSelections),
              maxSelections: Number(values.maxSelections),
            }),
          });
        } else if (selectedEditor.kind === "new-position") {
          await api(`/api/admin/events/${selectedEditor.eventId}/positions`, {
            method: "POST", headers: jsonHeaders, body: JSON.stringify({ title: values.title }),
          });
        } else if (selectedEditor.kind === "candidate") {
          let mediaFileId: string | null = null;
          const photo = form.get("photo");
          if (photo instanceof File && photo.size > 0) {
            const uploadForm = new FormData();
            uploadForm.set("file", photo);
            const response = await fetch("/api/admin/media", { method: "POST", body: uploadForm });
            const result = await response.json() as { mediaFileId?: string; message?: string };
            if (!response.ok) throw new AdminApiError(result.message ?? "Photo upload failed.", response.status);
            if (!result.mediaFileId) throw new Error("Photo upload did not return a file ID.");
            mediaFileId = result.mediaFileId;
          }
          const candidate = {
            name: values.name,
            grade: values.grade,
            statement: values.statement,
            ...(selectedEditor.candidateId
              ? (mediaFileId ? { mediaFileId } : {})
              : { positionId: selectedEditor.positionId, mediaFileId }),
          };
          await api(`/api/admin/events/${selectedEditor.eventId}/contestants`, {
            method: selectedEditor.candidateId ? "PATCH" : "POST",
            headers: jsonHeaders,
            body: JSON.stringify(selectedEditor.candidateId
              ? { ...candidate, candidateId: selectedEditor.candidateId }
              : candidate),
          });
        } else if (selectedEditor.kind === "poll") {
          await api(`/api/admin/events/${selectedEditor.id}`, {
            method: "PATCH", headers: jsonHeaders,
            body: JSON.stringify({ type: "poll", title: values.title, description: values.description }),
          });
        } else {
          await api(`/api/admin/events/${selectedEditor.pollId}/questions`, {
            method: "PATCH", headers: jsonHeaders,
            body: JSON.stringify({
              questionId: selectedEditor.questionId,
              prompt: values.prompt,
              options: String(values.options ?? "").split("\n").map((line) => line.trim()).filter(Boolean),
              maxSelections: Number(values.maxSelections),
            }),
          });
        }
      setEditor(null);
    }, "Changes saved.");
  }

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const visibleElections = (dashboard?.elections ?? []).filter((election) => {
    const matchesView = activeView === "dashboard" || activeView === "elections" ||
      (activeView === "contestants" && election.positions.some((position) => position.candidates.length > 0)) ||
      (activeView === "links" && election.status === "open" && election.eligibleCount > 0) ||
      ((activeView === "results" || activeView === "reports") && election.status === "closed");
    const matchesStatus = statusFilter === "all" || election.status === statusFilter;
    const matchesSearch = !normalizedSearch || `${election.title} ${election.description} ${election.status} ${election.positions.flatMap((position) => [position.title, ...position.candidates.map((candidate) => candidate.name)]).join(" ")}`.toLowerCase().includes(normalizedSearch);
    return matchesView && matchesStatus && matchesSearch;
  });
  const visiblePolls = (dashboard?.polls ?? []).filter((poll) => {
    const matchesView = activeView === "dashboard" || activeView === "polls" ||
      (activeView === "links" && poll.linkActive) ||
      ((activeView === "results" || activeView === "reports") && poll.status === "closed");
    const matchesStatus = statusFilter === "all" || poll.status === statusFilter;
    const matchesSearch = !normalizedSearch || `${poll.title} ${poll.description} ${poll.status} ${poll.questions.map((question) => question.prompt).join(" ")}`.toLowerCase().includes(normalizedSearch);
    return matchesView && matchesStatus && matchesSearch;
  });
  const eventCount = (dashboard?.polls.length ?? 0) + (dashboard?.elections.length ?? 0);
  const openCount = [...(dashboard?.polls ?? []), ...(dashboard?.elections ?? [])].filter((event) => event.status === "open").length;
  const ballotCount = (dashboard?.polls.reduce((sum, poll) => sum + poll.ballotCount, 0) ?? 0) +
    (dashboard?.elections.reduce((sum, election) => sum + election.ballotCount, 0) ?? 0);
  const eligibleCount = dashboard?.elections.reduce((sum, election) => sum + election.eligibleCount, 0) ?? 0;
  const candidateCount = dashboard?.elections.reduce((sum, election) =>
    sum + election.positions.reduce((positionSum, position) => positionSum + position.candidates.length, 0), 0) ?? 0;
  const visibleAudit = activeView === "dashboard" ? dashboard?.audit.slice(0, 5) : dashboard?.audit;
  const resultGroups = results ? groupResultRows(results.data.results) : [];
  const eventPageSize = 6;
  const eventPageCount = Math.max(1, Math.ceil((visibleElections.length + visiblePolls.length) / eventPageSize));
  const currentEventPage = Math.min(eventPage, eventPageCount);
  const pageStart = (currentEventPage - 1) * eventPageSize;
  const pagedIds = new Set([...visibleElections, ...visiblePolls].slice(pageStart, pageStart + eventPageSize).map((event) => event.id));
  const pagedElections = visibleElections.filter((election) => pagedIds.has(election.id));
  const pagedPolls = visiblePolls.filter((poll) => pagedIds.has(poll.id));

  useEffect(() => {
    if (!results) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById("results-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [results]);

  function navigate(view: AdminView) {
    setActiveView(view);
    setSearchQuery("");
    setStatusFilter("all");
    setEventPage(1);
    if (view === "polls") setEventType("poll");
    if (view === "elections") setEventType("election");
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (!admin) {
    return (
      <main className="admin-shell admin-login-shell">
        <div className="admin-login-layout">
          <aside className="admin-login-aside">
            <Link className="brand admin-brand" href="/">
              <span className="brand-mark" aria-hidden="true">Q</span>
              <span>QURA<span className="brand-light"> Admin</span></span>
            </Link>
            <div className="admin-login-message">
              <span className="admin-login-eyebrow">VOTING, MADE CLEAR</span>
              <h1>Make every vote count.</h1>
              <p>A secure workspace to manage your school polls and elections.</p>
            </div>
            <div className="admin-login-assurance">
              <span className="admin-login-lock" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <rect x="5" y="10" width="14" height="11" rx="2" />
                  <path d="M8 10V7a4 4 0 1 1 8 0v3M12 14v3" />
                </svg>
              </span>
              <span><strong>Private administrator access</strong><small>Voters never need an account.</small></span>
            </div>
          </aside>
          <section className="admin-login-card" aria-labelledby="admin-login-title">
            <span className="admin-login-eyebrow">ADMINISTRATOR ACCESS</span>
            <h2 id="admin-login-title">Welcome back</h2>
            <p className="admin-login-description">Sign in to manage your school’s voting.</p>
            <form className="admin-login-form" onSubmit={handleLogin}>
              <label className="admin-login-label" htmlFor="admin-email">Email address</label>
              <input
                id="admin-email"
                className="text-input"
                type="email"
                autoComplete="username"
                autoFocus
                aria-describedby="admin-credential-help"
                placeholder="admin@school.edu"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <label className="admin-login-label" htmlFor="admin-password">Password</label>
              <input
                id="admin-password"
                className="text-input"
                type="password"
                autoComplete="current-password"
                aria-describedby="admin-credential-help"
                placeholder="Enter your password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button className="primary-button" disabled={busy}>
                {busy ? "Signing in..." : "Sign in"}
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="none"><path d="M4 10h12m-5-5 5 5-5 5" /></svg>
              </button>
            </form>
            <p id="admin-credential-help" className="admin-credential-help">
              Use the administrator credentials created during secure setup.
            </p>
            {notice && <p className={`notice notice-${notice.kind}`} role="alert">{notice.text}</p>}
            <p className="admin-login-footer">Secure access for authorized administrators only.</p>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="admin-workspace">
      {sidebarOpen && <button className="admin-sidebar-backdrop" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
      <aside className={`admin-sidebar${sidebarOpen ? " admin-sidebar-open" : ""}`}>
        <Link className="brand admin-workspace-brand" href="/">
          <span className="brand-mark" aria-hidden="true">Q</span>
          <span>QURA<span className="brand-light"> Admin</span></span>
        </Link>
        <span className="admin-nav-caption">WORKSPACE</span>
        <nav className="admin-nav" aria-label="Administrator navigation">
          {adminNavigation.map((item) => {
            const count = item.id === "polls" ? dashboard?.polls.length
              : item.id === "elections" ? dashboard?.elections.length
                : item.id === "contestants"
                  ? dashboard?.elections.reduce((total, election) => total + election.positions.reduce((subtotal, position) => subtotal + position.candidates.length, 0), 0)
                  : undefined;
            return (
              <button
                className={`admin-nav-item${activeView === item.id ? " admin-nav-active" : ""}`}
                key={item.id}
                type="button"
                aria-current={activeView === item.id ? "page" : undefined}
                onClick={() => navigate(item.id)}
              >
                <span className="admin-nav-marker"><NavigationIcon view={item.id} /></span>
                <span>{item.label}</span>
                {count !== undefined && <span className="admin-nav-count">{count}</span>}
              </button>
            );
          })}
        </nav>
        <div className="admin-sidebar-footer">
          <span className="admin-account-avatar" aria-hidden="true">{admin.email.slice(0, 1).toUpperCase()}</span>
          <span className="admin-account-copy"><strong>Administrator</strong><small>{admin.email}</small></span>
        </div>
      </aside>
      <div className="admin-main-area">
        <header className="admin-topbar">
          <button className="admin-menu-toggle" type="button" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}>Menu</button>
          <div className="admin-breadcrumb"><span>QURA</span><span aria-hidden="true">/</span><strong>{viewCopy[activeView].title}</strong></div>
          <div className="admin-topbar-right">
            <span className="admin-topbar-email">{admin.email}</span>
            <button className="quiet-button" disabled={busy} onClick={logout}>Sign out</button>
          </div>
        </header>
        <section className="admin-dashboard">
        <div className="admin-welcome">
          <div><span className="public-overline">ADMIN WORKSPACE</span><h1>{viewCopy[activeView].title}</h1><p>{viewCopy[activeView].subtitle}</p></div>
          <div className="admin-welcome-actions">
            <span className="admin-secure-pill"><span className="secure-dot" /> Secure session</span>
            {(activeView === "dashboard" || activeView === "polls" || activeView === "elections") &&
              <button className="admin-new-event-button" type="button" onClick={() => document.getElementById("create-event")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                <span aria-hidden="true">+</span> New {eventType}
              </button>}
          </div>
        </div>
        {notice && <p className={`notice notice-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>}
        {confirmation && <section className="admin-confirmation" role="alert">
          <p>{confirmation.message}</p>
          <button className="small-action danger-action" disabled={busy} onClick={() => {
            const selected = confirmation;
            setConfirmation(null);
            void runAction(selected.action, selected.successText);
          }}>Confirm</button>
          <button className="small-action" disabled={busy} onClick={() => setConfirmation(null)}>Keep</button>
        </section>}

        {activeView === "dashboard" && (
          <section className="admin-metric-grid" aria-label="Voting overview">
            <article className="admin-metric">
              <span>Open events</span>
              <span className="admin-metric-icon metric-icon-blue" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4m8-4v4M4 10h16m-11 4h3m-3 3h7" /></svg></span>
              <strong>{openCount}</strong>
              <small>{eventCount} total poll{eventCount === 1 ? "" : "s"} and election{eventCount === 1 ? "" : "s"}</small>
            </article>
            <article className="admin-metric">
              <span>Ballots received</span>
              <span className="admin-metric-icon metric-icon-green" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M5 4h14v16H5zM8 8h8m-8 4h3m-3 4h8m1-5 1.5 1.5L21 10" /></svg></span>
              <strong>{ballotCount}</strong>
              <small>Across all voting events</small>
            </article>
            <article className="admin-metric">
              <span>Eligible voters</span>
              <span className="admin-metric-icon metric-icon-purple" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3" /><path d="M3 20v-1a6 6 0 0 1 12 0v1m2-11a3 3 0 0 1 0 6m1 2a5 5 0 0 1 3 4v1" /></svg></span>
              <strong>{eligibleCount}</strong>
              <small>Formal election invitations</small>
            </article>
            <article className="admin-metric">
              <span>Contestants</span>
              <span className="admin-metric-icon metric-icon-orange" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" /></svg></span>
              <strong>{candidateCount}</strong>
              <small>Across all formal elections</small>
            </article>
          </section>
        )}

        {editor && <section className="admin-panel admin-editor">
          <div className="admin-panel-heading"><div><span className="public-overline">EDIT DRAFT</span><h2>
            {editor.kind === "candidate" ? (editor.candidateId ? "Edit contestant" : "Add contestant")
              : editor.kind === "position" ? "Edit electoral position"
                : editor.kind === "new-position" ? "Add electoral position"
                  : editor.kind === "poll-question" ? "Edit poll question and options"
                    : `Edit ${editor.kind === "election" ? "election" : "poll"} details`}
          </h2></div></div>
          <form className="admin-create-form" onSubmit={(event) => void submitEditor(event)}>
            <div className="admin-form-grid">
              {(editor.kind === "election" || editor.kind === "poll") && <>
                <label>Event title<input name="title" className="text-input" required minLength={2} maxLength={160} defaultValue={editor.title} /></label>
                <label>Description<textarea name="description" className="text-input admin-textarea" maxLength={2000} defaultValue={editor.description} /></label>
              </>}
              {(editor.kind === "position" || editor.kind === "new-position") && <>
                <label>Position name<input name="title" className="text-input" required minLength={2} maxLength={120} defaultValue={editor.kind === "position" ? editor.title : ""} /></label>
                {editor.kind === "position" && <>
                  <label>Minimum candidate selections<input name="minSelections" type="number" className="text-input" min={0} max={10} required defaultValue={editor.minSelections} /></label>
                  <label>Maximum candidate selections<input name="maxSelections" type="number" className="text-input" min={1} max={10} required defaultValue={editor.maxSelections} /></label>
                </>}
              </>}
              {editor.kind === "candidate" && <>
                <label>Contestant name<input name="name" className="text-input" required minLength={2} maxLength={120} defaultValue={editor.name} /></label>
                <label>Grade or year<input name="grade" className="text-input" maxLength={80} defaultValue={editor.grade} /></label>
                <label>Candidate statement<textarea name="statement" className="text-input admin-textarea" maxLength={2000} defaultValue={editor.statement} /></label>
                <label>Photograph (optional){editor.candidateId && " — choose a new image to replace the current one"}<input name="photo" className="text-input" type="file" accept="image/png,image/jpeg,image/webp" /></label>
              </>}
              {editor.kind === "poll-question" && <>
                <label>Question<textarea name="prompt" className="text-input admin-textarea" required minLength={2} maxLength={500} defaultValue={editor.prompt} /></label>
                <label>Answer options, one per line<textarea name="options" className="text-input admin-textarea" required defaultValue={editor.options} /></label>
                <label>Maximum selections<input name="maxSelections" type="number" className="text-input" min={1} max={20} required defaultValue={editor.maxSelections} /></label>
              </>}
            </div>
            <div className="event-admin-actions">
              <button className="small-action primary-small" disabled={busy}>Save changes</button>
              <button className="small-action" type="button" disabled={busy} onClick={() => setEditor(null)}>Cancel</button>
            </div>
          </form>
        </section>}

        {(activeView === "dashboard" || activeView === "polls" || activeView === "elections") && <section className="admin-panel admin-create-panel" id="create-event">
          <div className="admin-panel-heading"><div><span className="public-overline">NEW</span><h2>Create event</h2></div></div>
          <div className="event-type-switch">
            <button type="button" className={eventType === "election" ? "type-selected" : ""} onClick={() => setEventType("election")}>Election</button>
            <button type="button" className={eventType === "poll" ? "type-selected" : ""} onClick={() => setEventType("poll")}>Poll</button>
          </div>
          <form className="admin-create-form" onSubmit={(event) => {
            event.preventDefault();
            const formElement = event.currentTarget;
            const form = new FormData(formElement);
            const payload = {
              type: eventType,
              title: String(form.get("title") ?? ""),
              description: String(form.get("description") ?? ""),
              opensAt: new Date(String(form.get("opensAt"))).toISOString(),
              closesAt: new Date(String(form.get("closesAt"))).toISOString(),
              secretBallots: true,
              ...(eventType === "poll"
                ? { prompt: String(form.get("prompt") ?? ""), options: String(form.get("options") ?? "").split("\n").map((line) => line.trim()).filter(Boolean), maxSelections: Number(form.get("maxSelections")), sessionDuplicateProtection: form.get("sessionDuplicateProtection") === "on", rateLimitPerMinute: Number(form.get("rateLimitPerMinute")), botProtection: form.get("botProtection") === "on" }
                : { positions: String(form.get("positions") ?? "").split("\n").map((line) => line.trim()).filter(Boolean), maxSelectionsPerPosition: Number(form.get("maxSelectionsPerPosition")) }),
            };
            void runAction(async () => {
              await api("/api/admin/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
              formElement.reset();
            }, "Draft event created.");
          }}>
            <div className="admin-form-grid">
              <label>Title<input name="title" className="text-input" required minLength={2} maxLength={160} placeholder="Student Council Election" /></label>
              <label>Description<textarea name="description" className="text-input admin-textarea" maxLength={2000} placeholder="Optional" /></label>
              <label>Opens<input name="opensAt" className="text-input" type="datetime-local" required defaultValue={defaultOpen()} /></label>
              <label>Closes<input name="closesAt" className="text-input" type="datetime-local" required defaultValue={defaultClose()} /></label>
              {eventType === "poll" ? (
                <>
                  <label>Question<textarea name="prompt" className="text-input admin-textarea" required placeholder="What would you like to ask?" /></label>
                  <label>Options (one per line)<textarea name="options" className="text-input admin-textarea" required placeholder={"Option one\nOption two"} /></label>
                  <label>Maximum selections<input name="maxSelections" type="number" className="text-input" min={1} max={20} defaultValue={1} /></label>
                  <label className="admin-check"><input name="sessionDuplicateProtection" type="checkbox" defaultChecked /> Limit repeat votes per browser</label>
                  <label>Votes per IP / minute<input name="rateLimitPerMinute" type="number" className="text-input" min={1} max={120} defaultValue={10} /></label>
                  <label className="admin-check"><input name="botProtection" type="checkbox" /> Require bot check (Turnstile)</label>
                </>
              ) : (
                <>
                  <label>Positions (one per line)<textarea name="positions" className="text-input admin-textarea" required placeholder={"President\nVice President"} /></label>
                  <label>Selections per position<input name="maxSelectionsPerPosition" type="number" className="text-input" min={1} max={10} defaultValue={1} /></label>
                </>
              )}
            </div>
            <button className="primary-button admin-submit" disabled={busy}>Create <span aria-hidden="true">→</span></button>
          </form>
        </section>}

        {(activeView !== "settings" && activeView !== "activity") && <section className="admin-panel admin-events-panel" id="events">
          <div className="admin-panel-heading admin-events-heading">
            <div><span className="public-overline">{activeView === "reports" ? "REPORTS" : activeView === "results" ? "RESULTS" : activeView === "links" ? "DISTRIBUTION" : "EVENTS"}</span><h2>{activeView === "dashboard" ? "All voting events" : viewCopy[activeView].title}</h2></div>
            <button className="quiet-button" disabled={busy || dashboardLoading} onClick={() => { setEventPage(1); void loadDashboard(); }}>{dashboardLoading ? "Refreshing…" : "Refresh"}</button>
          </div>
          <div className="admin-event-tools">
            <label className="admin-search"><span className="admin-search-icon" aria-hidden="true" /><span className="visually-hidden">Search events and contestants</span><input value={searchQuery} onChange={(event) => { setEventPage(1); setSearchQuery(event.target.value); }} placeholder="Search events or contestants" /></label>
            <label className="admin-status-filter"><span>Status</span><select value={statusFilter} onChange={(event) => { setEventPage(1); setStatusFilter(event.target.value); }}><option value="all">All statuses</option><option value="draft">Draft</option><option value="open">Open</option><option value="closed">Closed</option><option value="cancelled">Cancelled</option></select></label>
            <span className="admin-result-count">{visibleElections.length + visiblePolls.length} events</span>
          </div>
          {!dashboard && dashboardLoading && <p>Loading…</p>}
          {!dashboard && !dashboardLoading && dashboardError && <p className="admin-empty">Could not load events. Use Refresh to retry.</p>}
          {dashboard && visibleElections.length + visiblePolls.length === 0 && <div className="admin-empty-state"><span className="admin-empty-symbol" aria-hidden="true">Q</span><strong>{normalizedSearch || statusFilter !== "all" ? "No matching events" : "Nothing here yet"}</strong><p>{normalizedSearch || statusFilter !== "all" ? "Try a different search or status." : "Create a poll or election to get started."}</p></div>}
          <div className="event-list">
            {pagedElections.map((election) => (
              <article className="event-card" key={election.id}>
                <div className="event-card-heading">
                  <div><span className="event-type-label">FORMAL ELECTION</span><h3>{election.title}</h3><p>{election.description}</p></div>
                  <span className={`event-status event-status-${election.status}`}>{election.status}</span>
                </div>
                <div className="event-metrics"><span><strong>{election.eligibleCount}</strong> eligible</span><span><strong>{election.participationCount}</strong> participated</span><span><strong>{election.ballotCount}</strong> ballots</span></div>
                {election.status !== "draft" && <p className="admin-empty">Editing is locked because this election is {election.status}. Contestants and positions can only be changed while it is a draft.</p>}
                {election.status === "draft" && <button className="small-action" disabled={busy} onClick={() => setEditor({
                  kind: "election", id: election.id, title: election.title, description: election.description,
                })}>Edit election details</button>}
                {election.status === "draft" && <button className="small-action danger-action" onClick={() => {
                  setConfirmation({
                    message: `Permanently remove draft election “${election.title}”?`,
                    successText: "Draft election removed.",
                    action: async () => { await api(`/api/admin/events/${election.id}?type=election`, { method: "DELETE" }); },
                  });
                }}>Remove draft</button>}
                {election.positions.map((position) => (
                  <div className="position-admin" key={position.id}>
                    <div className="position-admin-heading"><strong>{position.title}</strong><div className="position-actions">
                    <button className="small-action" disabled={busy || election.status !== "draft"} onClick={() => setEditor({
                      kind: "position", eventId: election.id, positionId: position.id, title: position.title,
                      minSelections: position.min_selections, maxSelections: position.max_selections,
                    })}>Edit position and voting rules</button>
                    <button className="small-action" disabled={busy || election.status !== "draft"} onClick={() => setEditor({
                      kind: "candidate", eventId: election.id, positionId: position.id, name: "", grade: "", statement: "",
                    })}>Add contestant</button>
                    {position.candidates.length === 0 && <button className="small-action danger-action" disabled={busy || election.status !== "draft"} onClick={() => {
                      setConfirmation({
                        message: `Remove the ${position.title} position?`,
                        successText: "Position removed.",
                        action: async () => { await api(`/api/admin/events/${election.id}/positions?positionId=${position.id}`, { method: "DELETE" }); },
                      });
                    }}>Remove position</button>}
                    </div></div>
                    {position.candidates.length === 0 && <p className="admin-empty">No contestants added.</p>}
                    {position.candidates.map((candidate) => (
                      <div className="candidate-admin-row" key={candidate.id}>
                        {candidate.photoUrl && <Image src={candidate.photoUrl} width={34} height={34} alt="" unoptimized />}
                        <div><strong>{candidate.name}</strong><small>{candidate.grade} · {candidate.statement}</small></div>
                        <button className="small-action" disabled={busy || election.status !== "draft"} onClick={() => setEditor({
                          kind: "candidate", eventId: election.id, positionId: position.id, candidateId: candidate.id,
                          name: candidate.name, grade: candidate.grade, statement: candidate.statement,
                        })}>Edit</button>
                        <button className="small-action danger-action" disabled={busy || election.status !== "draft"} onClick={() => {
                          setConfirmation({
                            message: `Remove ${candidate.name}?`,
                            successText: "Contestant removed.",
                            action: async () => { await api(`/api/admin/events/${election.id}/contestants?candidateId=${candidate.id}`, { method: "DELETE" }); },
                          });
                        }}>Remove</button>
                      </div>
                    ))}
                  </div>
                ))}
                {election.status === "draft" && <button className="small-action add-position" disabled={busy} onClick={() => setEditor({ kind: "new-position", eventId: election.id })}>Add electoral position</button>}
                {election.status === "draft" && (
                  <div className="event-admin-actions">
                    <label className="file-import-label">Import voter eligibility CSV<input type="file" accept=".csv,text/csv" disabled={busy} onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      void runAction(async () => {
                        const form = new FormData(); form.set("file", file);
                        const response = await fetch(`/api/admin/events/${election.id}/eligibility`, { method: "POST", body: form });
                        if (!response.ok) {
                          const result = await response.json() as { message?: string };
                          throw new AdminApiError(result.message ?? "Eligibility import failed.", response.status);
                        }
                        const blob = await response.blob();
                        const url = URL.createObjectURL(blob);
                        const anchor = document.createElement("a"); anchor.href = url; anchor.download = `election-invitations-${election.id}.csv`; anchor.click(); URL.revokeObjectURL(url);
                        event.target.value = "";
                      }, "Eligibility loaded. Download the invitation file and distribute it securely.");
                    }} /></label>
                    <button className="small-action primary-small" disabled={busy} onClick={() => void runAction(async () => {
                      await api(`/api/admin/events/${election.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "election", status: "open" }) });
                    }, "Election opened.")}>Open election</button>
                    <button className="small-action danger-action" disabled={busy} onClick={() => void runAction(async () => {
                      await api(`/api/admin/events/${election.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "election", status: "cancelled" }) });
                    }, "Election cancelled.")}>Cancel</button>
                  </div>
                )}
                {election.status === "open" && <div className="event-admin-actions">
                  <button className="small-action danger-action" disabled={busy} onClick={() => void runAction(async () => {
                    await api(`/api/admin/events/${election.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "election", status: "closed" }) });
                  }, "Election closed.")}>Close election</button>
                  <button className="small-action danger-action" disabled={busy} onClick={() => {
                    setConfirmation({
                      message: `Cancel ${election.title}? Voting will stop immediately.`,
                      successText: "Election cancelled.",
                      action: async () => { await api(`/api/admin/events/${election.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "election", status: "cancelled" }) }); },
                    });
                  }}>Cancel election</button>
                </div>}
                {election.status === "closed" && <div className="event-admin-actions">
                  <button className="small-action" disabled={busy} onClick={() => void runAction(async () => {
                    const data = await api<Results>(`/api/admin/events/${election.id}/results?type=election`);
                    setResults({ id: election.id, type: "election", data });
                    setActiveView("results");
                  })}>View results</button>
                  <button className="small-action" disabled={busy} onClick={() => void runAction(async () => {
                    await api(`/api/admin/events/${election.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "election", resultsPublic: !election.results_public }) });
                  }, election.results_public ? "Results hidden." : "Results published.")}>{election.results_public ? "Hide results" : "Publish results"}</button>
                </div>}
              </article>
            ))}

            {pagedPolls.map((poll) => (
              <article className="event-card" key={poll.id}>
                <div className="event-card-heading">
                  <div><span className="event-type-label">PUBLIC POLL</span><h3>{poll.title}</h3><p>{poll.description}</p></div>
                  <span className={`event-status event-status-${poll.status}`}>{poll.status}</span>
                </div>
                <div className="poll-preview"><strong>{poll.questions[0]?.prompt}</strong><span>{poll.questions[0]?.options.map((option) => option.label).join(" · ")}</span></div>
                <div className="event-metrics"><span><strong>{poll.ballotCount}</strong> ballots</span><span><strong>{poll.session_duplicate_protection ? "On" : "Off"}</strong> session duplicate check</span><span><strong>{poll.rate_limit_per_minute}</strong> per IP/min</span><span><strong>{poll.bot_protection ? "On" : "Off"}</strong> bot protection</span></div>
                {poll.status === "draft" && <div className="event-admin-actions">
                  <button className="small-action" disabled={busy || !poll.questions[0]} onClick={() => {
                    const question = poll.questions[0];
                    if (!question) return;
                    setEditor({
                      kind: "poll-question", pollId: poll.id, questionId: question.id, prompt: question.prompt,
                      options: question.options.map((option) => option.label).join("\n"), maxSelections: question.max_selections,
                    });
                  }}>Edit question and options</button>
                  <button className="small-action" disabled={busy} onClick={() => setEditor({
                    kind: "poll", id: poll.id, title: poll.title, description: poll.description,
                  })}>Edit poll details</button>
                  <button className="small-action" disabled={busy} onClick={() => void runAction(async () => {
                    await api(`/api/admin/events/${poll.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "poll", sessionDuplicateProtection: !poll.session_duplicate_protection }) });
                  }, "Poll duplicate-protection setting updated.")}>{poll.session_duplicate_protection ? "Disable session protection" : "Enable session protection"}</button>
                  <button className="small-action" disabled={busy} onClick={() => void runAction(async () => {
                    const data = await api<{ url: string }>(`/api/admin/events/${poll.id}/link`, { method: "POST" });
                    setLink(data.url); setQr(await QRCode.toDataURL(data.url, { width: 220, margin: 2 }));
                    setActiveView("links");
                  }, "Voting link generated. Copy and share it securely.")}>Generate voting link</button>
                  <button className="small-action primary-small" disabled={busy} onClick={() => void runAction(async () => {
                    await api(`/api/admin/events/${poll.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "poll", status: "open" }) });
                  }, "Poll opened.")}>Open poll</button>
                  <button className="small-action danger-action" disabled={busy} onClick={() => void runAction(async () => {
                    await api(`/api/admin/events/${poll.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "poll", status: "cancelled" }) });
                  }, "Poll cancelled.")}>Cancel</button>
                </div>}
                {poll.status === "open" && <button className="small-action danger-action" disabled={busy} onClick={() => void runAction(async () => {
                  await api(`/api/admin/events/${poll.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "poll", status: "closed" }) });
                }, "Poll closed.")}>Close poll</button>}
                {poll.status === "open" &&                 <button className="small-action danger-action" disabled={busy} onClick={() => setConfirmation({
                  message: `Cancel ${poll.title}? Voting will stop immediately.`,
                  successText: "Poll cancelled.",
                  action: async () => { await api(`/api/admin/events/${poll.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "poll", status: "cancelled" }) }); },
                })}>Cancel poll</button>}
                {poll.status === "closed" && <div className="event-admin-actions">
                  <button className="small-action" disabled={busy} onClick={() => void runAction(async () => {
                    const data = await api<Results>(`/api/admin/events/${poll.id}/results?type=poll`);
                    setResults({ id: poll.id, type: "poll", data });
                    setActiveView("results");
                  })}>View results</button>
                  <button className="small-action" disabled={busy} onClick={() => void runAction(async () => {
                    await api(`/api/admin/events/${poll.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "poll", resultsPublic: !poll.results_public }) });
                  }, poll.results_public ? "Results hidden." : "Results published.")}>{poll.results_public ? "Hide results" : "Publish results"}</button>
                </div>}
              </article>
            ))}
          </div>
          {eventPageCount > 1 && <nav className="admin-pagination" aria-label="Event pages">
            <button type="button" className="small-action" disabled={currentEventPage === 1} onClick={() => setEventPage(currentEventPage - 1)}>Previous</button>
            <span>Page {currentEventPage} of {eventPageCount}</span>
            <button type="button" className="small-action" disabled={currentEventPage === eventPageCount} onClick={() => setEventPage(currentEventPage + 1)}>Next</button>
          </nav>}
        </section>}

        {link && activeView === "links" && <section className="admin-panel share-panel">
          <div><span className="public-overline">VOTING LINK</span><h2>Copy link</h2><p>Share only with intended voters.</p></div>
          <div className="share-content"><code>{link}</code><button className="small-action primary-small" onClick={() => void navigator.clipboard.writeText(link).then(() => setNotice({ kind: "success", text: "Voting link copied." })).catch(() => setNotice({ kind: "error", text: "Could not copy the link. Select and copy it instead." }))}>Copy link</button><button className="small-action" onClick={() => { const anchor = document.createElement("a"); anchor.href = qr; anchor.download = "qura-voting-link.png"; anchor.click(); }}>Download QR</button>{qr && <Image src={qr} alt="QR code for the generated voting link" width={160} height={160} unoptimized />}</div>
          <button className="text-button" onClick={() => { setLink(""); setQr(""); }}>Dismiss link</button>
        </section>}

        {results && (activeView === "results" || activeView === "reports") && <section className="admin-panel admin-results-panel" id="results-panel">
          <div className="admin-panel-heading"><div><span className="public-overline">RESULTS</span><h2>{results.data.event.title}</h2></div><button className="quiet-button" onClick={() => setResults(null)}>Close</button></div>
          <div className="admin-result-summary">
            <div><span>Ballots</span><strong>{results.data.ballots}</strong></div>
            <div><span>Participants</span><strong>{results.data.participation}</strong></div>
            <div><span>Selections counted</span><strong>{results.data.results.reduce((total, row) => total + row.count, 0)}</strong></div>
          </div>
          <div className="results-list">{resultGroups.map((group) => (
            <section className="admin-result-group" key={group.title}>
              <h3 className="admin-result-group-title">{group.title}</h3>
              <div className="admin-results-table-wrap">
                <table className="admin-results-table">
                  <caption className="visually-hidden">{group.title} results</caption>
                  <thead><tr><th scope="col">Rank</th><th scope="col">Candidate / option</th><th scope="col">Votes</th><th scope="col">Share</th></tr></thead>
                  <tbody>{group.items.map((row, index) => {
                    const percentage = group.total ? Math.round((row.count / group.total) * 100) : 0;
                    return <tr key={row.label}>
                      <td>{index + 1}</td>
                      <th scope="row">{row.label}</th>
                      <td>{row.count}</td>
                      <td><span>{percentage}%</span><div className="admin-result-track" role="img" aria-label={`${percentage}%`}><span style={{ width: `${percentage}%` }} /></div></td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
            </section>
          ))}</div>
          <div className="admin-results-actions">
            <button className="small-action" type="button" onClick={() => window.print()}>Print report</button>
            <button className="small-action primary-small" disabled={busy} onClick={() => void runAction(async () => {
            const response = await fetch(`/api/admin/events/${results.id}/results?type=${results.type}&format=csv`, { cache: "no-store" });
            if (!response.ok) {
              const result = await response.json() as { message?: string };
              throw new Error(result.message ?? "Could not export results.");
            }
            const url = URL.createObjectURL(await response.blob());
            const anchor = document.createElement("a"); anchor.href = url; anchor.download = `qura-results-${results.id}.csv`; anchor.click();
            URL.revokeObjectURL(url);
            }, "Results exported and added to the audit log.")}>Export CSV</button>
          </div>
        </section>}

        {activeView === "settings" && <section className="admin-panel admin-settings-panel">
          <div className="admin-panel-heading"><div><span className="public-overline">ACCOUNT</span><h2>Administrator access</h2></div></div>
          <div className="admin-settings-row"><span className="admin-account-avatar" aria-hidden="true">{admin.email.slice(0, 1).toUpperCase()}</span><div><strong>{admin.email}</strong><p>Only this administrator account can access the management workspace.</p></div></div>
          <div className="admin-security-note"><span className="secure-dot" /><span>Protected session · Automatically expires after 8 hours · Voter accounts are not used</span></div>
          <button className="small-action danger-action" disabled={busy} onClick={logout}>Sign out</button>
        </section>}

        {(activeView === "dashboard" || activeView === "activity") && <section className="admin-panel audit-panel" id="audit-log">
          <div className="admin-panel-heading">
            <div><span className="public-overline">ACTIVITY</span><h2>{activeView === "dashboard" ? "Recent activity" : "Administrator audit log"}</h2></div>
            {activeView === "dashboard" && dashboard?.audit.length ? <button className="quiet-button" type="button" onClick={() => navigate("activity")}>View all</button> : null}
          </div>
          {!visibleAudit?.length ? <div className="admin-empty-state"><span className="admin-empty-symbol" aria-hidden="true">A</span><strong>No activity recorded</strong><p>Administrator actions will appear here.</p></div> :
            <div className="audit-list">{visibleAudit.map((entry) => <div className="audit-row" key={entry.id}><span>{entry.action.replaceAll(".", " ")}</span><time>{new Date(entry.created_at).toLocaleString()}</time></div>)}</div>}
        </section>}
        </section>
      </div>
    </main>
  );
}
