import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API } from "./api";
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
import DiagnosticsLegend from "./DiagnosticsLegend";
import EventTimeline from "./EventTimeline";
import useBackendWarmup from "./useBackendWarmup";
import BackendWarmupPanel from "./BackendWarmupPanel";

const BENCHMARKS = [
  {
    id: "P1",
    label: "P1: x^3 - 2x + 2",
    expr: "x**3 - 2*x + 2",
    dexpr: "3*x**2 - 2",
    a: -2,
    b: 0,
  },
  {
    id: "P2",
    label: "P2: x^3 - x - 2",
    expr: "x**3 - x - 2",
    dexpr: "3*x**2 - 1",
    a: 1,
    b: 2,
  },
  {
    id: "P3",
    label: "P3: cos(x) - x",
    expr: "cos(x) - x",
    dexpr: "-sin(x) - 1",
    a: 0,
    b: 1,
  },
  {
    id: "P4",
    label: "P4: (x-1)^2 (x+2)",
    expr: "((x-1)**2)*(x+2)",
    dexpr: "2*(x-1)*(x+2) + (x-1)**2",
    a: -3,
    b: 2,
  },
];

ChartJS.register(
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend
);

const API_URL = API;

const METHOD_META = {
  newton: { label: "Newton Method", subtitle: "Quadratic Convergence" },
  secant: { label: "Secant Method", subtitle: "Superlinear Convergence" },
  bisection: { label: "Bisection Method", subtitle: "Linear but Guaranteed" },
  hybrid: { label: "Hybrid Method", subtitle: "Robust + Fast" },
  safeguarded_newton: {
    label: "Safeguarded Newton",
    subtitle: "Bracketed Newton Stability",
  },
};

const DEFAULT_RECORDS_LIMIT = 20;
const DEFAULT_EVENTS_LIMIT = 50;

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function pickBestMethod(results) {
  if (!results) return null;

  const ignore = new Set(["request", "_meta", "_debug_signature"]);
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
      };
    })
    .filter((m) => m.status === "converged");

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const ai = a.iterations ?? Infinity;
    const bi = b.iterations ?? Infinity;
    if (ai !== bi) return ai - bi;

    const ar = a.residual ?? Infinity;
    const br = b.residual ?? Infinity;
    return ar - br;
  });

  return candidates[0].key;
}

function fmtMaybe(num, kind) {
  if (num == null || !Number.isFinite(Number(num))) return "";
  const n = Number(num);
  if (kind === "exp3") return n.toExponential(3);
  if (kind === "prec12") return n.toPrecision(12);
  return String(n);
}

function numOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export default function Home() {
  const navigate = useNavigate();

  const {
    backendStatus,
    statusMessage,
    isPreparingRun,
    wakeBackendOnly,
    runWithWarmup,
  } = useBackendWarmup({ autoPoll: true, pollIntervalMs: 25000 });

  const [selectedScenarioId, setSelectedScenarioId] = useState(null);
  const [benchmarkId, setBenchmarkId] = useState("");
  const [expr, setExpr] = useState("x**3 - x - 2");
  const [dexpr, setDexpr] = useState("3*x**2 - 1");
  const [numericalDerivative, setNumericalDerivative] = useState(false);

  const [a, setA] = useState(1);
  const [b, setB] = useState(2);

  const [x0, setX0] = useState("");
  const [x1, setX1] = useState("");

  const [tol, setTol] = useState(1e-10);
  const [maxIter, setMaxIter] = useState(100);

  const DEMO_SCENARIOS = [
    {
      id: "ideal_newton",
      title: "Ideal Newton (Quadratic)",
      subtitle: "Good x₀ → fast quadratic convergence",
      payload: {
        expr: "x**3 - 2*x + 2",
        dexpr: "3*x**2 - 2",
        numericalDerivative: false,
        a: -2,
        b: 0,
        x0: -1.5,
        x1: -1,
        tol: 1e-10,
        maxIter: 100,
      },
    },
    {
      id: "small_derivative",
      title: "Small Derivative (Basin Sensitivity)",
      subtitle: "x₀ near f'(x)=0 → huge Newton step; loses quadratic rate",
      payload: {
        expr: "x**3 - 2*x + 2",
        dexpr: "3*x**2 - 2",
        numericalDerivative: false,
        a: -2,
        b: 0,
        x0: 0.8,
        x1: -1,
        tol: 1e-10,
        maxIter: 100,
      },
    },
    {
      id: "exact_root_start",
      title: "Exact Root at Start",
      subtitle: "Immediate termination (already at a root)",
      payload: {
        expr: "x**3",
        dexpr: "3*x**2",
        numericalDerivative: false,
        a: -2,
        b: 0,
        x0: 0,
        x1: -1,
        tol: 1e-10,
        maxIter: 100,
      },
    },
    {
      id: "newton_failure_derivative_zero",
      title: "Newton Failure (Derivative Zero)",
      subtitle: "x₀ where f'(x₀)=0 but f(x₀)≠0 → Newton fails; bracket methods rescue",
      payload: {
        expr: "x**3 - 1",
        dexpr: "3*x**2",
        numericalDerivative: false,
        a: -2,
        b: 2,
        x0: 0,
        x1: -1,
        tol: 1e-10,
        maxIter: 100,
      },
    },
  ];

  function applyScenario(scn) {
    setSelectedScenarioId(scn.id);
    setBenchmarkId("");

    const p = scn.payload;

    setExpr(p.expr);
    setDexpr(p.dexpr);
    setNumericalDerivative(!!p.numericalDerivative);

    setA(p.a);
    setB(p.b);

    setX0(p.x0);
    setX1(p.x1);

    setTol(p.tol);
    setMaxIter(p.maxIter);

    setErr("");
    setData(null);

    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      window.scrollTo(0, 0);
    }
  }

  function handleBenchmarkChange(e) {
    const id = e.target.value;
    setBenchmarkId(id);
    setSelectedScenarioId(null);

    const selected = BENCHMARKS.find((bmk) => bmk.id === id);
    if (!selected) return;

    setExpr(selected.expr);
    setDexpr(selected.dexpr);
    setA(selected.a);
    setB(selected.b);

    setErr("");
    setData(null);
  }

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [data, setData] = useState(null);

  const [openPanels, setOpenPanels] = useState({});
  const [showAllRecords, setShowAllRecords] = useState({});
  const [showAllEvents, setShowAllEvents] = useState({});

  const bestMethod = useMemo(() => pickBestMethod(data), [data]);

  const methods = useMemo(() => {
    if (!data) return [];
    const ignore = new Set(["request", "_meta", "_debug_signature"]);
    return Object.keys(data)
      .filter((k) => !ignore.has(k) && typeof data[k] === "object" && data[k] !== null)
      .sort((aKey, bKey) => {
        if (aKey === bestMethod) return -1;
        if (bKey === bestMethod) return 1;
        return aKey.localeCompare(bKey);
      });
  }, [data, bestMethod]);

  const domainMathHint = useMemo(() => {
    if (!data) return null;

    const req = data?.request || { expr, a, b };
    const exprStr = String(req?.expr || "");
    const A = Number(req?.a);
    const B = Number(req?.b);

    const bracketInvalidForLog = exprStr.includes("log(") && (A <= 0 || B <= 0);
    if (!bracketInvalidForLog) return null;

    const failedBracketMethod = ["bisection", "hybrid"].some((m) => {
      const s = data?.[m]?.summary;
      if (!s || s.status !== "nan_or_inf") return false;

      const events = data?.[m]?.trace?.events || [];
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
  }, [data, expr, a, b]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("expr")) return;

    if (params.has("expr")) setExpr(params.get("expr") || "");
    if (params.has("dexpr")) setDexpr(params.get("dexpr") || "");

    if (params.has("a")) setA(Number(params.get("a")));
    if (params.has("b")) setB(Number(params.get("b")));
    if (params.has("x0")) setX0(params.get("x0") ?? "");
    if (params.has("x1")) setX1(params.get("x1") ?? "");

    if (params.has("tol")) setTol(Number(params.get("tol")));
    if (params.has("max_iter")) setMaxIter(Number(params.get("max_iter")));

    if (params.has("numerical_derivative")) {
      setNumericalDerivative(params.get("numerical_derivative") === "true");
    }
  }, []);

  useEffect(() => {
    if (!data) return;

    const ignore = new Set(["request", "_meta", "_debug_signature"]);
    const keys = Object.keys(data).filter(
      (k) => !ignore.has(k) && typeof data[k] === "object" && data[k] !== null
    );

    const initPanels = {};
    const initShowRecords = {};
    const initShowEvents = {};

    keys.forEach((k) => {
      initPanels[k] = k === bestMethod;
      initShowRecords[k] = false;
      initShowEvents[k] = false;
    });

    setOpenPanels(initPanels);
    setShowAllRecords(initShowRecords);
    setShowAllEvents(initShowEvents);
  }, [data, bestMethod]);

  function buildPayload() {
    return {
      expr,
      dexpr,
      a: Number(a),
      b: Number(b),
      x0: numOrNull(x0),
      x1: numOrNull(x1),
      tol: Number(tol),
      max_iter: Number(maxIter),
      numerical_derivative: numericalDerivative,
    };
  }

  async function runCompare() {
    setLoading(true);
    setErr("");
    setData(null);

    try {
      const payload = buildPayload();

      const json = await runWithWarmup(
        async () => {
          const res = await fetch(`${API_URL}/compare`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

          if (!res.ok) {
            const txt = await res.text();
            throw new Error(txt || `HTTP ${res.status}`);
          }

          return res.json();
        },
        {
          startMessage: "Compute engine ready. Running solver comparison...",
          doneMessage: "Comparison completed.",
        }
      );

      setData(json);
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function createShareRun() {
    setLoading(true);
    setErr("");

    try {
      const payload = buildPayload();

      const json = await runWithWarmup(
        async () => {
          const res = await fetch(`${API_URL}/runs`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

          if (!res.ok) {
            const txt = await res.text();
            throw new Error(txt || `HTTP ${res.status}`);
          }

          return res.json();
        },
        {
          startMessage: "Compute engine ready. Creating shareable run...",
          doneMessage: "Share link created.",
        }
      );

      navigate(json.url_path || `/run/${json.run_id}`);
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  const problemCard = data ? (
    <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 14, marginBottom: 16 }}>
      <div style={{ fontWeight: 800, marginBottom: 8 }}>Problem Definition</div>

      <div
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 13,
        }}
      >
        f(x) = {expr}
        <br />
        {numericalDerivative ? "f'(x) = (numerical)" : `f'(x) = ${dexpr || "(none)"}`}
        <br />
        bracket = [{a}, {b}] • guesses: x0={x0 === "" ? "(default)" : x0}, x1={x1 === "" ? "(default)" : x1}
        <br />
        tol = {tol} • max_iter = {maxIter}
      </div>

      {domainMathHint && (
        <div style={{ marginTop: 8, fontSize: 12, color: "#b26a00", fontWeight: 700 }}>
          Warning: {domainMathHint}
        </div>
      )}

      {bestMethod && (
        <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
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
            ★ Best: {METHOD_META[bestMethod]?.label || bestMethod}
          </span>
          <span style={{ color: "#666", fontSize: 12 }}>
            Heuristic: converged → fewest iterations → smallest residual
          </span>
        </div>
      )}
    </div>
  ) : null;

  return (
    <div style={{ fontFamily: "system-ui, Arial", padding: 20, maxWidth: 1100, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          gap: 14,
          marginBottom: 18,
          paddingBottom: 10,
          borderBottom: "1px solid #ddd",
          flexWrap: "wrap",
        }}
      >
 
      </div>

      <h1 style={{ marginBottom: 6 }}>Numerical Lab UI</h1>

      <div style={{ color: "#555", marginBottom: 16 }}>
        Teaching-oriented root finding (compare methods + explanations).
      </div>

      <BackendWarmupPanel
        backendStatus={backendStatus}
        statusMessage={statusMessage}
        isPreparingRun={isPreparingRun}
        onWake={() => wakeBackendOnly({ onError: (e) => setErr(e.message || String(e)) })}
        disabled={loading}
      />

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          padding: 14,
          marginBottom: 16,
          background: "#fafafa",
        }}
      >
        <div style={{ fontWeight: 900, marginBottom: 6 }}>Demo Scenarios</div>
        <div style={{ color: "#555", fontSize: 13, marginBottom: 12 }}>
          One-click presets for classroom-style demonstrations (fills the form).
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {DEMO_SCENARIOS.map((scn) => (
            <button
              key={scn.id}
              onClick={() => applyScenario(scn)}
              style={{
                textAlign: "left",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #222",
                background: "white",
                cursor: "pointer",
              }}
              title="Load this scenario into the form"
            >
              <div style={{ fontWeight: 900 }}>{scn.title}</div>
              <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>{scn.subtitle}</div>
            </button>
          ))}
        </div>

        {selectedScenarioId && (
          <div style={{ marginTop: 10, fontSize: 12, color: "#333" }}>
            Loaded: <b>{DEMO_SCENARIOS.find((s) => s.id === selectedScenarioId)?.title}</b>
          </div>
        )}

        <div style={{ marginTop: 10, color: "#666", fontSize: 12 }}>
          Tip: After loading a scenario, click <b>Compare Methods</b> or <b>Create Share Link</b>.
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 14 }}>
          <h3>Function</h3>

          <label>Benchmark Problem</label>
          <select
            value={benchmarkId}
            onChange={handleBenchmarkChange}
            style={{ width: "100%", padding: 8, marginTop: 6, marginBottom: 12 }}
            disabled={loading || isPreparingRun}
          >
            <option value="">Select a benchmark...</option>
            {BENCHMARKS.map((bmk) => (
              <option key={bmk.id} value={bmk.id}>
                {bmk.label}
              </option>
            ))}
          </select>

          <label>f(x)</label>
          <input
            value={expr}
            onChange={(e) => setExpr(e.target.value)}
            style={{ width: "100%", padding: 8, marginTop: 6, marginBottom: 12 }}
            disabled={loading || isPreparingRun}
          />

          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
            <input
              type="checkbox"
              checked={numericalDerivative}
              onChange={(e) => setNumericalDerivative(e.target.checked)}
              disabled={loading || isPreparingRun}
            />
            <span>Use numerical derivative</span>
          </div>

          <label>f'(x) (optional)</label>
          <input
            value={dexpr}
            onChange={(e) => setDexpr(e.target.value)}
            disabled={numericalDerivative === true || loading || isPreparingRun}
            placeholder={numericalDerivative ? "Using numerical derivative" : "e.g. 3*x^2 - 1"}
            style={{ width: "100%", padding: 8, marginTop: 6 }}
          />
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 14 }}>
          <h3>Settings</h3>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label>a</label>
              <input
                value={a}
                onChange={(e) => setA(e.target.value)}
                style={{ width: "100%", padding: 8, marginTop: 6 }}
                disabled={loading || isPreparingRun}
              />
            </div>
            <div>
              <label>b</label>
              <input
                value={b}
                onChange={(e) => setB(e.target.value)}
                style={{ width: "100%", padding: 8, marginTop: 6 }}
                disabled={loading || isPreparingRun}
              />
            </div>

            <div style={{ gridColumn: "1 / -1" }}>
              <div
                style={{
                  marginTop: 10,
                  padding: 12,
                  borderRadius: 12,
                  border: "1px dashed #ddd",
                  background: "#fcfcfc",
                }}
              >
                <div style={{ fontWeight: 800, fontSize: 12, color: "#333", marginBottom: 6 }}>
                  Optional guesses (advanced)
                </div>
                <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
                  Leave blank to use safe defaults (midpoint / bracket endpoint).
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 12, color: "#333" }}>x₀ (Newton / Secant)</label>
                    <input
                      value={x0}
                      onChange={(e) => setX0(e.target.value)}
                      placeholder="e.g. 0.0"
                      style={{ width: "100%", padding: 8, marginTop: 6 }}
                      disabled={loading || isPreparingRun}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 12, color: "#333" }}>x₁ (Secant)</label>
                    <input
                      value={x1}
                      onChange={(e) => setX1(e.target.value)}
                      placeholder="e.g. -1.0"
                      style={{ width: "100%", padding: 8, marginTop: 6 }}
                      disabled={loading || isPreparingRun}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div>
              <label>tol</label>
              <input
                value={tol}
                onChange={(e) => setTol(e.target.value)}
                style={{ width: "100%", padding: 8, marginTop: 6 }}
                disabled={loading || isPreparingRun}
              />
            </div>
            <div>
              <label>max_iter</label>
              <input
                value={maxIter}
                onChange={(e) => setMaxIter(e.target.value)}
                style={{ width: "100%", padding: 8, marginTop: 6 }}
                disabled={loading || isPreparingRun}
              />
            </div>
          </div>

          <button
            onClick={runCompare}
            disabled={loading || isPreparingRun}
            style={{
              marginTop: 14,
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #222",
              background: loading || isPreparingRun ? "#eee" : "#111",
              color: loading || isPreparingRun ? "#333" : "white",
              cursor: loading || isPreparingRun ? "default" : "pointer",
              width: "100%",
              fontWeight: 600,
            }}
          >
            {isPreparingRun ? "Preparing..." : loading ? "Running..." : "Compare Methods"}
          </button>

          <button
            onClick={createShareRun}
            disabled={loading || isPreparingRun}
            style={{
              marginTop: 10,
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #222",
              background: loading || isPreparingRun ? "#eee" : "white",
              color: loading || isPreparingRun ? "#333" : "#111",
              cursor: loading || isPreparingRun ? "default" : "pointer",
              width: "100%",
              fontWeight: 700,
            }}
          >
            {isPreparingRun ? "Preparing..." : loading ? "Creating..." : "Create Share Link"}
          </button>

          {err && <div style={{ marginTop: 10, color: "crimson", whiteSpace: "pre-wrap" }}>{err}</div>}
        </div>
      </div>

      {data && (
        <div style={{ marginTop: 22 }}>
          {problemCard}

          <h2>Results</h2>

          <div style={{ overflowX: "auto", border: "1px solid #ddd", borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#fafafa" }}>
                  <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #ddd" }}>Method</th>
                  <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #ddd" }}>Status</th>
                  <th style={{ textAlign: "right", padding: 10, borderBottom: "1px solid #ddd" }}>Iters</th>
                  <th style={{ textAlign: "right", padding: 10, borderBottom: "1px solid #ddd" }}>Root</th>
                  <th style={{ textAlign: "right", padding: 10, borderBottom: "1px solid #ddd" }}>Last |f(x)|</th>
                </tr>
              </thead>

              <tbody>
                {methods.map((m) => {
                  const s = data[m]?.summary || {};
                  const events = data[m]?.trace?.events || [];
                  const isBest = m === bestMethod;

                  const badges = computeBadges(s, events);
                  const hint = computeHint(m, s, events);

                  return (
                    <tr
                      key={m}
                      style={{
                        background: isBest ? "#fff8e6" : "white",
                        borderLeft: isBest ? "4px solid #111" : "4px solid transparent",
                      }}
                    >
                      <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div>
                            <div style={{ fontWeight: 800 }}>{METHOD_META[m]?.label || m}</div>
                            <div style={{ color: "#666", fontSize: 12 }}>{METHOD_META[m]?.subtitle || ""}</div>
                            {hint ? <div style={{ color: "#555", fontSize: 12, marginTop: 4 }}>{hint}</div> : null}
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
                        <span style={{ fontFamily: "ui-monospace, monospace" }}>{s.status ? s.status : ""}</span>
                        <BadgePills badges={badges} max={99} />
                      </td>

                      <td style={{ padding: 10, borderBottom: "1px solid #eee", textAlign: "right" }}>
                        {s.iterations ?? ""}
                      </td>

                      <td style={{ padding: 10, borderBottom: "1px solid #eee", textAlign: "right" }}>
                        {s.root == null ? "" : fmtMaybe(s.root, "prec12")}
                      </td>

                      <td style={{ padding: 10, borderBottom: "1px solid #eee", textAlign: "right" }}>
                        {s.last_residual == null ? "" : fmtMaybe(s.last_residual, "exp3")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <DiagnosticsLegend />

          <h2 style={{ marginTop: 18 }}>Explanations & Trace</h2>

          {methods.map((m) => {
            const trace = data[m]?.trace || {};
            const records = trace.records || [];
            const events = trace.events || [];

            const isBest = m === bestMethod;
            const isOpen = !!openPanels[m];
            const meta = METHOD_META[m];

            const showAllR = !!showAllRecords[m];
            const showAllE = !!showAllEvents[m];

            const recordsToShow = showAllR ? records : records.slice(0, DEFAULT_RECORDS_LIMIT);
            const eventsToShow = showAllE ? events : events.slice(0, DEFAULT_EVENTS_LIMIT);

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
                  onClick={() => setOpenPanels((prev) => ({ ...prev, [m]: !prev[m] }))}
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
                    {meta?.label || m}
                    {meta?.subtitle ? (
                      <span style={{ marginLeft: 10, fontWeight: 600, color: "#666", fontSize: 12 }}>
                        {meta.subtitle}
                      </span>
                    ) : null}
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

                  <span style={{ marginLeft: "auto", fontFamily: "ui-monospace, monospace", color: "#444" }}>
                    {isOpen ? "▼" : "▶"}
                  </span>
                </div>

                {!isOpen ? (
                  <div style={{ color: "#666", fontSize: 13 }}>Collapsed (click to view explanation, plot, and events)</div>
                ) : (
                  <>
                    <div style={{ whiteSpace: "pre-wrap", color: "#222", marginBottom: 12 }}>
                      {data[m]?.explanation || ""}
                    </div>

                    <div style={{ marginTop: 10, marginBottom: 14 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                        <div style={{ fontWeight: 700 }}>Residual vs Iteration</div>

                        {records.length > DEFAULT_RECORDS_LIMIT && (
                          <button
                            onClick={() => setShowAllRecords((prev) => ({ ...prev, [m]: !prev[m] }))}
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
                            {showAllR ? `Show first ${DEFAULT_RECORDS_LIMIT}` : `Show all (${records.length})`}
                          </button>
                        )}
                      </div>

                      {records.length === 0 ? (
                        <div style={{ color: "#666" }}>No records available to plot.</div>
                      ) : (
                        <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 10 }}>
                          <Line
                            data={{
                              labels: recordsToShow.map((r) => r.k),
                              datasets: [
                                {
                                  label: "|f(x)|",
                                  data: recordsToShow.map((r) => (r.residual == null ? null : r.residual)),
                                  tension: 0.2,
                                },
                              ],
                            }}
                            options={{
                              responsive: true,
                              plugins: { legend: { display: true }, tooltip: { enabled: true } },
                              scales: {
                                x: { title: { display: true, text: "Iteration k" } },
                                y: { title: { display: true, text: "Residual |f(x)|" }, beginAtZero: false },
                              },
                            }}
                          />
                        </div>
                      )}
                    </div>

                    <div style={{ marginTop: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                        <div style={{ fontWeight: 700 }}>Iteration Table</div>

                        {records.length > DEFAULT_RECORDS_LIMIT && (
                          <button
                            onClick={() => setShowAllRecords((prev) => ({ ...prev, [m]: !prev[m] }))}
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
                            {showAllR ? `Show first ${DEFAULT_RECORDS_LIMIT}` : `Show all (${records.length})`}
                          </button>
                        )}
                      </div>

                      {records.length === 0 ? (
                        <div style={{ color: "#666" }}>No iteration records.</div>
                      ) : (
                        <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 10 }}>
                          <table style={{ width: "100%", borderCollapse: "collapse" }}>
                            <thead>
                              <tr style={{ background: "#fafafa" }}>
                                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #eee" }}>k</th>
                                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #eee" }}>x</th>
                                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #eee" }}>f(x)</th>
                                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #eee" }}>|f(x)|</th>
                                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #eee" }}>step_error</th>
                                <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>step_type</th>
                                <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>accepted</th>
                              </tr>
                            </thead>

                            <tbody>
                              {recordsToShow.map((r, idx) => (
                                <tr key={idx}>
                                  <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{r.k ?? ""}</td>
                                  <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{fmtMaybe(r.x, "prec12")}</td>
                                  <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{fmtMaybe(r.fx, "exp3")}</td>
                                  <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{fmtMaybe(r.residual, "exp3")}</td>
                                  <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{fmtMaybe(r.step_error, "exp3")}</td>
                                  <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{r.step_type || ""}</td>
                                  <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>
                                    {r.accepted === true ? "yes" : r.accepted === false ? "no" : ""}
                                    {r.reject_reason ? ` (${r.reject_reason})` : ""}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>

                          {!showAllR && records.length > DEFAULT_RECORDS_LIMIT && (
                            <div style={{ padding: 10, color: "#666", fontSize: 12 }}>
                              Showing first {DEFAULT_RECORDS_LIMIT} of {records.length} iterations.
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div style={{ marginTop: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                        <div style={{ fontWeight: 700 }}>Event Timeline</div>

                        {events.length > DEFAULT_EVENTS_LIMIT && (
                          <button
                            onClick={() => setShowAllEvents((prev) => ({ ...prev, [m]: !prev[m] }))}
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
                            {showAllE ? `Show first ${DEFAULT_EVENTS_LIMIT}` : `Show all (${events.length})`}
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
      )}
    </div>
  );
}