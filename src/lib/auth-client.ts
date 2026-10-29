"use client";

import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

// Same-origin client; the base URL is inferred from the current location.
export const authClient = createAuthClient({
  plugins: [twoFactorClient()],
});
