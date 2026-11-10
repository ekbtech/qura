import { notFound } from "next/navigation";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ElectionAccessView } from "@/components/election-access-view";
import { getPlatformSettings } from "@/lib/platform-settings";
import { createAdminSupabase } from "@/lib/supabase/admin";

type Props = { params: Promise<{ id: string }> };

export default function ElectionAccessPage({ params }: Props) {
  return (
    <Suspense fallback={<main className="public-shell"><div className="public-card"><p>Loading election…</p></div></main>}>
      <ElectionAccessContent params={params} />
    </Suspense>
  );
}

async function ElectionAccessContent({ params }: Props) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) notFound();

  await connection();
  const supabase = createAdminSupabase();
  const platformSettings = await getPlatformSettings();
  const { data: election, error } = await supabase.from("elections")
    .select("id, title, description, status")
    .eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not load election: ${error.message}`);
  if (!election) notFound();

  return (
    <main className="public-shell">
      <header className="public-header">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">Q</span>
          <span>{platformSettings.schoolName}<span className="brand-light"> Vote</span></span>
        </Link>
        <span className="secure-label"><span className="secure-dot" /> Secure election access</span>
      </header>
      <div className="public-content">
        <section className="public-event-header">
          <span className="public-overline">FORMAL ELECTION</span>
          <h1>{election.title}</h1>
          {election.description && <p>{election.description}</p>}
        </section>
        {election.status === "open"
          ? <ElectionAccessView
            electionId={election.id}
            verificationEnabled={platformSettings.emailVerificationEnabled}
          />
          : <section className="public-card public-empty">
            <h2>{election.status === "draft" ? "Voting is not open yet" : "Voting is closed"}</h2>
            <p>{election.status === "draft"
              ? "Return when the administrator opens this election."
              : "This election is not accepting votes."}</p>
          </section>}
      </div>
      <footer className="public-footer">
        {platformSettings.schoolName} · Secure school elections
        {platformSettings.contactEmail && <> · <a href={`mailto:${platformSettings.contactEmail}`}>Contact administrator</a></>}
      </footer>
    </main>
  );
}
