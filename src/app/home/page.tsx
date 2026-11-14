import { redirect } from "next/navigation";
import { homePathFor, requirePageActor } from "@/server/auth/session";

export const dynamic = "force-dynamic";

/** Post-login landing: employees and team managers go to their workspace, HR to the console. */
export default async function HomePage() {
  const { actor } = await requirePageActor();
  redirect(homePathFor(actor));
}
