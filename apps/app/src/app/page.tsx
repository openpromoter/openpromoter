import { redirect } from "next/navigation";
import { currentUser } from "@/server/context";

export default async function Home() {
  redirect((await currentUser()) ? "/app" : "/login");
}
