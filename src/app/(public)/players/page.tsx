import { Suspense } from "react";
import { PlayersPage } from "@/components/pages/PlayersPage";

export const metadata = { title: "Players" };

export default function Players() {
  return (
    <Suspense>
      <PlayersPage />
    </Suspense>
  );
}
