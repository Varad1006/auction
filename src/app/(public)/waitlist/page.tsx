import { Suspense } from "react";
import { WaitlistPage } from "@/components/pages/WaitlistPage";

export const metadata = { title: "Waitlist" };

export default function Waitlist() {
  return (
    <Suspense>
      <WaitlistPage />
    </Suspense>
  );
}
