import { MAX_MEDIA_BYTES, type MediaFile } from "../adapters/types.js";

/** Hands inbound files to the backend, which validates and stores them. Returns the attachment id. */
export interface MediaUploader {
  upload(organizationId: string, connectionId: string, media: MediaFile): Promise<string>;
}

export class BackendMediaUploader implements MediaUploader {
  constructor(
    private readonly backendUrl: string,
    private readonly token: string,
  ) {}

  async upload(organizationId: string, connectionId: string, media: MediaFile): Promise<string> {
    const form = new FormData();
    form.set("organization_id", organizationId);
    form.set("connection_id", connectionId);
    form.set("file", new Blob([new Uint8Array(media.data)], { type: media.mimetype }), media.filename ?? defaultName(media.mimetype));
    const res = await fetch(`${this.backendUrl}/api/v1/internal/channels/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`media upload rejected (${res.status}): ${(await res.text()).slice(0, 200)}`);
    return ((await res.json()) as { attachment_id: string }).attachment_id;
  }
}

export class MemoryMediaUploader implements MediaUploader {
  readonly uploads: { organizationId: string; connectionId: string; media: MediaFile }[] = [];
  fail = false;
  async upload(organizationId: string, connectionId: string, media: MediaFile): Promise<string> {
    if (this.fail) throw new Error("upload failed");
    this.uploads.push({ organizationId, connectionId, media });
    return `00000000-0000-4000-8000-${String(this.uploads.length).padStart(12, "0")}`;
  }
}

/** Downloads an outbound file from the backend's short-lived signed URL, with a hard size cap. */
export async function fetchMedia(url: string, mimetype: string, filename: string): Promise<MediaFile> {
  if (!/^https?:\/\//i.test(url)) throw new Error("Unsupported media URL");
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`media download failed (${res.status})`);
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_MEDIA_BYTES) throw new Error("media too large");
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > MAX_MEDIA_BYTES) throw new Error("media too large");
  return { data, mimetype, filename };
}

function defaultName(mimetype: string): string {
  const ext: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "audio/ogg": "ogg", "audio/mpeg": "mp3",
    "video/mp4": "mp4", "application/pdf": "pdf",
  };  // prettier-ignore
  const base = mimetype.split(";")[0]?.trim() ?? "";
  return `file.${ext[base] ?? "bin"}`;
}
