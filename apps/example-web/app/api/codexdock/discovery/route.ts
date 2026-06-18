import { codexdock } from "@/lib/codexdock";

export function GET(request: Request) {
  const manifest = codexdock.discovery(request);
  const origin = new URL(request.url).origin;
  return Response.json(
    {
      ...manifest,
      endpoints: {
        ...manifest.endpoints,
        pairingExchange: new URL("/api/codexdock/pairing/exchange", origin).toString(),
      },
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
