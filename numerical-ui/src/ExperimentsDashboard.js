import React, { useEffect, useMemo, useRef, useState } from "react";
import { API } from "./api";
import useBackendWarmup from "./useBackendWarmup";
import BackendWarmupPanel from "./BackendWarmupPanel";

const METHOD_OPTIONS = [
  "newton",
  "secant",
  "bisection",
  "hybrid",
  "safeguarded_newton",
  "brent",
];

const BOUNDARY_METHOD_OPTIONS = ["newton"];

const BENCHMARK_DETAILS = {
  p1: {
    expr: "x**3 - 2*x + 2",
    dexpr: "3*x**2 - 2",
    note: "Cubic benchmark with challenging Newton behavior.",
  },
  p2: {
    expr: "x**3 - x - 2",
    dexpr: "3*x**2 - 1",
    note: "Classic nonlinear cubic with a real root.",
  },
  p3: {
    expr: "cos(x) - x",
    dexpr: "-sin(x) - 1",
    note: "Fixed-point style benchmark with a unique real root.",
  },
  p4: {
    expr: "(x - 1)**2 * (x + 2)",
    dexpr: "2*(x - 1)*(x + 2) + (x - 1)**2",
    note: "Multiple-root benchmark useful for basin and stability analysis.",
  },
};

