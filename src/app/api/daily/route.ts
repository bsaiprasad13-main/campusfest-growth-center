import { body, handle } from "@/lib/api";
import { upsertDaily, type DailyInput } from "@/lib/mutations";
import { getDataset } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const campaignId = new URL(req.url).searchParams.get("campaign_id");
  return handle(async () => {
    const ds = await getDataset();
    return ds.campaign_daily
      .filter((r) => !campaignId || r.campaign_id === campaignId)
      .sort((a, b) => b.activity_date.localeCompare(a.activity_date) || a.activity_id.localeCompare(b.activity_id));
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const b = await body<DailyInput>(req);
    return upsertDaily({ ...b, activity_id: undefined });
  });
}
