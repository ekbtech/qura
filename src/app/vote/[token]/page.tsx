import { PublicBallotView } from "@/components/public-ballot-view";
import { getPublicBallot } from "@/lib/public-ballot";
import { Suspense } from "react";

type Props = { params: Promise<{ token: string }> };

export default function VotePage({ params }: Props) {
  return (
    <Suspense fallback={<main className="public-shell"><div className="public-card"><p>Loading voting link…</p></div></main>}>
      <Ballot params={params} />
    </Suspense>
  );
}

async function Ballot({ params }: Props) {
  const { token } = await params;
  const ballot = await getPublicBallot(token);
  return <PublicBallotView token={token} ballot={ballot} />;
}
