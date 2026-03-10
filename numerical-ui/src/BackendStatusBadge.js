import React from "react";

const STATUS_META = {
  active: {
    label: "Active",
    color: "#166534",
    bg: "#dcfce7",
    dot: "#22c55e",
  },
  waking_up: {
    label: "Waking up",
    color: "#92400e",
    bg: "#fef3c7",
    dot: "#f59e0b",
  },
  offline: {
    label: "Offline",
    color: "#991b1b",
    bg: "#fee2e2",
    dot: "#ef4444",
  },
};

export default function BackendStatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.offline;

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        borderRadius: 999,
        background: meta.bg,
        color: meta.color,
        fontWeight: 700,
        fontSize: 14,
      }}
    >
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: meta.dot,
          display: "inline-block",
        }}
      />
      Compute Engine: {meta.label}
    </div>
  );
}