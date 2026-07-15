import { redirect } from "next/navigation";

/** Authentication has been removed — the single organization bootstraps itself on first request. */
export default function OnboardingPage() {
  redirect("/dashboard");
}
