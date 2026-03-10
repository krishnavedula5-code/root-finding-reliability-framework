import { API } from "./api";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pingBackend() {
  try {
    const res = await fetch(`${API}/health`, {
      method: "GET",
      cache: "no-store",
    });

    if (!res.ok) {
      return { state: "offline" };
    }

    return { state: "active" };
  } catch (err) {
    return { state: "offline" };
  }
}

export async function waitForBackendReady({
  maxAttempts = 20,
  intervalMs = 3000,
  onProgress = null,
} = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (onProgress) {
      onProgress({
        attempt,
        maxAttempts,
        state: "waking_up",
      });
    }

    try {
      const res = await fetch(`${API}/health`, {
        method: "GET",
        cache: "no-store",
      });

      if (res.ok) {
        if (onProgress) {
          onProgress({
            attempt,
            maxAttempts,
            state: "active",
          });
        }
        return true;
      }
    } catch (err) {
      // retry
    }

    await sleep(intervalMs);
  }

  throw new Error(
    "Backend is not ready yet. Render may still be waking up. Please try again."
  );
}