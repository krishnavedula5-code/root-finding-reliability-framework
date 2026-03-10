import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

const API =  process.env.REACT_APP_API_BASE_URL || "http://127.0.0.1:8000";


const METHOD_OPTIONS = [
  "newton",
  "secant",
  "bisection",
  "hybrid",
  "safeguarded_newton",
];

export default function ExperimentsDashboard() {
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);

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
  ]);
  const [nPoints, setNPoints] = useState(100);
  const [tol, setTol] = useState(1e-10);
  const [maxIter, setMaxIter] = useState(100);

  const [showBoundaryAnalysis, setShowBoundaryAnalysis] = useState(true);
  const [showBasinMap, setShowBasinMap] = useState(true);
  const [showSolverComparison, setShowSolverComparison] = useState(true);
  const [showPareto, setShowPareto] = useState(true);
  const [showBasinComplexity, setShowBasinComplexity] = useState(true);
  const [showBasinDistribution, setShowBasinDistribution] = useState(false);
  const [showFailureRegions, setShowFailureRegions] = useState(false);
  const [showHistograms, setShowHistograms] = useState(false);
  const [showCcdfs, setShowCcdfs] = useState(false);
  const [showArtifacts, setShowArtifacts] = useState(false);

  const pollRef = useRef(null);

  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, []);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function validateInputs() {
    if (!Array.isArray(selectedMethods) || selectedMethods.length === 0) {
      throw new Error("Select at least one method.");
    }

    const numericNPoints = Number(nPoints);
    const numericTol = Number(tol);
    const numericMaxIter = Number(maxIter);

    if (!Number.isFinite(numericNPoints) || numericNPoints < 2) {
      throw new Error("Points must be at least 2.");
    }

    if (!Number.isFinite(numericTol) || numericTol <= 0) {
      throw new Error("Tolerance must be a positive number.");
    }

    if (!Number.isFinite(numericMaxIter) || numericMaxIter < 1) {
      throw new Error("Max Iter must be at least 1.");
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

    const sMin = Number(scalarMin);
    const sMax = Number(scalarMax);
    const bMin = Number(bracketMin);
    const bMax = Number(bracketMax);

    if (!Number.isFinite(sMin) || !Number.isFinite(sMax) || sMin >= sMax) {
      throw new Error("Scalar range is invalid. Ensure min < max.");
    }

    if (!Number.isFinite(bMin) || !Number.isFinite(bMax) || bMin >= bMax) {
      throw new Error("Bracket search range is invalid. Ensure min < max.");
    }
  }

  function buildPayload() {
    const numericNPoints = Number(nPoints);
    const numericTol = Number(tol);
    const numericMaxIter = Number(maxIter);

    if (problemMode === "custom") {
      const sMin = Number(scalarMin);
      const sMax = Number(scalarMax);
      const bMin = Number(bracketMin);
      const bMax = Number(bracketMax);

      return {
        problem_mode: "custom",
        problem_id: null,
        expr: String(expr || "").trim(),
        dexpr: String(dexpr || "").trim(),
        x_min: sMin,
        x_max: sMax,
        n_points: numericNPoints,
        methods: selectedMethods,
        tol: numericTol,
        max_iter: numericMaxIter,
        boundary_method: boundaryMethod,
        scalar_range: {
          x_min: sMin,
          x_max: sMax,
          n_points: numericNPoints,
        },
        bracket_search_range: {
          x_min: bMin,
          x_max: bMax,
          n_points: numericNPoints,
        },
      };
    }

    return {
      problem_mode: "benchmark",
      problem_id: problemId,
      methods: selectedMethods,
      n_points: numericNPoints,
      tol: numericTol,
      max_iter: numericMaxIter,
      boundary_method: boundaryMethod,
    };
  }

  async function runSweep() {
    try {
      setRunning(true);
      setError(null);
      setResult(null);
      setJobStatus(null);

      stopPolling();
      validateInputs();

      const payload = buildPayload();
      console.log("SWEEP PAYLOAD:", payload);

      const res = await fetch(`${API}/experiments/sweep`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to create experiment job: ${res.status} ${text}`);
      }

      const data = await res.json();
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
    return `${API}${String(path).startsWith("/") ? "" : "/"}${String(path).replace(/\\/g, "/")}`;
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

  const analyticsCollection = result?.artifacts?.analytics || {};
  const analyticsKey =
    result?.problem_id ||
    (problemMode === "benchmark" ? problemId : "custom");
  const analytics =
    analyticsCollection?.[analyticsKey] ||
    analyticsCollection?.custom ||
    Object.values(analyticsCollection || {})[0] ||
    null;

  const basinMapUrl =
    toOutputUrl(result?.artifacts?.basin_map) ||
    toOutputUrl(analytics?.basin_map);

  const comparisonRows = analytics?.comparison_summary_data?.methods || [];
  const entropyRows = analytics?.basin_entropy_data?.methods || [];

  const paretoMeanUrl = toOutputUrl(analytics?.pareto?.mean_vs_failure);
  const paretoMedianUrl = toOutputUrl(analytics?.pareto?.median_vs_failure);

  const failureRegionEntries = analytics?.failure_region
    ? Object.entries(analytics.failure_region)
    : [];

  const basinDistributionEntries = analytics?.basin_distribution
    ? Object.entries(analytics.basin_distribution)
    : [];

  const detectedRoots = Array.from(
    new Set(
      (entropyRows || []).flatMap((row) =>
        row?.basin_counts ? Object.keys(row.basin_counts) : []
      )
    )
  ).sort((a, b) => Number(a) - Number(b));

  const histogramEntries = analytics?.histogram
    ? Object.entries(analytics.histogram)
    : [];

  const ccdfEntries = analytics?.ccdf ? Object.entries(analytics.ccdf) : [];

  const boundaryRegions = Array.isArray(result?.boundaries)
    ? result.boundaries
    : [];
  const rawBoundaries = Array.isArray(result?.raw_boundaries)
    ? result.raw_boundaries
    : [];
  const boundarySummary = result?.boundary_summary || null;
  const boundaryClusterTol = result?.boundary_cluster_tol;

  const boundarySummaryText = boundarySummary
    ? `${boundarySummary.clustered_count ?? boundaryRegions.length} regions (${boundarySummary.raw_count ?? rawBoundaries.length} raw)`
    : boundaryRegions.length > 0
      ? `${boundaryRegions.length} regions`
      : "None";

  const clusterTol = analytics?.basin_entropy_data?.cluster_tol;

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
              disabled={running}
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
                disabled={running}
                style={styles.input}
              >
                <option value="p1">p1</option>
                <option value="p2">p2</option>
                <option value="p3">p3</option>
                <option value="p4">p4</option>
              </select>
            </div>
          ) : (
            <>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={styles.label}>f(x)</label>
                <input
                  value={expr}
                  onChange={(e) => setExpr(e.target.value)}
                  disabled={running}
                  style={styles.input}
                />
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <label style={styles.label}>f&apos;(x)</label>
                <input
                  value={dexpr}
                  onChange={(e) => setDexpr(e.target.value)}
                  disabled={running}
                  style={styles.input}
                />
              </div>

              <div>
                <label style={styles.label}>Scalar Range Min</label>
                <input
                  type="number"
                  value={scalarMin}
                  onChange={(e) => setScalarMin(e.target.value)}
                  disabled={running}
                  style={styles.input}
                />
              </div>

              <div>
                <label style={styles.label}>Scalar Range Max</label>
                <input
                  type="number"
                  value={scalarMax}
                  onChange={(e) => setScalarMax(e.target.value)}
                  disabled={running}
                  style={styles.input}
                />
              </div>

              <div>
                <label style={styles.label}>Bracket Range Min</label>
                <input
                  type="number"
                  value={bracketMin}
                  onChange={(e) => setBracketMin(e.target.value)}
                  disabled={running}
                  style={styles.input}
                />
              </div>

              <div>
                <label style={styles.label}>Bracket Range Max</label>
                <input
                  type="number"
                  value={bracketMax}
                  onChange={(e) => setBracketMax(e.target.value)}
                  disabled={running}
                  style={styles.input}
                />
              </div>
            </>
          )}

          <div>
            <label style={styles.label}>Boundary Method</label>
            <select
              value={boundaryMethod}
              onChange={(e) => setBoundaryMethod(e.target.value)}
              disabled={running}
              style={styles.input}
            >
              <option value="newton">newton</option>
              <option value="secant">secant</option>
              <option value="hybrid">hybrid</option>
              <option value="bisection">bisection</option>
              <option value="safeguarded_newton">safeguarded_newton</option>
            </select>
          </div>

          <div>
            <label style={styles.label}>Points</label>
            <input
              type="number"
              min="20"
              max="5000"
              value={nPoints}
              onChange={(e) => setNPoints(e.target.value)}
              disabled={running}
              style={styles.input}
            />
          </div>

          <div>
            <label style={styles.label}>Tolerance</label>
            <input
              type="number"
              step="any"
              value={tol}
              onChange={(e) => setTol(e.target.value)}
              disabled={running}
              style={styles.input}
            />
          </div>

          <div>
            <label style={styles.label}>Max Iter</label>
            <input
              type="number"
              value={maxIter}
              onChange={(e) => setMaxIter(e.target.value)}
              disabled={running}
              style={styles.input}
            />
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          <label style={styles.label}>Methods to Compare</label>
          <div style={styles.methodsWrap}>
            {METHOD_OPTIONS.map((m) => (
              <label key={m} style={styles.methodChip}>
                <input
                  type="checkbox"
                  checked={selectedMethods.includes(m)}
                  onChange={() => toggleMethod(m)}
                  disabled={running}
                />
                <span>{m}</span>
              </label>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 22 }}>
          <button
            onClick={runSweep}
            disabled={running}
            style={{
              ...styles.runButton,
              ...(running ? styles.runButtonDisabled : {}),
            }}
          >
            {running ? "Running..." : "Run Sweep Experiment"}
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
          <h2 style={styles.resultsTitle}>Experiment Results</h2>

          <div style={styles.summaryGrid}>
            <SummaryCard
              label="Problem Mode"
              value={result.problem_mode || problemMode}
            />
            <SummaryCard
              label="Problem"
              value={result.problem_id || analyticsKey}
            />
            <SummaryCard label="Boundary Method" value={boundaryMethod} />
            <SummaryCard label="Points" value={String(nPoints)} />
            <SummaryCard label="Methods" value={selectedMethods.join(", ")} />
            <SummaryCard
              label="Sweep Folder"
              value={result.latest_sweep_dir || "-"}
            />
            <SummaryCard label="Boundary Regions" value={boundarySummaryText} />
          </div>

          <div style={styles.section}>
            <div style={styles.card}>
              <h3 style={styles.sectionTitle}>Detected Real Roots</h3>

              {detectedRoots.length > 0 ? (
                <div style={{ fontSize: 16, fontWeight: 600 }}>
                  {detectedRoots.join(", ")}
                </div>
              ) : (
                <p style={styles.mutedText}>
                  Root locations inferred from basin clustering.
                </p>
              )}
            </div>
          </div>

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
                              <td style={styles.td}>{formatNumber(region.center)}</td>
                              <td style={styles.td}>{formatNumber(region.start)}</td>
                              <td style={styles.td}>{formatNumber(region.end)}</td>
                              <td style={styles.td}>{formatNumber(region.width)}</td>
                              <td style={styles.td}>{formatNumber(region.count)}</td>
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
            title="Solver Comparison Summary"
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
                      <tr key={row.method}>
                        <td style={styles.td}>{row.method}</td>
                        <td style={styles.td}>{formatPercent(row.success_rate)}</td>
                        <td style={styles.td}>{formatMean(row.mean_iter)}</td>
                        <td style={styles.td}>{formatNumber(row.median_iter)}</td>
                        <td style={styles.td}>{formatNumber(row.p95_iter)}</td>
                        <td style={styles.td}>{formatNumber(row.max_iter)}</td>
                        <td style={styles.td}>{formatNumber(row.failure_count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={styles.mutedText}>No comparison summary available.</p>
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
                    />
                  </div>
                )}
              </div>
            ) : (
              <p style={styles.mutedText}>No Pareto artifacts available.</p>
            )}
          </SectionCard>

          <SectionCard
            title="Basin Complexity Metrics"
            isOpen={showBasinComplexity}
            onToggle={() => setShowBasinComplexity((v) => !v)}
          >
            {clusterTol !== undefined && clusterTol !== null && (
              <p style={styles.metaText}>
                <b>Cluster tolerance:</b> {formatNumber(clusterTol)} (based on
                sweep resolution)
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
                      <tr key={`entropy-${row.method}`}>
                        <td style={styles.td}>{row.method}</td>
                        <td style={styles.td}>{formatEntropy(row.entropy)}</td>
                        <td style={styles.td}>{formatNumber(row.num_basins)}</td>
                        <td style={styles.td}>{formatNumber(row.total_converged)}</td>
                        <td style={styles.td}>{formatNumber(row.cluster_tol)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={styles.mutedText}>No basin entropy metrics available.</p>
            )}
          </SectionCard>

          <SectionCard
            title="Basin Distribution Plots"
            isOpen={showBasinDistribution}
            onToggle={() => setShowBasinDistribution((v) => !v)}
          >
            {basinDistributionEntries.length > 0 ? (
              <div style={styles.plotGrid}>
                {basinDistributionEntries.map(([methodName, path]) => (
                  <div key={`basin-${methodName}`} style={styles.plotCard}>
                    <div style={styles.plotCardTitle}>{methodName}</div>
                    <img
                      src={toOutputUrl(path)}
                      alt={`Basin distribution for ${methodName}`}
                      style={styles.plotImage}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p style={styles.mutedText}>
                No basin distribution artifacts available.
              </p>
            )}
          </SectionCard>

          <SectionCard
            title="Failure Region Plots"
            isOpen={showFailureRegions}
            onToggle={() => setShowFailureRegions((v) => !v)}
          >
            {failureRegionEntries.length > 0 ? (
              <div style={styles.plotGrid}>
                {failureRegionEntries.map(([methodName, path]) => (
                  <div key={`fail-${methodName}`} style={styles.plotCard}>
                    <div style={styles.plotCardTitle}>{methodName}</div>
                    <img
                      src={toOutputUrl(path)}
                      alt={`Failure region for ${methodName}`}
                      style={styles.plotImage}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p style={styles.mutedText}>
                No failure region artifacts available.
              </p>
            )}
          </SectionCard>

          <SectionCard
            title="Iteration Histograms"
            isOpen={showHistograms}
            onToggle={() => setShowHistograms((v) => !v)}
          >
            {histogramEntries.length > 0 ? (
              <div style={styles.plotGrid}>
                {histogramEntries.map(([methodName, path]) => (
                  <div key={`hist-${methodName}`} style={styles.plotCard}>
                    <div style={styles.plotCardTitle}>{methodName}</div>
                    <img
                      src={toOutputUrl(path)}
                      alt={`Iteration histogram for ${methodName}`}
                      style={styles.plotImage}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p style={styles.mutedText}>No histogram artifacts available.</p>
            )}
          </SectionCard>

          <SectionCard
            title="Iteration CCDFs"
            isOpen={showCcdfs}
            onToggle={() => setShowCcdfs((v) => !v)}
          >
            {ccdfEntries.length > 0 ? (
              <div style={styles.plotGrid}>
                {ccdfEntries.map(([methodName, path]) => (
                  <div key={`ccdf-${methodName}`} style={styles.plotCard}>
                    <div style={styles.plotCardTitle}>{methodName}</div>
                    <img
                      src={toOutputUrl(path)}
                      alt={`Iteration CCDF for ${methodName}`}
                      style={styles.plotImage}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p style={styles.mutedText}>No CCDF artifacts available.</p>
            )}
          </SectionCard>

          <SectionCard
            title="Artifacts"
            isOpen={showArtifacts}
            onToggle={() => setShowArtifacts((v) => !v)}
          >
            <div style={styles.artifactsGrid}>
              {renderArtifactLink("records.csv", result.records_csv)}
              {renderArtifactLink("records.json", result.records_json)}
              {renderArtifactLink("summary.json", result.summary_json)}
              {renderArtifactLink("metadata.json", result.metadata_json)}
              {renderArtifactLink(
                "comparison_summary.json",
                analytics?.comparison_summary
              )}
              {renderArtifactLink(
                "basin_entropy.json",
                analytics?.basin_entropy
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
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value }) {
  return (
    <div style={styles.summaryCard}>
      <div style={styles.summaryLabel}>{label}</div>
      <div style={styles.summaryValue}>{value || "-"}</div>
    </div>
  );
}

function SectionCard({ title, isOpen, onToggle, children }) {
  return (
    <div style={styles.section}>
      <div style={styles.card}>
        <button type="button" onClick={onToggle} style={styles.sectionToggle}>
          <span>{title}</span>
          <span>{isOpen ? "▾" : "▸"}</span>
        </button>
        {isOpen && <div style={{ marginTop: 12 }}>{children}</div>}
      </div>
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

  metaText: {
    marginTop: 0,
    marginBottom: 14,
    color: "#4b5563",
    fontSize: 14,
  },

  card: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: 16,
    padding: 20,
    boxShadow: "0 6px 18px rgba(15, 23, 42, 0.06)",
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
    gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
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