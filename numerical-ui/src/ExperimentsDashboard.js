import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
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

// Keep this conservative until boundary refinement supports more methods well.
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

function SummaryCard({ label, value }) {
  return (
    <div style={styles.summaryCard}>
      <div style={styles.summaryLabel}>{label}</div>
      <div style={styles.summaryValue}>{value || "-"}</div>
    </div>
  );
}

function SectionCard({ title, isOpen, onToggle, description, children }) {
  return (
    <div style={styles.section}>
      <div style={styles.card}>
        <button type="button" onClick={onToggle} style={styles.sectionToggle}>
          <span>{title}</span>
          <span>{isOpen ? "▾" : "▸"}</span>
        </button>
        {isOpen && (
          <div style={{ marginTop: 12 }}>
            {description ? (
              <p style={styles.sectionDescription}>{description}</p>
            ) : null}
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

function PlotGrid({ entries, emptyText, altPrefix, prettyMethod }) {
  const [hidden, setHidden] = useState({});

  const visibleEntries = (entries || []).filter(([name]) => !hidden[name]);

  if (visibleEntries.length === 0) {
    return <p style={styles.mutedText}>{emptyText}</p>;
  }

  return (
    <div style={styles.plotGrid}>
      {visibleEntries.map(([name, url]) => (
        <div key={name} style={styles.plotCard}>
          <div style={styles.plotCardTitle}>{prettyMethod(name)}</div>
          <img
            src={url}
            alt={`${altPrefix} ${name}`}
            style={styles.plotImage}
            onError={() =>
              setHidden((prev) => ({
                ...prev,
                [name]: true,
              }))
            }
          />
        </div>
      ))}
    </div>
  );
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

  const {
    backendStatus,
    statusMessage,
    isPreparingRun,
    wakeBackendOnly,
    runWithWarmup,
  } = useBackendWarmup({ autoPoll: true, pollIntervalMs: 25000 });

  const [showInitializationSampling, setShowInitializationSampling] =
    useState(true);
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

  // Parent grouped sections
  const [showInterpretation, setShowInterpretation] = useState(true);
  const [showOverview, setShowOverview] = useState(true);
  const [showBasinGeometry, setShowBasinGeometry] = useState(true);
  const [showSolverStability, setShowSolverStability] = useState(true);
  const [showStatDiagnostics, setShowStatDiagnostics] = useState(true);
  const [showOutputsSection, setShowOutputsSection] = useState(false);

  // Child sections
  const [showBoundaryAnalysis, setShowBoundaryAnalysis] = useState(true);
  const [showBasinMap, setShowBasinMap] = useState(true);
  const [showBasinComplexity, setShowBasinComplexity] = useState(true);
  const [showBasinDistribution, setShowBasinDistribution] = useState(false);
  const [showRootBasinSize, setShowRootBasinSize] = useState(false);

  const [showFailureRegions, setShowFailureRegions] = useState(false);

  const [showSolverComparison, setShowSolverComparison] = useState(true);
  const [showPareto, setShowPareto] = useState(true);
  const [showHistograms, setShowHistograms] = useState(false);
  const [showCcdfs, setShowCcdfs] = useState(false);

  const [showArtifacts, setShowArtifacts] = useState(true);

  const [showInitializationHistograms, setShowInitializationHistograms] =
    useState(true);
  const [showInitialGuessVsRoot, setShowInitialGuessVsRoot] = useState(true);
  const [showInitialGuessVsIterations, setShowInitialGuessVsIterations] =
    useState(true);

  const pollRef = useRef(null);

  const benchmarkInfo = BENCHMARK_DETAILS[problemId] || null;

  useEffect(() => {
    return () => {
      stopPolling();
    };
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

  function prettyMethod(name) {
    if (!name) return "-";
    return String(name)
      .replaceAll("_", " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function validateInputs() {
    if (!Array.isArray(selectedMethods) || selectedMethods.length === 0) {
      throw new Error("Select at least one method.");
    }

    const numericNPoints = Number(nPoints);
    const numericTol = Number(tol);
    const numericMaxIter = Number(maxIter);
    const numericNSamples = Number(nSamples);
    const numericGaussianMean = Number(gaussianMean);
    const numericGaussianStd = Number(gaussianStd);

    const sMin = Number(scalarMin);
    const sMax = Number(scalarMax);
    const bMin = Number(bracketMin);
    const bMax = Number(bracketMax);

    if (!Number.isFinite(numericTol) || numericTol <= 0) {
      throw new Error("Tolerance must be a positive number.");
    }

    if (!Number.isFinite(numericMaxIter) || numericMaxIter < 1) {
      throw new Error("Max Iter must be at least 1.");
    }

    if (!Number.isFinite(sMin) || !Number.isFinite(sMax) || sMin >= sMax) {
      throw new Error("Scalar/domain range is invalid. Ensure min < max.");
    }

    if (!Number.isFinite(bMin) || !Number.isFinite(bMax) || bMin >= bMax) {
      throw new Error("Bracket search range is invalid. Ensure min < max.");
    }

    if (samplingMode === "grid") {
      if (!Number.isFinite(numericNPoints) || numericNPoints < 2) {
        throw new Error("Points must be at least 2 for grid mode.");
      }
    }

    if (samplingMode === "uniform") {
      if (!Number.isFinite(numericNSamples) || numericNSamples < 1) {
        throw new Error("Number of samples must be at least 1 for uniform mode.");
      }
    }

    if (samplingMode === "gaussian") {
      if (!Number.isFinite(numericNSamples) || numericNSamples < 1) {
        throw new Error("Number of samples must be at least 1 for gaussian mode.");
      }
      if (!Number.isFinite(numericGaussianMean)) {
        throw new Error("Gaussian mean must be a valid number.");
      }
      if (!Number.isFinite(numericGaussianStd) || numericGaussianStd <= 0) {
        throw new Error("Gaussian standard deviation must be positive.");
      }
    }

    if (problemMode === "benchmark") {
      if (!problemId) {
        throw new Error("Select a benchmark problem.");
      }
      return;
    }

    if (!String(expr || "").trim()) {
      throw new Error("Custom expression f(x) is required.");
    }
  }

  function buildPayload() {
    const numericNPoints = Number(nPoints);
    const numericTol = Number(tol);
    const numericMaxIter = Number(maxIter);
    const numericNSamples = Number(nSamples);
    const numericSeed = Number(randomSeed);
    const numericGaussianMean = Number(gaussianMean);
    const numericGaussianStd = Number(gaussianStd);

    const sMin = Number(scalarMin);
    const sMax = Number(scalarMax);
    const bMin = Number(bracketMin);
    const bMax = Number(bracketMax);

    if (problemMode === "custom") {
      const payload = {
        problem_mode: "custom",
        problem_id: null,
        expr: String(expr || "").trim(),
        dexpr: String(dexpr || "").trim(),
        methods: selectedMethods,
        sampling_mode: samplingMode,
        tol: numericTol,
        max_iter: numericMaxIter,
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

      if (samplingMode === "grid") {
        payload.n_points = numericNPoints;
        payload.x_min = sMin;
        payload.x_max = sMax;
        payload.scalar_range.n_points = numericNPoints;
        payload.bracket_search_range.n_points = numericNPoints;
      }

      if (samplingMode === "uniform") {
        payload.n_samples = numericNSamples;
        payload.random_seed = numericSeed;
      }

      if (samplingMode === "gaussian") {
        payload.n_samples = numericNSamples;
        payload.random_seed = numericSeed;
        payload.gaussian_mean = numericGaussianMean;
        payload.gaussian_std = numericGaussianStd;
      }

      return payload;
    }

    const payload = {
      problem_mode: "benchmark",
      problem_id: problemId,
      methods: selectedMethods,
      sampling_mode: samplingMode,
      tol: numericTol,
      max_iter: numericMaxIter,
      boundary_method: boundaryMethod,
      x_min: sMin,
      x_max: sMax,
      scalar_range: {
        x_min: sMin,
        x_max: sMax,
      },
      bracket_search_range: {
        x_min: bMin,
        x_max: bMax,
      },
    };

    if (samplingMode === "grid") {
      payload.n_points = numericNPoints;
      payload.scalar_range.n_points = numericNPoints;
      payload.bracket_search_range.n_points = numericNPoints;
    }

    if (samplingMode === "uniform") {
      payload.n_samples = numericNSamples;
      payload.random_seed = numericSeed;
    }

    if (samplingMode === "gaussian") {
      payload.n_samples = numericNSamples;
      payload.random_seed = numericSeed;
      payload.gaussian_mean = numericGaussianMean;
      payload.gaussian_std = numericGaussianStd;
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
      console.log("SWEEP PAYLOAD:", payload);

      const data = await runWithWarmup(
        async () => {
          const res = await fetch(`${API}/experiments/sweep`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          });

          if (!res.ok) {
            const text = await res.text();
            throw new Error(
              `Failed to create experiment job: ${res.status} ${text}`
            );
          }

          return res.json();
        },
        {
          startMessage: "Compute engine ready. Starting sweep experiment...",
          doneMessage: "Sweep submitted successfully.",
        }
      );

      console.log("SWEEP RESPONSE:", data);

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
        console.log("JOB STATUS:", data);
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
        return next.length > 0 ? next : [selected];
      }
      return [...prev, selected];
    });
  }

  function toOutputUrl(path) {
    if (!path) return null;
    if (
      String(path).startsWith("http://") ||
      String(path).startsWith("https://")
    ) {
      return path;
    }
    return `${API}${
      String(path).startsWith("/") ? "" : "/"
    }${String(path).replace(/\\/g, "/")}`;
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

  function formatNumber(x) {
    const num = Number(x);
    if (!Number.isFinite(num)) return "-";
    return Number.isInteger(num) ? String(num) : num.toFixed(4);
  }

  function formatEntropy(x) {
    const num = Number(x);
    if (!Number.isFinite(num)) return "-";
    return num.toFixed(4);
  }

  function normalizePlotEntries(entries) {
    return (entries || [])
      .map(([name, path]) => [name, toOutputUrl(path)])
      .filter(([, url]) => !!url);
  }

  function renderArtifactLink(label, path) {
    const url = toOutputUrl(path);
    if (!url) return null;

    return (
      <a
        key={label}
        href={url}
        target="_blank"
        rel="noreferrer"
        style={styles.artifactLink}
      >
        {label}
      </a>
    );
  }
  

  const analyticsKey =
    result?.problem_id ||
    (problemMode === "benchmark" ? problemId : "custom");

  const analytics =
    result?.artifacts?.analytics?.[analyticsKey] ||
    result?.artifacts?.analytics?.custom ||
    null;

  const basinMapUrl =
    toOutputUrl(result?.artifacts?.basin_map) ||
    toOutputUrl(analytics?.basin_map);

  const basinEntropyPlotUrl =
    toOutputUrl(analytics?.basin_entropy_plot) ||
    toOutputUrl(analytics?.basin_entropy_comparison_plot);

  const comparisonRows = analytics?.comparison_summary_data?.methods || [];
  const entropyRows = analytics?.basin_entropy_data?.methods || [];

  const paretoMeanUrl = toOutputUrl(analytics?.pareto?.mean_vs_failure);
  const paretoMedianUrl = toOutputUrl(analytics?.pareto?.median_vs_failure);

  const rootCoverageData = analytics?.root_coverage_data || null;
  const rootCoveragePlot = analytics?.root_coverage_plot || null;

  const rootBasinStatisticsData = analytics?.root_basin_statistics_data || null;
  const rootBasinStatisticsPlot = analytics?.root_basin_statistics_plot || {};

  const basinDistributionEntries = normalizePlotEntries(
    analytics?.basin_distribution ? Object.entries(analytics.basin_distribution) : []
  );

  const rootDistributionEntries = normalizePlotEntries(
    analytics?.basin_root_distribution
      ? Object.entries(analytics.basin_root_distribution)
      : []
  );

  const detectedRoots = Array.from(
    new Set(
      (entropyRows || []).flatMap((row) =>
        row?.basin_counts ? Object.keys(row.basin_counts) : []
      )
    )
  ).sort((a, b) => Number(a) - Number(b));

  const initializationHistogramEntries = normalizePlotEntries(
    analytics?.initialization_histogram
      ? Object.entries(analytics.initialization_histogram)
      : []
  );

  const initialXVsRootEntries = normalizePlotEntries(
    analytics?.initial_x_vs_root
      ? Object.entries(analytics.initial_x_vs_root)
      : []
  );

  const initialXVsIterationsEntries = normalizePlotEntries(
    analytics?.initial_x_vs_iterations
      ? Object.entries(analytics.initial_x_vs_iterations)
      : []
  );

  const histogramEntries = normalizePlotEntries(
    analytics?.histogram ? Object.entries(analytics.histogram) : []
  );

  const ccdfEntries = normalizePlotEntries(
    analytics?.ccdf ? Object.entries(analytics.ccdf) : []
  );

  const failureRegionEntries = normalizePlotEntries(
    analytics?.failure_region ? Object.entries(analytics.failure_region) : []
  );

  const boundaryRegions = Array.isArray(result?.boundaries)
    ? result.boundaries
    : [];
  const rawBoundaries = Array.isArray(result?.raw_boundaries)
    ? result.raw_boundaries
    : [];
  const boundarySummary = result?.boundary_summary || null;
  const boundaryClusterTol = result?.boundary_cluster_tol;

  const boundarySummaryText = boundarySummary
    ? `${boundarySummary.clustered_count ?? boundaryRegions.length} regions (${
        boundarySummary.raw_count ?? rawBoundaries.length
      } raw)`
    : boundaryRegions.length > 0
      ? `${boundaryRegions.length} regions`
      : "None";

  const clusterTol = analytics?.basin_entropy_data?.cluster_tol;

  const totalMethods = selectedMethods.length;
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

    if (boundarySummary && boundarySummary.clustered_count !== undefined) {
      insights.push(
        `Boundary analysis detected ${boundarySummary.clustered_count} clustered transition region(s), indicating where solver behavior changes across initializations.`
      );
    }

    if (rootDistributionEntries.length > 0) {
      insights.push(
        "Basin distribution plots show how different initializations are attracted to different roots, revealing solver sensitivity to starting conditions."
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
      return `${prettyMethod(reliable)} is the best overall choice here because it achieves the highest success rate while also converging fastest on average.`;
    }

    if (reliable && reliable === stable) {
      return `${prettyMethod(reliable)} provides the most reliable performance with the lowest observed failure risk.`;
    }

    return `${prettyMethod(reliable)} is the most reliable solver, while ${prettyMethod(fastest)} offers the fastest convergence. The best choice depends on whether robustness or speed is more important for this problem.`;
  }

  const effectiveSamplingMode = result?.sampling_mode || samplingMode;
  const effectiveSampleCount =
    effectiveSamplingMode === "grid"
      ? result?.n_points ?? nPoints
      : result?.n_samples ?? nSamples;

  const overviewExpr =
    result?.expr ||
    (problemMode === "benchmark" ? benchmarkInfo?.expr : expr) ||
    "-";

  const overviewDexpr =
    result?.dexpr ||
    (problemMode === "benchmark" ? benchmarkInfo?.dexpr : dexpr) ||
    "-";

  const overviewRangeMin =
    result?.scalar_range?.[0] ?? result?.scalar_range?.x_min ?? scalarMin;
  const overviewRangeMax =
    result?.scalar_range?.[1] ?? result?.scalar_range?.x_max ?? scalarMax;

  return (
    <div style={styles.page}>
      <div style={styles.breadcrumbRow}>
        <Link to="/" style={styles.navButton}>
          ← Home
        </Link>
        <Link to="/experiments" style={styles.navButtonSecondary}>
          Experiments
        </Link>
        <Link to="/experiment-jobs" style={styles.navButtonSecondary}>
          Experiment Jobs
        </Link>
      </div>

      <div style={styles.headerBlock}>
        <h1 style={styles.pageTitle}>Experiment Dashboard</h1>
        <p style={styles.pageSubtitle}>
          Launch sweep experiments, monitor job progress, and analyze basin and
          iteration statistics across nonlinear solvers.
        </p>
      </div>

      <div style={styles.card}>
        <h2 style={styles.sectionTitle}>Experiment Setup</h2>

        <div style={styles.controlsGrid}>
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
            <>
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

              <div style={{ gridColumn: "1 / -1" }}>
                <div style={styles.problemInfoBox}>
                  <div style={styles.problemInfoTitle}>
                    Benchmark Definition
                  </div>
                  <div style={styles.problemInfoText}>
                    <b>f(x)</b> = {benchmarkInfo?.expr || "-"}
                  </div>
                  <div style={styles.problemInfoText}>
                    <b>f&apos;(x)</b> = {benchmarkInfo?.dexpr || "-"}
                  </div>
                  {benchmarkInfo?.note ? (
                    <div style={styles.problemInfoNote}>{benchmarkInfo.note}</div>
                  ) : null}
                </div>
              </div>

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
            </>
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

              <div>
                <label style={styles.label}>Scalar Range Min</label>
                <input
                  type="number"
                  value={scalarMin}
                  onChange={(e) => setScalarMin(e.target.value)}
                  disabled={running || isPreparingRun}
                  style={styles.input}
                />
              </div>

              <div>
                <label style={styles.label}>Scalar Range Max</label>
                <input
                  type="number"
                  value={scalarMax}
                  onChange={(e) => setScalarMax(e.target.value)}
                  disabled={running || isPreparingRun}
                  style={styles.input}
                />
              </div>

              <div>
                <label style={styles.label}>Bracket Range Min</label>
                <input
                  type="number"
                  value={bracketMin}
                  onChange={(e) => setBracketMin(e.target.value)}
                  disabled={running || isPreparingRun}
                  style={styles.input}
                />
              </div>

              <div>
                <label style={styles.label}>Bracket Range Max</label>
                <input
                  type="number"
                  value={bracketMax}
                  onChange={(e) => setBracketMax(e.target.value)}
                  disabled={running || isPreparingRun}
                  style={styles.input}
                />
              </div>
            </>
          )}

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

          {samplingMode === "grid" && (
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
          )}

          {samplingMode === "uniform" && (
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
                  min="0.0000001"
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

        <BackendWarmupPanel
          backendStatus={backendStatus}
          statusMessage={statusMessage}
          isPreparingRun={isPreparingRun}
          onWake={() =>
            wakeBackendOnly({ onError: (err) => setError(err.message) })
          }
          disabled={running}
        />

        <div style={{ marginTop: 20 }}>
          <label style={styles.label}>Methods to Compare</label>
          <div style={styles.methodsWrap}>
            {METHOD_OPTIONS.map((m) => (
              <label key={m} style={styles.methodChip}>
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

        <div style={{ marginTop: 22 }}>
          <button
            onClick={runSweep}
            disabled={running || isPreparingRun}
            style={{
              ...styles.runButton,
              ...(running || isPreparingRun ? styles.runButtonDisabled : {}),
            }}
          >
            {isPreparingRun
              ? "Preparing..."
              : running
                ? "Running..."
                : "Run Sweep Experiment"}
          </button>
        </div>
      </div>

      {(jobId || jobStatus || error) && (
        <div style={styles.section}>
          <div style={styles.card}>
            <h2 style={styles.sectionTitle}>Job Status</h2>

            {jobId && (
              <div style={styles.statusRow}>
                <span style={styles.statusLabel}>Job ID</span>
                <span style={styles.monoText}>{jobId}</span>
              </div>
            )}

            {jobStatus && (
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
            )}

            {error && (
              <div style={styles.errorBox}>
                <h3 style={styles.errorTitle}>Error</h3>
                <p style={styles.errorText}>{error}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {result && (
        <div style={styles.section}>
          <h2 style={styles.resultsTitle}>Experiment Analysis</h2>

          <SectionCard
            title="Automated Experiment Interpretation"
            isOpen={showInterpretation}
            onToggle={() => setShowInterpretation((v) => !v)}
            description="Automatically generated observations and recommendations from the current experiment."
          >
            <div style={styles.interpretationGrid}>
              <div style={styles.cardMuted}>
                <h3 style={styles.subsectionTitle}>Key Observations</h3>
                {generateInsights().length > 0 ? (
                  <ul style={styles.insightList}>
                    {generateInsights().map((text, i) => (
                      <li key={i} style={styles.insightItem}>
                        {text}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p style={styles.mutedText}>No observations available yet.</p>
                )}
              </div>

              <div style={styles.cardMuted}>
                <h3 style={styles.subsectionTitle}>Suggested Solver Choice</h3>
                <p style={styles.recommendationText}>{suggestSolverChoice()}</p>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="Overview"
            isOpen={showOverview}
            onToggle={() => setShowOverview((v) => !v)}
            description="High-level summary of the experiment configuration, detected roots, and the main findings from the sweep."
          >
            <div style={styles.summaryGrid}>
              <SummaryCard
                label="Problem Mode"
                value={result.problem_mode || problemMode}
              />
              <SummaryCard
                label="Problem"
                value={result.problem_id || analyticsKey}
              />
              <SummaryCard
                label="Sampling Mode"
                value={effectiveSamplingMode}
              />
              <SummaryCard
                label={
                  effectiveSamplingMode === "grid" ? "Points" : "Sample Count"
                }
                value={String(effectiveSampleCount)}
              />
              {effectiveSamplingMode === "grid" && (
                <SummaryCard
                  label="Range"
                  value={`[${formatNumber(overviewRangeMin)}, ${formatNumber(
                    overviewRangeMax
                  )}]`}
                />
              )}
              <SummaryCard
                label="Random Seed"
                value={
                  effectiveSamplingMode === "grid"
                    ? "-"
                    : result?.random_seed ?? randomSeed
                }
              />
              <SummaryCard
                label="Boundary Method"
                value={prettyMethod(boundaryMethod)}
              />
              <SummaryCard
                label="Methods"
                value={selectedMethods.map(prettyMethod).join(", ")}
              />
              <SummaryCard
                label="Sweep Folder"
                value={result.latest_sweep_dir || "-"}
              />
              <SummaryCard
                label="Boundary Regions"
                value={boundarySummaryText}
              />
            </div>

            <div style={styles.subsectionSpacer}>
              <div style={styles.cardMuted}>
                <h3 style={styles.subsectionTitle}>Problem Definition</h3>
                <div style={styles.problemInfoText}>
                  <b>f(x)</b> = {overviewExpr}
                </div>
                <div style={styles.problemInfoText}>
                  <b>f&apos;(x)</b> = {overviewDexpr}
                </div>
              </div>
            </div>

            <div style={styles.subsectionSpacer}>
              <div style={styles.cardMuted}>
                <h3 style={styles.subsectionTitle}>Detected Real Roots</h3>
                {detectedRoots.length > 0 ? (
                  <div style={{ fontSize: 16, fontWeight: 600 }}>
                    {detectedRoots.join(", ")}
                  </div>
                ) : (
                  <p style={styles.mutedText}>
                    Root locations inferred from basin clustering are not yet
                    available for this experiment.
                  </p>
                )}
              </div>
            </div>

            <div style={styles.subsectionSpacer}>
              <div style={styles.cardMuted}>
                <h3 style={styles.subsectionTitle}>Key Findings</h3>
                <div style={styles.keyFindingsGrid}>
                  <SummaryCard
                    label="Methods Compared"
                    value={String(totalMethods)}
                  />
                  <SummaryCard
                    label="Best Success Rate"
                    value={
                      bestSuccessMethod
                        ? `${prettyMethod(bestSuccessMethod.method)} (${formatPercent(
                            bestSuccessMethod.success_rate
                          )})`
                        : "-"
                    }
                  />
                  <SummaryCard
                    label="Fastest Median"
                    value={
                      fastestMedianMethod
                        ? `${prettyMethod(fastestMedianMethod.method)} (${formatNumber(
                            fastestMedianMethod.median_iter
                          )})`
                        : "-"
                    }
                  />
                  <SummaryCard
                    label="Lowest Failures"
                    value={
                      mostStableMethod
                        ? `${prettyMethod(mostStableMethod.method)} (${formatNumber(
                            mostStableMethod.failure_count
                          )})`
                        : "-"
                    }
                  />
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="Basin Geometry"
            isOpen={showBasinGeometry}
            onToggle={() => setShowBasinGeometry((v) => !v)}
            description="Geometry of solver basins, basin transitions, entropy, and root attractor regions."
          >
            <SectionCard
              title="Boundary Analysis"
              isOpen={showBoundaryAnalysis}
              onToggle={() => setShowBoundaryAnalysis((v) => !v)}
            >
              {boundarySummary ? (
                <>
                  <div style={styles.summaryGrid}>
                    <SummaryCard
                      label="Clustered Regions"
                      value={String(boundarySummary.clustered_count ?? "-")}
                    />
                    <SummaryCard
                      label="Raw Boundary Points"
                      value={String(boundarySummary.raw_count ?? "-")}
                    />
                    <SummaryCard
                      label="Leftmost Boundary"
                      value={formatNumber(boundarySummary.leftmost)}
                    />
                    <SummaryCard
                      label="Rightmost Boundary"
                      value={formatNumber(boundarySummary.rightmost)}
                    />
                    <SummaryCard
                      label="Median Spacing"
                      value={formatNumber(boundarySummary.median_spacing)}
                    />
                    <SummaryCard
                      label="Cluster Tolerance"
                      value={formatNumber(boundaryClusterTol)}
                    />
                  </div>

                  <div style={{ marginTop: 18 }}>
                    {boundaryRegions.length > 0 ? (
                      <div style={styles.tableWrap}>
                        <table style={styles.table}>
                          <thead>
                            <tr>
                              <th style={styles.th}>Region</th>
                              <th style={styles.th}>Center</th>
                              <th style={styles.th}>Start</th>
                              <th style={styles.th}>End</th>
                              <th style={styles.th}>Width</th>
                              <th style={styles.th}>Raw Points</th>
                            </tr>
                          </thead>
                          <tbody>
                            {boundaryRegions.map((region) => (
                              <tr key={`boundary-region-${region.region_id}`}>
                                <td style={styles.td}>{region.region_id}</td>
                                <td style={styles.td}>
                                  {formatNumber(region.center)}
                                </td>
                                <td style={styles.td}>
                                  {formatNumber(region.start)}
                                </td>
                                <td style={styles.td}>
                                  {formatNumber(region.end)}
                                </td>
                                <td style={styles.td}>
                                  {formatNumber(region.width)}
                                </td>
                                <td style={styles.td}>
                                  {formatNumber(region.count)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p style={styles.mutedText}>
                        No clustered boundary regions available.
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <p style={styles.mutedText}>No boundary summary available.</p>
              )}
            </SectionCard>

            <SectionCard
              title="Basin Map"
              isOpen={showBasinMap}
              onToggle={() => setShowBasinMap((v) => !v)}
            >
              {basinMapUrl ? (
                <img
                  src={basinMapUrl}
                  alt="Basin map"
                  style={styles.basinImage}
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              ) : (
                <p style={styles.mutedText}>No basin map available.</p>
              )}
            </SectionCard>

            <SectionCard
              title="Basin Complexity"
              isOpen={showBasinComplexity}
              onToggle={() => setShowBasinComplexity((v) => !v)}
            >
              {clusterTol !== undefined && clusterTol !== null && (
                <p style={styles.metaText}>
                  <b>Cluster tolerance:</b> {formatNumber(clusterTol)} (based on
                  sweep resolution)
                </p>
              )}

              {basinEntropyPlotUrl ? (
                <div style={styles.plotGrid}>
                  <div style={styles.plotCard}>
                    <div style={styles.plotCardTitle}>
                      Basin Entropy Comparison
                    </div>
                    <img
                      src={basinEntropyPlotUrl}
                      alt="Basin entropy comparison"
                      style={styles.plotImage}
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  </div>
                </div>
              ) : (
                <p style={styles.mutedText}>
                  No basin entropy comparison plot available.
                </p>
              )}

              {entropyRows.length > 0 ? (
                <div style={styles.tableWrap}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Method</th>
                        <th style={styles.th}>Entropy</th>
                        <th style={styles.th}>Basins</th>
                        <th style={styles.th}>Converged Runs</th>
                        <th style={styles.th}>Cluster Tol</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entropyRows.map((row) => (
                        <tr key={`entropy-${prettyMethod(row.method)}`}>
                          <td style={styles.td}>{prettyMethod(row.method)}</td>
                          <td style={styles.td}>
                            {formatEntropy(row.entropy)}
                          </td>
                          <td style={styles.td}>
                            {formatNumber(row.num_basins)}
                          </td>
                          <td style={styles.td}>
                            {formatNumber(row.total_converged)}
                          </td>
                          <td style={styles.td}>
                            {formatNumber(row.cluster_tol)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={styles.mutedText}>
                  No basin entropy metrics available.
                </p>
              )}
            </SectionCard>

            <SectionCard
              title="Basin Distribution Plots"
              isOpen={showBasinDistribution}
              onToggle={() => setShowBasinDistribution((v) => !v)}
            >
              <PlotGrid
                entries={basinDistributionEntries}
                emptyText="No basin distribution artifacts available."
                altPrefix="Basin distribution for"
                prettyMethod={prettyMethod}
              />
            </SectionCard>

            <SectionCard
              title="Root Basin Size"
              isOpen={showRootBasinSize}
              onToggle={() => setShowRootBasinSize((v) => !v)}
            >
              <PlotGrid
                entries={rootDistributionEntries}
                emptyText="No root basin distribution available."
                altPrefix="Root basin distribution for"
                prettyMethod={prettyMethod}
              />
            </SectionCard>
          </SectionCard>

          <SectionCard
            title="Initialization Sampling"
            isOpen={showInitializationSampling}
            onToggle={() => setShowInitializationSampling((v) => !v)}
            description="Diagnostics showing where initial guesses were sampled and how they relate to convergence outcomes."
          >
            <SectionCard
              title="Initialization Histograms"
              isOpen={showInitializationHistograms}
              onToggle={() => setShowInitializationHistograms((v) => !v)}
            >
              <PlotGrid
                entries={initializationHistogramEntries}
                emptyText="No initialization histogram artifacts available."
                altPrefix="Initialization histogram for"
                prettyMethod={prettyMethod}
              />
            </SectionCard>

            <SectionCard
              title="Initial Guess vs Converged Root"
              isOpen={showInitialGuessVsRoot}
              onToggle={() => setShowInitialGuessVsRoot((v) => !v)}
            >
              <PlotGrid
                entries={initialXVsRootEntries}
                emptyText="No initial guess vs root artifacts available."
                altPrefix="Initial guess vs converged root for"
                prettyMethod={prettyMethod}
              />
            </SectionCard>

            <SectionCard
              title="Initial Guess vs Iterations"
              isOpen={showInitialGuessVsIterations}
              onToggle={() => setShowInitialGuessVsIterations((v) => !v)}
            >
              <PlotGrid
                entries={initialXVsIterationsEntries}
                emptyText="No initial guess vs iterations artifacts available."
                altPrefix="Initial guess vs iterations for"
                prettyMethod={prettyMethod}
              />
            </SectionCard>
          </SectionCard>

          <SectionCard
            title="Solver Stability"
            isOpen={showSolverStability}
            onToggle={() => setShowSolverStability((v) => !v)}
            description="Regions where solvers fail, diverge, or exhibit unstable convergence."
          >
            <SectionCard
              title="Failure Region Plots"
              isOpen={showFailureRegions}
              onToggle={() => setShowFailureRegions((v) => !v)}
            >
              <PlotGrid
                entries={failureRegionEntries}
                emptyText="No failure region artifacts available."
                altPrefix="Failure region for"
                prettyMethod={prettyMethod}
              />
            </SectionCard>
          </SectionCard>

          <SectionCard
            title="Statistical Diagnostics"
            isOpen={showStatDiagnostics}
            onToggle={() => setShowStatDiagnostics((v) => !v)}
            description="Summarizes aggregate solver performance, convergence efficiency, failure behavior, and tail-risk across all sampled initializations."
          >
            
            <SectionCard
              title="Root Coverage"
              isOpen={true}
              onToggle={() => {}}
            >
              {rootCoverageData ? (
                <>
                  <div style={styles.summaryGrid}>
                    <SummaryCard
                      label="Total Roots Detected"
                      value={rootCoverageData.total_roots_detected}
                    />
                    <SummaryCard
                      label="Global Roots"
                      value={(rootCoverageData.global_roots || []).join(", ")}
                    />
                  </div>

                  <div style={{ marginTop: 16 }}>

                    <div style={styles.tableWrap}>
                      <table style={styles.table}>
                        <thead>
                          <tr>
                            <th style={styles.th}>Solver</th>
                            <th style={styles.th}>Roots Found</th>
                            <th style={styles.th}>Total Roots</th>
                            <th style={styles.th}>Coverage</th>
                            <th style={styles.th}>Found Roots</th>
                          </tr>
                        </thead>

                        <tbody>
                          {Object.entries(rootCoverageData.solvers || {}).map(
                            ([solver, info]) => (
                              <tr key={solver}>
                                <td style={styles.td}>{prettyMethod(solver)}</td>
                                <td style={styles.td}>{info.roots_found}</td>
                                <td style={styles.td}>{info.total_roots}</td>
                                <td style={styles.td}>
                                  {formatPercent(info.coverage)}
                                </td>
                                <td style={styles.td}>
                                  {(info.found_roots || []).join(", ")}
                                </td>
                              </tr>
                            )
                          )}
                        </tbody>
                      </table>
                    </div>

                    {rootCoveragePlot && (
                      <div style={{ marginTop: 18 }}>
                        <img
                          src={toOutputUrl(rootCoveragePlot)}
                          alt="Root coverage comparison"
                          style={styles.plotImage}
                        />
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <p style={styles.mutedText}>No root coverage data available.</p>
              )}
            </SectionCard>
            
            <SectionCard
              title="Root Basin Statistics"
              isOpen={false}
              onToggle={() => {}}
            >
              {rootBasinStatisticsData ? (
                <>
                  <div style={styles.tableWrap}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.th}>Method</th>
                          <th style={styles.th}>Basins</th>
                          <th style={styles.th}>Dominant Root</th>
                          <th style={styles.th}>Dominant Share</th>
                          <th style={styles.th}>Total Converged</th>
                          <th style={styles.th}>Failure Count</th>
                        </tr>
                      </thead>

                      <tbody>
                        {rootBasinStatisticsData.summary_table.map((row) => (
                          <tr key={row.method}>
                            <td style={styles.td}>{prettyMethod(row.method)}</td>
                            <td style={styles.td}>{row.num_basins}</td>
                            <td style={styles.td}>{row.dominant_root}</td>
                            <td style={styles.td}>
                              {formatPercent(row.dominant_share)}
                            </td>
                            <td style={styles.td}>{row.total_converged}</td>
                            <td style={styles.td}>{row.failure_count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div style={{ marginTop: 20 }}>
                    {Object.entries(rootBasinStatisticsPlot || {}).map(
                      ([method, path]) => (
                        <div key={method} style={{ marginBottom: 20 }}>
                          <div style={styles.plotCardTitle}>
                            Root Basin Size — {prettyMethod(method)}
                          </div>

                          <img
                            src={toOutputUrl(path)}
                            alt={`Root basin statistics ${method}`}
                            style={styles.plotImage}
                          />
                        </div>
                      )
                    )}
                  </div>
                </>
              ) : (
                <p style={styles.mutedText}>No root basin statistics available.</p>
              )}
            </SectionCard>

            <SectionCard
              title="Solver Comparison"
              isOpen={showSolverComparison}
              onToggle={() => setShowSolverComparison((v) => !v)}
            >
              {comparisonRows.length > 0 ? (
                <div style={styles.tableWrap}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Method</th>
                        <th style={styles.th}>Success Rate</th>
                        <th style={styles.th}>Mean Iter</th>
                        <th style={styles.th}>Median Iter</th>
                        <th style={styles.th}>P95 Iter</th>
                        <th style={styles.th}>Max Iter</th>
                        <th style={styles.th}>Failure Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparisonRows.map((row) => (
                        <tr key={prettyMethod(row.method)}>
                          <td style={styles.td}>{prettyMethod(row.method)}</td>
                          <td style={styles.td}>
                            {formatPercent(row.success_rate)}
                          </td>
                          <td style={styles.td}>{formatMean(row.mean_iter)}</td>
                          <td style={styles.td}>
                            {formatNumber(row.median_iter)}
                          </td>
                          <td style={styles.td}>
                            {formatNumber(row.p95_iter)}
                          </td>
                          <td style={styles.td}>
                            {formatNumber(row.max_iter)}
                          </td>
                          <td style={styles.td}>
                            {formatNumber(row.failure_count)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={styles.mutedText}>
                  No comparison summary available.
                </p>
              )}
            </SectionCard>

            <SectionCard
              title="Pareto Tradeoff Analysis"
              isOpen={showPareto}
              onToggle={() => setShowPareto((v) => !v)}
            >
              {paretoMeanUrl || paretoMedianUrl ? (
                <div style={styles.plotGrid}>
                  {paretoMeanUrl && (
                    <div style={styles.plotCard}>
                      <div style={styles.plotCardTitle}>
                        Mean Iterations vs Failure Rate
                      </div>
                      <img
                        src={paretoMeanUrl}
                        alt="Pareto mean iterations vs failure rate"
                        style={styles.plotImage}
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    </div>
                  )}

                  {paretoMedianUrl && (
                    <div style={styles.plotCard}>
                      <div style={styles.plotCardTitle}>
                        Median Iterations vs Failure Rate
                      </div>
                      <img
                        src={paretoMedianUrl}
                        alt="Pareto median iterations vs failure rate"
                        style={styles.plotImage}
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    </div>
                  )}
                </div>
              ) : (
                <p style={styles.mutedText}>No Pareto artifacts available.</p>
              )}
            </SectionCard>

            <SectionCard
              title="Iteration Histograms"
              isOpen={showHistograms}
              onToggle={() => setShowHistograms((v) => !v)}
            >
              <PlotGrid
                entries={histogramEntries}
                emptyText="No histogram artifacts available."
                altPrefix="Iteration histogram for"
                prettyMethod={prettyMethod}
              />
            </SectionCard>

            <SectionCard
              title="Iteration CCDFs"
              isOpen={showCcdfs}
              onToggle={() => setShowCcdfs((v) => !v)}
            >
              <PlotGrid
                entries={ccdfEntries}
                emptyText="No CCDF artifacts available."
                altPrefix="Iteration CCDF for"
                prettyMethod={prettyMethod}
              />
            </SectionCard>
          </SectionCard>

          <SectionCard
            title="Outputs"
            isOpen={showOutputsSection}
            onToggle={() => setShowOutputsSection((v) => !v)}
            description="Downloadable files generated by the experiment, including raw records, summary artifacts, and analysis outputs."
          >
            <SectionCard
              title="Exported Outputs"
              isOpen={showArtifacts}
              onToggle={() => setShowArtifacts((v) => !v)}
            >
              <div style={styles.artifactsGrid}>
                {renderArtifactLink("records.csv", result.records_csv)}
                {renderArtifactLink("records.json", result.records_json)}
                {renderArtifactLink("summary.json", result.summary_json)}
                {renderArtifactLink("metadata.json", result.metadata_json)}
                {renderArtifactLink(
                  "root_basin_statistics.json",
                  analytics?.root_basin_statistics
                )}
                {renderArtifactLink(
                  "comparison_summary.json",
                  analytics?.comparison_summary
                )}
                {renderArtifactLink(
                  "basin_entropy.json",
                  analytics?.basin_entropy
                )}
                {renderArtifactLink(
                  "basin_entropy_comparison.png",
                  analytics?.basin_entropy_plot ||
                    analytics?.basin_entropy_comparison_plot
                )}
                {paretoMeanUrl &&
                  renderArtifactLink(
                    "pareto_mean_vs_failure.png",
                    analytics?.pareto?.mean_vs_failure
                  )}
                {paretoMedianUrl &&
                  renderArtifactLink(
                    "pareto_median_vs_failure.png",
                    analytics?.pareto?.median_vs_failure
                  )}
                {basinMapUrl && (
                  <a
                    href={basinMapUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={styles.artifactLink}
                  >
                    basin_map.png
                  </a>
                )}
              </div>
            </SectionCard>
          </SectionCard>
        </div>
      )}
    </div>
  );
}

const styles = {
  page: {
    maxWidth: 1500,
    margin: "0 auto",
    padding: "32px 20px 60px",
    fontFamily: "Arial, sans-serif",
    color: "#111827",
    background: "#f8fafc",
    minHeight: "100vh",
  },

  breadcrumbRow: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    marginBottom: 18,
  },

  navButton: {
    display: "inline-block",
    padding: "10px 14px",
    borderRadius: 10,
    textDecoration: "none",
    fontWeight: 700,
    background: "#2563eb",
    color: "#ffffff",
    border: "1px solid #2563eb",
  },

  navButtonSecondary: {
    display: "inline-block",
    padding: "10px 14px",
    borderRadius: 10,
    textDecoration: "none",
    fontWeight: 700,
    background: "#ffffff",
    color: "#374151",
    border: "1px solid #d1d5db",
  },

  headerBlock: {
    marginBottom: 24,
  },

  pageTitle: {
    margin: 0,
    fontSize: 32,
    fontWeight: 700,
  },

  pageSubtitle: {
    marginTop: 10,
    marginBottom: 0,
    color: "#4b5563",
    fontSize: 15,
    lineHeight: 1.6,
  },

  section: {
    marginTop: 24,
  },

  resultsTitle: {
    marginTop: 8,
    marginBottom: 18,
    fontSize: 26,
    fontWeight: 700,
  },

  sectionTitle: {
    marginTop: 0,
    marginBottom: 16,
    fontSize: 20,
    fontWeight: 700,
  },

  subsectionTitle: {
    marginTop: 0,
    marginBottom: 12,
    fontSize: 18,
    fontWeight: 700,
    color: "#111827",
  },

  sectionToggle: {
    width: "100%",
    border: "none",
    background: "transparent",
    padding: 0,
    margin: 0,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 20,
    fontWeight: 700,
    color: "#111827",
    cursor: "pointer",
    textAlign: "left",
  },

  sectionDescription: {
    marginTop: 4,
    marginBottom: 16,
    color: "#4b5563",
    fontSize: 14,
    lineHeight: 1.6,
  },

  metaText: {
    marginTop: 0,
    marginBottom: 14,
    color: "#4b5563",
    fontSize: 14,
  },

  problemInfoBox: {
    background: "#f8fafc",
    border: "1px solid #dbe2ea",
    borderRadius: 12,
    padding: 14,
  },

  problemInfoTitle: {
    fontSize: 14,
    fontWeight: 700,
    marginBottom: 8,
    color: "#111827",
  },

  problemInfoText: {
    fontSize: 14,
    color: "#1f2937",
    marginBottom: 4,
    wordBreak: "break-word",
  },

  problemInfoNote: {
    marginTop: 8,
    fontSize: 13,
    color: "#6b7280",
    lineHeight: 1.5,
  },

  card: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: 16,
    padding: 20,
    boxShadow: "0 6px 18px rgba(15, 23, 42, 0.06)",
  },

  cardMuted: {
    background: "#f8fafc",
    border: "1px solid #e5e7eb",
    borderRadius: 14,
    padding: 16,
  },

  controlsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 16,
    alignItems: "end",
  },

  label: {
    display: "block",
    fontSize: 14,
    fontWeight: 700,
    marginBottom: 8,
    color: "#374151",
  },

  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    fontSize: 14,
    background: "#fff",
    boxSizing: "border-box",
  },

  methodsWrap: {
    display: "flex",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 8,
  },

  methodChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 12px",
    border: "1px solid #dbeafe",
    background: "#f8fbff",
    borderRadius: 999,
    fontSize: 14,
  },

  runButton: {
    padding: "12px 18px",
    borderRadius: 10,
    border: "none",
    background: "#2563eb",
    color: "white",
    fontSize: 15,
    fontWeight: 700,
    cursor: "pointer",
  },

  runButtonDisabled: {
    opacity: 0.7,
    cursor: "not-allowed",
  },

  statusRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 16,
    padding: "10px 0",
    borderBottom: "1px solid #f1f5f9",
    flexWrap: "wrap",
  },

  statusLabel: {
    fontWeight: 700,
    color: "#374151",
  },

  monoText: {
    fontFamily: "monospace",
    wordBreak: "break-all",
  },

  progressTrack: {
    width: "100%",
    height: 12,
    background: "#e5e7eb",
    borderRadius: 999,
    overflow: "hidden",
    marginTop: 16,
  },

  progressFill: {
    height: "100%",
    background: "#2563eb",
    borderRadius: 999,
    transition: "width 0.3s ease",
  },

  errorBox: {
    marginTop: 18,
    padding: 14,
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 12,
  },

  errorTitle: {
    margin: "0 0 6px 0",
    color: "#991b1b",
    fontSize: 16,
  },

  errorText: {
    margin: 0,
    color: "#7f1d1d",
  },

  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 16,
  },

  keyFindingsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 16,
  },

  interpretationGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: 16,
  },

  summaryCard: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: 16,
    padding: 16,
    boxShadow: "0 4px 14px rgba(15, 23, 42, 0.04)",
    minHeight: 92,
  },

  summaryLabel: {
    fontSize: 13,
    color: "#6b7280",
    marginBottom: 8,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.03em",
  },

  summaryValue: {
    fontSize: 16,
    fontWeight: 700,
    lineHeight: 1.45,
    wordBreak: "break-word",
  },

  subsectionSpacer: {
    marginTop: 18,
  },

  basinImage: {
    display: "block",
    width: "100%",
    maxWidth: 980,
    margin: "0 auto",
    borderRadius: 12,
    border: "1px solid #d1d5db",
  },

  tableWrap: {
    overflowX: "auto",
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
    borderBottom: "1px solid #dbe2ea",
    fontSize: 14,
    fontWeight: 700,
    color: "#374151",
  },

  td: {
    textAlign: "left",
    padding: "12px 14px",
    borderBottom: "1px solid #eef2f7",
    fontSize: 14,
  },

  plotGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(480px, 1fr))",
    gap: 18,
  },

  plotCard: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: 14,
    padding: 14,
  },

  plotCardTitle: {
    fontSize: 15,
    fontWeight: 700,
    marginBottom: 10,
    textTransform: "capitalize",
  },

  plotImage: {
    width: "100%",
    height: "auto",
    display: "block",
    borderRadius: 10,
    border: "1px solid #d1d5db",
  },

  mutedText: {
    color: "#6b7280",
    margin: 0,
  },

  insightList: {
    margin: 0,
    paddingLeft: 18,
  },

  insightItem: {
    marginBottom: 10,
    color: "#1f2937",
    lineHeight: 1.55,
  },

  recommendationText: {
    margin: 0,
    color: "#1f2937",
    lineHeight: 1.7,
    fontSize: 15,
  },

  artifactsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 12,
  },

  artifactLink: {
    display: "block",
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid #dbeafe",
    background: "#f8fbff",
    color: "#1d4ed8",
    textDecoration: "none",
    fontWeight: 700,
    wordBreak: "break-word",
  },
};