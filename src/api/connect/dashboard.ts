import { timestampDate } from "@bufbuild/protobuf/wkt";
import { connectClients, connectUnary } from "@/api/connect/client";
import type { DashboardTrafficBucket } from "@/utils/dashboard";

const byteCount = (value: bigint) => {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) ? numeric : Number.MAX_SAFE_INTEGER;
};

const trafficBucketLabel = (date: Date) => {
  const part = (value: number) => String(value).padStart(2, "0");
  return `${part(date.getMonth() + 1)}-${part(date.getDate())} ${part(date.getHours())}:${part(date.getMinutes())}`;
};

export async function requestTrafficTrend(signal: AbortSignal): Promise<DashboardTrafficBucket[]> {
  const response = await connectUnary({ signal }, (requestSignal, timeoutMs) =>
    connectClients.browser.getTrafficTrend({}, { signal: requestSignal, timeoutMs }),
  );
  return response.buckets.map((bucket) => {
    const startTime = bucket.startTime ? timestampDate(bucket.startTime) : null;
    return {
      hour: startTime ? trafficBucketLabel(startTime) : "-",
      timestamp: startTime?.getTime() ?? 0,
      up: byteCount(bucket.uploadBytes),
      down: byteCount(bucket.downloadBytes),
    };
  });
}
