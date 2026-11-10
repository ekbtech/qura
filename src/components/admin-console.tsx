"use client";

import Image from "next/image";
import QRCode from "qrcode";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { DEFAULT_PLATFORM_SETTINGS, type PlatformSettings } from "@/lib/platform-settings.types";

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
type Voter = { id: string; email: string | null; is_active: boolean; created_at: string };
type VoterPage = { election: { id: string; title: string }; voters: Voter[]; total: number; page: number; pageSize: number };
type Notice = { kind: "success" | "error"; text: string };
type Results = { event: { title: string; status: string; resultsPublic: boolean }; ballots: number; participation: number; results: { label: string; count: number; category?: string }[] };
type AdminView = "dashboard" | "polls" | "elections" | "contestants" | "voters" | "links" | "results" | "reports" | "settings" | "activity";
type Editor =
  | { kind: "election"; id: string; title: string; description: string }
  | { kind: "position"; eventId: string; positionId: string; title: string; minSelections: number; maxSelections: number }
  | { kind: "new-position"; eventId: string }
  | { kind: "candidate"; eventId: string; positionId: string; candidateId?: string; name: string; grade: string; statement: string }
  | { kind: "poll"; id: string; title: string; description: string }
  | { kind: "poll-question"; pollId: string; questionId: string; prompt: string; options: string; maxSelections: number };
type Confirmation = { message: string; successText: string; action: () => Promise<void>; error?: string };

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
  { id: "voters", label: "Voters" },
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
    voters: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-1a6 6 0 0 1 12 0v1m2-10h4m-2-2v4" /></>,
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
  voters: { title: "Voters", subtitle: "Review eligible voters and add them to draft elections." },
  links: { title: "Voting links", subtitle: "Prepare and distribute voter access links." },
  results: { title: "Results", subtitle: "Review results from closed voting events." },
  reports: { title: "Reports", subtitle: "Review and export closed-event results." },
  settings: { title: "Settings", subtitle: "Administrator account and access." },
  activity: { title: "Audit log", subtitle: "Recent administrator actions." },
};

const defaultOpen = (timeZone: string) => {
  const date = new Date();
  date.setHours(date.getHours() + 1, 0, 0, 0);
  return dateTimeInZone(date, timeZone);
};
const defaultClose = (timeZone: string, durationHours: number) => {
  const date = new Date();
  date.setHours(date.getHours() + 1 + durationHours, 0, 0, 0);
  return dateTimeInZone(date, timeZone);
};
function dateTimeInZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
function instantFromZonedDateTime(value: string, timeZone: string): string {
  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let timestamp = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(timestamp));
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value);
    const displayed = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"));
    timestamp += target - displayed;
  }
  return new Date(timestamp).toISOString();
}
function formatDateTime(value: string, settings: PlatformSettings): string {
  return new Intl.DateTimeFormat(settings.language === "sw" ? "sw-KE" : "en-KE", {
    dateStyle: "medium", timeStyle: "short", timeZone: settings.timeZone,
  }).format(new Date(value));
}

