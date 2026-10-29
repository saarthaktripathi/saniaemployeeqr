// Liveness: the process is up. Reveals no configuration or dependency details.
export const GET = () => Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
