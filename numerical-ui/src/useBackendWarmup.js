import { useCallback, useEffect, useState } from "react";
import { pingBackend, waitForBackendReady } from "./apiStatus";

export default function useBackendWarmup({
  autoPoll = true,
  pollIntervalMs = 25000,
} = {}) {
  const [backendStatus, setBackendStatus] = useState("offline");
  const [statusMessage, setStatusMessage] = useState("");
  const [isPreparingRun, setIsPreparingRun] = useState(false);

  const refreshStatus = useCallback(async () => {
    const res = await pingBackend();

    setBackendStatus((prev) => {
      if (prev === "waking_up") return prev;
      return res.state;
    });

    setStatusMessage((prev) => {
      if (prev && prev.startsWith("Waking up compute engine")) {
        return prev;
      }

      return res.state === "active"
        ? "Compute engine ready."
        : "Compute engine is currently offline or sleeping.";
    });
  }, []);

  useEffect(() => {
    let mounted = true;

    async function initialCheck() {
      const res = await pingBackend();
      if (!mounted) return;

      setBackendStatus(res.state);
      setStatusMessage(
        res.state === "active"
          ? "Compute engine ready."
          : "Compute engine is currently offline or sleeping."
      );
    }

    initialCheck();

    if (!autoPoll) {
      return () => {
        mounted = false;
      };
    }

    const intervalId = setInterval(() => {
      refreshStatus();
    }, pollIntervalMs);

    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
  }, [autoPoll, pollIntervalMs, refreshStatus]);

  const wakeBackendOnly = useCallback(async ({ onError } = {}) => {
    try {
      setIsPreparingRun(true);
      setBackendStatus("waking_up");
      setStatusMessage("Waking up compute engine...");

      await waitForBackendReady({
        maxAttempts: 20,
        intervalMs: 3000,
        onProgress: ({ attempt, maxAttempts, state }) => {
          setBackendStatus(state);
          setStatusMessage(
            `Waking up compute engine... (${attempt}/${maxAttempts})`
          );
        },
      });

      setBackendStatus("active");
      setStatusMessage("Compute engine is active and ready.");
      return true;
    } catch (err) {
      setBackendStatus("offline");
      setStatusMessage(err.message || "Backend unavailable.");
      if (onError) {
        onError(err);
      }
      throw err;
    } finally {
      setIsPreparingRun(false);
    }
  }, []);

  const runWithWarmup = useCallback(async (taskFn, { startMessage, doneMessage } = {}) => {
    try {
      setIsPreparingRun(true);
      setBackendStatus("waking_up");
      setStatusMessage("Waking up compute engine...");

      await waitForBackendReady({
        maxAttempts: 20,
        intervalMs: 3000,
        onProgress: ({ attempt, maxAttempts, state }) => {
          setBackendStatus(state);
          setStatusMessage(
            `Waking up compute engine... (${attempt}/${maxAttempts})`
          );
        },
      });

      setBackendStatus("active");
      setStatusMessage(startMessage || "Compute engine ready. Starting task...");

      const result = await taskFn();

      setBackendStatus("active");
      setStatusMessage(doneMessage || "Task completed.");
      return result;
    } catch (err) {
      setBackendStatus("offline");
      setStatusMessage(err.message || "Backend unavailable.");
      throw err;
    } finally {
      setIsPreparingRun(false);
    }
  }, []);

  return {
    backendStatus,
    statusMessage,
    isPreparingRun,
    setStatusMessage,
    setBackendStatus,
    refreshStatus,
    wakeBackendOnly,
    runWithWarmup,
  };
}