import { body, handle } from "@/lib/api";
import { createCampaign } from "@/lib/mutations";
import type { CampaignRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(async () =>
    createCampaign(await body<Partial<CampaignRow> & { campaign_name: string; channel: string; owner_id: string }>(req)),
  );
}
