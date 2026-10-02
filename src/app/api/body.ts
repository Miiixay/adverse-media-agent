export type JsonBody =
  { ok: true; value: unknown } | { ok: false; status: 400 | 413; message: string };

// Reads the body as a stream and stops at maxBytes, so that a client cannot make the server buffer
// an arbitrary payload, with or without a Content-Length header.
export async function readJsonBody(request: Request, maxBytes: number): Promise<JsonBody> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return tooLarge(maxBytes);
  if (request.body === null) return { ok: false, status: 400, message: "the request has no body" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return tooLarge(maxBytes);
    }
    chunks.push(value);
  }

  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { ok: false, status: 400, message: "the body is not valid JSON" };
  }
}

function tooLarge(maxBytes: number): JsonBody {
  return { ok: false, status: 413, message: `the body exceeds ${maxBytes} bytes` };
}
