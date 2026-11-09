import { PublicBallotView } from "@/components/public-ballot-view";
import { getPublicBallot } from "@/lib/public-ballot";
import { cookies } from "next/headers";
import { ELECTION_VERIFICATION_COOKIE, isElectionInvitationVerified } from "@/lib/qura-security";
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
  const cookieStore = await cookies();
  const eligibleVerified = isElectionInvitationVerified(token, cookieStore.get(ELECTION_VERIFICATION_COOKIE)?.value);
  const ballot = await getPublicBallot(token, eligibleVerified);
  return <PublicBallotView token={token} ballot={ballot} />;
}