const navigationLabels: Record<PlatformSettings["language"], Partial<Record<AdminView, string>>> = {
  en: {},
  sw: {
    dashboard: "Dashibodi", polls: "Kura za maoni", elections: "Chaguzi", contestants: "Wagombea",
    voters: "Wapiga kura", links: "Viungo vya kupiga kura", results: "Matokeo", reports: "Ripoti",
    settings: "Mipangilio", activity: "Kumbukumbu ya ukaguzi",
  },
};
const supportedTimeZones = [
  "Africa/Nairobi", "Africa/Dar_es_Salaam", "Africa/Kampala", "Africa/Lagos",
  "UTC", "Europe/London", "Europe/Paris", "Asia/Kolkata", "Asia/Dubai",
  "America/New_York", "America/Los_Angeles",
];

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
  const [showPassword, setShowPassword] = useState(false);
  const [eventType, setEventType] = useState<"poll" | "election">("election");
  const [link, setLink] = useState("");
  const [qr, setQr] = useState("");
  const [electionShare, setElectionShare] = useState<{ id: string; url: string } | null>(null);
  const [results, setResults] = useState<{ id: string; type: string; data: Results } | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [activeView, setActiveView] = useState<AdminView>("dashboard");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [eventPage, setEventPage] = useState(1);
  const [settings, setSettings] = useState<PlatformSettings>(DEFAULT_PLATFORM_SETTINGS);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(null);
  const [selectedElectionId, setSelectedElectionId] = useState("");
  const [voterPageNumber, setVoterPageNumber] = useState(1);
  const [voterData, setVoterData] = useState<VoterPage | null>(null);
  const [votersLoading, setVotersLoading] = useState(false);
  const [voterSearch, setVoterSearch] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const elections = dashboard?.elections ?? [];
  const activeElectionId = elections.some((election) => election.id === selectedElectionId)
    ? selectedElectionId
    : (elections.find((election) => election.status === "draft") ?? elections[0])?.id ?? "";

  const showActionError = useCallback((error: unknown, fallback: string) => {
    if (error instanceof AdminApiError && error.status === 401) {
      setAdmin(null);
      setDashboard(null);
      setEditor(null);
      setConfirmation(null);
      setNotice({ kind: "error", text: "Your administrator session expired. Sign in again to continue." });
      return;
    }
    setNotice({ kind: "error", text: error instanceof Error ? error.message : fallback });
  }, []);

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

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true);
    setSettingsLoadError(null);
    try {
      const result = await api<{ settings: PlatformSettings }>("/api/admin/settings");
      setSettings(result.settings);
    } catch (error) {
      setSettingsLoadError(error instanceof Error ? error.message : "Could not load platform settings.");
      throw error;
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  const loadVoters = useCallback(async () => {
    if (!activeElectionId) {
      setVoterData(null);
      return;
    }
    setVotersLoading(true);
    try {
      const result = await api<VoterPage>(`/api/admin/events/${activeElectionId}/eligibility?page=${voterPageNumber}`);
      setVoterData(result);
    } finally {
      setVotersLoading(false);
    }
  }, [activeElectionId, voterPageNumber]);

  useEffect(() => {
    api<{ admin: Admin | null }>("/api/admin/session", { signal: AbortSignal.timeout(15000) })
      .then(({ admin: activeAdmin }) => {
        setAdmin(activeAdmin);
        if (activeAdmin) {
          void loadDashboard().catch(() => {});
          void loadSettings().catch((error: unknown) => setNotice({
            kind: "error", text: error instanceof Error ? error.message : "Could not load platform settings.",
          }));
        }
      })
      .catch((error: unknown) => setNotice({
        kind: "error",
        text: error instanceof Error && error.name === "TimeoutError"
          ? "Administrator session check timed out. Please sign in or refresh the page."
          : error instanceof Error ? error.message : "Could not check administrator session.",
      }));
  }, [loadDashboard, loadSettings]);

  useEffect(() => {
    if (activeView !== "voters" || !admin || !activeElectionId) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setVotersLoading(true);
      void api<VoterPage>(`/api/admin/events/${activeElectionId}/eligibility?page=${voterPageNumber}`)
        .then((result) => {
          if (active) setVoterData(result);
        })
        .catch((error: unknown) => {
          if (active) showActionError(error, "Could not load voters.");
        })
        .finally(() => {
          if (active) setVotersLoading(false);
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [activeView, activeElectionId, admin, voterPageNumber, showActionError]);

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
      await Promise.all([loadDashboard(), loadSettings()]);
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

  async function copyElectionLink(electionId: string) {
    const url = new URL(`/election/${electionId}`, window.location.origin).toString();
    setElectionShare({ id: electionId, url });
    try {
      await navigator.clipboard.writeText(url);
      setNotice({ kind: "success", text: settings.emailVerificationEnabled
        ? "Shared election link copied. Voters will verify with their registration number and email code."
        : "Shared election link copied. Eligible voters can continue with their registration number." });
    } catch {
      window.prompt("Copy this shared election link for voters:", url);
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

  async function confirmAction() {
    if (!confirmation) return;
    const selected = confirmation;
    setBusy(true);
    setNotice(null);
    setConfirmation({ ...selected, error: undefined });
    try {
      await selected.action();
    } catch (error) {
      if (error instanceof AdminApiError && error.status === 401) {
        showActionError(error, "Action failed.");
      } else {
        const message = error instanceof Error ? error.message : "Action failed.";
        setConfirmation({ ...selected, error: message });
      }
      setBusy(false);
      return;
    }

    setConfirmation(null);
    try {
      await loadDashboard();
      setNotice({ kind: "success", text: selected.successText });
    } catch (error) {
      showActionError(error, "Action succeeded, but the dashboard could not be refreshed.");
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
            method: "POST", headers: jsonHeaders,
            body: JSON.stringify({
              title: values.title,
              minSelections: Number(values.minSelections),
              maxSelections: Number(values.maxSelections),
            }),
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
      (activeView === "contestants" && election.positions.length > 0) ||
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
  const viewTitle = navigationLabels[settings.language][activeView] ?? viewCopy[activeView].title;
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

  useEffect(() => {
    if (!editor) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById("admin-editor")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editor]);

  function navigate(view: AdminView) {
    setActiveView(view);
    setSearchQuery("");
    setVoterSearch("");
    setStatusFilter("all");
    setEventPage(1);
    setVoterPageNumber(1);
    if (view === "polls") setEventType("poll");
    if (view === "elections") setEventType("election");
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function addVoter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeElectionId) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setNotice(null);
    try {
      await api(`/api/admin/events/${activeElectionId}/eligibility`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registrationNumber: form.get("registrationNumber"),
          email: form.get("email"),
        }),
      });
      formElement.reset();
      await Promise.all([loadDashboard(), loadVoters()]);
      setNotice({ kind: "success", text: "Eligible voter added." });
    } catch (error) {
      showActionError(error, "Could not add eligible voter.");
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const result = await api<{ settings: PlatformSettings; warning?: string }>("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      setSettings(result.settings);
      setSettingsLoadError(null);
      setNotice({ kind: "success", text: result.warning ?? "Settings saved. Session timeout changes apply at your next sign-in." });
    } catch (error) {
      showActionError(error, "Could not save settings.");
    } finally {
      setBusy(false);
    }
  }

  async function changeAdminPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword !== confirmNewPassword) {
      setNotice({ kind: "error", text: "The new passwords do not match." });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await api("/api/admin/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setNotice({ kind: "success", text: "Password changed. Sign in again with your new password." });
      await logout();
    } catch (error) {
      showActionError(error, "Could not change the administrator password.");
    } finally {
      setBusy(false);
    }
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
              <div className="admin-password-field">
                <input
                  id="admin-password"
                  className="text-input"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  aria-describedby="admin-credential-help"
                  placeholder="Enter your password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  className="admin-password-toggle"
                  type="button"
                  aria-controls="admin-password"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
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
    <main className="admin-workspace" data-theme={settings.theme} lang={settings.language}>
      {sidebarOpen && <button className="admin-sidebar-backdrop" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
      <aside className={`admin-sidebar${sidebarOpen ? " admin-sidebar-open" : ""}`}>
        <Link className="brand admin-workspace-brand" href="/">
          <span className="brand-mark" aria-hidden="true">Q</span>
          <span>{settings.schoolName}<span className="brand-light"> Admin</span></span>
        </Link>
        <span className="admin-nav-caption">WORKSPACE</span>
        <nav className="admin-nav" aria-label="Administrator navigation">
          {adminNavigation.map((item) => {
            const count = item.id === "polls" ? dashboard?.polls.length
              : item.id === "elections" ? dashboard?.elections.length
                : item.id === "contestants"
                  ? dashboard?.elections.reduce((total, election) => total + election.positions.reduce((subtotal, position) => subtotal + position.candidates.length, 0), 0)
                  : item.id === "voters" ? eligibleCount
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
                <span>{navigationLabels[settings.language][item.id] ?? item.label}</span>
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
          <div className="admin-breadcrumb"><span>{settings.schoolName}</span><span aria-hidden="true">/</span><strong>{viewTitle}</strong></div>
          <div className="admin-topbar-right">
            <span className="admin-topbar-email">{admin.email}</span>
            <button className="quiet-button" disabled={busy} onClick={logout}>Sign out</button>
          </div>
        </header>
        <section className="admin-dashboard">
        <div className="admin-welcome">
          <div><span className="public-overline">ADMIN WORKSPACE</span><h1>{viewTitle}</h1><p>{viewCopy[activeView].subtitle}</p></div>
          <div className="admin-welcome-actions">
            <span className="admin-secure-pill"><span className="secure-dot" /> Secure session</span>
            {(activeView === "dashboard" || activeView === "polls" || activeView === "elections") &&
              <button className="admin-new-event-button" type="button" onClick={() => document.getElementById("create-event")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                <span aria-hidden="true">+</span> New {eventType}
              </button>}
          </div>
        </div>
        {notice?.kind === "success" && <p className="notice notice-success" role="status">{notice.text}</p>}
        {notice?.kind === "error" && <div className="admin-confirmation-overlay">
          <section className="admin-error-dialog" role="alertdialog" aria-modal="true" aria-labelledby="admin-error-title" aria-describedby="admin-error-message">
            <h2 id="admin-error-title">Action could not be completed</h2>
            <p id="admin-error-message" role="alert">{notice.text}</p>
            <button className="small-action" type="button" onClick={() => setNotice(null)}>Close</button>
          </section>
        </div>}
        {confirmation && <div className="admin-confirmation-overlay">
          <section className="admin-confirmation" id="admin-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="admin-confirmation-message">
            <p id="admin-confirmation-message">{confirmation.message}</p>
            {confirmation.error && <p className="notice notice-error admin-confirmation-error" role="alert">{confirmation.error}</p>}
            <button className="small-action danger-action" type="button" disabled={busy} onClick={() => void confirmAction()}>Confirm</button>
            <button className="small-action" type="button" disabled={busy} onClick={() => setConfirmation(null)}>Keep</button>
          </section>
        </div>}

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
              <button className="admin-metric-action" type="button" onClick={() => navigate("voters")}>View voter list <span aria-hidden="true">→</span></button>
            </article>
            <article className="admin-metric">
              <span>Contestants</span>
              <span className="admin-metric-icon metric-icon-orange" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" /></svg></span>
              <strong>{candidateCount}</strong>
              <small>Across all formal elections</small>
            </article>
          </section>
        )}

        {activeView === "voters" && <section className="admin-panel admin-voters-panel">
          <div className="admin-panel-heading">
            <div><span className="public-overline">ELIGIBILITY</span><h2>Voter directory</h2><p>Select an election to review and add eligible voters.</p></div>
            <button className="quiet-button" type="button" disabled={votersLoading || !activeElectionId} onClick={() => void loadVoters().catch((error: unknown) => showActionError(error, "Could not load voters."))}>Refresh voters</button>
          </div>
          {!dashboard && dashboardLoading
            ? <p>Loading elections…</p>
            : !dashboard && dashboardError
              ? <div className="admin-empty-state"><strong>Could not load elections</strong><p>{dashboardError}</p><button className="small-action" type="button" onClick={() => void loadDashboard().catch(() => {})}>Retry</button></div>
              : !dashboard?.elections.length
            ? <div className="admin-empty-state"><strong>No elections yet</strong><p>Create an election first, then add its eligible voters here.</p><button className="small-action primary-small" type="button" onClick={() => navigate("elections")}>Go to elections</button></div>
            : <>
              <label className="admin-election-picker">Election
                <select value={activeElectionId} onChange={(event) => {
                  setSelectedElectionId(event.target.value);
                  setVoterPageNumber(1);
                  setVoterData(null);
                }}>
                  {dashboard.elections.map((election) => <option key={election.id} value={election.id}>{election.title} · {election.status}</option>)}
                </select>
              </label>
              {(() => {
                const selectedElection = dashboard.elections.find((election) => election.id === activeElectionId);
                const showingData = voterData?.election.id === activeElectionId ? voterData : null;
                const filteredVoters = (showingData?.voters ?? []).filter((voter) =>
                  !voterSearch.trim() || (voter.email ?? "").toLowerCase().includes(voterSearch.trim().toLowerCase()));
                return <>
                  {selectedElection?.status === "draft" && <form className="eligibility-add-form voter-directory-add" onSubmit={(event) => void addVoter(event)}>
                    <label>School registration number<input name="registrationNumber" className="text-input" required minLength={2} maxLength={100} /></label>
                    <label>Registered email<input name="email" type="email" className="text-input" required maxLength={254} /></label>
                    <button className="small-action primary-small" disabled={busy || !activeElectionId}>Add voter</button>
                  </form>}
                  {selectedElection && selectedElection.status !== "draft" && <p className="admin-security-note">Voter eligibility is locked because this election is {selectedElection.status}.</p>}
                  <p className="voter-data-note">Registration numbers are protected with one-way hashes, so this directory shows email and status instead of registration numbers.</p>
                  <div className="admin-event-tools">
                    <label className="admin-search"><span className="admin-search-icon" aria-hidden="true" /><span className="visually-hidden">Search voters by email</span><input value={voterSearch} onChange={(event) => setVoterSearch(event.target.value)} placeholder="Search by email" /></label>
                    <span className="admin-result-count">{showingData?.total ?? 0} voters</span>
                  </div>
                  {votersLoading ? <p>Loading voters…</p>
                    : !showingData?.voters.length ? <div className="admin-empty-state"><strong>No voters added</strong><p>Add an eligible voter above or import a CSV from the draft election card.</p></div>
                      : <div className="admin-results-table-wrap voter-table-wrap">
                        <table className="admin-results-table voter-table">
                          <thead><tr><th scope="col">Registered email</th><th scope="col">Status</th><th scope="col">Date added</th></tr></thead>
                          <tbody>{filteredVoters.map((voter) => <tr key={voter.id}>
                            <td>{voter.email ?? "No email recorded"}</td>
                            <td><span className={`event-status event-status-${voter.is_active ? "open" : "cancelled"}`}>{voter.is_active ? "Eligible" : "Inactive"}</span></td>
                            <td>{formatDateTime(voter.created_at, settings)}</td>
                          </tr>)}</tbody>
                        </table>
                        {!filteredVoters.length && <p className="admin-empty">No voters match that email.</p>}
                      </div>}
                  {showingData && showingData.total > showingData.pageSize && <nav className="admin-pagination" aria-label="Voter pages">
                    <button type="button" className="small-action" disabled={votersLoading || voterPageNumber <= 1} onClick={() => setVoterPageNumber(voterPageNumber - 1)}>Previous</button>
                    <span>Page {voterPageNumber} of {Math.ceil(showingData.total / showingData.pageSize)}</span>
                    <button type="button" className="small-action" disabled={votersLoading || voterPageNumber >= Math.ceil(showingData.total / showingData.pageSize)} onClick={() => setVoterPageNumber(voterPageNumber + 1)}>Next</button>
                  </nav>}
                </>;
              })()}
            </>}
        </section>}

        {editor && <section className="admin-panel admin-editor" id="admin-editor">
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
                <label>Minimum candidate selections<input name="minSelections" type="number" className="text-input" min={0} max={10} required defaultValue={editor.kind === "position" ? editor.minSelections : 1} /></label>
                <label>Maximum candidate selections<input name="maxSelections" type="number" className="text-input" min={1} max={10} required defaultValue={editor.kind === "position" ? editor.maxSelections : 1} /></label>
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
          <form className="admin-create-form" key={JSON.stringify(settings)} onSubmit={(event) => {
            event.preventDefault();
            const formElement = event.currentTarget;
            const form = new FormData(formElement);
            const payload = {
              type: eventType,
              title: String(form.get("title") ?? ""),
              description: String(form.get("description") ?? ""),
              opensAt: instantFromZonedDateTime(String(form.get("opensAt")), settings.timeZone),
              closesAt: instantFromZonedDateTime(String(form.get("closesAt")), settings.timeZone),
              secretBallots: true,
              resultsPublic: settings.defaultResultsPublic,
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
              <label>Opens ({settings.timeZone})<input name="opensAt" className="text-input" type="datetime-local" required defaultValue={defaultOpen(settings.timeZone)} /></label>
              <label>Closes ({settings.timeZone})<input name="closesAt" className="text-input" type="datetime-local" required defaultValue={defaultClose(settings.timeZone, settings.defaultEventDurationHours)} /></label>
              {eventType === "poll" ? (
                <>
                  <label>Question<textarea name="prompt" className="text-input admin-textarea" required placeholder="What would you like to ask?" /></label>
                  <label>Options (one per line)<textarea name="options" className="text-input admin-textarea" required placeholder={"Option one\nOption two"} /></label>
                  <label>Maximum selections<input name="maxSelections" type="number" className="text-input" min={1} max={20} defaultValue={1} /></label>
                  <label className="admin-check"><input name="sessionDuplicateProtection" type="checkbox" defaultChecked={settings.defaultPollSessionProtection} /> Limit repeat votes per browser</label>
                  <label>Votes per IP / minute<input name="rateLimitPerMinute" type="number" className="text-input" min={1} max={120} defaultValue={settings.defaultPollRateLimit} /></label>
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

        {(activeView !== "settings" && activeView !== "activity" && activeView !== "voters") && <section className="admin-panel admin-events-panel" id="events">
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
                <p className="event-schedule">Opens {formatDateTime(election.opens_at, settings)} · Closes {formatDateTime(election.closes_at, settings)} ({settings.timeZone})</p>
                <div className="event-metrics"><span><strong>{election.eligibleCount}</strong> eligible</span><span><strong>{election.participationCount}</strong> participated</span><span><strong>{election.ballotCount}</strong> ballots</span></div>
                {election.status !== "draft" && <p className="admin-empty">Editing is locked because this election is {election.status}. Contestants and positions can only be changed while it is a draft.</p>}
                {election.status === "draft" && <div className="event-admin-actions">
                  <button className="small-action" disabled={busy} onClick={() => setEditor({
                    kind: "election", id: election.id, title: election.title, description: election.description,
                  })}>Edit election details</button>
                  <button className="small-action primary-small" type="button" onClick={() => {
                    document.getElementById(`eligible-voters-${election.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}>Add eligible voters</button>
                </div>}
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
                  <section className="eligibility-management" id={`eligible-voters-${election.id}`}>
                    <div className="eligibility-management-heading">
                      <div>
                        <span className="event-type-label">VOTER ELIGIBILITY</span>
                        <h4>Eligible voters</h4>
                        <p>Add voters individually or import a CSV before opening the election.</p>
                      </div>
                      <strong>{election.eligibleCount} added</strong>
                    </div>
                    <form className="eligibility-add-form" onSubmit={(event) => {
                      event.preventDefault();
                      const formElement = event.currentTarget;
                      const form = new FormData(formElement);
                      void runAction(async () => {
                        await api(`/api/admin/events/${election.id}/eligibility`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            registrationNumber: form.get("registrationNumber"),
                            email: form.get("email"),
                          }),
                        });
                        formElement.reset();
                      }, "Eligible voter added.");
                    }}>
                      <label>School registration number<input name="registrationNumber" className="text-input" required minLength={2} maxLength={100} /></label>
                      <label>Registered email<input name="email" type="email" className="text-input" required maxLength={254} /></label>
                      <button className="small-action primary-small" disabled={busy}>Add voter</button>
                    </form>
                    <div className="event-admin-actions">
                    <label className="file-import-label">Import voter eligibility CSV<input type="file" accept=".csv,text/csv" disabled={busy} onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      const input = event.currentTarget;
                      void runAction(async () => {
                        const form = new FormData(); form.set("file", file);
                        const response = await fetch(`/api/admin/events/${election.id}/eligibility`, { method: "POST", body: form });
                        if (!response.ok) {
                          const result = await response.json() as { message?: string };
                          throw new AdminApiError(result.message ?? "Eligibility import failed.", response.status);
                        }
                        const result = await response.json() as { imported: number };
                        input.value = "";
                        if (!result.imported) throw new Error("No eligible voters were imported.");
                      }, "Eligible voters imported.");
                    }} /></label>
                    <button className="small-action" disabled={busy} onClick={() => void copyElectionLink(election.id)}>Copy voter link</button>
                    <button className="small-action primary-small" disabled={busy} onClick={() => void runAction(async () => {
                      await api(`/api/admin/events/${election.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "election", status: "open" }) });
                    }, "Election opened.")}>Open election</button>
                    <button className="small-action danger-action" disabled={busy} onClick={() => void runAction(async () => {
                      await api(`/api/admin/events/${election.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "election", status: "cancelled" }) });
                    }, "Election cancelled.")}>Cancel</button>
                  </div>
                  </section>
                )}
                {election.status === "open" && <div className="event-admin-actions">
                  <button className="small-action primary-small" disabled={busy} onClick={() => void copyElectionLink(election.id)}>Copy voter link</button>
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
                {electionShare?.id === election.id && <p className="admin-shared-link"><span>Shared voter link</span><code>{electionShare.url}</code></p>}
              </article>
            ))}

            {pagedPolls.map((poll) => (
              <article className="event-card" key={poll.id}>
                <div className="event-card-heading">
                  <div><span className="event-type-label">PUBLIC POLL</span><h3>{poll.title}</h3><p>{poll.description}</p></div>
                  <span className={`event-status event-status-${poll.status}`}>{poll.status}</span>
                </div>
                <p className="event-schedule">Opens {formatDateTime(poll.opens_at, settings)} · Closes {formatDateTime(poll.closes_at, settings)} ({settings.timeZone})</p>
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

        {activeView === "settings" && <div className="admin-settings-stack">
          <section className="admin-panel admin-settings-panel">
            <div className="admin-panel-heading"><div><span className="public-overline">GENERAL</span><h2>School and display settings</h2><p>{settingsLoading ? "Loading saved settings…" : "These preferences are saved to the database and shared by the admin workspace."}</p></div></div>
            {settingsLoadError && <div className="notice notice-error" role="alert">
              <span>{settingsLoadError} Retry loading before saving so saved preferences are not overwritten.</span>
              <button className="small-action" type="button" disabled={settingsLoading} onClick={() => void loadSettings().catch(() => {})}>Retry settings</button>
            </div>}
            <form className="admin-create-form settings-form" onSubmit={(event) => void saveSettings(event)}>
              <div className="admin-form-grid">
                <label>School or organization name<input className="text-input" maxLength={120} required value={settings.schoolName} onChange={(event) => setSettings({ ...settings, schoolName: event.target.value })} /></label>
                <label>Contact email<input className="text-input" type="email" maxLength={254} value={settings.contactEmail} onChange={(event) => setSettings({ ...settings, contactEmail: event.target.value })} placeholder="Optional" /></label>
                <label>Timezone
                  <select className="text-input" value={settings.timeZone} onChange={(event) => setSettings({ ...settings, timeZone: event.target.value })}>
                    {!supportedTimeZones.includes(settings.timeZone) && <option value={settings.timeZone}>{settings.timeZone}</option>}
                    {supportedTimeZones.map((timeZone) => <option key={timeZone} value={timeZone}>{timeZone}</option>)}
                  </select>
                </label>
                <label>Language
                  <select className="text-input" value={settings.language} onChange={(event) => setSettings({ ...settings, language: event.target.value as PlatformSettings["language"] })}>
                    <option value="en">English</option><option value="sw">Kiswahili</option>
                  </select>
                </label>
                <label>Admin workspace theme
                  <select className="text-input" value={settings.theme} onChange={(event) => setSettings({ ...settings, theme: event.target.value as PlatformSettings["theme"] })}>
                    <option value="light">Light</option><option value="dark">Dark</option><option value="system">Use system preference</option>
                  </select>
                </label>
              </div>
              <p className="settings-help">Language currently applies to navigation labels and date formatting. Timezone is used for event date entry and display.</p>
              <div className="admin-panel-heading settings-subheading"><div><span className="public-overline">ELECTIONS AND POLLS</span><h2>Default behavior</h2></div></div>
              <div className="admin-form-grid">
                <label>Default event duration (hours)<input className="text-input" type="number" min={1} max={720} step={1} value={settings.defaultEventDurationHours} onChange={(event) => setSettings({ ...settings, defaultEventDurationHours: Number(event.target.value) })} /></label>
                <label>Poll votes per IP per minute<input className="text-input" type="number" min={1} max={120} step={1} value={settings.defaultPollRateLimit} onChange={(event) => setSettings({ ...settings, defaultPollRateLimit: Number(event.target.value) })} /></label>
                <label className="admin-check"><input type="checkbox" checked={settings.defaultPollSessionProtection} onChange={(event) => setSettings({ ...settings, defaultPollSessionProtection: event.target.checked })} /> Enable browser-session duplicate protection by default</label>
                <label className="admin-check"><input type="checkbox" checked={settings.defaultResultsPublic} onChange={(event) => setSettings({ ...settings, defaultResultsPublic: event.target.checked })} /> Publish results to voters by default after closing</label>
                <label className="admin-check"><input type="checkbox" checked={settings.emailVerificationEnabled} onChange={(event) => setSettings({ ...settings, emailVerificationEnabled: event.target.checked })} /> Require email verification codes for election access</label>
              </div>
              <p className="settings-help">Email verification needs a working Resend configuration on the server. Keep this off to let eligible voters continue with their registration number only.</p>
              <div className="admin-panel-heading settings-subheading"><div><span className="public-overline">SECURITY</span><h2>Administrator session</h2></div></div>
              <div className="admin-form-grid">
                <label>Session timeout (hours)<input className="text-input" type="number" min={1} max={24} step={1} value={settings.sessionTimeoutHours} onChange={(event) => setSettings({ ...settings, sessionTimeoutHours: Number(event.target.value) })} /></label>
                <label>Administrator email<input className="text-input" value={admin.email} readOnly /></label>
              </div>
              <p className="settings-help">Session timeout changes apply the next time you sign in. Saving settings does not change the current session.</p>
              <button className="small-action primary-small" disabled={busy || settingsLoading || Boolean(settingsLoadError)}>Save settings</button>
            </form>
          </section>
          <section className="admin-panel admin-settings-panel">
            <div className="admin-panel-heading"><div><span className="public-overline">PASSWORD</span><h2>Change administrator password</h2></div></div>
            <form className="admin-form-grid settings-password-form" onSubmit={(event) => void changeAdminPassword(event)}>
              <label>Current password<input className="text-input" type="password" autoComplete="current-password" minLength={6} required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
              <label>New password (at least 6 characters)<input className="text-input" type="password" autoComplete="new-password" minLength={6} maxLength={256} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
              <label>Confirm new password<input className="text-input" type="password" autoComplete="new-password" minLength={6} maxLength={256} required value={confirmNewPassword} onChange={(event) => setConfirmNewPassword(event.target.value)} /></label>
              <button className="small-action primary-small" disabled={busy}>Change password and sign out</button>
            </form>
          </section>
          <section className="admin-panel admin-settings-panel">
            <div className="admin-panel-heading"><div><span className="public-overline">ACCOUNT</span><h2>Administrator access</h2></div></div>
            <div className="admin-settings-row"><span className="admin-account-avatar" aria-hidden="true">{admin.email.slice(0, 1).toUpperCase()}</span><div><strong>{admin.email}</strong><p>Only this administrator account can access the management workspace.</p></div></div>
            <div className="admin-security-note"><span className="secure-dot" /><span>Protected session · Automatically expires after {settings.sessionTimeoutHours} hours · Voter accounts are not used</span></div>
            <button className="small-action danger-action" disabled={busy} onClick={logout}>Sign out</button>
          </section>
        </div>}

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
