const token = () => localStorage.getItem("greenRoomToken") || "";

export async function apiJson(path, body, options = {}) {
  const response = await fetch(path, {
    method: options.method || "POST",
    headers: {
      Authorization: `Bearer ${token()}`,
      ...(body == null ? {} : { "Content-Type": "application/json" }),
      ...options.headers,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Something went wrong");
  return result;
}

export async function transcribeAudio(blob, durationSec) {
  const response = await fetch(`/api/speech-map/transcribe?durationSec=${Math.ceil(durationSec)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": blob.type || "audio/webm" },
    body: blob,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Transcription failed");
  return result.text;
}
