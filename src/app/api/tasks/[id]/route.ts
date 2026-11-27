import { body, handle } from "@/lib/api";
import { deleteTask, updateTask, type TaskInput } from "@/lib/mutations";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(async () => updateTask(id, await body<TaskInput>(req)));
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(async () => deleteTask(id));
}