function prettyMethod(name) {
  if (!name) return "-";
  return String(name)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatNumber(x) {
  const num = Number(x);
  if (!Number.isFinite(num)) return "-";
  return Number.isInteger(num) ? String(num) : num.toFixed(4);
}

function formatPercent(x) {
  const num = Number(x);
  if (!Number.isFinite(num)) return "-";
  return `${(num * 100).toFixed(1)}%`;
}

function formatMean(x) {
  const num = Number(x);
  if (!Number.isFinite(num)) return "-";
  return num.toFixed(2);
}

function formatEntropy(x) {
  const num = Number(x);
  if (!Number.isFinite(num)) return "-";
  return num.toFixed(4);
}

function SectionCard({ title, isOpen, onToggle, description, children }) {
  return (
    <section style={styles.sectionCard}>
      <button type="button" style={styles.sectionHeader} onClick={onToggle}>
        <div>
          <div style={styles.sectionTitle}>{title}</div>
          {description ? (
            <div style={styles.sectionDescription}>{description}</div>
          ) : null}
        </div>
        <div style={styles.sectionChevron}>{isOpen ? "▾" : "▸"}</div>
      </button>

      {isOpen ? <div style={styles.sectionBody}>{children}</div> : null}
    </section>
  );
}

function SubsectionCard({ title, isOpen, onToggle, children }) {
  return (
    <div style={styles.subsectionCard}>
      <button type="button" style={styles.subsectionHeader} onClick={onToggle}>
        <span style={styles.subsectionTitle}>{title}</span>
        <span style={styles.subsectionChevron}>{isOpen ? "▾" : "▸"}</span>
      </button>
      {isOpen ? <div style={styles.subsectionBody}>{children}</div> : null}
    </div>
  );
}

function SummaryMetric({ label, value }) {
  return (
    <div style={styles.metricCard}>
      <div style={styles.metricLabel}>{label}</div>
      <div style={styles.metricValue}>{value || "-"}</div>
    </div>
  );
}

function InfoGrid({ items }) {
  return (
    <div style={styles.infoGrid}>
      {items.map((item) => (
        <SummaryMetric
          key={item.label}
          label={item.label}
          value={item.value}
        />
      ))}
    </div>
  );
}

function BulletList({ items, emptyText = "No data available." }) {
  if (!items || items.length === 0) {
    return <p style={styles.emptyText}>{emptyText}</p>;
  }

  return (
    <ul style={styles.bulletList}>
      {items.map((item, idx) => (
        <li key={idx} style={styles.bulletItem}>
          {item}
        </li>
      ))}
    </ul>
  );
}

function PlotTile({ title, url, alt }) {
  const [hidden, setHidden] = useState(false);

  if (!url || hidden) return null;

  return (
    <div style={styles.plotTile}>
      <div style={styles.plotTileTitle}>{title}</div>
      <img
        src={url}
        alt={alt}
        style={styles.plotImage}
        onError={() => setHidden(true)}
      />
    </div>
  );
}

function PlotGrid({ entries, prettyMethodFn, altPrefix, emptyText }) {
  const normalized = (entries || []).filter(([, url]) => !!url);

  if (normalized.length === 0) {
    return <p style={styles.emptyText}>{emptyText}</p>;
  }

  return (
    <div style={styles.plotGrid}>
      {normalized.map(([name, url]) => (
        <div key={name} style={styles.plotTile}>
          <div style={styles.plotTileTitle}>{prettyMethodFn(name)}</div>
          <img
            src={url}
            alt={`${altPrefix} ${name}`}
            style={styles.plotImage}
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        </div>
      ))}
    </div>
  );
}

function DataTable({ columns, rows, emptyText = "No data available." }) {
  if (!rows || rows.length === 0) {
    return <p style={styles.emptyText}>{emptyText}</p>;
  }

  return (
    <div style={styles.tableWrap}>
      <table style={styles.table}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} style={styles.th}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={row.id || idx}>
              {columns.map((col) => (
                <td key={col.key} style={styles.td}>
                  {col.render ? col.render(row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Badge({ children }) {
  return <span style={styles.badge}>{children}</span>;
}

export default function ExperimentsDashboard() {
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);

  const [samplingMode, setSamplingMode] = useState("grid");
  const [nSamples, setNSamples] = useState(100);
  const [randomSeed, setRandomSeed] = useState(42);
  const [gaussianMean, setGaussianMean] = useState(0);
  const [gaussianStd, setGaussianStd] = useState(1);

  const [problemMode, setProblemMode] = useState("benchmark");
  const [problemId, setProblemId] = useState("p4");

  const [expr, setExpr] = useState("((x-1)**2)*(x+2)");
  const [dexpr, setDexpr] = useState("2*(x-1)*(x+2) + (x-1)**2");
  const [scalarMin, setScalarMin] = useState(-4);
  const [scalarMax, setScalarMax] = useState(4);
  const [bracketMin, setBracketMin] = useState(-4);
  const [bracketMax, setBracketMax] = useState(4);

  const [boundaryMethod, setBoundaryMethod] = useState("newton");
  const [selectedMethods, setSelectedMethods] = useState([
    "newton",
    "secant",
    "bisection",
    "hybrid",
    "safeguarded_newton",
    "brent",
  ]);

  const [nPoints, setNPoints] = useState(100);
  const [tol, setTol] = useState(1e-10);
  const [maxIter, setMaxIter] = useState(100);

  const [showInterpretation, setShowInterpretation] = useState(true);
  const [showOverview, setShowOverview] = useState(true);
  const [showBasinGeometry, setShowBasinGeometry] = useState(true);
  const [showInitializationSampling, setShowInitializationSampling] =
    useState(true);
  const [showSolverStability, setShowSolverStability] = useState(true);
  const [showStatDiagnostics, setShowStatDiagnostics] = useState(true);
  const [showOutputs, setShowOutputs] = useState(false);

  const [showBoundaryAnalysis, setShowBoundaryAnalysis] = useState(true);
  const [showBasinMap, setShowBasinMap] = useState(true);
  const [showBasinComplexity, setShowBasinComplexity] = useState(true);
  const [showBasinDistribution, setShowBasinDistribution] = useState(false);
  const [showRootBasinSize, setShowRootBasinSize] = useState(false);

  const [showInitHist, setShowInitHist] = useState(true);
  const [showInitVsRoot, setShowInitVsRoot] = useState(true);
  const [showInitVsIter, setShowInitVsIter] = useState(true);

  const [showFailureRegions, setShowFailureRegions] = useState(false);

  const [showRootCoverage, setShowRootCoverage] = useState(true);
  const [showRootBasinStats, setShowRootBasinStats] = useState(false);
  const [showSolverComparison, setShowSolverComparison] = useState(true);
  const [showPareto, setShowPareto] = useState(true);
  const [showHistograms, setShowHistograms] = useState(false);
  const [showCcdfs, setShowCcdfs] = useState(false);
  const [showExportedOutputs, setShowExportedOutputs] = useState(true);

  const pollRef = useRef(null);

  const {
    backendStatus,
    statusMessage,
    isPreparingRun,
    wakeBackendOnly,
    runWithWarmup,
  } = useBackendWarmup({ autoPoll: true, pollIntervalMs: 25000 });

  const benchmarkInfo = BENCHMARK_DETAILS[problemId] || null;

  useEffect(() => {
    return () => stopPolling();
  }, []);

  useEffect(() => {
    if (!BOUNDARY_METHOD_OPTIONS.includes(boundaryMethod)) {
      setBoundaryMethod(BOUNDARY_METHOD_OPTIONS[0]);
    }
  }, [boundaryMethod]);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function validateInputs() {
    if (!selectedMethods.length) {
      throw new Error("Select at least one method.");
    }

    const sMin = Number(scalarMin);
    const sMax = Number(scalarMax);
    const bMin = Number(bracketMin);
    const bMax = Number(bracketMax);

    if (!Number.isFinite(Number(tol)) || Number(tol) <= 0) {
      throw new Error("Tolerance must be positive.");
    }

    if (!Number.isFinite(Number(maxIter)) || Number(maxIter) < 1) {
      throw new Error("Max Iter must be at least 1.");
    }

    if (!Number.isFinite(sMin) || !Number.isFinite(sMax) || sMin >= sMax) {
      throw new Error("Scalar range is invalid.");
    }

    if (!Number.isFinite(bMin) || !Number.isFinite(bMax) || bMin >= bMax) {
      throw new Error("Bracket search range is invalid.");
    }

    if (samplingMode === "grid" && Number(nPoints) < 2) {
      throw new Error("Points must be at least 2 for grid mode.");
    }

    if (samplingMode === "uniform" && Number(nSamples) < 1) {
      throw new Error("Number of samples must be at least 1.");
    }

    if (samplingMode === "gaussian") {
      if (Number(nSamples) < 1) {
        throw new Error("Number of samples must be at least 1.");
      }
      if (!Number.isFinite(Number(gaussianMean))) {
        throw new Error("Gaussian mean must be valid.");
      }
      if (!Number.isFinite(Number(gaussianStd)) || Number(gaussianStd) <= 0) {
        throw new Error("Gaussian std dev must be positive.");
      }
    }

    if (problemMode === "custom" && !String(expr || "").trim()) {
      throw new Error("Custom expression f(x) is required.");
    }
  }

  function buildPayload() {
    const sMin = Number(scalarMin);
    const sMax = Number(scalarMax);
    const bMin = Number(bracketMin);
    const bMax = Number(bracketMax);

    const base = {
      methods: selectedMethods,
      sampling_mode: samplingMode,
      tol: Number(tol),
      max_iter: Number(maxIter),
      boundary_method: boundaryMethod,
      scalar_range: {
        x_min: sMin,
        x_max: sMax,
      },
      bracket_search_range: {
        x_min: bMin,
        x_max: bMax,
      },
    };

    if (problemMode === "custom") {
      const payload = {
        ...base,
        problem_mode: "custom",
        problem_id: null,
        expr: String(expr || "").trim(),
        dexpr: String(dexpr || "").trim(),
      };

      if (samplingMode === "grid") {
        payload.n_points = Number(nPoints);
        payload.x_min = sMin;
        payload.x_max = sMax;
      } else {
        payload.n_samples = Number(nSamples);
        payload.random_seed = Number(randomSeed);
      }

      if (samplingMode === "gaussian") {
        payload.gaussian_mean = Number(gaussianMean);
        payload.gaussian_std = Number(gaussianStd);
      }

      return payload;
    }

    const payload = {
      ...base,
      problem_mode: "benchmark",
      problem_id: problemId,
      x_min: sMin,
      x_max: sMax,
    };

    if (samplingMode === "grid") {
      payload.n_points = Number(nPoints);
    } else {
      payload.n_samples = Number(nSamples);
      payload.random_seed = Number(randomSeed);
    }

    if (samplingMode === "gaussian") {
      payload.gaussian_mean = Number(gaussianMean);
      payload.gaussian_std = Number(gaussianStd);
    }

    return payload;
  }

  async function runSweep() {
    try {
      setRunning(true);
      setError(null);
      setResult(null);
      setJobStatus(null);
      setJobId(null);

      stopPolling();
      validateInputs();

      const payload = buildPayload();

      const data = await runWithWarmup(
        async () => {
          const res = await fetch(`${API}/experiments/sweep`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

          if (!res.ok) {
            const text = await res.text();
            throw new Error(`Failed to create experiment job: ${res.status} ${text}`);
          }

          return res.json();
        },
        {
          startMessage: "Compute engine ready. Starting sweep experiment...",
          doneMessage: "Sweep submitted successfully.",
        }
      );

      if (!data?.job_id) {
        throw new Error("Backend did not return a job_id.");
      }

      setJobId(data.job_id);
      startPolling(data.job_id);
    } catch (err) {
      setError(err.message || "Unknown error");
      setRunning(false);
    }
  }

  function startPolling(id) {
    stopPolling();

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API}/experiments/jobs/${id}`);
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Polling failed: ${res.status} ${text}`);
        }

        const data = await res.json();
        setJobStatus(data);

        if (data.status === "completed") {
          setResult(data.result || data);
          setRunning(false);
          stopPolling();
          return;
        }

        if (data.status === "failed" || data.status === "error") {
          setError(data.error || data.message || "Experiment failed");
          setRunning(false);
          stopPolling();
        }
      } catch (err) {
        setError(err.message || "Polling error");
        setRunning(false);
        stopPolling();
      }
    }, 2000);
  }

  function toggleMethod(selected) {
    setSelectedMethods((prev) => {
      if (prev.includes(selected)) {
        const next = prev.filter((m) => m !== selected);
        return next.length ? next : [selected];
      }
      return [...prev, selected];
    });
  }

  function toOutputUrl(path) {
    if (!path) return null;
    if (String(path).startsWith("http://") || String(path).startsWith("https://")) {
      return path;
    }
    return `${API}${String(path).startsWith("/") ? "" : "/"}${String(path).replace(/\\/g, "/")}`;
  }

  const analyticsKey =
    result?.problem_id || (problemMode === "benchmark" ? problemId : "custom");

  const analytics =
    result?.artifacts?.analytics?.[analyticsKey] ||
    result?.artifacts?.analytics?.custom ||
    null;

  const problemExpectations = analytics?.problem_expectations_data || null;
  const interpretationSummary = analytics?.interpretation_summary_data || null;

  const basinMapUrl =
    toOutputUrl(result?.artifacts?.basin_map) ||
    toOutputUrl(analytics?.basin_map);

  const basinEntropyPlotUrl =
    toOutputUrl(analytics?.basin_entropy_plot) ||
    toOutputUrl(analytics?.basin_entropy_comparison_plot);

  const comparisonRows = analytics?.comparison_summary_data?.methods || [];
  const entropyRows = analytics?.basin_entropy_data?.methods || [];
  const clusterTol = analytics?.basin_entropy_data?.cluster_tol;


  const paretoMeanUrl = toOutputUrl(analytics?.pareto?.mean_vs_failure);
  const paretoMedianUrl = toOutputUrl(analytics?.pareto?.median_vs_failure);

  const rootCoverageData = analytics?.root_coverage_data || null;
  const rootCoveragePlot = analytics?.root_coverage_plot || null;

  const rootBasinStatisticsData = analytics?.root_basin_statistics_data || null;
  const rootBasinStatisticsPlot = analytics?.root_basin_statistics_plot || {};

  const basinDistributionEntries = useMemo(() => {
    return Object.entries(analytics?.basin_distribution || {}).map(([k, v]) => [
      k,
      toOutputUrl(v),
    ]);
  }, [analytics]);

  const rootDistributionEntries = useMemo(() => {
    return Object.entries(analytics?.basin_root_distribution || {}).map(([k, v]) => [
      k,
      toOutputUrl(v),
    ]);
  }, [analytics]);

  const initializationHistogramEntries = useMemo(() => {
    return Object.entries(analytics?.initialization_histogram || {}).map(([k, v]) => [
      k,
      toOutputUrl(v),
    ]);
  }, [analytics]);

  const initialXVsRootEntries = useMemo(() => {
    return Object.entries(analytics?.initial_x_vs_root || {}).map(([k, v]) => [
      k,
      toOutputUrl(v),
    ]);
  }, [analytics]);

  const initialXVsIterationsEntries = useMemo(() => {
    return Object.entries(analytics?.initial_x_vs_iterations || {}).map(([k, v]) => [
      k,
      toOutputUrl(v),
    ]);
  }, [analytics]);

  const histogramEntries = useMemo(() => {
    return Object.entries(analytics?.histogram || {}).map(([k, v]) => [
      k,
      toOutputUrl(v),
    ]);
  }, [analytics]);

  const ccdfEntries = useMemo(() => {
    return Object.entries(analytics?.ccdf || {}).map(([k, v]) => [
      k,
      toOutputUrl(v),
    ]);
  }, [analytics]);

  const failureRegionEntries = useMemo(() => {
    return Object.entries(analytics?.failure_region || {}).map(([k, v]) => [
      k,
      toOutputUrl(v),
    ]);
  }, [analytics]);

  const detectedRoots = Array.from(
    new Set(
      (entropyRows || []).flatMap((row) =>
        row?.basin_counts ? Object.keys(row.basin_counts) : []
      )
    )
  ).sort((a, b) => Number(a) - Number(b));

  const boundaryRegions = Array.isArray(result?.boundaries) ? result.boundaries : [];
  const rawBoundaries = Array.isArray(result?.raw_boundaries) ? result.raw_boundaries : [];
  const boundarySummary = result?.boundary_summary || null;
  const boundaryClusterTol = result?.boundary_cluster_tol;

  const bestSuccessMethod =
    comparisonRows.length > 0
      ? [...comparisonRows].sort(
          (a, b) => Number(b.success_rate || 0) - Number(a.success_rate || 0)
        )[0]
      : null;

  const fastestMedianMethod =
    comparisonRows.length > 0
      ? [...comparisonRows]
          .filter((row) => Number.isFinite(Number(row.median_iter)))
          .sort((a, b) => Number(a.median_iter) - Number(b.median_iter))[0]
      : null;

  const mostStableMethod =
    comparisonRows.length > 0
      ? [...comparisonRows].sort(
          (a, b) => Number(a.failure_count || 0) - Number(b.failure_count || 0)
        )[0]
      : null;

  const mostStructuredMethod =
    entropyRows.length > 0
      ? [...entropyRows].sort(
          (a, b) => Number(a.entropy || 0) - Number(b.entropy || 0)
        )[0]
      : null;

  const overviewInterpretationNotes =
    interpretationSummary?.top_summary?.slice(0, 3) || [];

  const failureQuickNote =
    interpretationSummary?.failure_interpretation?.global_notes?.[0] || null;

  function generateInsights() {
    const insights = [];

    if (bestSuccessMethod) {
      insights.push(
        `${prettyMethod(bestSuccessMethod.method)} achieved the highest success rate (${formatPercent(
          bestSuccessMethod.success_rate
        )}).`
      );
    }

    if (fastestMedianMethod) {
      insights.push(
        `${prettyMethod(fastestMedianMethod.method)} has the fastest median convergence (${formatNumber(
          fastestMedianMethod.median_iter
        )} iterations).`
      );
    }

    if (mostStableMethod) {
      insights.push(
        `${prettyMethod(mostStableMethod.method)} exhibits the lowest failure count (${formatNumber(
          mostStableMethod.failure_count
        )}).`
      );
    }

    if (mostStructuredMethod) {
      insights.push(
        `${prettyMethod(mostStructuredMethod.method)} shows the most structured basin geometry (lowest entropy = ${formatEntropy(
          mostStructuredMethod.entropy
        )}).`
      );
    }

    if (detectedRoots.length > 0) {
      insights.push(
        `Detected real root basins in this experiment: ${detectedRoots.join(", ")}.`
      );
    }

    if (boundarySummary?.clustered_count !== undefined) {
      insights.push(
        `Boundary analysis detected ${boundarySummary.clustered_count} clustered transition region(s), indicating where solver behavior changes across initializations.`
      );
    }

    return insights;
  }

  function suggestSolverChoice() {
    if (!comparisonRows.length) {
      return "No solver recommendation available.";
    }

    const reliable = bestSuccessMethod?.method;
    const fastest = fastestMedianMethod?.method;
    const stable = mostStableMethod?.method;

    if (reliable && reliable === fastest) {
      return `${prettyMethod(reliable)} provides the best overall performance here because it combines the highest success rate with the fastest convergence.`;
    }

    if (reliable && reliable === stable) {
      return `${prettyMethod(reliable)} provides the strongest reliability profile with the lowest observed failure risk.`;
    }

    return `${prettyMethod(reliable)} is the most reliable solver here, while ${prettyMethod(fastest)} is the fastest. Choose based on whether robustness or speed matters more for this problem.`;
  }

  const effectiveSamplingMode = result?.sampling_mode || samplingMode;
  const effectiveSampleCount =
    effectiveSamplingMode === "grid"
      ? result?.n_points ?? nPoints
      : result?.n_samples ?? nSamples;

  const overviewExpr =
    result?.expr || (problemMode === "benchmark" ? benchmarkInfo?.expr : expr) || "-";
  const overviewDexpr =
    result?.dexpr || (problemMode === "benchmark" ? benchmarkInfo?.dexpr : dexpr) || "-";

  const overviewRangeMin =
    result?.scalar_range?.[0] ?? result?.scalar_range?.x_min ?? scalarMin;
  const overviewRangeMax =
    result?.scalar_range?.[1] ?? result?.scalar_range?.x_max ?? scalarMax;

  const overviewItems = [
    { label: "Problem Mode", value: result?.problem_mode || problemMode },
    { label: "Problem", value: result?.problem_id || analyticsKey },
    { label: "Sampling Mode", value: effectiveSamplingMode },
    {
      label: effectiveSamplingMode === "grid" ? "Points" : "Sample Count",
      value: String(effectiveSampleCount),
    },
    {
      label: "Range",
      value: `[${formatNumber(overviewRangeMin)}, ${formatNumber(overviewRangeMax)}]`,
    },
    {
      label: "Random Seed",
      value:
        effectiveSamplingMode === "grid"
          ? "-"
          : result?.random_seed ?? randomSeed,
    },
    { label: "Boundary Method", value: prettyMethod(boundaryMethod) },
    { label: "Methods", value: selectedMethods.map(prettyMethod).join(", ") },
    { label: "Sweep Folder", value: result?.latest_sweep_dir || "-" },
    {
      label: "Boundary Regions",
      value: boundarySummary
        ? `${boundarySummary.clustered_count ?? boundaryRegions.length} regions (${boundarySummary.raw_count ?? rawBoundaries.length} raw)`
        : "None",
    },
  ];

  return (
    <div style={styles.page}>
      <div style={styles.pageHeader}>
        <h1 style={styles.pageTitle}>Experiment Analysis</h1>
        <p style={styles.pageSubtitle}>
          Research dashboard for basin geometry, solver reliability, and statistical behavior across initializations.
        </p>
      </div>

      <div style={styles.setupCard}>
        <div style={styles.setupTitle}>Experiment Setup</div>

        <div style={styles.formGrid}>
          <div>
            <label style={styles.label}>Problem Source</label>
            <select
              value={problemMode}
              onChange={(e) => setProblemMode(e.target.value)}
              disabled={running || isPreparingRun}
              style={styles.input}
            >
              <option value="benchmark">Benchmark</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          {problemMode === "benchmark" ? (
            <div>
              <label style={styles.label}>Problem</label>
              <select
                value={problemId}
                onChange={(e) => setProblemId(e.target.value)}
                disabled={running || isPreparingRun}
                style={styles.input}
              >
                {Object.entries(BENCHMARK_DETAILS).map(([key, info]) => (
                  <option key={key} value={key}>
                    {key} - {info.expr}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={styles.label}>f(x)</label>
                <input
                  value={expr}
                  onChange={(e) => setExpr(e.target.value)}
                  disabled={running || isPreparingRun}
                  style={styles.input}
                />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={styles.label}>f&apos;(x)</label>
                <input
                  value={dexpr}
                  onChange={(e) => setDexpr(e.target.value)}
                  disabled={running || isPreparingRun}
                  style={styles.input}
                />
              </div>
            </>
          )}

          <div>
            <label style={styles.label}>Domain Min</label>
            <input
              type="number"
              value={scalarMin}
              onChange={(e) => setScalarMin(e.target.value)}
              disabled={running || isPreparingRun}
              style={styles.input}
            />
          </div>

          <div>
            <label style={styles.label}>Domain Max</label>
            <input
              type="number"
              value={scalarMax}
              onChange={(e) => setScalarMax(e.target.value)}
              disabled={running || isPreparingRun}
              style={styles.input}
            />
          </div>

          <div>
            <label style={styles.label}>Bracket Search Min</label>
            <input
              type="number"
              value={bracketMin}
              onChange={(e) => setBracketMin(e.target.value)}
              disabled={running || isPreparingRun}
              style={styles.input}
            />
          </div>

          <div>
            <label style={styles.label}>Bracket Search Max</label>
            <input
              type="number"
              value={bracketMax}
              onChange={(e) => setBracketMax(e.target.value)}
              disabled={running || isPreparingRun}
              style={styles.input}
            />
          </div>

          <div>
            <label style={styles.label}>Sampling Mode</label>
            <select
              value={samplingMode}
              onChange={(e) => setSamplingMode(e.target.value)}
              disabled={running || isPreparingRun}
              style={styles.input}
            >
              <option value="grid">Grid</option>
              <option value="uniform">Uniform Random</option>
              <option value="gaussian">Gaussian</option>
            </select>
          </div>

          <div>
            <label style={styles.label}>Boundary Method</label>
            <select
              value={boundaryMethod}
              onChange={(e) => setBoundaryMethod(e.target.value)}
              disabled={running || isPreparingRun}
              style={styles.input}
            >
              {BOUNDARY_METHOD_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {prettyMethod(m)}
                </option>
              ))}
            </select>
          </div>

          {samplingMode === "grid" ? (
            <div>
              <label style={styles.label}>Points</label>
              <input
                type="number"
                min="2"
                value={nPoints}
                onChange={(e) => setNPoints(Number(e.target.value))}
                disabled={running || isPreparingRun}
                style={styles.input}
              />
            </div>
          ) : (
            <>
              <div>
                <label style={styles.label}>Number of Samples</label>
                <input
                  type="number"
                  min="1"
                  value={nSamples}
                  onChange={(e) => setNSamples(Number(e.target.value))}
                  disabled={running || isPreparingRun}
                  style={styles.input}
                />
              </div>
              <div>
                <label style={styles.label}>Random Seed</label>
                <input
                  type="number"
                  value={randomSeed}
                  onChange={(e) => setRandomSeed(Number(e.target.value))}
                  disabled={running || isPreparingRun}
                  style={styles.input}
                />
              </div>
            </>
          )}

          {samplingMode === "gaussian" && (
            <>
              <div>
                <label style={styles.label}>Gaussian Mean</label>
                <input
                  type="number"
                  step="any"
                  value={gaussianMean}
                  onChange={(e) => setGaussianMean(Number(e.target.value))}
                  disabled={running || isPreparingRun}
                  style={styles.input}
                />
              </div>
              <div>
                <label style={styles.label}>Gaussian Std Dev</label>
                <input
                  type="number"
                  step="any"
                  value={gaussianStd}
                  onChange={(e) => setGaussianStd(Number(e.target.value))}
                  disabled={running || isPreparingRun}
                  style={styles.input}
                />
              </div>
            </>
          )}

          <div>
            <label style={styles.label}>Tolerance</label>
            <input
              type="number"
              step="any"
              value={tol}
              onChange={(e) => setTol(e.target.value)}
              disabled={running || isPreparingRun}
              style={styles.input}
            />
          </div>

          <div>
            <label style={styles.label}>Max Iter</label>
            <input
              type="number"
              value={maxIter}
              onChange={(e) => setMaxIter(e.target.value)}
              disabled={running || isPreparingRun}
              style={styles.input}
            />
          </div>
        </div>

        {problemMode === "benchmark" && benchmarkInfo ? (
          <div style={styles.inlineInfoBox}>
            <div style={styles.inlineInfoTitle}>Benchmark Definition</div>
            <div style={styles.inlineInfoText}>
              <b>f(x)</b> = {benchmarkInfo.expr}
            </div>
            <div style={styles.inlineInfoText}>
              <b>f&apos;(x)</b> = {benchmarkInfo.dexpr}
            </div>
            <div style={styles.inlineInfoNote}>{benchmarkInfo.note}</div>
          </div>
        ) : null}

        <BackendWarmupPanel
          backendStatus={backendStatus}
          statusMessage={statusMessage}
          isPreparingRun={isPreparingRun}
          onWake={() =>
            wakeBackendOnly({ onError: (err) => setError(err.message) })
          }
          disabled={running}
        />

        <div style={styles.methodsBlock}>
          <div style={styles.label}>Methods to Compare</div>
          <div style={styles.chipWrap}>
            {METHOD_OPTIONS.map((m) => (
              <label key={m} style={styles.chip}>
                <input
                  type="checkbox"
                  checked={selectedMethods.includes(m)}
                  onChange={() => toggleMethod(m)}
                  disabled={running || isPreparingRun}
                />
                <span>{prettyMethod(m)}</span>
              </label>
            ))}
          </div>
        </div>

        <div style={styles.runRow}>
          <button
            onClick={runSweep}
            disabled={running || isPreparingRun}
            style={{
              ...styles.runButton,
              ...(running || isPreparingRun ? styles.runButtonDisabled : {}),
            }}
          >
            {isPreparingRun ? "Preparing..." : running ? "Running..." : "Run Sweep Experiment"}
          </button>
        </div>
      </div>

      {(jobId || jobStatus || error) && (
        <div style={styles.statusCard}>
          <div style={styles.setupTitle}>Job Status</div>

          {jobId ? (
            <div style={styles.statusRow}>
              <span style={styles.statusLabel}>Job ID</span>
              <span style={styles.mono}>{jobId}</span>
            </div>
          ) : null}

          {jobStatus ? (
            <>
              <div style={styles.statusRow}>
                <span style={styles.statusLabel}>Status</span>
                <span>{jobStatus.status || "-"}</span>
              </div>
              <div style={styles.statusRow}>
                <span style={styles.statusLabel}>Progress</span>
                <span>{Math.round((jobStatus.progress || 0) * 100)}%</span>
              </div>
              <div style={styles.statusRow}>
                <span style={styles.statusLabel}>Message</span>
                <span>{jobStatus.message || "-"}</span>
              </div>

              <div style={styles.progressTrack}>
                <div
                  style={{
                    ...styles.progressFill,
                    width: `${Math.round((jobStatus.progress || 0) * 100)}%`,
                  }}
                />
              </div>
            </>
          ) : null}

          {error ? (
            <div style={styles.errorBox}>
              <div style={styles.errorTitle}>Error</div>
              <div style={styles.errorText}>{error}</div>
            </div>
          ) : null}
        </div>
      )}

      {result ? (
        <div style={styles.resultsWrap}>
          <SectionCard
            title="Automated Experiment Interpretation"
            isOpen={showInterpretation}
            onToggle={() => setShowInterpretation((v) => !v)}
            description="Automatically generated observations and recommendations from the current experiment."
          >
            <div style={styles.twoColGrid}>
              <div style={styles.innerPanel}>
                <div style={styles.innerPanelTitle}>Key Observations</div>
                <BulletList items={generateInsights()} emptyText="No observations available yet." />
              </div>

              <div style={styles.innerPanel}>
                <div style={styles.innerPanelTitle}>Suggested Solver Choice</div>
                <p style={styles.paragraph}>{suggestSolverChoice()}</p>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="Overview"
            isOpen={showOverview}
            onToggle={() => setShowOverview((v) => !v)}
            description="High-level summary of the experiment configuration, detected roots, and the main findings from the sweep."
          >
            <InfoGrid items={overviewItems} />

            <div style={styles.blockSpacer}>
              <div style={styles.innerPanel}>
                <div style={styles.innerPanelTitle}>Problem Definition</div>
                <div style={styles.inlineInfoText}>
                  <b>f(x)</b> = {overviewExpr}
                </div>
                <div style={styles.inlineInfoText}>
                  <b>f&apos;(x)</b> = {overviewDexpr}
                </div>
              </div>
            </div>

            {problemExpectations ? (
              <div style={styles.blockSpacer}>
                <div style={styles.innerPanel}>
                  <div style={styles.innerPanelTitle}>Analytic Expectation Snapshot</div>
                  <InfoGrid
                    items={[
                      {
                        label: "Root Candidates",
                        value:
                          problemExpectations.analytic_checks?.root_candidates?.length
                            ? problemExpectations.analytic_checks.root_candidates.join(", ")
                            : "None detected",
                      },
                      {
                        label: "Sign-Change Accessible Roots",
                        value: String(
                          problemExpectations.analytic_checks?.sign_change_interval_count ?? 0
                        ),
                      },
                      {
                        label: "Critical Points",
                        value:
                          problemExpectations.analytic_checks?.critical_points?.length
                            ? problemExpectations.analytic_checks.critical_points.join(", ")
                            : "None detected",
                      },
                    ]}
                  />
                </div>
              </div>
            ) : null}

            <div style={styles.blockSpacer}>
              <div style={styles.twoColGrid}>
                <div style={styles.innerPanel}>
                  <div style={styles.innerPanelTitle}>Detected Real Roots</div>
                  <div style={styles.rootText}>
                    {detectedRoots.length > 0 ? detectedRoots.join(", ") : "Not available"}
                  </div>
                </div>

                <div style={styles.innerPanel}>
                  <div style={styles.innerPanelTitle}>Key Findings</div>
                  <InfoGrid
                    items={[
                      { label: "Methods Compared", value: String(selectedMethods.length) },
                      {
                        label: "Best Success Rate",
                        value: bestSuccessMethod
                          ? `${prettyMethod(bestSuccessMethod.method)} (${formatPercent(
                              bestSuccessMethod.success_rate
                            )})`
                          : "-",
                      },
                      {
                        label: "Fastest Median",
                        value: fastestMedianMethod
                          ? `${prettyMethod(fastestMedianMethod.method)} (${formatNumber(
                              fastestMedianMethod.median_iter
                            )})`
                          : "-",
                      },
                      {
                        label: "Lowest Failures",
                        value: mostStableMethod
                          ? `${prettyMethod(mostStableMethod.method)} (${formatNumber(
                              mostStableMethod.failure_count
                            )})`
                          : "-",
                      },
                    ]}
                  />
                </div>
              </div>
            </div>

            {overviewInterpretationNotes.length > 0 ? (
              <div style={styles.blockSpacer}>
                <div style={styles.innerPanel}>
                  <div style={styles.innerPanelTitle}>High-Level Interpretation</div>
                  <BulletList items={overviewInterpretationNotes} />
                </div>
              </div>
            ) : null}
          </SectionCard>

          <SectionCard
            title="Basin Geometry"
            isOpen={showBasinGeometry}
            onToggle={() => setShowBasinGeometry((v) => !v)}
            description="Geometry of solver basins, basin transitions, entropy, and root attractor regions."
          >
            <SubsectionCard
              title="Boundary Analysis"
              isOpen={showBoundaryAnalysis}
              onToggle={() => setShowBoundaryAnalysis((v) => !v)}
            >
              {boundarySummary ? (
                <>
                  <InfoGrid
                    items={[
                      { label: "Clustered Regions", value: String(boundarySummary.clustered_count ?? "-") },
                      { label: "Raw Boundary Points", value: String(boundarySummary.raw_count ?? "-") },
                      { label: "Leftmost Boundary", value: formatNumber(boundarySummary.leftmost) },
                      { label: "Rightmost Boundary", value: formatNumber(boundarySummary.rightmost) },
                      { label: "Median Spacing", value: formatNumber(boundarySummary.median_spacing) },
                      { label: "Cluster Tolerance", value: formatNumber(boundaryClusterTol) },
                    ]}
                  />

                  <div style={styles.blockSpacer}>
                    <DataTable
                      columns={[
                        { key: "region_id", label: "Region" },
                        {
                          key: "center",
                          label: "Center",
                          render: (row) => formatNumber(row.center),
                        },
                        {
                          key: "start",
                          label: "Start",
                          render: (row) => formatNumber(row.start),
                        },
                        {
                          key: "end",
                          label: "End",
                          render: (row) => formatNumber(row.end),
                        },
                        {
                          key: "width",
                          label: "Width",
                          render: (row) => formatNumber(row.width),
                        },
                        {
                          key: "count",
                          label: "Raw Points",
                          render: (row) => formatNumber(row.count),
                        },
                      ]}
                      rows={boundaryRegions}
                      emptyText="No clustered boundary regions available."
                    />
                  </div>
                </>
              ) : (
                <p style={styles.emptyText}>No boundary summary available.</p>
              )}
            </SubsectionCard>

            <SubsectionCard
              title="Basin Map"
              isOpen={showBasinMap}
              onToggle={() => setShowBasinMap((v) => !v)}
            >
              {basinMapUrl ? (
                <>
                  <div style={styles.singlePlotWrap}>
                    <PlotTile
                      title={`Root-Labeled Basin Map — ${analyticsKey} — ${boundaryMethod}`}
                      url={basinMapUrl}
                      alt="Basin map"
                    />
                  </div>

                  {problemExpectations?.section_expectations?.basin_map?.notes?.length > 0 ? (
                    <div style={styles.blockSpacer}>
                      <div style={styles.innerPanel}>
                        <div style={styles.innerPanelTitle}>Expected Basin Behavior</div>
                        <BulletList
                          items={problemExpectations.section_expectations.basin_map.notes}
                        />
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <p style={styles.emptyText}>No basin map available.</p>
              )}
            </SubsectionCard>

            <SubsectionCard
              title="Basin Complexity"
              isOpen={showBasinComplexity}
              onToggle={() => setShowBasinComplexity((v) => !v)}
            >
              {clusterTol !== undefined && clusterTol !== null ? (
                <p style={styles.metaText}>
                  <b>Cluster tolerance:</b> {formatNumber(clusterTol)} (based on sweep resolution)
                </p>
              ) : null}

              {basinEntropyPlotUrl ? (
                <div style={styles.singlePlotWrap}>
                  <PlotTile
                    title="Basin Entropy Comparison"
                    url={basinEntropyPlotUrl}
                    alt="Basin entropy comparison"
                  />
                </div>
              ) : (
                <p style={styles.emptyText}>No basin entropy comparison plot available.</p>
              )}

              <div style={styles.blockSpacer}>
                <DataTable
                  columns={[
                    { key: "method", label: "Method", render: (row) => prettyMethod(row.method) },
                    {
                      key: "entropy",
                      label: "Entropy",
                      render: (row) => formatEntropy(row.entropy),
                    },
                    {
                      key: "num_basins",
                      label: "Basins",
                      render: (row) => formatNumber(row.num_basins),
                    },
                    {
                      key: "total_converged",
                      label: "Converged Runs",
                      render: (row) => formatNumber(row.total_converged),
                    },
                    {
                      key: "cluster_tol",
                      label: "Cluster Tol",
                      render: (row) => formatNumber(row.cluster_tol),
                    },
                  ]}
                  rows={entropyRows}
                  emptyText="No basin entropy metrics available."
                />
              </div>
            </SubsectionCard>

            <SubsectionCard
              title="Basin Distribution Plots"
              isOpen={showBasinDistribution}
              onToggle={() => setShowBasinDistribution((v) => !v)}
            >
              <PlotGrid
                entries={basinDistributionEntries}
                prettyMethodFn={prettyMethod}
                altPrefix="Basin distribution for"
                emptyText="No basin distribution artifacts available."
              />
            </SubsectionCard>

            <SubsectionCard
              title="Root Basin Size"
              isOpen={showRootBasinSize}
              onToggle={() => setShowRootBasinSize((v) => !v)}
            >
              <PlotGrid
                entries={rootDistributionEntries}
                prettyMethodFn={prettyMethod}
                altPrefix="Root basin distribution for"
                emptyText="No root basin distribution available."
              />
            </SubsectionCard>
          </SectionCard>

          <SectionCard
            title="Initialization Sampling"
            isOpen={showInitializationSampling}
            onToggle={() => setShowInitializationSampling((v) => !v)}
            description="Diagnostics showing where initial guesses were sampled and how they relate to convergence outcomes."
          >
            <SubsectionCard
              title="Initialization Histograms"
              isOpen={showInitHist}
              onToggle={() => setShowInitHist((v) => !v)}
            >
              <PlotGrid
                entries={initializationHistogramEntries}
                prettyMethodFn={prettyMethod}
                altPrefix="Initialization histogram for"
                emptyText="No initialization histogram artifacts available."
              />
            </SubsectionCard>

            <SubsectionCard
              title="Initial Guess vs Converged Root"
              isOpen={showInitVsRoot}
              onToggle={() => setShowInitVsRoot((v) => !v)}
            >
              <PlotGrid
                entries={initialXVsRootEntries}
                prettyMethodFn={prettyMethod}
                altPrefix="Initial guess vs converged root for"
                emptyText="No initial guess vs root artifacts available."
              />
            </SubsectionCard>

            <SubsectionCard
              title="Initial Guess vs Iterations"
              isOpen={showInitVsIter}
              onToggle={() => setShowInitVsIter((v) => !v)}
            >
              <PlotGrid
                entries={initialXVsIterationsEntries}
                prettyMethodFn={prettyMethod}
                altPrefix="Initial guess vs iterations for"
                emptyText="No initial guess vs iterations artifacts available."
              />
            </SubsectionCard>
          </SectionCard>

          <SectionCard
            title="Solver Stability"
            isOpen={showSolverStability}
            onToggle={() => setShowSolverStability((v) => !v)}
            description="Regions where solvers fail, diverge, or exhibit unstable convergence."
          >
            {failureQuickNote ? (
              <div style={styles.innerPanel}>
                <div style={styles.innerPanelTitle}>Stability Summary</div>
                <p style={styles.paragraph}>{failureQuickNote}</p>
              </div>
            ) : null}

            <SubsectionCard
              title="Failure Region Plots"
              isOpen={showFailureRegions}
              onToggle={() => setShowFailureRegions((v) => !v)}
            >
              <PlotGrid
                entries={failureRegionEntries}
                prettyMethodFn={prettyMethod}
                altPrefix="Failure region for"
                emptyText="No failure region artifacts available."
              />

              {interpretationSummary?.failure_interpretation ? (
                <div style={styles.blockSpacer}>
                  <div style={styles.innerPanel}>
                    <div style={styles.innerPanelTitle}>Failure Interpretation</div>
                    <BulletList
                      items={
                        interpretationSummary.failure_interpretation.global_notes || []
                      }
                      emptyText="No failure interpretation available."
                    />
                  </div>
                </div>
              ) : null}
            </SubsectionCard>
          </SectionCard>

          <SectionCard
            title="Statistical Diagnostics"
            isOpen={showStatDiagnostics}
            onToggle={() => setShowStatDiagnostics((v) => !v)}
            description="Summarizes aggregate solver performance, convergence efficiency, failure behavior, and tail-risk across all sampled initializations."
          >
            <SubsectionCard
              title="Root Coverage"
              isOpen={showRootCoverage}
              onToggle={() => setShowRootCoverage((v) => !v)}
            >
              {rootCoverageData ? (
                <>
                  <InfoGrid
                    items={[
                      {
                        label: "Total Roots Detected",
                        value: rootCoverageData.total_roots_detected,
                      },
                      {
                        label: "Global Roots",
                        value: (rootCoverageData.global_roots || []).join(", "),
                      },
                    ]}
                  />

                  <div style={styles.blockSpacer}>
                    <DataTable
                      columns={[
                        { key: "solver", label: "Solver", render: (row) => prettyMethod(row.solver) },
                        { key: "roots_found", label: "Roots Found" },
                        { key: "total_roots", label: "Total Roots" },
                        {
                          key: "coverage",
                          label: "Coverage",
                          render: (row) => formatPercent(row.coverage),
                        },
                        {
                          key: "found_roots",
                          label: "Found Roots",
                          render: (row) => (row.found_roots || []).join(", "),
                        },
                      ]}
                      rows={Object.entries(rootCoverageData.solvers || {}).map(
                        ([solver, info]) => ({
                          solver,
                          ...info,
                        })
                      )}
                    />
                  </div>

                  {rootCoveragePlot ? (
                    <div style={styles.blockSpacer}>
                      <div style={styles.singlePlotWrap}>
                        <PlotTile
                          title="Root Coverage Comparison"
                          url={toOutputUrl(rootCoveragePlot)}
                          alt="Root coverage comparison"
                        />
                      </div>
                    </div>
                  ) : null}

                  {interpretationSummary?.root_coverage_interpretation ? (
                    <>
                      <div style={styles.blockSpacer}>
                        <div style={styles.innerPanel}>
                          <div style={styles.innerPanelTitle}>Coverage Interpretation</div>
                          <BulletList
                            items={
                              interpretationSummary.root_coverage_interpretation
                                .comparison_notes || []
                            }
                            emptyText="No coverage interpretation available."
                          />
                        </div>
                      </div>

                      <div style={styles.blockSpacer}>
                        <DataTable
                          columns={[
                            {
                              key: "method",
                              label: "Method",
                              render: (row) => prettyMethod(row.method),
                            },
                            {
                              key: "status",
                              label: "Status",
                              render: (row) => <Badge>{row.status}</Badge>,
                            },
                            { key: "expected", label: "Expected" },
                            { key: "observed", label: "Observed" },
                          ]}
                          rows={Object.entries(
                            interpretationSummary.root_coverage_interpretation
                              .per_method || {}
                          ).map(([method, info]) => ({
                            method,
                            ...info,
                          }))}
                          emptyText="No expectation-vs-observation data available."
                        />
                      </div>
                    </>
                  ) : null}
                </>
              ) : (
                <p style={styles.emptyText}>No root coverage data available.</p>
              )}
            </SubsectionCard>

            <SubsectionCard
              title="Root Basin Statistics"
              isOpen={showRootBasinStats}
              onToggle={() => setShowRootBasinStats((v) => !v)}
            >
              {rootBasinStatisticsData ? (
                <>
                  <DataTable
                    columns={[
                      { key: "method", label: "Method", render: (row) => prettyMethod(row.method) },
                      { key: "num_basins", label: "Basins" },
                      { key: "dominant_root", label: "Dominant Root" },
                      {
                        key: "dominant_share",
                        label: "Dominant Share",
                        render: (row) => formatPercent(row.dominant_share),
                      },
                      { key: "total_converged", label: "Total Converged" },
                      { key: "failure_count", label: "Failure Count" },
                    ]}
                    rows={rootBasinStatisticsData.summary_table || []}
                    emptyText="No root basin statistics available."
                  />

                  <div style={styles.blockSpacer}>
                    <PlotGrid
                      entries={Object.entries(rootBasinStatisticsPlot || {}).map(
                        ([k, v]) => [k, toOutputUrl(v)]
                      )}
                      prettyMethodFn={(m) => `Root Basin Size — ${prettyMethod(m)}`}
                      altPrefix="Root basin statistics for"
                      emptyText="No root basin statistics plots available."
                    />
                  </div>

                  {interpretationSummary?.root_basin_statistics_interpretation ? (
                    <div style={styles.blockSpacer}>
                      <div style={styles.innerPanel}>
                        <div style={styles.innerPanelTitle}>
                          Basin Statistics Interpretation
                        </div>
                        <BulletList
                          items={
                            interpretationSummary
                              .root_basin_statistics_interpretation
                              .expectation_notes || []
                          }
                          emptyText="No basin-statistics interpretation available."
                        />
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <p style={styles.emptyText}>No root basin statistics available.</p>
              )}
            </SubsectionCard>

            <SubsectionCard
              title="Solver Comparison"
              isOpen={showSolverComparison}
              onToggle={() => setShowSolverComparison((v) => !v)}
            >
              {comparisonRows.length > 0 ? (
                <>
                  <DataTable
                    columns={[
                      { key: "method", label: "Method", render: (row) => prettyMethod(row.method) },
                      {
                        key: "success_rate",
                        label: "Success Rate",
                        render: (row) => formatPercent(row.success_rate),
                      },
                      {
                        key: "mean_iter",
                        label: "Mean Iter",
                        render: (row) => formatMean(row.mean_iter),
                      },
                      {
                        key: "median_iter",
                        label: "Median Iter",
                        render: (row) => formatNumber(row.median_iter),
                      },
                      {
                        key: "p95_iter",
                        label: "P95 Iter",
                        render: (row) => formatNumber(row.p95_iter),
                      },
                      {
                        key: "max_iter",
                        label: "Max Iter",
                        render: (row) => formatNumber(row.max_iter),
                      },
                      {
                        key: "failure_count",
                        label: "Failure Count",
                        render: (row) => formatNumber(row.failure_count),
                      },
                    ]}
                    rows={comparisonRows}
                    emptyText="No comparison summary available."
                  />

                  {interpretationSummary?.comparison_interpretation?.notes?.length > 0 ? (
                    <div style={styles.blockSpacer}>
                      <div style={styles.innerPanel}>
                        <div style={styles.innerPanelTitle}>Comparison Interpretation</div>
                        <BulletList
                          items={interpretationSummary.comparison_interpretation.notes}
                          emptyText="No comparison interpretation available."
                        />
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <p style={styles.emptyText}>No comparison summary available.</p>
              )}
            </SubsectionCard>

            <SubsectionCard
              title="Pareto Tradeoff Analysis"
              isOpen={showPareto}
              onToggle={() => setShowPareto((v) => !v)}
            >
              <div style={styles.plotGrid}>
                <PlotTile
                  title="Mean Iterations vs Failure Rate"
                  url={paretoMeanUrl}
                  alt="Pareto mean iterations vs failure rate"
                />
                <PlotTile
                  title="Median Iterations vs Failure Rate"
                  url={paretoMedianUrl}
                  alt="Pareto median iterations vs failure rate"
                />
              </div>

              {!paretoMeanUrl && !paretoMedianUrl ? (
                <p style={styles.emptyText}>No Pareto artifacts available.</p>
              ) : null}
            </SubsectionCard>

            <SubsectionCard
              title="Iteration Histograms"
              isOpen={showHistograms}
              onToggle={() => setShowHistograms((v) => !v)}
            >
              <PlotGrid
                entries={histogramEntries}
                prettyMethodFn={prettyMethod}
                altPrefix="Iteration histogram for"
                emptyText="No histogram artifacts available."
              />
            </SubsectionCard>

            <SubsectionCard
              title="Iteration CCDFs"
              isOpen={showCcdfs}
              onToggle={() => setShowCcdfs((v) => !v)}
            >
              <PlotGrid
                entries={ccdfEntries}
                prettyMethodFn={prettyMethod}
                altPrefix="Iteration CCDF for"
                emptyText="No CCDF artifacts available."
              />
            </SubsectionCard>
          </SectionCard>

          <SectionCard
            title="Outputs"
            isOpen={showOutputs}
            onToggle={() => setShowOutputs((v) => !v)}
            description="Downloadable files generated by the experiment, including raw records, summary artifacts, and analysis outputs."
          >
            <SubsectionCard
              title="Exported Outputs"
              isOpen={showExportedOutputs}
              onToggle={() => setShowExportedOutputs((v) => !v)}
            >
              <div style={styles.outputGrid}>
                {[
                  ["records.csv", result.records_csv],
                  ["records.json", result.records_json],
                  ["summary.json", result.summary_json],
                  ["metadata.json", result.metadata_json],
                  ["problem_expectations.json", analytics?.problem_expectations],
                  ["interpretation_summary.json", analytics?.interpretation_summary],
                  ["interpretation_summary.txt", analytics?.interpretation_summary_text],
                  ["root_basin_statistics.json", analytics?.root_basin_statistics],
                  ["comparison_summary.json", analytics?.comparison_summary],
                  ["failure_statistics.json", analytics?.failure_statistics],
                  ["root_coverage_summary.json", analytics?.root_coverage_summary],
                  ["basin_entropy.json", analytics?.basin_entropy],
                  ["basin_map.png", result?.artifacts?.basin_map],
                ]
                  .filter(([, path]) => !!path)
                  .map(([label, path]) => (
                    <a
                      key={label}
                      href={toOutputUrl(path)}
                      target="_blank"
                      rel="noreferrer"
                      style={styles.outputLink}
                    >
                      {label}
                    </a>
                  ))}
              </div>
            </SubsectionCard>
          </SectionCard>
        </div>
      ) : null}
    </div>
  );
}

const styles = {
  page: {
    maxWidth: 1520,
    margin: "0 auto",
    padding: "24px 20px 64px",
    background: "#f8fafc",
    minHeight: "100vh",
    fontFamily: "Arial, sans-serif",
    color: "#0f172a",
  },

  topNav: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 16,
    padding: "10px 0 18px",
    marginBottom: 12,
    borderBottom: "1px solid #e2e8f0",
  },

  brand: {
    fontSize: 20,
    fontWeight: 800,
    color: "#0f172a",
  },

  navLinks: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
  },

  navLink: {
    textDecoration: "none",
    color: "#334155",
    fontWeight: 700,
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid transparent",
  },

  navLinkActive: {
    textDecoration: "none",
    color: "#2563eb",
    fontWeight: 800,
    padding: "10px 14px",
    borderRadius: 12,
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
  },

  pageHeader: {
    marginBottom: 20,
  },

  pageTitle: {
    margin: 0,
    fontSize: 34,
    fontWeight: 800,
    color: "#0f172a",
  },

  pageSubtitle: {
    marginTop: 10,
    marginBottom: 0,
    fontSize: 15,
    lineHeight: 1.65,
    color: "#475569",
  },


  setupCard: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    padding: 24,
    boxShadow: "0 10px 28px rgba(15, 23, 42, 0.05)",
    marginBottom: 20,
  },

  setupTitle: {
    fontSize: 22,
    fontWeight: 800,
    marginBottom: 18,
    color: "#0f172a",
  },

  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 16,
    alignItems: "end",
  },

  label: {
    display: "block",
    fontSize: 14,
    fontWeight: 700,
    color: "#334155",
    marginBottom: 8,
  },

  input: {
    width: "100%",
    boxSizing: "border-box",
    borderRadius: 12,
    border: "1px solid #cbd5e1",
    padding: "10px 12px",
    fontSize: 14,
    background: "#ffffff",
    color: "#0f172a",
  },

  inlineInfoBox: {
    marginTop: 18,
    padding: 16,
    borderRadius: 14,
    border: "1px solid #dbeafe",
    background: "#f8fbff",
  },

  inlineInfoTitle: {
    fontSize: 15,
    fontWeight: 800,
    marginBottom: 8,
    color: "#0f172a",
  },

  inlineInfoText: {
    fontSize: 14,
    color: "#1e293b",
    marginBottom: 4,
    wordBreak: "break-word",
    lineHeight: 1.5,
  },

  inlineInfoNote: {
    marginTop: 8,
    fontSize: 13,
    color: "#64748b",
    lineHeight: 1.55,
  },

  methodsBlock: {
    marginTop: 18,
  },

  chipWrap: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
  },

  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    border: "1px solid #dbeafe",
    background: "#f8fbff",
    borderRadius: 999,
    padding: "10px 12px",
    fontSize: 14,
    color: "#1e293b",
  },

  runRow: {
    marginTop: 22,
  },

  runButton: {
    border: "none",
    borderRadius: 12,
    padding: "12px 18px",
    background: "#2563eb",
    color: "#ffffff",
    fontWeight: 800,
    fontSize: 15,
    cursor: "pointer",
  },

  runButtonDisabled: {
    opacity: 0.65,
    cursor: "not-allowed",
  },

  statusCard: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    padding: 24,
    boxShadow: "0 10px 28px rgba(15, 23, 42, 0.05)",
    marginBottom: 20,
  },

  statusRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 20,
    padding: "10px 0",
    borderBottom: "1px solid #f1f5f9",
    flexWrap: "wrap",
    fontSize: 14,
  },

  statusLabel: {
    fontWeight: 700,
    color: "#334155",
  },

  mono: {
    fontFamily: "monospace",
    wordBreak: "break-all",
    color: "#0f172a",
  },

  progressTrack: {
    marginTop: 16,
    width: "100%",
    height: 12,
    borderRadius: 999,
    background: "#e2e8f0",
    overflow: "hidden",
  },

  progressFill: {
    height: "100%",
    background: "#2563eb",
    borderRadius: 999,
    transition: "width 0.25s ease",
  },

  errorBox: {
    marginTop: 18,
    padding: 14,
    borderRadius: 12,
    background: "#fef2f2",
    border: "1px solid #fecaca",
  },

  errorTitle: {
    fontWeight: 800,
    color: "#991b1b",
    marginBottom: 6,
  },

  errorText: {
    color: "#7f1d1d",
    fontSize: 14,
    lineHeight: 1.5,
  },

  resultsWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 18,
  },

  sectionCard: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    boxShadow: "0 10px 28px rgba(15, 23, 42, 0.05)",
    overflow: "hidden",
  },

  sectionHeader: {
    width: "100%",
    border: "none",
    background: "transparent",
    padding: "22px 22px 16px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 16,
    cursor: "pointer",
    textAlign: "left",
  },

  sectionTitle: {
    fontSize: 20,
    fontWeight: 800,
    color: "#0f172a",
    marginBottom: 6,
  },

  sectionDescription: {
    fontSize: 14,
    color: "#64748b",
    lineHeight: 1.55,
  },

  sectionChevron: {
    fontSize: 18,
    color: "#334155",
    fontWeight: 700,
    paddingTop: 2,
  },

  sectionBody: {
    padding: "0 22px 22px",
  },

  subsectionCard: {
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    background: "#fbfdff",
    marginTop: 14,
    overflow: "hidden",
  },

  subsectionHeader: {
    width: "100%",
    border: "none",
    background: "transparent",
    padding: "14px 16px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    cursor: "pointer",
    textAlign: "left",
  },

  subsectionTitle: {
    fontSize: 15,
    fontWeight: 800,
    color: "#0f172a",
  },

  subsectionChevron: {
    fontSize: 16,
    color: "#475569",
    fontWeight: 700,
  },

  subsectionBody: {
    padding: "0 16px 16px",
  },

  infoGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 14,
  },

  metricCard: {
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    padding: 14,
    background: "#ffffff",
    minHeight: 88,
  },

  metricLabel: {
    fontSize: 12,
    fontWeight: 800,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    marginBottom: 8,
  },

  metricValue: {
    fontSize: 15,
    fontWeight: 700,
    color: "#0f172a",
    lineHeight: 1.5,
    wordBreak: "break-word",
  },

  innerPanel: {
    border: "1px solid #e2e8f0",
    background: "#f8fafc",
    borderRadius: 14,
    padding: 16,
  },

  innerPanelTitle: {
    fontSize: 17,
    fontWeight: 800,
    color: "#0f172a",
    marginBottom: 10,
  },

  twoColGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: 16,
  },

  blockSpacer: {
    marginTop: 16,
  },

  paragraph: {
    margin: 0,
    fontSize: 15,
    lineHeight: 1.7,
    color: "#1e293b",
  },

  rootText: {
    fontSize: 16,
    fontWeight: 700,
    color: "#0f172a",
  },

  bulletList: {
    margin: 0,
    paddingLeft: 20,
  },

  bulletItem: {
    marginBottom: 8,
    color: "#1e293b",
    lineHeight: 1.6,
    fontSize: 14,
  },

  emptyText: {
    margin: 0,
    color: "#64748b",
    fontSize: 14,
    lineHeight: 1.6,
  },

  metaText: {
    marginTop: 0,
    marginBottom: 12,
    color: "#475569",
    fontSize: 14,
  },

  tableWrap: {
    overflowX: "auto",
    background: "#ffffff",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
  },

  table: {
    width: "100%",
    borderCollapse: "collapse",
    minWidth: 760,
  },

  th: {
    textAlign: "left",
    padding: "12px 14px",
    background: "#f8fafc",
    borderBottom: "1px solid #e2e8f0",
    fontSize: 14,
    fontWeight: 800,
    color: "#334155",
    verticalAlign: "top",
  },

  td: {
    textAlign: "left",
    padding: "12px 14px",
    borderBottom: "1px solid #eef2f7",
    fontSize: 14,
    color: "#0f172a",
    verticalAlign: "top",
    lineHeight: 1.5,
  },

  plotGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
    gap: 18,
    alignItems: "start",
  },

  singlePlotWrap: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    gap: 18,
  },

  plotTile: {
    border: "1px solid #e2e8f0",
    borderRadius: 16,
    background: "#ffffff",
    padding: 14,
    minHeight: 120,
    boxShadow: "0 4px 14px rgba(15, 23, 42, 0.04)",
  },

  plotTileTitle: {
    fontSize: 15,
    fontWeight: 800,
    color: "#0f172a",
    marginBottom: 10,
    lineHeight: 1.4,
  },

  plotImage: {
    display: "block",
    width: "100%",
    height: 320,
    objectFit: "contain",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: "#ffffff",
  },


  badge: {
    display: "inline-block",
    padding: "4px 8px",
    borderRadius: 999,
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    color: "#1d4ed8",
    fontSize: 12,
    fontWeight: 800,
    textTransform: "capitalize",
    whiteSpace: "nowrap",
  },

  outputGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 12,
  },

  outputLink: {
    display: "block",
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid #dbeafe",
    background: "#f8fbff",
    color: "#1d4ed8",
    fontWeight: 800,
    textDecoration: "none",
    wordBreak: "break-word",
  },
};
