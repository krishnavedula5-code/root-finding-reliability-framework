import React from "react";
import BackendStatusBadge from "./BackendStatusBadge";

export default function BackendWarmupPanel({
  backendStatus,
  statusMessage,
  isPreparingRun,
  onWake,
  disabled = false,
}) {
  return (
    <>
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
          marginTop: 16,
          marginBottom: 12,
        }}
      >
        <BackendStatusBadge status={backendStatus} />

        <button
          type="button"
          onClick={onWake}
          disabled={disabled || isPreparingRun}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #d1d5db",
            background: "#ffffff",
            color: "#374151",
            fontSize: 14,
            fontWeight: 700,
            cursor: disabled || isPreparingRun ? "not-allowed" : "pointer",
            opacity: disabled || isPreparingRun ? 0.7 : 1,
          }}
        >
          {isPreparingRun ? "Waking..." : "Wake Compute Engine"}
        </button>
      </div>

      {statusMessage && (
        <div
          style={{
            marginBottom: 12,
            fontSize: 14,
            color: "#374151",
            background: "#f8fafc",
            border: "1px solid #e5e7eb",
            borderRadius: 10,
            padding: "10px 12px",
          }}
        >
          {statusMessage}
        </div>
      )}
    </>
  );
}