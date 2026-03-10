// src/RunViewer.js
import React, { useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import DiagnosticsLegend from "./DiagnosticsLegend";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
} from "chart.js";

import BadgePills from "./BadgePills";
import { computeBadges } from "./diagnosticsBadges";
import { computeHint } from "./diagnosticsHints";
import EventTimeline from "./EventTimeline";

ChartJS.register(
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend
);

// In dev (localhost:3000), CRA proxy forwards /runs/:id -> http://localhost:8000
// In prod (served by FastAPI), same-origin also works.
const API_URL = "";

const METHOD_META = {
  newton: { label: "Newton Method", subtitle: "Quadratic Convergence" },
  secant: { label: "Secant Method", subtitle: "Superlinear Convergence" },
  bisection: { label: "Bisection Method", subtitle: "Linear but Guaranteed" },
  hybrid: { label: "Hybrid Method", subtitle: "Robust + Fast" },
};

const DEFAULT_RECORDS_LIMIT = 20;
const DEFAULT_EVENTS_LIMIT = 50;

/* -------------------- Existing utilities -------------------- */

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

// Subtitle override logic to avoid misleading "Quadratic/Superlinear" labels
function methodSubtitle(methodKey, summary, badges) {
  const s = summary || {};
  const b = Array.isArray(badges) ? badges : [];
  const iters = Number.isFinite(Number(s.iterations)) ? Number(s.iterations) : null;
  const conv = String(s.convergence_class || "").toLowerCase();

  if (b.includes("Exact Root")) return "Exact root hit";
  if (iters != null && iters < 3) return "Insufficient data";
  if (conv === "insufficient_data") return "Insufficient data";

  return METHOD_META?.[methodKey]?.subtitle || "";
}

function pickBestMethod(results) {
  if (!results) return null;

  const ignore = new Set(["request", "_meta"]);
  const keys = Object.keys(results).filter(
    (k) => !ignore.has(k) && typeof results[k] === "object" && results[k] !== null
  );

  const candidates = keys
    .map((k) => {
      const s = results[k]?.summary || {};
      return {
        key: k,
        status: s.status,
        iterations: safeNum(s.iterations),
        residual: safeNum(s.last_residual),
        stop_reason: s.stop_reason,
      };
    })
    .filter((m) => m.status === "converged");

  if (candidates.length === 0) return null;

  // Deterministic tie-break:
  // 1) EXACT_ROOT
  // 2) fewer iterations
  // 3) smaller residual
  // 4) method key
  candidates.sort((a, b) => {
    const ae = String(a.stop_reason || "").toUpperCase() === "EXACT_ROOT" ? 0 : 1;
    const be = String(b.stop_reason || "").toUpperCase() === "EXACT_ROOT" ? 0 : 1;
    if (ae !== be) return ae - be;

    const ai = a.iterations ?? Infinity;
    const bi = b.iterations ?? Infinity;
    if (ai !== bi) return ai - bi;

    const ar = a.residual ?? Infinity;
    const br = b.residual ?? Infinity;
    if (ar !== br) return ar - br;

    return String(a.key).localeCompare(String(b.key));
  });

  return candidates[0].key;
}

async function copyText(text, successMsg) {
  try {
    await navigator.clipboard.writeText(text);
    alert(successMsg);
  } catch {
    window.prompt("Copy to clipboard (Ctrl/Cmd+C, Enter):", text);
  }
}

function fmtMaybe(num, kind) {
  if (num == null || !Number.isFinite(Number(num))) return "";
  const n = Number(num);
  if (kind === "exp3") return n.toExponential(3);
  if (kind === "prec12") return n.toPrecision(12);
  return String(n);
}

