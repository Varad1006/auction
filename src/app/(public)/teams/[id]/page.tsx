import { TeamDetailPage } from "@/components/pages/TeamsPage";

export const metadata = { title: "Team" };

export default async function Team({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TeamDetailPage teamId={id} />;
}
