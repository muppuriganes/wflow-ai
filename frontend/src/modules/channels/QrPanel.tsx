import { useQuery } from "@tanstack/react-query";
import { Loader2, ScanLine } from "lucide-react";
import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/states";
import { channelsApi } from "@/services/channels";
import { orgKeys, useCurrentOrg } from "@/stores/organization";
import type { Connection } from "@/types/api";

/** Shows the live QR code while the session waits for a scan. WhatsApp rotates it about every 20s. */
export function QrPanel({ connection }: { connection: Connection }) {
  const org = useCurrentOrg();
  const waiting = connection.status === "QR_PENDING";
  const qr = useQuery({
    queryKey: orgKeys.scoped(org.id, "connection-qr", connection.id),
    queryFn: () => channelsApi.qr(org.id, connection.id),
    enabled: waiting,
    refetchInterval: waiting ? 3000 : false,
    gcTime: 0, // never keep a QR code around after leaving the page
  });
  const hasCode = Boolean(qr.data?.qr_data_url);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!waiting || hasCode) return;
    const timer = setTimeout(() => setSlow(true), 30_000);
    return () => clearTimeout(timer);
  }, [waiting, hasCode]);

  if (connection.status === "INITIALIZING" || connection.status === "RECONNECTING") {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <Spinner label={connection.channel_type === "whatsapp_web" ? "Starting WhatsApp Web (this can take ~20 seconds)" : "Starting"} />
      </div>
    );
  }
  if (connection.status === "AUTHENTICATING") {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <Loader2 className="size-6 animate-spin text-primary" aria-hidden />
        <p className="font-medium">Scanned — linking your device…</p>
      </div>
    );
  }
  if (!waiting) return null;

  return (
    <div className="flex flex-col items-center gap-5 py-6 sm:flex-row sm:items-start sm:justify-center sm:gap-10">
      <div className="flex size-[232px] shrink-0 items-center justify-center rounded-lg border bg-white p-2">
        {qr.data?.qr_data_url ? (
          <img src={qr.data.qr_data_url} alt="WhatsApp link QR code" className="size-full" />
        ) : slow ? (
          // ~30s without a code: the messaging service is probably not running this session.
          <p className="px-4 text-center text-xs text-muted">
            The QR code is taking longer than usual. Cancel and connect again; if it keeps happening, the messaging
            service may be offline.
          </p>
        ) : (
          <Spinner label="Generating QR code" />
        )}
      </div>
      <ol className="max-w-xs space-y-2.5 text-[13px]">
        <li className="flex gap-2">
          <ScanLine className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <span className="font-medium">Link this number</span>
        </li>
        <li>1. Open WhatsApp on the phone for this number.</li>
        <li>
          2. Tap <strong>Settings</strong> (iPhone) or the <strong>⋮ menu</strong> (Android), then <strong>Linked devices</strong>.
        </li>
        <li>
          3. Tap <strong>Link a device</strong> and point the phone at this code.
        </li>
        <li className="text-xs text-muted">The code refreshes automatically. Keep this page open until it says Connected.</li>
      </ol>
    </div>
  );
}
