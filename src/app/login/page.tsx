import { redirect } from "next/navigation";

/** Authentication has been removed — this app has no login wall. */
export default function LoginPage() {
  redirect("/dashboard");
}
