import { body, handle } from "@/lib/api";
import { createTask, type TaskInput } from "@/lib/mutations";
import { getApp } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => (await getApp()).tasks);
}

export async function POST(req: Request) {
  return handle(async () => {
    const b = await body<TaskInput & { created_by?: "user" | "copilot" }>(req);
    return createTask(b, b.created_by === "copilot" ? "copilot" : "user");
  });
}