export default function RunViewer() {
  const { runId } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [data, setData] = useState(null);

  const [openPanels, setOpenPanels] = useState({});
  const [showAllRecords, setShowAllRecords] = useState({});
  const [showAllEvents, setShowAllEvents] = useState({});

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setErr("");
      try {
        const res = await fetch(`${API_URL}/runs/${runId}`);
        if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
        const json = await res.json();
        if (alive) setData(json);
      } catch (e) {
        if (alive) setErr(e.message || String(e));
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [runId]);

  const meta = data?._meta || null;
  const req = data?.request || null;

  const domainMathHint = useMemo(() => {
    if (!req || !data) return null;

    const expr = String(req.expr || "");
    const a = Number(req.a);
    const b = Number(req.b);

    const bracketInvalidForLog = expr.includes("log(") && (a <= 0 || b <= 0);
    if (!bracketInvalidForLog) return null;

    const failedBracketMethod = ["bisection", "hybrid"].some((m) => {
      const s = data[m]?.summary;
      if (!s) return false;
      if (s.status !== "nan_or_inf") return false;

      const events = data[m]?.trace?.events || [];
      return events.some(
        (e) =>
          e?.code === "DOMAIN_ERROR" ||
          e?.code === "NONFINITE" ||
          e?.kind === "domain_error" ||
          e?.kind === "nonfinite"
      );
    });

    if (!failedBracketMethod) return null;
    return "log(x) undefined for x ≤ 0 → bracket violates function domain.";
  }, [req, data]);

  const bestMethod = useMemo(() => pickBestMethod(data), [data]);

  const methods = useMemo(() => {
    if (!data) return [];
    const ignore = new Set(["request", "_meta"]);
    return Object.keys(data)
      .filter(
        (k) => !ignore.has(k) && typeof data[k] === "object" && data[k] !== null
      )
      .sort((a, b) => {
        if (a === bestMethod) return -1;
        if (b === bestMethod) return 1;
        return a.localeCompare(b);
      });
  }, [data, bestMethod]);

  const bracketFailureHint = useMemo(() => {
    if (!data) return null;

    const check = (methodKey) => {
      const block = data[methodKey];
      if (!block?.summary) return false;
      if (block.summary.status !== "nan_or_inf") return false;

      const events = block?.trace?.events || [];
      return events.some(
        (e) =>
          e?.code === "DOMAIN_ERROR" ||
          e?.code === "NONFINITE" ||
          e?.kind === "domain_error" ||
          e?.kind === "nonfinite"
      );
    };

    if (check("bisection") || check("hybrid")) {
      return "Bisection/Hybrid require finite endpoint evaluations; bracket may violate function domain.";
    }

    return null;
  }, [data]);

  useEffect(() => {
    if (!data) return;

    const initPanels = {};
    const initShowRecords = {};
    const initShowEvents = {};

    methods.forEach((m) => {
      initPanels[m] = m === bestMethod;
      initShowRecords[m] = false;
      initShowEvents[m] = false;
    });

    setOpenPanels(initPanels);
    setShowAllRecords(initShowRecords);
    setShowAllEvents(initShowEvents);
  }, [data, methods, bestMethod]);

  function openAsNewExperiment() {
    if (!req) return;

    const params = new URLSearchParams();
    Object.entries(req).forEach(([k, v]) => {
      if (v !== null && v !== undefined) params.set(k, String(v));
    });

    navigate(`/?${params.toString()}`);
  }

  function setAllPanels(open) {
    const next = {};
    methods.forEach((m) => {
      next[m] = open;
    });
    setOpenPanels(next);
  }

  function openBestOnly() {
    const next = {};
    methods.forEach((m) => {
      next[m] = m === bestMethod;
    });
    setOpenPanels(next);
  }

  async function copyShareUrl() {
    await copyText(window.location.href, "Copied share URL.");
  }

  async function copyRequestJson() {
    if (!req) return;
    await copyText(JSON.stringify(req, null, 2), "Copied request JSON.");
  }

  async function copyDebugBundle() {
    if (!data) return;
    await copyText(JSON.stringify(data, null, 2), "Copied debug bundle JSON.");
  }

  if (loading) return <div style={{ padding: 20 }}>Loading run…</div>;
  if (err)
    return (
      <div style={{ padding: 20, color: "crimson", whiteSpace: "pre-wrap" }}>
        {err}
      </div>
    );
  if (!data) return <div style={{ padding: 20 }}>No data.</div>;

  return (
    <div
      style={{
        fontFamily: "system-ui, Arial",
        padding: 20,
        maxWidth: 1100,
        margin: "0 auto",
      }}
    >
      <div
        style={{
          marginBottom: 16,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: "1px solid #ddd",
          paddingBottom: 10,
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link to="/" style={{ fontWeight: 700 }}>
            Home
          </Link>

          <Link to="/experiments" style={{ fontWeight: 700 }}>
            Experiments
          </Link>

          <Link to="/experiment-jobs" style={{ fontWeight: 700 }}>
            Experiment Jobs
          </Link>
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
          <button
            onClick={openAsNewExperiment}
            disabled={!req}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #222",
              background: "white",
              cursor: req ? "pointer" : "not-allowed",
              fontWeight: 700,
            }}
          >
            Open as New Experiment
          </button>

          <button
            onClick={copyShareUrl}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #222",
              background: "white",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            Copy Share URL
          </button>

          <button
            onClick={copyDebugBundle}
            disabled={!data}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #222",
              background: "white",
              cursor: data ? "pointer" : "not-allowed",
              fontWeight: 700,
            }}
          >
            Copy Debug Bundle
          </button>

          <button
            onClick={copyRequestJson}
            disabled={!req}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #222",
              background: "white",
              cursor: req ? "pointer" : "not-allowed",
              fontWeight: 700,
            }}
          >
            Copy JSON
          </button>
        </div>
      </div>

      <h1 style={{ marginBottom: 6 }}>Shared Run</h1>

      <div style={{ color: "#555", marginBottom: 16 }}>
        Run ID: <strong>{meta?.run_id || runId}</strong>
        {meta?.created_at ? <span> • {meta.created_at}</span> : null}
      </div>

      {req && (
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            padding: 14,
            marginBottom: 16,
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Problem</div>

          <div
            style={{
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              fontSize: 13,
            }}
          >
            f(x) = {req.expr}
            <br />
            {req.numerical_derivative
              ? "f'(x) = (numerical)"
              : `f'(x) = ${req.dexpr || "(none)"}`}
            <br />
            bracket = [{req.a}, {req.b}] • secant guesses = ({req.x0}, {req.x1})
            <br />
            tol = {req.tol} • max_iter = {req.max_iter}
            {domainMathHint && (
              <div
                style={{
                  marginTop: 6,
                  fontSize: 12,
                  color: "#b26a00",
                  fontWeight: 600,
                }}
              >
                Warning: {domainMathHint}
              </div>
            )}
            {bracketFailureHint && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 12,
                  color: "#b26a00",
                  fontWeight: 600,
                }}
              >
                Warning: {bracketFailureHint}
              </div>
            )}
          </div>
        </div>
      )}

      <h2>Results</h2>

      <div
        style={{
          overflowX: "auto",
          border: "1px solid #ddd",
          borderRadius: 10,
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#fafafa" }}>
              <th
                style={{
                  textAlign: "left",
                  padding: 10,
                  borderBottom: "1px solid #ddd",
                }}
              >
                Method
              </th>
              <th
                style={{
                  textAlign: "left",
                  padding: 10,
                  borderBottom: "1px solid #ddd",
                }}
              >
                Status
              </th>
              <th
                style={{
                  textAlign: "right",
                  padding: 10,
                  borderBottom: "1px solid #ddd",
                }}
              >
                Iters
              </th>
              <th
                style={{
                  textAlign: "right",
                  padding: 10,
                  borderBottom: "1px solid #ddd",
                }}
              >
                Root
              </th>
              <th
                style={{
                  textAlign: "right",
                  padding: 10,
                  borderBottom: "1px solid #ddd",
                }}
              >
                Last |f(x)|
              </th>
            </tr>
          </thead>

          <tbody>
            {methods.map((m) => {
              const block = data[m] || {};
              const s = block.summary || {};
              const events = block?.trace?.events || [];
              const isBest = m === bestMethod;

              const badges = computeBadges(s, events);
              const subtitle = methodSubtitle(m, s, badges);
              const hint = computeHint(m, s, events);

              return (
                <tr
                  key={m}
                  style={{
                    background: isBest ? "#fff8e6" : "white",
                    borderLeft: isBest
                      ? "4px solid #111"
                      : "4px solid transparent",
                  }}
                >
                  <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 10 }}
                    >
                      <div>
                        <div style={{ fontWeight: 800 }}>
                          {METHOD_META[m]?.label || m}
                        </div>
                        <div style={{ color: "#666", fontSize: 12 }}>
                          {subtitle}
                        </div>
                        {hint ? (
                          <div
                            style={{
                              color: "#555",
                              fontSize: 12,
                              marginTop: 4,
                            }}
                          >
                            {hint}
                          </div>
                        ) : null}
                      </div>

                      {isBest && (
                        <span
                          style={{
                            marginLeft: "auto",
                            fontSize: 12,
                            fontWeight: 800,
                            border: "1px solid #111",
                            borderRadius: 999,
                            padding: "4px 10px",
                            background: "white",
                          }}
                        >
                          ★ Best
                        </span>
                      )}
                    </div>
                  </td>

                  <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>
                    <BadgePills badges={badges} max={99} />
                  </td>

                  <td
                    style={{
                      padding: 10,
                      borderBottom: "1px solid #eee",
                      textAlign: "right",
                    }}
                  >
                    {s.iterations ?? ""}
                  </td>

                  <td
                    style={{
                      padding: 10,
                      borderBottom: "1px solid #eee",
                      textAlign: "right",
                    }}
                  >
                    {s.root == null ? "" : fmtMaybe(s.root, "prec12")}
                  </td>

                  <td
                    style={{
                      padding: 10,
                      borderBottom: "1px solid #eee",
                      textAlign: "right",
                    }}
                  >
                    {s.last_residual == null
                      ? ""
                      : fmtMaybe(s.last_residual, "exp3")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          onClick={() => setAllPanels(true)}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid #222",
            background: "white",
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          Expand all
        </button>
        <button
          onClick={() => setAllPanels(false)}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid #222",
            background: "white",
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          Collapse all
        </button>
        <button
          onClick={openBestOnly}
          disabled={!bestMethod}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid #222",
            background: "white",
            cursor: bestMethod ? "pointer" : "not-allowed",
            fontWeight: 700,
          }}
        >
          Best only
        </button>
      </div>

      <DiagnosticsLegend />

      <h2 style={{ marginTop: 18 }}>Explanations & Trace</h2>

      {methods.map((m) => {
        const block = data[m] || {};
        const trace = block.trace || {};
        const records = trace.records || [];
        const events = trace.events || [];

        const isBest = m === bestMethod;
        const isOpen = !!openPanels[m];
        const meta2 = METHOD_META[m];

        const showAllR = !!showAllRecords[m];
        const showAllE = !!showAllEvents[m];

        const recordsToShow = showAllR
          ? records
          : records.slice(0, DEFAULT_RECORDS_LIMIT);
        const eventsToShow = showAllE
          ? events
          : events.slice(0, DEFAULT_EVENTS_LIMIT);

        const badges = computeBadges(block.summary || {}, events);
        const subtitle = methodSubtitle(m, block.summary || {}, badges);
        const hint = computeHint(m, block.summary || {}, events);

        return (
          <div
            key={m}
            style={{
              border: "1px solid #ddd",
              borderRadius: 10,
              padding: 14,
              marginTop: 10,
              background: isBest ? "#fffdf5" : "white",
            }}
          >
            <div
              onClick={() =>
                setOpenPanels((prev) => ({ ...prev, [m]: !prev[m] }))
              }
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                cursor: "pointer",
                userSelect: "none",
                marginBottom: 8,
              }}
              title="Click to expand/collapse"
            >
              <div style={{ fontWeight: 900 }}>
                {meta2?.label || m}
                {subtitle ? (
                  <span
                    style={{
                      marginLeft: 10,
                      fontWeight: 600,
                      color: "#666",
                      fontSize: 12,
                    }}
                  >
                    {subtitle}
                  </span>
                ) : null}

                {hint ? (
                  <div
                    style={{
                      marginTop: 4,
                      color: "#555",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {hint}
                  </div>
                ) : null}

                <BadgePills badges={badges} max={99} />
              </div>

              {isBest && (
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 900,
                    border: "1px solid #111",
                    borderRadius: 999,
                    padding: "4px 10px",
                    background: "#fff",
                  }}
                >
                  ★ Best
                </span>
              )}

              <span
                style={{
                  marginLeft: "auto",
                  fontFamily: "ui-monospace, monospace",
                  color: "#444",
                }}
              >
                {isOpen ? "▼" : "▶"}
              </span>
            </div>

            {!isOpen ? (
              <div style={{ color: "#666", fontSize: 13 }}>
                Collapsed (click to view explanation, plot, and events)
              </div>
            ) : (
              <>
                <div
                  style={{
                    whiteSpace: "pre-wrap",
                    color: "#222",
                    marginBottom: 12,
                  }}
                >
                  {block.explanation || ""}
                </div>

                <div style={{ marginTop: 10, marginBottom: 14 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>Residual vs Iteration</div>
                    {records.length > DEFAULT_RECORDS_LIMIT && (
                      <button
                        onClick={() =>
                          setShowAllRecords((prev) => ({
                            ...prev,
                            [m]: !prev[m],
                          }))
                        }
                        style={{
                          marginLeft: "auto",
                          padding: "6px 10px",
                          borderRadius: 10,
                          border: "1px solid #222",
                          background: "white",
                          cursor: "pointer",
                          fontWeight: 700,
                          fontSize: 12,
                        }}
                        title={showAllR ? "Show fewer iterations" : "Show all iterations"}
                      >
                        {showAllR
                          ? `Show first ${DEFAULT_RECORDS_LIMIT}`
                          : `Show all (${records.length})`}
                      </button>
                    )}
                  </div>

                  {records.length === 0 ? (
                    <div style={{ color: "#666" }}>No records available to plot.</div>
                  ) : (
                    <div
                      style={{
                        border: "1px solid #eee",
                        borderRadius: 10,
                        padding: 10,
                      }}
                    >
                      <Line
                        data={{
                          labels: recordsToShow.map((r) => r.k),
                          datasets: [
                            {
                              label: "|f(x)|",
                              data: recordsToShow.map((r) =>
                                r.residual == null ? null : r.residual
                              ),
                              tension: 0.2,
                            },
                          ],
                        }}
                        options={{
                          responsive: true,
                          plugins: {
                            legend: { display: true },
                            tooltip: { enabled: true },
                          },
                          scales: {
                            x: { title: { display: true, text: "Iteration k" } },
                            y: {
                              title: {
                                display: true,
                                text: "Residual |f(x)|",
                              },
                              beginAtZero: false,
                            },
                          },
                        }}
                      />
                    </div>
                  )}
                </div>

                <div style={{ marginTop: 12 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>Event Timeline</div>
                    {events.length > DEFAULT_EVENTS_LIMIT && (
                      <button
                        onClick={() =>
                          setShowAllEvents((prev) => ({
                            ...prev,
                            [m]: !prev[m],
                          }))
                        }
                        style={{
                          marginLeft: "auto",
                          padding: "6px 10px",
                          borderRadius: 10,
                          border: "1px solid #222",
                          background: "white",
                          cursor: "pointer",
                          fontWeight: 700,
                          fontSize: 12,
                        }}
                      >
                        {showAllE
                          ? `Show first ${DEFAULT_EVENTS_LIMIT}`
                          : `Show all (${events.length})`}
                      </button>
                    )}
                  </div>

                  <EventTimeline events={eventsToShow} />
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}