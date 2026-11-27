import { body, handle } from "@/lib/api";
import { updateCampaign, type CampaignPatch } from "@/lib/mutations";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(async () => updateCampaign(id, await body<CampaignPatch>(req)));
}
