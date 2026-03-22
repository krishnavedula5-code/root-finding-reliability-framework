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
    id: "p1",
    name: "Cubic with challenging Newton behavior",
    category: "polynomial",
    expr: "x**3 - 2*x + 2",
    dexpr: "3*x**2 - 2",
    domain: [-4, 4],
    roots: [],
    notes: "Cubic benchmark with challenging Newton behavior.",
  },
  p2: {
    id: "p2",
    name: "Classic nonlinear cubic",
    category: "polynomial",
    expr: "x**3 - x - 2",
    dexpr: "3*x**2 - 1",
    domain: [-4, 4],
    roots: [],
    notes: "Classic nonlinear cubic with a real root.",
  },
  p3: {
    id: "p3",
    name: "Fixed-point style cosine benchmark",
    category: "transcendental",
    expr: "cos(x) - x",
    dexpr: "-sin(x) - 1",
    domain: [-4, 4],
    roots: [],
    notes: "Fixed-point style benchmark with a unique real root.",
  },
  p4: {
    id: "p4",
    name: "Multiple-root cubic benchmark",
    category: "multiple_root",
    expr: "(x - 1)**2 * (x + 2)",
    dexpr: "2*(x - 1)*(x + 2) + (x - 1)**2",
    domain: [-4, 4],
    roots: [-2, 1],
    notes: "Multiple-root benchmark useful for basin and stability analysis.",
  },
};

function formatRoots(arr) {
  if (!Array.isArray(arr)) return "-";
  return arr
    .map((x) => Number.parseFloat(x))
    .filter((x) => Number.isFinite(x))
    .map((x) => x.toFixed(3))
    .join(", ");
}

function prettyMethod(name) {
  if (!name) return "-";
  return String(name)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatNumber(x, digits = 4) {
  const v = Number(x);
  if (!isFinite(v)) return "-";

  // FIX: clean near-zero noise
  if (Math.abs(v) < 1e-10) return "0.0000";

  return v.toFixed(digits);
}

function formatRootLabel(root) {
  const x = Number(root);
  if (!Number.isFinite(x)) return String(root);
  const rounded = Number(x.toFixed(3));
  return String(rounded);
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

function formatProbability(x) {
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

function MonteCarloSummaryCards({ rows }) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return <p style={styles.emptyText}>No Monte Carlo summary available.</p>;
  }

  return (
    <div style={styles.infoGrid}>
      {rows.map((row) => (
        <div key={row.method} style={styles.metricCard}>
          <div style={styles.metricLabel}>{prettyMethod(row.method)}</div>

          <div style={{ ...styles.metricValue, marginBottom: 8 }}>
            Success: {formatPercent(row.success_probability)}
          </div>

          <div style={styles.metricSubValue}>
            Failure: {formatPercent(getMcFailureProbability(row))}
          </div>

          <div style={styles.metricSubValue}>
            95% CI: [{formatProbability(getMcCiLow(row))}, {formatProbability(getMcCiHigh(row))}]
          </div>

          <div style={styles.metricSubValue}>
            Mean Iter: {formatMean(getMcMeanIterations(row))}
          </div>

          <div style={styles.metricSubValue}>
            Median Iter: {formatNumber(getMcMedianIterations(row))}
          </div>

          <div style={styles.metricSubValue}>
            Root Coverage: {formatNumber(getMcRootCoverage(row))}
          </div>
        </div>
      ))}
    </div>
  );
}

function getMcFailureProbability(row) {
  if (Number.isFinite(Number(row?.failure_probability))) {
    return Number(row.failure_probability);
  }
  if (Number.isFinite(Number(row?.failure_prob))) {
    return Number(row.failure_prob);
  }
  if (
    Number.isFinite(Number(row?.failure_count)) &&
    Number.isFinite(Number(row?.samples)) &&
    Number(row.samples) > 0
  ) {
    return Number(row.failure_count) / Number(row.samples);
  }
  return null;
}

function getMcCiLow(row) {
  if (Number.isFinite(Number(row?.ci_low))) {
    return Number(row.ci_low);
  }
  if (Array.isArray(row?.confidence_interval_95) && row.confidence_interval_95.length >= 2) {
    return Number(row.confidence_interval_95[0]);
  }
  if (Array.isArray(row?.ci) && row.ci.length >= 2) {
    return Number(row.ci[0]);
  }
  return null;
}

function getMcCiHigh(row) {
  if (Number.isFinite(Number(row?.ci_high))) {
    return Number(row.ci_high);
  }
  if (Array.isArray(row?.confidence_interval_95) && row.confidence_interval_95.length >= 2) {
    return Number(row.confidence_interval_95[1]);
  }
  if (Array.isArray(row?.ci) && row.ci.length >= 2) {
    return Number(row.ci[1]);
  }
  return null;
}

function getMcMeanIterations(row) {
  if (Number.isFinite(Number(row?.mean_iterations))) {
    return Number(row.mean_iterations);
  }
  if (Number.isFinite(Number(row?.mean_iterations_converged))) {
    return Number(row.mean_iterations_converged);
  }
  if (Number.isFinite(Number(row?.mean_iter))) {
    return Number(row.mean_iter);
  }
  return null;
}

function getMcMedianIterations(row) {
  if (Number.isFinite(Number(row?.median_iterations))) {
    return Number(row.median_iterations);
  }
  if (Number.isFinite(Number(row?.median_iterations_converged))) {
    return Number(row.median_iterations_converged);
  }
  if (Number.isFinite(Number(row?.median_iter))) {
    return Number(row.median_iter);
  }
  return null;
}

function getMcRootCoverage(row) {
  if (Number.isFinite(Number(row?.clustered_root_coverage))) {
    return Number(row.clustered_root_coverage);
  }
  if (Number.isFinite(Number(row?.root_coverage_count))) {
    return Number(row.root_coverage_count);
  }
  return null;
}

function MonteCarloRankingChart({ rows }) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return <p style={styles.emptyText}>No ranking data available.</p>;
  }

  return (
    <div style={styles.rankingChartWrap}>
      {rows.map((row, idx) => {
        const success = Number(row.success_probability || 0);
        const failure = Number(getMcFailureProbability(row) || 0);

        return (
          <div key={row.method} style={styles.rankingRow}>
            <div style={styles.rankingLabelBlock}>
              <div style={styles.rankingRank}>#{idx + 1}</div>
              <div>
                <div style={styles.rankingMethod}>{prettyMethod(row.method)}</div>
                <div style={styles.rankingSubtext}>
                  Mean iter: {formatMean(getMcMeanIterations(row))}
                </div>
              </div>
            </div>

            <div style={styles.stackedBarWrap}>
              <div style={styles.stackedBarOuter}>
                <div
                  style={{
                    ...styles.stackedBarSuccess,
                    width: `${Math.max(0, Math.min(100, success * 100))}%`,
                  }}
                />
                <div
                  style={{
                    ...styles.stackedBarFailure,
                    width: `${Math.max(0, Math.min(100, failure * 100))}%`,
                  }}
                />
              </div>

              <div style={styles.stackedBarLabels}>
                <span style={styles.successText}>
                  Success {formatPercent(success)}
                </span>
                <span style={styles.failureText}>
                  Failure {formatPercent(failure)}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MonteCarloSpeedReliabilityChart({ rows }) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return <p style={styles.emptyText}>No speed–reliability data available.</p>;
  }

  const validRows = rows.filter(
    (row) =>
      Number.isFinite(Number(getMcMeanIterations(row))) &&
      Number.isFinite(Number(row.success_probability))
  );

  if (validRows.length === 0) {
    return <p style={styles.emptyText}>No valid speed–reliability data available.</p>;
  }

  const methodColors = {
    newton: "#2563eb",
    secant: "#dc2626",
    bisection: "#16a34a",
    hybrid: "#9333ea",
    safeguarded_newton: "#ea580c",
    brent: "#0891b2",
  };

  const xVals = validRows.map((row) => Number(getMcMeanIterations(row)));
  const yVals = validRows.map((row) => Number(row.success_probability));

  const rawMinX = Math.min(...xVals);
  const rawMaxX = Math.max(...xVals);
  const rawMinY = Math.min(...yVals);
  const rawMaxY = Math.max(...yVals);

  const xPad = Math.max(1.0, (rawMaxX - rawMinX) * 0.08);
  const yPad = Math.max(0.0005, (rawMaxY - rawMinY) * 0.25);

  const minX = rawMinX - xPad;
  const maxX = rawMaxX + xPad;
  const minY = Math.max(0, Math.min(rawMinY, 0.98) - yPad);
  const maxY = Math.min(1.001, Math.max(rawMaxY, 1.0) + yPad);

  const chartWidth = 920;
  const chartHeight = 430;
  const padLeft = 82;
  const padRight = 170;
  const padTop = 28;
  const padBottom = 64;

  const innerWidth = chartWidth - padLeft - padRight;
  const innerHeight = chartHeight - padTop - padBottom;

  function scaleX(x) {
    if (maxX === minX) return padLeft + innerWidth / 2;
    return padLeft + ((x - minX) / (maxX - minX)) * innerWidth;
  }

  function scaleY(y) {
    if (maxY === minY) return padTop + innerHeight / 2;
    return padTop + innerHeight - ((y - minY) / (maxY - minY)) * innerHeight;
  }

  const xTicks = 6;
  const yTicks = 5;

  const legendX = chartWidth - padRight + 18;
  const legendY = 52;

  return (
    <div style={styles.scatterWrap}>
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        style={styles.scatterSvg}
        role="img"
        aria-label="Monte Carlo speed versus reliability scatter plot"
      >
        <rect
          x="0"
          y="0"
          width={chartWidth}
          height={chartHeight}
          fill="#ffffff"
          rx="16"
        />

        {/* Gridlines + Y ticks */}
        {Array.from({ length: yTicks + 1 }).map((_, i) => {
          const t = i / yTicks;
          const y = padTop + innerHeight - t * innerHeight;
          const value = minY + t * (maxY - minY);

          return (
            <g key={`y-${i}`}>
              <line
                x1={padLeft}
                y1={y}
                x2={padLeft + innerWidth}
                y2={y}
                stroke="#e2e8f0"
                strokeWidth="1"
              />
              <text
                x={padLeft - 12}
                y={y + 4}
                textAnchor="end"
                fontSize="12"
                fill="#475569"
              >
                {formatPercent(value)}
              </text>
            </g>
          );
        })}

        {/* Gridlines + X ticks */}
        {Array.from({ length: xTicks + 1 }).map((_, i) => {
          const t = i / xTicks;
          const x = padLeft + t * innerWidth;
          const value = minX + t * (maxX - minX);

          return (
            <g key={`x-${i}`}>
              <line
                x1={x}
                y1={padTop}
                x2={x}
                y2={padTop + innerHeight}
                stroke="#f1f5f9"
                strokeWidth="1"
              />
              <text
                x={x}
                y={padTop + innerHeight + 24}
                textAnchor="middle"
                fontSize="12"
                fill="#475569"
              >
                {formatMean(value)}
              </text>
            </g>
          );
        })}

        {/* Axes */}
        <line
          x1={padLeft}
          y1={padTop}
          x2={padLeft}
          y2={padTop + innerHeight}
          stroke="#334155"
          strokeWidth="1.5"
        />
        <line
          x1={padLeft}
          y1={padTop + innerHeight}
          x2={padLeft + innerWidth}
          y2={padTop + innerHeight}
          stroke="#334155"
          strokeWidth="1.5"
        />

        {/* Axis labels */}
        <text
          x={padLeft + innerWidth / 2}
          y={chartHeight - 16}
          textAnchor="middle"
          fontSize="13"
          fill="#0f172a"
          fontWeight="700"
        >
          Mean Iterations
        </text>

        <text
          x="22"
          y={padTop + innerHeight / 2}
          textAnchor="middle"
          fontSize="13"
          fill="#0f172a"
          fontWeight="700"
          transform={`rotate(-90 22 ${padTop + innerHeight / 2})`}
        >
          Success Probability
        </text>

        {/* Points + labels */}
        {validRows.map((row) => {
          const baseX = scaleX(Number(getMcMeanIterations(row)));
          const jitter = (row.method === "bisection") ? 6 : (row.method === "hybrid" ? -6 : 0);
          const x = baseX + jitter;
          const y = scaleY(Number(row.success_probability));
          const color = methodColors[row.method] || "#2563eb";
          
          return (
            <g key={row.method}>
              <circle
                cx={x}
                cy={y}
                r="8"
                fill={color}
                stroke="#ffffff"
                strokeWidth="2.5"
              />
            </g>
          );
        })}

        {/* Legend */}
        <g>
          <text
            x={legendX}
            y={legendY - 14}
            fontSize="13"
            fill="#0f172a"
            fontWeight="700"
          >
            Methods
          </text>

          {validRows.map((row, idx) => {
            const color = methodColors[row.method] || "#2563eb";
            return (
              <g key={`legend-${row.method}`}>
                <circle
                  cx={legendX + 8}
                  cy={legendY + idx * 24}
                  r="6"
                  fill={color}
                />
                <text
                  x={legendX + 22}
                  y={legendY + idx * 24 + 4}
                  fontSize="12"
                  fill="#0f172a"
                >
                  {prettyMethod(row.method)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      <div style={styles.scatterCaption}>
        Top-left indicates higher reliability with fewer iterations.
      </div>
    </div>
  );
}

function getMcRootCounts(row) {
  if (row && row.root_counts && typeof row.root_counts === "object") {
    return row.root_counts;
  }
  return {};
}

function collectAllMcRoots(rows) {
  const roots = new Set();

  (rows || []).forEach((row) => {
    Object.keys(getMcRootCounts(row)).forEach((root) => {
      roots.add(formatRootLabel(root));
    });
  });

  return Array.from(roots).sort((a, b) => Number(a) - Number(b));
}

function MonteCarloRootDistributionChart({ rows }) {
  
  function canonicalizeRootCounts(rootCounts) {
    const grouped = {};

    Object.entries(rootCounts || {}).forEach(([root, count]) => {
      const label = formatRootLabel(root);
      grouped[label] = (grouped[label] || 0) + Number(count || 0);
    });

    return grouped;
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return <p style={styles.emptyText}>No root distribution data available.</p>;
  }

  const allRoots = collectAllMcRoots(rows);

  if (allRoots.length === 0) {
    return <p style={styles.emptyText}>No root clusters found in Monte Carlo summary.</p>;
  }

  const rootColors = [
    "#2563eb",
    "#16a34a",
    "#9333ea",
    "#ea580c",
    "#0891b2",
    "#dc2626",
    "#7c3aed",
    "#0f766e",
  ];

  const rootColorMap = {};
  allRoots.forEach((root, idx) => {
    rootColorMap[root] = rootColors[idx % rootColors.length];
  });

  const sortedRows = [...rows].sort((a, b) => {
    const sa = Number(a.success_probability || 0);
    const sb = Number(b.success_probability || 0);
    if (sb !== sa) return sb - sa;
    return Number(getMcMeanIterations(a) || Infinity) - Number(getMcMeanIterations(b) || Infinity);
  });

  return (
    <div style={styles.rootDistWrap}>
      <div style={styles.rootDistLegend}>
        {allRoots.map((root) => (
          <div key={root} style={styles.rootLegendItem}>
            <span
              style={{
                ...styles.rootLegendSwatch,
                background: rootColorMap[root],
              }}
            />
            <span style={styles.rootLegendText}>Root {formatRootLabel(root)}</span>
          </div>
        ))}

        <div style={styles.rootLegendItem}>
          <span
            style={{
              ...styles.rootLegendSwatch,
              background: "#ef4444",
            }}
          />
          <span style={styles.rootLegendText}>Failure</span>
        </div>
      </div>

      <div style={styles.rootDistRows}>
        {sortedRows.map((row) => {
          const samples = Number(row.samples || 0);
          const rootCounts = canonicalizeRootCounts(getMcRootCounts(row));
          const failureCount = Number(row.failure_count || 0);

          return (
            <div key={row.method} style={styles.rootDistRow}>
              <div style={styles.rootDistMethod}>
                <div style={styles.rootDistMethodName}>{prettyMethod(row.method)}</div>
                <div style={styles.rootDistMethodMeta}>
                  Success {formatPercent(row.success_probability)} · Mean iter {formatMean(getMcMeanIterations(row))}
                </div>
              </div>

              <div style={styles.rootDistBarWrap}>
                <div style={styles.rootDistBar}>
                  {allRoots.map((root) => {
                    const count = Number(rootCounts[root] || 0);
                    const pct = samples > 0 ? (count / samples) * 100 : 0;

                    if (pct <= 0) return null;

                    return (
                      <div
                        key={root}
                        title={`Root ${formatRootLabel(root)}: ${pct.toFixed(1)}%`}
                        style={{
                          height: "100%",
                          width: `${pct}%`,
                          background: rootColorMap[root],
                        }}
                      />
                    );
                  })}

                  {failureCount > 0 && samples > 0 ? (
                    <div
                      title={`Failure: ${((failureCount / samples) * 100).toFixed(1)}%`}
                      style={{
                        height: "100%",
                        width: `${(failureCount / samples) * 100}%`,
                        background: "#ef4444",
                      }}
                    />
                  ) : null}
                </div>

                <div style={styles.rootDistLabels}>
                  {allRoots.map((root) => {
                    const count = Number(rootCounts[root] || 0);
                    const pct = samples > 0 ? count / samples : 0;
                    if (pct <= 0) return null;

                    return (
                      <span key={root} style={styles.rootDistLabel}>
                        {formatRootLabel(root)}: {formatPercent(pct)}
                      </span>
                    );
                  })}

                  {failureCount > 0 && samples > 0 ? (
                    <span style={styles.rootDistFailureLabel}>
                      fail: {formatPercent(failureCount / samples)}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function computeMcRankingScore(row, minIter, maxIter) {
  const success = Number(row?.success_probability || 0);
  const meanIter = Number(getMcMeanIterations(row));

  if (!Number.isFinite(meanIter)) {
    return success - 0.01;
  }

  let normalizedIterations = 0;

  if (Number.isFinite(minIter) && Number.isFinite(maxIter) && maxIter > minIter) {
    normalizedIterations = (meanIter - minIter) / (maxIter - minIter);
  }

  return success - 0.01 * normalizedIterations;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}


function normalizeRanking(rawSolverSelection) {
  const raw =
    asArray(rawSolverSelection?.ranking).length > 0
      ? rawSolverSelection.ranking
      : asArray(rawSolverSelection?.ranked_methods);

  return raw.map((item, index) => ({
    rank: item?.rank ?? index + 1,
    method: item?.method || "-",
    score:
      Number.isFinite(Number(item?.score))
        ? Number(item.score)
        : Number.isFinite(Number(item?.overall_score))
        ? Number(item.overall_score)
        : null,
    recommended: Boolean(item?.recommended),
    reasons_for: asArray(item?.reasons_for),
    reasons_against: asArray(item?.reasons_against),
  }));
}



export default function ExperimentsDashboard() {
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [showValidationSummary, setShowValidationSummary] = useState(true);
  const [error, setError] = useState(null);
  const [numericalDerivative, setNumericalDerivative] = useState(false);
  const [experimentType, setExperimentType] = useState("sweep");

  const [samplingMode, setSamplingMode] = useState("grid");
  const [nSamples, setNSamples] = useState(100);
  const [randomSeed, setRandomSeed] = useState(42);
  const [gaussianMean, setGaussianMean] = useState(0);
  const [gaussianStd, setGaussianStd] = useState(1);

  const [problemMode, setProblemMode] = useState("benchmark");
  const [problemId, setProblemId] = useState("p4");
  const [benchmarks, setBenchmarks] = useState([]);

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

  const [mcConfig, setMcConfig] = useState({
    distributionType: "uniform",
    a: -4,
    b: 4,
    mean: 0,
    std: 1,
    nSamples: 5000,
    randomSeed: 42,
    tol: 1e-10,
    maxIter: 100,
    derivativeMode: "analytic",
    clusterTol: 1e-3,
  });

  const [mcSummaryData, setMcSummaryData] = useState(null);
  const [mcInterpretationText, setMcInterpretationText] = useState("");

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
  const [validation, setValidation] = useState(null);
  const [showRootCoverage, setShowRootCoverage] = useState(true);
  const [showRootBasinStats, setShowRootBasinStats] = useState(false);
  const [showSolverComparison, setShowSolverComparison] = useState(true);
  const [showPareto, setShowPareto] = useState(true);
  const [showExportedOutputs, setShowExportedOutputs] = useState(true);

  const [showMcOverview, setShowMcOverview] = useState(true);
  const [showMcRankingChart, setShowMcRankingChart] = useState(true);
  const [showMcSpeedReliabilityChart, setShowMcSpeedReliabilityChart] = useState(true);
  const [showMcRootDistributionChart, setShowMcRootDistributionChart] = useState(true);
  const [showMcComparison, setShowMcComparison] = useState(true);
  const [showMcInterpretation, setShowMcInterpretation] = useState(true);
  const [showMcArtifacts, setShowMcArtifacts] = useState(true);

  const pollRef = useRef(null);
  const problemIdRef = useRef(problemId);

  const {
    backendStatus,
    statusMessage,
    isPreparingRun,
    wakeBackendOnly,
    runWithWarmup,
  } = useBackendWarmup({ autoPoll: true, pollIntervalMs: 25000 });

  const benchmarkInfo =
    benchmarks.find((b) => String(b.id) === String(problemId)) ||
    BENCHMARK_DETAILS[problemId] ||
    null;

  useEffect(() => {
    return () => stopPolling();
  }, []);

  useEffect(() => {
    problemIdRef.current = problemId;
  }, [problemId]);

  useEffect(() => {
    fetch(`${API}/benchmarks`)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to fetch benchmarks: ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        const normalized = Array.isArray(data)
          ? data
          : Object.entries(data || {}).map(([id, info]) => ({
              id,
              ...(info || {}),
            }));

        setBenchmarks(normalized);

        if (normalized.length > 0) {
          const exists = normalized.some(
            (b) => String(b.id) === String(problemIdRef.current)
          );
          if (!exists) {
            const firstId = String(normalized[0].id);
            problemIdRef.current = firstId;
            setProblemId(firstId);
          }
        }
      })
      .catch((err) => {
        console.error("Failed to load benchmarks", err);

        const fallback = Object.entries(BENCHMARK_DETAILS).map(([id, info]) => ({
          id,
          name: info.name || id,
          category: info.category || "benchmark",
          expr: info.expr,
          dexpr: info.dexpr,
          domain: info.domain || [-4, 4],
          roots: info.roots || [],
          known_roots: info.roots || [],
          notes: info.notes || info.note || "",
        }));

        setBenchmarks(fallback);

        const exists = fallback.some(
          (b) => String(b.id) === String(problemIdRef.current)
        );
        if (!exists && fallback.length > 0) {
          const firstId = String(fallback[0].id);
          problemIdRef.current = firstId;
          setProblemId(firstId);
        }
      });
  }, []);

  useEffect(() => {
    if (problemMode !== "benchmark" || !benchmarkInfo) return;

    if (benchmarkInfo.expr) {
      setExpr(benchmarkInfo.expr);
    }

    if (benchmarkInfo.dexpr) {
      setDexpr(benchmarkInfo.dexpr);
    }

    if (Array.isArray(benchmarkInfo.domain) && benchmarkInfo.domain.length >= 2) {
      const d0 = Number(benchmarkInfo.domain[0]);
      const d1 = Number(benchmarkInfo.domain[1]);

      setScalarMin(d0);
      setScalarMax(d1);
      setBracketMin(d0);
      setBracketMax(d1);

      setMcConfig((prev) => ({
        ...prev,
        a: d0,
        b: d1,
      }));
    }
  }, [problemMode, problemId, benchmarkInfo]);

  useEffect(() => {
    if (!BOUNDARY_METHOD_OPTIONS.includes(boundaryMethod)) {
      setBoundaryMethod(BOUNDARY_METHOD_OPTIONS[0]);
    }
  }, [boundaryMethod]);

  useEffect(() => {
    setMcConfig((prev) => ({
      ...prev,
      a: Number(scalarMin),
      b: Number(scalarMax),
      tol: Number(tol),
      maxIter: Number(maxIter),
      randomSeed: Number(randomSeed),
      derivativeMode: numericalDerivative ? "numerical" : "analytic",
    }));
  }, [scalarMin, scalarMax, tol, maxIter, randomSeed, numericalDerivative]);

  useEffect(() => {
    async function loadMonteCarloArtifacts() {
      const isMonteCarloResult =
        (jobStatus?.job_type || result?.job_type) === "monte_carlo";

      if (!result || !isMonteCarloResult) {
        setMcSummaryData(null);
        setMcInterpretationText("");
        return;
      }

      try {
        if (result.summary_json) {
          const summaryRes = await fetch(toOutputUrl(result.summary_json));
          if (summaryRes.ok) {
            const summaryJson = await summaryRes.json();
            setMcSummaryData(summaryJson);
          } else {
            setMcSummaryData(null);
          }
        } else {
          setMcSummaryData(null);
        }

        if (result.interpretation_txt) {
          const txtRes = await fetch(toOutputUrl(result.interpretation_txt));
          if (txtRes.ok) {
            const txt = await txtRes.text();
            setMcInterpretationText(txt);
          } else {
            setMcInterpretationText("");
          }
        } else {
          setMcInterpretationText("");
        }
      } catch (err) {
        console.error("Failed loading Monte Carlo artifacts:", err);
        setMcSummaryData(null);
        setMcInterpretationText("");
      }
    }

    loadMonteCarloArtifacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, jobStatus?.job_type]);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function updateMcConfig(key, value) {
    setMcConfig((prev) => ({ ...prev, [key]: value }));
  }

  function validateSweepInputs() {
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

    if (
      problemMode === "custom" &&
      !numericalDerivative &&
      !String(dexpr || "").trim()
    ) {
      throw new Error(
        "Custom derivative f'(x) is required unless numerical derivative is enabled."
      );
    }
  }

  function validateMonteCarloInputs() {
    if (!selectedMethods.length) {
      throw new Error("Select at least one method.");
    }

    if (!Number.isFinite(Number(mcConfig.tol)) || Number(mcConfig.tol) <= 0) {
      throw new Error("Monte Carlo tolerance must be positive.");
    }

    if (!Number.isFinite(Number(mcConfig.maxIter)) || Number(mcConfig.maxIter) < 1) {
      throw new Error("Monte Carlo max_iter must be at least 1.");
    }

    if (!Number.isFinite(Number(mcConfig.nSamples)) || Number(mcConfig.nSamples) < 1) {
      throw new Error("Monte Carlo number of samples must be at least 1.");
    }

    if (
      !Number.isFinite(Number(mcConfig.clusterTol)) ||
      Number(mcConfig.clusterTol) <= 0
    ) {
      throw new Error("Cluster tolerance must be positive.");
    }

    if (mcConfig.distributionType === "uniform") {
      if (
        !Number.isFinite(Number(mcConfig.a)) ||
        !Number.isFinite(Number(mcConfig.b)) ||
        Number(mcConfig.a) >= Number(mcConfig.b)
      ) {
        throw new Error("Uniform Monte Carlo interval [a, b] is invalid.");
      }
    }

    if (mcConfig.distributionType === "gaussian") {
      if (!Number.isFinite(Number(mcConfig.mean))) {
        throw new Error("Gaussian mean must be valid.");
      }
      if (!Number.isFinite(Number(mcConfig.std)) || Number(mcConfig.std) <= 0) {
        throw new Error("Gaussian std dev must be positive.");
      }
    }

    if (problemMode === "custom" && !String(expr || "").trim()) {
      throw new Error("Custom expression f(x) is required.");
    }

    if (
      problemMode === "custom" &&
      mcConfig.derivativeMode !== "numerical" &&
      !String(dexpr || "").trim()
    ) {
      throw new Error(
        "Custom derivative f'(x) is required unless Monte Carlo derivative mode is numerical."
      );
    }
  }

  function buildSweepPayload() {
    console.log("buildSweepPayload problemId state =", problemId);
    console.log("buildSweepPayload problemId ref =", problemIdRef.current);

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
      numerical_derivative: numericalDerivative,
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
      problem_id: problemIdRef.current,
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

    console.log("SWEEP PAYLOAD =", payload);
    return payload;
  }

  function buildMonteCarloPayload() {
    const payload = {
      problem_mode: problemMode,
      problem_id: problemMode === "benchmark" ? problemIdRef.current : null,
      methods: selectedMethods,
      gaussian_mean: Number(gaussianMean),
      gaussian_std: Number(gaussianStd),
      distribution: mcConfig.distributionType,
      n_samples: Number(mcConfig.nSamples),
      random_seed: Number(mcConfig.randomSeed),
      tol: Number(mcConfig.tol),
      max_iter: Number(mcConfig.maxIter),
      derivative_mode: mcConfig.derivativeMode,
      cluster_tol: Number(mcConfig.clusterTol),
    };

    if (problemMode === "custom") {
      payload.expr = String(expr || "").trim();
      payload.dexpr = String(dexpr || "").trim();
    }

    if (mcConfig.distributionType === "uniform") {
      payload.x_min = Number(mcConfig.a);
      payload.x_max = Number(mcConfig.b);
    }

    if (mcConfig.distributionType === "gaussian") {
      payload.mean = Number(mcConfig.mean);
      payload.std = Number(mcConfig.std);
      payload.x_min = Number(scalarMin);
      payload.x_max = Number(scalarMax);
    }

    console.log("MONTE CARLO PAYLOAD =", payload);
    return payload;
  }

  async function runExperiment() {
    try {
      setRunning(true);
      setError(null);
      setResult(null);
      setJobStatus(null);
      setJobId(null);
      setMcSummaryData(null);
      setMcInterpretationText("");

      stopPolling();

      if (experimentType === "monte_carlo") {
        validateMonteCarloInputs();
      } else {
        validateSweepInputs();
      }

      console.log("experimentType =", experimentType);
      console.log("problemMode =", problemMode);
      console.log("problemId state before submit =", problemId);
      console.log("problemId ref before submit =", problemIdRef.current);

      const payload =
        experimentType === "monte_carlo"
          ? buildMonteCarloPayload()
          : buildSweepPayload();

      const endpoint =
        experimentType === "monte_carlo"
          ? `${API}/experiments/monte-carlo`
          : `${API}/experiments/sweep`;

      const startLabel =
        experimentType === "monte_carlo"
          ? "Monte Carlo experiment"
          : "Sweep experiment";

      const data = await runWithWarmup(
        async () => {
          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

          if (!res.ok) {
            const text = await res.text();
            throw new Error(
              `Failed to create ${startLabel.toLowerCase()} job: ${res.status} ${text}`
            );
          }

          return res.json();
        },
        {
          startMessage: `Compute engine ready. Starting ${startLabel.toLowerCase()}...`,
          doneMessage: `${startLabel} submitted successfully.`,
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

          const validationPayload =
            (data.result && data.result.validation) || data.validation || null;

          console.log("FULL JOB DATA:", data);
          console.log("VALIDATION PAYLOAD:", validationPayload);

          setValidation(validationPayload);

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
    if (
      String(path).startsWith("http://") ||
      String(path).startsWith("https://")
    ) {
      return path;
    }
    return `${API}${String(path).startsWith("/") ? "" : "/"}${String(path).replace(
      /\\/g,
      "/"
    )}`;
  }

  const resultJobType = jobStatus?.job_type || result?.job_type || experimentType;
  const isMonteCarloResult = resultJobType === "monte_carlo";

  const analyticsKey =
    result?.problem_id || (problemMode === "benchmark" ? problemId : "custom");

  const analytics =
    result?.artifacts?.analytics?.[analyticsKey] ||
    result?.artifacts?.analytics?.custom ||
    null;

  const problemExpectations =
    analytics?.problem_expectations_data ||
    analytics?.problem_expectations ||
    null;

  const interpretationSummary = analytics?.interpretation_summary_data || null;

  const basinMapUrl =
    toOutputUrl(result?.artifacts?.basin_map) || toOutputUrl(analytics?.basin_map);

  const basinEntropyPlotUrl =
    toOutputUrl(analytics?.basin_entropy_plot) ||
    toOutputUrl(analytics?.basin_entropy_comparison_plot);

  const comparisonRows = asArray(analytics?.comparison_summary_data?.methods);
  const entropyRows = asArray(analytics?.basin_entropy_data?.methods);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analytics]);



  const initializationHistogramEntries = useMemo(() => {
    return Object.entries(analytics?.initialization_histogram || {}).map(([k, v]) => [
      k,
      toOutputUrl(v),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analytics]);

  const initialXVsRootEntries = useMemo(() => {
    return Object.entries(analytics?.initial_x_vs_root || {}).map(([k, v]) => [
      k,
      toOutputUrl(v),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analytics]);

  const initialXVsIterationsEntries = useMemo(() => {
    return Object.entries(analytics?.initial_x_vs_iterations || {}).map(([k, v]) => [
      k,
      toOutputUrl(v),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analytics]);


  const failureRegionEntries = useMemo(() => {
    return Object.entries(analytics?.failure_region || {}).map(([k, v]) => [
      k,
      toOutputUrl(v),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analytics]);

const detectedRootsRaw =
  problemMode === "benchmark"
    ? (
        (Array.isArray(benchmarkInfo?.known_roots) && benchmarkInfo.known_roots.length > 0
          ? benchmarkInfo.known_roots
          : Array.isArray(benchmarkInfo?.roots) && benchmarkInfo.roots.length > 0
          ? benchmarkInfo.roots
          : Array.isArray(result?.known_roots) && result.known_roots.length > 0
          ? result.known_roots
          : [])
      )
    : (
        (Array.isArray(result?.known_roots) && result.known_roots.length > 0
          ? result.known_roots
          : Array.isArray(rootCoverageData?.global_roots) && rootCoverageData.global_roots.length > 0
          ? rootCoverageData.global_roots
          : [])
      );

const detectedRoots = [...new Set(
  asArray(detectedRootsRaw)
    .map((r) => Number.parseFloat(r))
    .filter((r) => Number.isFinite(r))
    .map((r) => r.toFixed(3))
)];

  const boundaryRegions = Array.isArray(result?.boundaries) ? result.boundaries : [];
  const rawBoundaries = Array.isArray(result?.raw_boundaries) ? result.raw_boundaries : [];
  const boundarySummary = result?.boundary_summary || null;
  
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

    if (numericalDerivative || result?.numerical_derivative) {
      insights.push(
        "Derivative-based methods in this sweep used numerical derivative approximation rather than an analytic derivative."
      );
    }

    return insights;
  }

  const effectiveSamplingMode = result?.sampling_mode || samplingMode;
  const effectiveSampleCount =
    effectiveSamplingMode === "grid"
      ? result?.n_points ?? nPoints
      : result?.n_samples ?? nSamples;

  const effectiveNumericalDerivative =
    result?.numerical_derivative ?? numericalDerivative;

  const overviewExpr =
    result?.expr || (problemMode === "benchmark" ? benchmarkInfo?.expr : expr) || "-";

  const overviewDexpr = effectiveNumericalDerivative
    ? "(numerical derivative)"
    : result?.dexpr || (problemMode === "benchmark" ? benchmarkInfo?.dexpr : dexpr) || "-";

  const solverKey =
    result?.problem_id || (problemMode === "benchmark" ? problemIdRef.current : "custom");

  const solverSelection =
    analytics?.solver_selection_recommendation ||
    result?.artifacts?.analytics?.[solverKey]?.solver_selection_recommendation ||
    null;

  const rankedMethods = normalizeRanking(solverSelection);

  const primaryRecommendation = solverSelection?.primary_recommendation || null;
  const secondaryRecommendation = solverSelection?.secondary_recommendation || null;
  const recommendationConfidence =
    solverSelection?.recommendation_confidence_band || "unknown";

  const recommendationRationale =
    asArray(solverSelection?.rationale).length > 0
      ? asArray(solverSelection?.rationale)
      : asArray(rankedMethods.find((row) => row.method === primaryRecommendation)?.reasons_for);

  const primaryReasonsAgainst =
    asArray(rankedMethods.find((row) => row.method === primaryRecommendation)?.reasons_against);

  const executedMethods =
    asArray(result?.methods).length > 0
      ? result.methods
      : asArray(result?.methods_used).length > 0
      ? result.methods_used
      : selectedMethods;

  const overviewRangeMin =
    result?.scalar_range?.[0] ?? result?.scalar_range?.x_min ?? scalarMin;
  const overviewRangeMax =
    result?.scalar_range?.[1] ?? result?.scalar_range?.x_max ?? scalarMax;

  const expectationSource =
    problemExpectations?.analytic_checks && typeof problemExpectations.analytic_checks === "object"
      ? problemExpectations.analytic_checks
      : problemExpectations || {};

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
        effectiveSamplingMode === "grid" ? "-" : result?.random_seed ?? randomSeed,
    },
    {
      label: "Derivative Mode",
      value: effectiveNumericalDerivative ? "Numerical" : "Analytic",
    },
    { label: "Boundary Method", value: prettyMethod(boundaryMethod) },
    { label: "Methods", value: executedMethods.map(prettyMethod).join(", ") },
    { label: "Sweep Folder", value: result?.latest_sweep_dir || "-" },
    {
      label: "Boundary Regions",
      value: boundarySummary
        ? `${boundarySummary.clustered_count ?? boundaryRegions.length} regions (${boundarySummary.raw_count ?? rawBoundaries.length} raw)`
        : "None",
    },
  ];

  function normalizeMonteCarloRows(data) {
    const candidate =
      data?.methods ??
      data?.summary ??
      data?.solvers ??
      data?.method_summaries ??
      [];

    if (Array.isArray(candidate)) {
      return candidate;
    }

    if (candidate && typeof candidate === "object") {
      return Object.entries(candidate).map(([method, info]) => ({
        method,
        ...(info || {}),
      }));
    }

    return [];
  }

  const mcMethodRows = normalizeMonteCarloRows(mcSummaryData);
  const mcMeanIterationValues = mcMethodRows
    .map((row) => Number(getMcMeanIterations(row)))
    .filter((x) => Number.isFinite(x));

  const mcMinIter =
    mcMeanIterationValues.length > 0 ? Math.min(...mcMeanIterationValues) : 0;

  const mcMaxIter =
    mcMeanIterationValues.length > 0 ? Math.max(...mcMeanIterationValues) : 1;

  const mcRankingRows = [...mcMethodRows].sort((a, b) => {
    const scoreA = computeMcRankingScore(a, mcMinIter, mcMaxIter);
    const scoreB = computeMcRankingScore(b, mcMinIter, mcMaxIter);

    if (Math.abs(scoreB - scoreA) > 1e-12) {
      return scoreB - scoreA;
    }

    return Number(getMcMeanIterations(a) || Infinity) - Number(getMcMeanIterations(b) || Infinity);
  });

  const mcOverviewItems = [
    { label: "Problem Mode", value: result?.problem_mode || problemMode },
    { label: "Problem", value: result?.problem_id || problemId || "-" },
    {
      label: "Distribution",
      value: result?.distribution_type || mcConfig.distributionType,
    },
    {
      label: "Samples",
      value: String(result?.n_samples ?? mcConfig.nSamples),
    },
    {
      label: "Random Seed",
      value: String(result?.random_seed ?? mcConfig.randomSeed),
    },
    {
      label: "Derivative Mode",
      value: result?.derivative_mode || mcConfig.derivativeMode,
    },
    {
      label: "Cluster Tol",
      value: formatNumber(result?.cluster_tol ?? mcConfig.clusterTol),
    },
    {
      label: "Methods",
      value: (asArray(result?.methods).length > 0 ? result.methods : selectedMethods)
        .map(prettyMethod)
        .join(", "),
    },
    {
      label: "Output Folder",
      value: result?.latest_monte_carlo_dir || "-",
    },
  ];

  const mcTopMethod =
    mcMethodRows.length > 0
      ? [...mcMethodRows].sort(
          (a, b) =>
            Number(b.success_probability || 0) - Number(a.success_probability || 0)
        )[0]
      : null;

  const getStatusColor = (status) => {
  if (!status) return "#999";
  if (status.toLowerCase() === "pass") return "green";
  if (status.toLowerCase() === "warning") return "orange";
  if (status.toLowerCase() === "suspicious") return "red";
  return "#999";
};

  return (
    <div style={styles.page}>
      <div style={styles.pageHeader}>
        <h1 style={styles.pageTitle}>Experiment Analysis</h1>
        <p style={styles.pageSubtitle}>
          Research dashboard for basin geometry, solver reliability, and
          statistical behavior across initializations.
        </p>
      </div>

      <div style={styles.setupCard}>
        <div style={styles.setupTitle}>Experiment Setup</div>

        <div style={styles.modeSwitchRow}>
          <label style={styles.radioPill}>
            <input
              type="radio"
              name="experimentType"
              value="sweep"
              checked={experimentType === "sweep"}
              onChange={() => setExperimentType("sweep")}
              disabled={running || isPreparingRun}
            />
            <span>Sweep</span>
          </label>

          <label style={styles.radioPill}>
            <input
              type="radio"
              name="experimentType"
              value="monte_carlo"
              checked={experimentType === "monte_carlo"}
              onChange={() => setExperimentType("monte_carlo")}
              disabled={running || isPreparingRun}
            />
            <span>Monte Carlo</span>
          </label>
        </div>

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
                onChange={(e) => {
                  const nextId = e.target.value;
                  problemIdRef.current = nextId;
                  setProblemId(nextId);

                  const selected =
                    benchmarks.find((b) => String(b.id) === String(nextId)) ||
                    BENCHMARK_DETAILS[nextId];

                  if (selected) {
                    if (selected.expr) setExpr(selected.expr);
                    if (selected.dexpr) setDexpr(selected.dexpr);

                    const domain = selected.domain;
                    if (Array.isArray(domain) && domain.length >= 2) {
                      const d0 = Number(domain[0]);
                      const d1 = Number(domain[1]);

                      setScalarMin(d0);
                      setScalarMax(d1);
                      setBracketMin(d0);
                      setBracketMax(d1);

                      setMcConfig((prev) => ({
                        ...prev,
                        a: d0,
                        b: d1,
                      }));
                    }
                  }
                }}
                disabled={running || isPreparingRun}
                style={styles.input}
              >
                {benchmarks.length > 0
                  ? benchmarks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.id} - {b.name || b.expr}
                      </option>
                    ))
                  : Object.entries(BENCHMARK_DETAILS).map(([key, info]) => (
                      <option key={key} value={key}>
                        {key} - {info.name || info.expr}
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
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontWeight: 600,
                    color: "#222",
                    marginBottom: 6,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={numericalDerivative}
                    onChange={(e) => {
                      setNumericalDerivative(e.target.checked);
                      setMcConfig((prev) => ({
                        ...prev,
                        derivativeMode: e.target.checked ? "numerical" : "analytic",
                      }));
                    }}
                    disabled={running || isPreparingRun}
                  />
                  <span>Use numerical derivative</span>
                </label>
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <label style={styles.label}>f&apos;(x)</label>
                <input
                  value={dexpr}
                  onChange={(e) => setDexpr(e.target.value)}
                  disabled={
                    (experimentType === "sweep" && numericalDerivative) ||
                    (experimentType === "monte_carlo" &&
                      mcConfig.derivativeMode === "numerical") ||
                    running ||
                    isPreparingRun
                  }
                  placeholder={
                    (experimentType === "sweep" && numericalDerivative) ||
                    (experimentType === "monte_carlo" &&
                      mcConfig.derivativeMode === "numerical")
                      ? "Using numerical derivative"
                      : "e.g. 3*x**2 - 1"
                  }
                  style={styles.input}
                />
              </div>
            </>
          )}

          {problemMode === "benchmark" && experimentType === "sweep" ? (
            <div style={{ gridColumn: "1 / -1" }}>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontWeight: 600,
                  color: "#222",
                  marginBottom: 6,
                }}
              >
                <input
                  type="checkbox"
                  checked={numericalDerivative}
                  onChange={(e) => setNumericalDerivative(e.target.checked)}
                  disabled={running || isPreparingRun}
                />
                <span>Use numerical derivative for derivative-based methods</span>
              </label>
            </div>
          ) : null}

          {experimentType === "sweep" ? (
            <>
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
            </>
          ) : (
            <>
              <div>
                <label style={styles.label}>Distribution</label>
                <select
                  value={mcConfig.distributionType}
                  onChange={(e) => updateMcConfig("distributionType", e.target.value)}
                  disabled={running || isPreparingRun}
                  style={styles.input}
                >
                  <option value="uniform">Uniform</option>
                  <option value="gaussian">Gaussian</option>
                </select>
              </div>

              {mcConfig.distributionType === "uniform" ? (
                <>
                  <div>
                    <label style={styles.label}>Uniform a</label>
                    <input
                      type="number"
                      step="any"
                      value={mcConfig.a}
                      onChange={(e) => updateMcConfig("a", Number(e.target.value))}
                      disabled={running || isPreparingRun}
                      style={styles.input}
                    />
                  </div>

                  <div>
                    <label style={styles.label}>Uniform b</label>
                    <input
                      type="number"
                      step="any"
                      value={mcConfig.b}
                      onChange={(e) => updateMcConfig("b", Number(e.target.value))}
                      disabled={running || isPreparingRun}
                      style={styles.input}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label style={styles.label}>Gaussian Mean</label>
                    <input
                      type="number"
                      step="any"
                      value={mcConfig.mean}
                      onChange={(e) => updateMcConfig("mean", Number(e.target.value))}
                      disabled={running || isPreparingRun}
                      style={styles.input}
                    />
                  </div>

                  <div>
                    <label style={styles.label}>Gaussian Std Dev</label>
                    <input
                      type="number"
                      step="any"
                      value={mcConfig.std}
                      onChange={(e) => updateMcConfig("std", Number(e.target.value))}
                      disabled={running || isPreparingRun}
                      style={styles.input}
                    />
                  </div>
                </>
              )}

              <div>
                <label style={styles.label}>Number of Samples</label>
                <input
                  type="number"
                  min="1"
                  value={mcConfig.nSamples}
                  onChange={(e) =>
                    updateMcConfig("nSamples", Number(e.target.value))
                  }
                  disabled={running || isPreparingRun}
                  style={styles.input}
                />
              </div>

              <div>
                <label style={styles.label}>Random Seed</label>
                <input
                  type="number"
                  value={mcConfig.randomSeed}
                  onChange={(e) =>
                    updateMcConfig("randomSeed", Number(e.target.value))
                  }
                  disabled={running || isPreparingRun}
                  style={styles.input}
                />
              </div>

              <div>
                <label style={styles.label}>Derivative Mode</label>
                <select
                  value={mcConfig.derivativeMode}
                  onChange={(e) =>
                    updateMcConfig("derivativeMode", e.target.value)
                  }
                  disabled={running || isPreparingRun}
                  style={styles.input}
                >
                  <option value="analytic">Analytic</option>
                  <option value="numerical">Numerical</option>
                </select>
              </div>

              <div>
                <label style={styles.label}>Cluster Tol</label>
                <input
                  type="number"
                  step="any"
                  value={mcConfig.clusterTol}
                  onChange={(e) =>
                    updateMcConfig("clusterTol", Number(e.target.value))
                  }
                  disabled={running || isPreparingRun}
                  style={styles.input}
                />
              </div>

              <div>
                <label style={styles.label}>Tolerance</label>
                <input
                  type="number"
                  step="any"
                  value={mcConfig.tol}
                  onChange={(e) => updateMcConfig("tol", Number(e.target.value))}
                  disabled={running || isPreparingRun}
                  style={styles.input}
                />
              </div>

              <div>
                <label style={styles.label}>Max Iter</label>
                <input
                  type="number"
                  value={mcConfig.maxIter}
                  onChange={(e) =>
                    updateMcConfig("maxIter", Number(e.target.value))
                  }
                  disabled={running || isPreparingRun}
                  style={styles.input}
                />
              </div>
            </>
          )}
        </div>

        {problemMode === "benchmark" && benchmarkInfo ? (
          <div style={styles.inlineInfoBox}>
            <div style={styles.inlineInfoTitle}>Benchmark Definition</div>

            <div style={styles.inlineInfoText}>
              <b>ID</b> = {benchmarkInfo.id || problemId}
            </div>

            <div style={styles.inlineInfoText}>
              <b>Name</b> = {benchmarkInfo.name || "-"}
            </div>

            <div style={styles.inlineInfoText}>
              <b>Category</b> = {benchmarkInfo.category || "-"}
            </div>

            <div style={styles.inlineInfoText}>
              <b>f(x)</b> = {benchmarkInfo.expr}
            </div>

            <div style={styles.inlineInfoText}>
              <b>f&apos;(x)</b> ={" "}
              {experimentType === "sweep"
                ? numericalDerivative
                  ? "(numerical derivative)"
                  : benchmarkInfo.dexpr || "-"
                : mcConfig.derivativeMode === "numerical"
                ? "(numerical derivative)"
                : benchmarkInfo.dexpr || "-"}
            </div>

            <div style={styles.inlineInfoText}>
              <b>Domain</b> ={" "}
              {Array.isArray(benchmarkInfo.domain) && benchmarkInfo.domain.length >= 2
                ? `[${benchmarkInfo.domain[0]}, ${benchmarkInfo.domain[1]}]`
                : "-"}
            </div>

            <div style={styles.inlineInfoText}>
              <b>Known Roots</b> ={" "}
              {Array.isArray(benchmarkInfo.known_roots) && benchmarkInfo.known_roots.length > 0
                ? benchmarkInfo.known_roots.join(", ")
                : Array.isArray(benchmarkInfo.roots) && benchmarkInfo.roots.length > 0
                ? benchmarkInfo.roots.join(", ")
                : "Not provided"}
            </div>

            {(benchmarkInfo.notes || benchmarkInfo.note) ? (
              <div style={styles.inlineInfoNote}>
                {benchmarkInfo.notes || benchmarkInfo.note}
              </div>
            ) : null}
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
            onClick={runExperiment}
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
              : experimentType === "monte_carlo"
              ? "Run Monte Carlo Experiment"
              : "Run Sweep Experiment"}
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
                <span style={styles.statusLabel}>Job Type</span>
                <span>{jobStatus.job_type || experimentType}</span>
              </div>
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
                    <div
            style={{
              padding: "10px 12px",
              marginBottom: "16px",
              borderRadius: "8px",
              background: "#f3f4f6",
              fontWeight: 600,
            }}
          >
            GRASP analyzes solver reliability globally and validates consistency between expected and observed behavior.
          </div>
          {isMonteCarloResult ? (
            <>
              <SectionCard
                title="Monte Carlo Overview"
                isOpen={showMcOverview}
                onToggle={() => setShowMcOverview((v) => !v)}
                description="Probabilistic solver reliability summary under the selected initialization distribution."
              >
                <InfoGrid items={mcOverviewItems} />

                {mcTopMethod ? (
                  <div style={styles.blockSpacer}>
                    <div style={styles.innerPanel}>
                      <div style={styles.innerPanelTitle}>Best Reliability</div>
                      <p style={styles.paragraph}>
                        {prettyMethod(mcTopMethod.method)} achieved the highest
                        estimated success probability (
                        {formatPercent(mcTopMethod.success_probability)}).
                      </p>
                    </div>
                  </div>
                ) : null}

                <div style={styles.blockSpacer}>
                  <MonteCarloSummaryCards rows={mcMethodRows} />
                </div>
              </SectionCard>

              <SectionCard
                title="Root Basin Probability Distribution"
                isOpen={showMcRootDistributionChart}
                onToggle={() => setShowMcRootDistributionChart((v) => !v)}
                description="Stacked probability distribution of convergence across root clusters for each Monte Carlo solver."
              >
                <MonteCarloRootDistributionChart rows={mcMethodRows} />
              </SectionCard>

              <SectionCard
                title="Solver Reliability Ranking"
                isOpen={showMcRankingChart}
                onToggle={() => setShowMcRankingChart((v) => !v)}
                description="Methods ranked by Monte Carlo success probability, with stacked success/failure bars and speed tie-breaking."
              >
                <MonteCarloRankingChart rows={mcRankingRows} />
              </SectionCard>

              <SectionCard
                title="Speed vs Reliability"
                isOpen={showMcSpeedReliabilityChart}
                onToggle={() => setShowMcSpeedReliabilityChart((v) => !v)}
                description="Scatter plot of mean iterations versus success probability for Monte Carlo solver comparison."
              >
                <MonteCarloSpeedReliabilityChart rows={mcMethodRows} />
              </SectionCard>

              <SectionCard
                title="Monte Carlo Method Comparison"
                isOpen={showMcComparison}
                onToggle={() => setShowMcComparison((v) => !v)}
                description="Method-level success probability, confidence intervals, iteration statistics, and clustered root coverage."
              >
                <DataTable
                  columns={[
                    {
                      key: "method",
                      label: "Method",
                      render: (row) => prettyMethod(row.method),
                    },
                    {
                      key: "success_probability",
                      label: "Success Prob.",
                      render: (row) => formatPercent(row.success_probability),
                    },
                    {
                      key: "failure_probability",
                      label: "Failure Prob.",
                      render: (row) => formatPercent(getMcFailureProbability(row)),
                    },
                    {
                      key: "ci",
                      label: "95% CI",
                      render: (row) =>
                        `[${formatProbability(getMcCiLow(row))}, ${formatProbability(
                          getMcCiHigh(row)
                        )}]`,
                    },
                    {
                      key: "mean_iterations",
                      label: "Mean Iter",
                      render: (row) => formatMean(getMcMeanIterations(row)),
                    },
                    {
                      key: "median_iterations",
                      label: "Median Iter",
                      render: (row) => formatNumber(getMcMedianIterations(row)),
                    },
                    {
                      key: "clustered_root_coverage",
                      label: "Root Coverage",
                      render: (row) => formatNumber(getMcRootCoverage(row)),
                    },
                  ]}
                  rows={mcMethodRows}
                  emptyText="No Monte Carlo method summary available."
                />
              </SectionCard>

              <SectionCard
                title="Monte Carlo Interpretation"
                isOpen={showMcInterpretation}
                onToggle={() => setShowMcInterpretation((v) => !v)}
                description="Automatically generated interpretation for probabilistic reliability behavior."
              >
                {mcInterpretationText ? (
                  <pre style={styles.preBlock}>{mcInterpretationText}</pre>
                ) : (
                  <p style={styles.emptyText}>
                    No Monte Carlo interpretation text available.
                  </p>
                )}
              </SectionCard>

              <SectionCard
                title="Monte Carlo Outputs"
                isOpen={showMcArtifacts}
                onToggle={() => setShowMcArtifacts((v) => !v)}
                description="Downloadable artifacts generated by the Monte Carlo experiment."
              >
                <div style={styles.outputGrid}>
                  {[
                    ["monte_carlo_records.csv", result.records_csv],
                    ["monte_carlo_summary.json", result.summary_json],
                    ["monte_carlo_metadata.json", result.metadata_json],
                    ["monte_carlo_interpretation.json", result.interpretation_json],
                    ["monte_carlo_interpretation.txt", result.interpretation_txt],
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
              </SectionCard>
            </>
          ) : (
            <>
              <SectionCard
                title="Automated Experiment Interpretation"
                isOpen={showInterpretation}
                onToggle={() => setShowInterpretation((v) => !v)}
                description="Automatically generated observations and recommendations from the current experiment."
              >
                <div style={styles.twoColGrid}>
                  <div style={styles.innerPanel}>
                    <div style={styles.innerPanelTitle}>Key Observations</div>
                    <BulletList
                      items={generateInsights()}
                      emptyText="No observations available yet."
                    />
                  </div>

                  <div style={styles.innerPanel}>
                    <div style={styles.innerPanelTitle}>Suggested Solver Choice</div>

                    {primaryRecommendation ? (
                      <>
                        <div style={{ marginBottom: 10 }}>
                          <div style={styles.kvLabel}>Primary Recommendation</div>
                          <div style={styles.kvValue}>{prettyMethod(primaryRecommendation)}</div>
                        </div>

                        <div style={{ marginBottom: 10 }}>
                          <div style={styles.kvLabel}>Secondary Recommendation</div>
                          <div style={styles.kvValue}>
                            {secondaryRecommendation ? prettyMethod(secondaryRecommendation) : "-"}
                          </div>
                        </div>

                        <div style={{ marginBottom: 10 }}>
                          <div style={styles.kvLabel}>Confidence</div>
                          <div style={styles.kvValue}>{recommendationConfidence}</div>
                        </div>

                        <div style={{ marginBottom: 10 }}>
                          <div style={styles.kvLabel}>Why this solver?</div>
                          <BulletList
                            items={recommendationRationale}
                            emptyText="No recommendation rationale available."
                          />
                        </div>

                        <div>
                          <div style={styles.kvLabel}>Why not others?</div>
                          <BulletList
                            items={primaryReasonsAgainst}
                            emptyText="No explicit drawbacks reported."
                          />
                        </div>
                      </>
                    ) : (
                      <p style={styles.paragraph}>No recommendation available yet.</p>
                    )}
                  </div>
                </div>

                {rankedMethods.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div style={styles.innerPanel}>
                      <div style={styles.innerPanelTitle}>Solver Ranking</div>

                      <div style={{ overflowX: "auto" }}>
                        <table style={styles.table}>
                          <thead>
                            <tr>
                              <th style={styles.th}>Rank</th>
                              <th style={styles.th}>Method</th>
                              <th style={styles.th}>Score</th>
                              <th style={styles.th}>Recommended</th>
                              <th style={styles.th}>Why this solver</th>
                              <th style={styles.th}>Why not others</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rankedMethods.slice(0, 3).map((item, idx) => (
                              <tr key={item.method || idx}>
                                <td style={styles.td}>{item.rank ?? idx + 1}</td>
                                <td style={styles.td}>{prettyMethod(item.method)}</td>
                                <td style={styles.td}>
                                  {item.score == null ? "-" : formatNumber(item.score)}
                                </td>
                                <td style={styles.td}>{item.recommended ? "Yes" : "No"}</td>
                                <td style={styles.td}>
                                  {item.reasons_for.length > 0 ? (
                                    <BulletList items={item.reasons_for} emptyText="-" />
                                  ) : (
                                    "-"
                                  )}
                                </td>
                                <td style={styles.td}>
                                  {item.reasons_against.length > 0 ? (
                                    <BulletList items={item.reasons_against} emptyText="-" />
                                  ) : (
                                    "-"
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </SectionCard>

            {validation && (
              <SectionCard
                title="Validation Summary"
                isOpen={showValidationSummary}
                onToggle={() => setShowValidationSummary((v) => !v)}
                description="Self-validation checks for consistency between problem expectations, solver outputs, and interpretation."
              >
                  <div style={styles.blockSpacer}>
                    <div style={styles.innerPanel}>
                      <div style={styles.innerPanelTitle}>Overall Status</div>
                      <div
                        style={{
                          fontWeight: 700,
                          color: getStatusColor(
                            validation.overall_status || validation.status
                          ),
                          fontSize: "16px",
                        }}
                      >
                        {(validation.overview?.status || "unknown").toUpperCase()}
                      </div>
                    </div>
                  </div>

                  {validation.methods && Object.keys(validation.methods).length > 0 ? (
                    <div style={styles.blockSpacer}>
                      <div style={styles.innerPanel}>
                        <div style={styles.innerPanelTitle}>Per-Method Validation</div>
                        <div style={{ overflowX: "auto" }}>
                          <table style={styles.table}>
                            <thead>
                              <tr>
                                <th style={styles.th}>Method</th>
                                <th style={styles.th}>Success Rate</th>
                                <th style={styles.th}>Status</th>
                              </tr>
                            </thead>
<tbody>
  {(validation.methods || []).map((method) => {
    const probabilityIssue = (validation.solver_checks?.issues || []).find(
      (issue) =>
        issue.code === "success_probability_consistent" &&
        issue.method === method
    );

    const countIssue = (validation.solver_checks?.issues || []).find(
      (issue) =>
        issue.code === "success_failure_consistent" &&
        issue.method === method
    );

    const successRate =
      probabilityIssue && probabilityIssue.observed != null
        ? `${(Number(probabilityIssue.observed) * 100).toFixed(2)}%`
        : "-";

    const status =
      probabilityIssue?.severity ||
      countIssue?.severity ||
      "unknown";

    return (
      <tr key={method}>
        <td style={styles.td}>{prettyMethod(method)}</td>
        <td style={styles.td}>{successRate}</td>
        <td
          style={{
            ...styles.td,
            fontWeight: 700,
            color: getStatusColor(status),
          }}
        >
          {status.toUpperCase()}
        </td>
      </tr>
    );
  })}
</tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <div style={styles.blockSpacer}>
                    <div style={styles.innerPanel}>
                      <div style={styles.innerPanelTitle}>Validation Issues</div>

                      {[
                        {
                          label: "Problem Checks",
                          items: validation.problem_checks?.issues || [],
                        },
                        {
                          label: "Solver Checks",
                          items: validation.solver_checks?.issues || [],
                        },
                        {
                          label: "Consistency Checks",
                          items: validation.consistency_checks?.issues || [],
                        },
                      ].map((group) => (
                        <div key={group.label} style={{ marginBottom: "16px" }}>
                          <div style={{ fontWeight: 700, marginBottom: "8px" }}>
                            {group.label}
                          </div>

                          {group.items.length > 0 ? (
                            <div style={{ display: "grid", gap: "10px" }}>
                              {group.items.filter((issue) => issue.severity !== "pass")
                                  .map((issue, idx) => (
                                <div
                                  key={`${group.label}-${issue.code || "issue"}-${idx}`}
                                  style={{
                                    padding: "10px 12px",
                                    borderRadius: "8px",
                                    background: "#f9fafb",
                                    border: "1px solid #e5e7eb",
                                  }}
                                >
                                  <div
                                    style={{
                                      fontWeight: 700,
                                      color: getStatusColor(issue?.severity),
                                      marginBottom: "4px",
                                    }}
                                  >
                                    [{(issue?.severity || "info").toUpperCase()}]
                                    {issue?.method ? ` ${prettyMethod(issue.method)}` : ""}
                                    {issue?.code ? ` — ${issue.code}` : ""}
                                  </div>
                                  <div
                                    style={{
                                      color: "#374151",
                                      fontSize: "13px",
                                      lineHeight: 1.6,
                                    }}
                                  >
                                    {issue?.message || "No message provided."}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p style={styles.paragraph}>
                              No warnings or inconsistencies detected.
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </SectionCard>
              )}

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
                      <div style={styles.innerPanelTitle}>
                        Analytic Expectation Snapshot
                      </div>
                      <InfoGrid
                        items={[
                          {
                            label: "Expected Root Count",
                            value: formatNumber(
                              expectationSource?.root_candidate_count ??
                              expectationSource?.root_candidates?.length ??
                              "-"
                            ),
                          },
                          {
                            label: "Sign-Change Accessible Roots",
                            value: String(
                              expectationSource?.sign_change_interval_count ?? "Not available"
                            ),
                          },
                          {
                            label: "Critical Points",
                            value: formatNumber(
                              expectationSource?.critical_point_count ??
                              expectationSource?.critical_points?.length ??
                              "-"
                            ),
                          },
                        ]}
                      />
                    </div>
                  </div>
                ) : null}

                <div style={styles.blockSpacer}>
                  <div style={styles.twoColGrid}>
                    <div style={styles.innerPanel}>
                      <div style={styles.innerPanelTitle}>Root Validation</div>

                      <div style={styles.inlineInfoText}>
                        <b>Expected Roots</b> = {formatRoots(benchmarkInfo?.roots)}
                      </div>

                      <div style={styles.inlineInfoText}>
                        <b>Observed Roots</b> = {detectedRoots.length > 0 ? detectedRoots.join(", ") : "Not available"}
                      </div>

                      <div style={styles.inlineInfoText}>
                        <b>Coverage</b> = {detectedRoots.length} / {asArray(benchmarkInfo?.roots).length}
                      </div>
                    </div>

                   

                    <div style={styles.innerPanel}>
                      <div style={styles.innerPanelTitle}>Key Findings</div>
                      <InfoGrid
                        items={[
                          {
                            label: "Methods Compared",
                            value: String(executedMethods.length),
                          },
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
                              ? `${prettyMethod(
                                  fastestMedianMethod.method
                                )} (${formatNumber(
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
                      <div style={styles.innerPanelTitle}>
                        High-Level Interpretation
                      </div>
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
                <p style={styles.paragraph}>
                  This section explains how initial guesses map to converged roots, how sharply
                  solver behavior changes across the domain, and how structured or chaotic the
                  basin geometry is.
                </p>
<SubsectionCard
  title="Boundary Analysis"
  isOpen={showBoundaryAnalysis}
  onToggle={() => setShowBoundaryAnalysis((v) => !v)}
>
  {boundarySummary ? (
    (() => {
      const clustered = Number(boundarySummary?.clustered_count || 0);
      const raw = Number(boundarySummary?.raw_count || 0);


      let interpretation = "";
      let tone = "#6b7280";
      let background = "#f9fafb";

      if (clustered > 0) {
        interpretation =
          `Detected ${clustered} clustered boundary region(s). ` +
          `This indicates well-defined basin transition zones where solver behavior changes sharply. ` +
          `The problem likely exhibits multiple attractors with structured basin separation.`;
        tone = "#b45309";
        background = "#fffbeb";
      } else if (raw > 0) {
        interpretation =
          `No clustered boundary regions detected, but ${raw} raw boundary transition point(s) exist. ` +
          `This suggests basin transitions are present but not sharply resolved at the current sampling resolution. ` +
          `Increasing resolution may reveal clearer basin structure.`;
        tone = "#1d4ed8";
        background = "#eff6ff";
} else {
  interpretation =
    `No clustered boundary transitions were detected at the current resolution. ` +
    `Multiple basins may still exist, but their transition structure is not sharply resolved in this sampling. ` +
    `Higher sampling density may reveal narrower or more fragmented transition regions.`;
  tone = "#047857";
  background = "#ecfdf5";
}

      return (
        <>
          <div style={styles.kpiGrid}>
            <div style={styles.kpiCard}>
              <div style={styles.kpiLabel}>Clustered Regions</div>
              <div style={styles.kpiValue}>{clustered}</div>
            </div>

            <div style={styles.kpiCard}>
              <div style={styles.kpiLabel}>Raw Boundary Points</div>
              <div style={styles.kpiValue}>{raw}</div>
            </div>

            {boundarySummary?.cluster_tolerance !== undefined && (
              <div style={styles.kpiCard}>
                <div style={styles.kpiLabel}>Cluster Tolerance</div>
                <div style={styles.kpiValue}>
                  {Number(boundarySummary.cluster_tolerance).toFixed(4)}
                </div>
              </div>
            )}
          </div>

          <div
            style={{
              marginTop: "8px",
              padding: "10px 12px",
              borderRadius: "8px",
              background,
              border: "1px solid #e5e7eb",
              color: tone,
              fontSize: "13px",
              lineHeight: "1.6",
            }}
          >
            {interpretation}
          </div>
        </>
      );
    })()
  ) : (
    <div style={styles.mutedText}>Boundary summary is not available for this run.</div>
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

      {/* ✅ NEW: Interpretation Block */}
      <div
        style={{
          marginTop: "10px",
          padding: "10px 12px",
          borderRadius: "8px",
          background: "#f9fafb",
          border: "1px solid #e5e7eb",
          color: "#374151",
          fontSize: "13px",
          lineHeight: "1.6",
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: "6px" }}>
          Basin map interpretation
        </div>

        <div>
          This plot shows the <strong>observed attraction structure</strong> for
          the selected method. Each colored region represents the converged root
          or attractor reached from sampled initial guesses.
        </div>

        <div style={{ marginTop: "6px" }}>
          These regions are derived from empirical solver outcomes across the
          sampled domain. They represent <strong>observed basins</strong>, not
          the analytic ground-truth root definition by themselves.
        </div>

        <div style={{ marginTop: "6px" }}>
          Broad contiguous color bands indicate more stable attraction zones,
          while narrow interleaved or fragmented regions indicate stronger
          sensitivity to initialization and more complex basin geometry.
        </div>
      </div>

      {/* Existing Expected Behavior Block */}
      {asArray(problemExpectations?.section_expectations?.basin_map?.notes)
        .length > 0 ? (
        <div style={styles.blockSpacer}>
          <div style={styles.innerPanel}>
            <div style={styles.innerPanelTitle}>
              Expected Basin Behavior
            </div>
            <BulletList
              items={
                problemExpectations.section_expectations.basin_map.notes
              }
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
    <p style={styles.emptyText}>
      No basin entropy comparison plot available.
    </p>
  )}

  <div
    style={{
      marginTop: "10px",
      padding: "10px 12px",
      borderRadius: "8px",
      background: "#f9fafb",
      border: "1px solid #e5e7eb",
      color: "#374151",
      fontSize: "13px",
      lineHeight: "1.6",
    }}
  >
    <div style={{ fontWeight: 700, marginBottom: "6px" }}>
      Basin complexity interpretation
    </div>

    {(() => {
      const rows = asArray(entropyRows).filter(
        (row) => row && row.entropy !== undefined && row.entropy !== null
      );

      if (!rows.length) {
        return <div>No entropy data available.</div>;
      }

      const entropies = rows.map((r) => Number(r.entropy)).filter(Number.isFinite);

      const minE = Math.min(...entropies);
      const maxE = Math.max(...entropies);

      const minMethods = rows
        .filter((r) => Number(r.entropy) === minE)
        .map((r) => prettyMethod(r.method));

      const maxMethods = rows
        .filter((r) => Number(r.entropy) === maxE)
        .map((r) => prettyMethod(r.method));

      return (
        <>
          <div>
            Lower entropy indicates more structured basin geometry, while higher
            entropy indicates more fragmented and complex basin structure.
          </div>

          <div style={{ marginTop: "6px" }}>
            <strong>Most structured method(s):</strong>
<div>{minMethods.join(", ")}</div>
<div style={{ fontSize: "12px", color: "#6b7280" }}>
  Entropy: {formatEntropy(minE)}
</div>
          </div>

          <div style={{ marginTop: "4px" }}>
            <strong>Most fragmented method(s):</strong> {maxMethods.join(", ")} ({formatEntropy(maxE)})
          </div>

          <div style={{ marginTop: "6px" }}>
            More structured basin geometry generally suggests more predictable
            convergence across initial guesses. More fragmented basin geometry
            suggests stronger sensitivity to initialization and less stable
            global behavior.
          </div>
        </>
      );
    })()}
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

  {asArray(basinDistributionEntries).length > 0 ? (
    <div
      style={{
        marginTop: "10px",
        padding: "10px 12px",
        borderRadius: "8px",
        background: "#f9fafb",
        border: "1px solid #e5e7eb",
        color: "#374151",
        fontSize: "13px",
        lineHeight: "1.6",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: "6px" }}>
        Basin distribution interpretation
      </div>

      <div>
        These plots show how each method distributes its converged runs across
        the observed root basins. A more uniform distribution suggests broader
        coverage across attractors, while a strongly skewed distribution suggests
        that the method is biased toward particular roots or attraction regions.
      </div>

      <div style={{ marginTop: "6px" }}>
        If some expected roots are absent or receive very little probability,
        that can indicate incomplete global coverage, unequal basin sizes, or a
        tendency of the method to favor only part of the domain.
      </div>

      <div style={{ marginTop: "6px" }}>
        Distribution plots should be read together with root coverage and basin
        size plots: a balanced distribution is not always required, but strong
        imbalance can reveal solver preference, asymmetric basin geometry, or
        missed attractors.
      </div>
    </div>
  ) : null}
</SubsectionCard>

                <SubsectionCard
                  title="Root Basin Size"
                  isOpen={showRootBasinSize}
                  onToggle={() => setShowRootBasinSize((v) => !v)}
                >
                  <PlotGrid
                    entries={basinDistributionEntries}
                    prettyMethodFn={prettyMethod}
                    altPrefix="Root basin size for"
                    emptyText="No root basin size artifacts available."
                  />

                  {asArray(basinDistributionEntries).length > 0 ? (
                    <div
                      style={{
                        marginTop: "10px",
                        padding: "10px 12px",
                        borderRadius: "8px",
                        background: "#f9fafb",
                        border: "1px solid #e5e7eb",
                        color: "#374151",
                        fontSize: "13px",
                        lineHeight: "1.6",
                      }}
                    >
                      <div style={{ fontWeight: 700, marginBottom: "6px" }}>
                        Root basin size interpretation
                      </div>

                      <div>
                        These plots show how many initial guesses converge to each observed root,
                        effectively measuring the relative size of each basin of attraction.
                      </div>

                      <div style={{ marginTop: "6px" }}>
                        A more uniform distribution of basin sizes suggests balanced attraction
                        across roots, while strongly uneven basin sizes indicate dominance of
                        certain roots or attraction regions.
                      </div>

                      <div style={{ marginTop: "6px" }}>
                        Large dominant basins may reflect either true geometric dominance or
                        solver bias. Very small or missing basins may indicate that some roots
                        are difficult to discover under the current method or sampling.
                      </div>

                      <div style={{ marginTop: "6px" }}>
                        Basin size should be interpreted together with entropy and distribution:
                        balanced basin sizes with low entropy generally indicate more stable and
                        predictable global behavior.
                      </div>
                    </div>
                  ) : null}
                </SubsectionCard>
              </SectionCard>

<SectionCard
  title="Initialization Sampling"
  isOpen={showInitializationSampling}
  onToggle={() => setShowInitializationSampling((v) => !v)}
  description="Diagnostics showing where initial guesses were sampled and how they relate to convergence outcomes."
>
  <p style={styles.paragraph}>
    Initialization sampling shows how initial guesses are distributed and how they
    influence convergence behavior across methods.
  </p>
  {(
  asArray(initializationHistogramEntries).length > 0 ||
  asArray(initialXVsRootEntries).length > 0 ||
  asArray(initialXVsIterationsEntries).length > 0
) && (
  <div
    style={{
      marginTop: "10px",
      marginBottom: "10px",
      padding: "10px 12px",
      borderRadius: "8px",
      background: "#f3f4f6",
      border: "1px solid #e5e7eb",
      color: "#374151",
      fontSize: "13px",
      lineHeight: "1.6",
    }}
  >
    <div style={{ fontWeight: 700, marginBottom: "6px" }}>
      Initialization behavior summary
    </div>

    <div>
      These diagnostics collectively describe how solver behavior depends on the
      starting point. They reveal whether convergence is consistent across the
      domain or concentrated in specific regions.
    </div>

    <div style={{ marginTop: "6px" }}>
      Uniform sampling with smooth root mapping and stable iteration counts
      suggests robust global behavior. Strong dependence on initial conditions,
      abrupt root switching, or localized high-iteration regions indicate
      sensitivity and potential instability.
    </div>

    <div style={{ marginTop: "6px" }}>
      This section connects basin geometry with performance: it explains not only
      which roots are found, but where they are reachable and how difficult they
      are to compute from different initializations.
    </div>
  </div>
)}

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

    {asArray(initializationHistogramEntries).length > 0 ? (
      <div
        style={{
          marginTop: "10px",
          padding: "10px 12px",
          borderRadius: "8px",
          background: "#f9fafb",
          border: "1px solid #e5e7eb",
          color: "#374151",
          fontSize: "13px",
          lineHeight: "1.6",
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: "6px" }}>
          Initialization histogram interpretation
        </div>

        <div>
          These plots show how sampled initial guesses were distributed across the
          domain for each method. They help verify whether the experiment explored
          the initialization range evenly or whether sampling was concentrated in
          particular regions.
        </div>

        <div style={{ marginTop: "6px" }}>
          Broad, even coverage supports fair global comparison. Sparse or uneven
          sampling can hide narrow failure regions, distort basin statistics, or
          overemphasize behavior in only part of the domain.
        </div>
      </div>
    ) : null}
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

    {asArray(initialXVsRootEntries).length > 0 ? (
      <div
        style={{
          marginTop: "10px",
          padding: "10px 12px",
          borderRadius: "8px",
          background: "#f9fafb",
          border: "1px solid #e5e7eb",
          color: "#374151",
          fontSize: "13px",
          lineHeight: "1.6",
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: "6px" }}>
          Initial guess vs converged root interpretation
        </div>

        <div>
          These plots show how the final converged root depends on the starting
          point. They are a direct view of attraction behavior: nearby initial
          guesses may converge to the same root, or sharp changes may send them to
          different attractors.
        </div>

        <div style={{ marginTop: "6px" }}>
          Smooth, well-separated regions suggest predictable basin structure.
          Interleaved bands or abrupt switching indicate stronger sensitivity to
          initialization and more complex global behavior.
        </div>

        <div style={{ marginTop: "6px" }}>
          This view should be read together with basin maps and root coverage: it
          helps explain not just which roots were found, but where in the domain
          they were reachable.
        </div>
      </div>
    ) : null}
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

    {asArray(initialXVsIterationsEntries).length > 0 ? (
      <div
        style={{
          marginTop: "10px",
          padding: "10px 12px",
          borderRadius: "8px",
          background: "#f9fafb",
          border: "1px solid #e5e7eb",
          color: "#374151",
          fontSize: "13px",
          lineHeight: "1.6",
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: "6px" }}>
          Initial guess vs iterations interpretation
        </div>

        <div>
          These plots show how iteration count varies with the starting point.
          They reveal where convergence is easy, where it slows down, and where
          the solver may be struggling near difficult regions of the domain.
        </div>

        <div style={{ marginTop: "6px" }}>
          Low and relatively uniform iteration counts suggest stable performance
          across initializations. Sharp spikes or localized high-iteration bands
          often indicate sensitive regions, weak local conditioning, or transitions
          between attraction basins.
        </div>

        <div style={{ marginTop: "6px" }}>
          When high-iteration regions align with fragmented basin structure or
          failures, that is strong evidence of global instability rather than just
          isolated slow convergence.
        </div>
      </div>
    ) : null}
  </SubsectionCard>
</SectionCard>

<SectionCard
  title="Solver Stability"
  isOpen={showSolverStability}
  onToggle={() => setShowSolverStability((v) => !v)}
  description="Regions where solvers fail, diverge, or exhibit unstable convergence."
>
  <p style={styles.paragraph}>
    Stability analysis identifies where solvers fail, stagnate, or behave
    inconsistently across the domain. These diagnostics reveal how reliable a
    method is with respect to initialization.
  </p>

  <div
    style={{
      marginTop: "10px",
      marginBottom: "10px",
      padding: "10px 12px",
      borderRadius: "8px",
      background: "#f3f4f6",
      border: "1px solid #e5e7eb",
      color: "#374151",
      fontSize: "13px",
      lineHeight: "1.6",
    }}
  >
    <div style={{ fontWeight: 700, marginBottom: "6px" }}>
      Stability summary
    </div>

    {failureQuickNote ? (
      <div style={{ marginBottom: "8px" }}>{failureQuickNote}</div>
    ) : null}

    <div>
      This section highlights where convergence breaks down across the
      initialization domain. It provides a direct measure of solver reliability
      under varying starting conditions.
    </div>

    <div style={{ marginTop: "6px" }}>
      Consistent convergence across the domain indicates strong global
      robustness. Localized failure regions reveal sensitivity to initial
      conditions and potential instability near difficult regions such as basin
      boundaries or derivative-critical points.
    </div>

    <div style={{ marginTop: "6px" }}>
      Observed failures should be interpreted together with basin geometry and
      analytic expectations: alignment with predicted pathology regions confirms
      theoretical risk, while unexpected failures may indicate numerical or
      implementation issues.
    </div>
  </div>

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

    <div style={styles.blockSpacer}>
      <div style={styles.innerPanel}>
        <div style={styles.innerPanelTitle}>
          Failure Interpretation
        </div>

        {interpretationSummary?.failure_interpretation ? (
          <BulletList
            items={
              interpretationSummary.failure_interpretation.global_notes || []
            }
            emptyText="No failure interpretation available."
          />
        ) : (
          <p style={styles.paragraph}>No failure interpretation available.</p>
        )}

        <div
          style={{
            marginTop: "10px",
            padding: "10px 12px",
            borderRadius: "8px",
            background: "#f9fafb",
            border: "1px solid #e5e7eb",
            color: "#374151",
            fontSize: "13px",
            lineHeight: "1.6",
          }}
        >
          <div>
            Failure region plots show where convergence fails or becomes
            unstable. Each point corresponds to an initialization that either
            converged successfully or encountered divergence, stagnation, or
            iteration limits.
          </div>

          <div style={{ marginTop: "6px" }}>
            Isolated failure points indicate localized numerical difficulty,
            whereas continuous bands of failure suggest structurally unstable
            regions in the problem.
          </div>

          <div style={{ marginTop: "6px" }}>
            Derivative-based methods such as Newton and Secant are generally
            more sensitive to initialization and may fail near critical points
            or basin boundaries. Bracket-based methods typically avoid
            divergence but may trade off speed for robustness.
          </div>

          <div style={{ marginTop: "6px" }}>
            Failure regions should be interpreted alongside basin maps and
            iteration plots: alignment between failure zones and basin
            transitions indicates inherent problem difficulty rather than random
            instability.
          </div>
        </div>
      </div>
    </div>
  </SubsectionCard>
</SectionCard>

<SectionCard
  title="Statistical Diagnostics"
  isOpen={showStatDiagnostics}
  onToggle={() => setShowStatDiagnostics((v) => !v)}
  description="Summarizes aggregate solver performance, convergence efficiency, failure behavior, and tail-risk across all sampled initializations."
>
  <p style={styles.paragraph}>
    This section summarizes root coverage, basin-size statistics, solver
    comparison, and speed–reliability tradeoffs across all sampled initial
    conditions.
  </p>

  {comparisonRows.length > 0 && (
    <div
      style={{
        marginTop: "10px",
        marginBottom: "10px",
        padding: "10px 12px",
        borderRadius: "8px",
        background: "#f3f4f6",
        border: "1px solid #e5e7eb",
        color: "#374151",
        fontSize: "13px",
        lineHeight: "1.6",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: "6px" }}>
        Statistical summary
      </div>

      {(() => {
        const validRows = asArray(comparisonRows).filter(Boolean);
        if (!validRows.length) return null;

        const maxSuccess = Math.max(
          ...validRows.map((row) => Number(row.success_rate ?? -Infinity))
        );

        const fastest = [...validRows].sort(
          (a, b) =>
            (Number(a.median_iter) || 1e9) -
            (Number(b.median_iter) || 1e9)
        )[0];

        const allPerfect = validRows.every(
          (row) => Number(row.success_rate) >= 0.999999
        );

        return (
          <>
            {allPerfect ? (
              <div>
                <b>Reliability:</b> All methods achieved perfect success rate (
                {formatPercent(maxSuccess)}).
              </div>
            ) : (
              <div>
                <b>Most reliable:</b>{" "}
                {validRows
                  .filter((row) => Number(row.success_rate) === maxSuccess)
                  .map((row) => prettyMethod(row.method))
                  .join(", ")}{" "}
                ({formatPercent(maxSuccess)})
              </div>
            )}

            <div style={{ marginTop: "4px" }}>
              <b>Fastest (median):</b> {prettyMethod(fastest?.method)} (
              {formatNumber(fastest?.median_iter)} iterations)
            </div>

            <div style={{ marginTop: "6px" }}>
              When reliability and coverage are identical across methods, the
              main differences arise from convergence speed, stability margins,
              and sensitivity to initialization rather than from root discovery.
            </div>
          </>
        );
      })()}
    </div>
  )}

  <SubsectionCard
    title="Root Coverage"
    isOpen={showRootCoverage}
    onToggle={() => setShowRootCoverage((v) => !v)}
  >
    {(() => {
      const globalRoots = asArray(
        rootCoverageData?.global_roots ||
          rootCoverageData?.globalRoots ||
          rootCoverageData?.global_behavior?.in_domain_detected_roots ||
          []
      ).map((r) => (Math.abs(Number(r)) < 1e-10 ? 0 : Number(r)));

      const solverData =
        rootCoverageData?.solvers_ui ||
        rootCoverageData?.solvers ||
        rootCoverageData?.per_solver ||
        rootCoverageData?.perSolver ||
        {};

      const coverageRows = Object.entries(solverData).map(([solver, info]) => {
        const trueBehavior = info?.true_behavior || {};
        const benchmarkEval = info?.benchmark_evaluation || {};

        const rootsFound =
          info?.roots_found ??
          trueBehavior?.in_domain_detected_root_count ??
          benchmarkEval?.benchmark_matched_count ??
          "-";

        const totalRoots =
          info?.total_roots ??
          benchmarkEval?.benchmark_known_root_count ??
          (globalRoots.length > 0 ? globalRoots.length : "-");

        const coverage =
          info?.coverage ??
          benchmarkEval?.benchmark_coverage ??
          null;

        const foundRoots =
          info?.found_roots ??
          trueBehavior?.in_domain_detected_roots ??
          benchmarkEval?.benchmark_matched_roots ??
          [];

        return {
          solver,
          roots_found: rootsFound,
          total_roots: totalRoots,
          coverage,
          found_roots: foundRoots,
        };
      });

      const allFullCoverage =
        coverageRows.length > 0 &&
        coverageRows.every(
          (row) => Number(row.coverage) >= 0.999999 || Number(row.coverage) === 1
        );

      return rootCoverageData ? (
        <>
          <InfoGrid
            items={[
              {
                label: "Total Roots Detected",
                value:
                  globalRoots.length > 0
                    ? String(globalRoots.length)
                    : "Not available",
              },
              {
                label: "Global Roots",
                value:
                  globalRoots.length > 0
                    ? globalRoots.map((r) => formatNumber(r)).join(", ")
                    : "Not available",
              },
            ]}
          />

          <div style={styles.blockSpacer}>
            <DataTable
              columns={[
                {
                  key: "solver",
                  label: "Solver",
                  render: (row) => prettyMethod(row.solver),
                },
                { key: "roots_found", label: "Roots Found" },
                { key: "total_roots", label: "Total Roots" },
                {
                  key: "coverage",
                  label: "Coverage",
                  render: (row) =>
                    row.coverage !== null && row.coverage !== undefined
                      ? formatPercent(row.coverage)
                      : "-",
                },
                {
                  key: "found_roots",
                  label: "Found Roots",
                  render: (row) => {
                    const roots = asArray(row.found_roots);
                    if (!roots.length) return "-";
                    const preview = roots
                      .slice(0, 3)
                      .map((r) => formatNumber(r));
                    return `${preview.join(", ")}${roots.length > 3 ? " ..." : ""}`;
                  },
                },
              ]}
              rows={coverageRows}
              emptyText="No root coverage data available."
            />
          </div>

          {rootCoveragePlot ? (
            <div style={styles.blockSpacer}>
              <div style={styles.singlePlotWrap}>
                <PlotTile
                  title="Benchmark Root Coverage by Solver"
                  url={toOutputUrl(rootCoveragePlot)}
                  alt="Benchmark root coverage by solver"
                />
              </div>
            </div>
          ) : null}

          <div style={styles.blockSpacer}>
            <div style={styles.innerPanel}>
              <div style={styles.innerPanelTitle}>
                Coverage Interpretation
              </div>

              <p style={styles.paragraph}>
                Root coverage measures how completely each solver discovers the
                expected set of roots across all sampled initializations.
              </p>

              {allFullCoverage ? (
                <>
                  <p style={styles.paragraph}>
                    All evaluated methods achieved complete root coverage across
                    the domain. This indicates that all attractors are globally
                    reachable and no solver exhibits basin exclusion or
                    structural bias.
                  </p>

                  <p style={styles.paragraph}>
                    Because coverage is identical across methods, solver
                    differences are driven by convergence speed, stability, and
                    sensitivity to initialization rather than discovery
                    capability.
                  </p>

                  <p style={styles.paragraph}>
                    This corresponds to a well-conditioned regime where the
                    problem structure does not disadvantage any solver, making
                    efficiency the primary differentiator.
                  </p>
                </>
              ) : (
                <>
                  <p style={styles.paragraph}>
                    Missing coverage suggests bias, instability, or limited
                    basin accessibility. Methods with stronger basin exploration
                    and robustness tend to recover more of the global root set,
                    while sensitive methods may miss roots due to attraction
                    bias or failure regions.
                  </p>

                  <p style={styles.paragraph}>
                    Coverage differences should be interpreted together with
                    basin geometry and failure diagnostics to determine whether
                    missed roots arise from true geometric difficulty or from
                    solver-specific instability.
                  </p>
                </>
              )}
            </div>
          </div>

          {asArray(
            interpretationSummary?.root_coverage_interpretation?.comparison_notes
          ).length > 0 ? (
            <>
              <div style={styles.blockSpacer}>
                <div style={styles.innerPanel}>
                  <div style={styles.innerPanelTitle}>
                    Coverage Notes from Interpretation Layer
                  </div>
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
                      render: (row) => <span>{row.status}</span>,
                    },
                    { key: "expected", label: "Expected" },
                    { key: "observed", label: "Observed" },
                  ]}
                  rows={Object.entries(
                    interpretationSummary.root_coverage_interpretation
                      .per_method || {}
                  ).map(([method, info]) => ({
                    method,
                    ...(info || {}),
                  }))}
                  emptyText="No expectation-vs-observation data available."
                />
              </div>
            </>
          ) : null}
        </>
      ) : (
        <p style={styles.emptyText}>No root coverage data available.</p>
      );
    })()}
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
            {
              key: "method",
              label: "Method",
              render: (row) => prettyMethod(row.method),
            },
            { key: "num_basins", label: "Basins" },
            {
              key: "dominant_root",
              label: "Dominant Root",
              render: (row) => formatNumber(row.dominant_root),
            },
            {
              key: "dominant_share",
              label: "Dominant Share",
              render: (row) => formatPercent(row.dominant_share),
            },
            { key: "total_converged", label: "Converged" },
            { key: "failure_count", label: "Failures" },
          ]}
          rows={(rootBasinStatisticsData.summary_table || []).map((row) => ({
            ...row,
            basins: row.num_basins,
          }))}
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

        <div style={styles.blockSpacer}>
          <div style={styles.innerPanel}>
            <div style={styles.innerPanelTitle}>
              Basin Dominance Interpretation
            </div>

            <p style={styles.paragraph}>
              Root basin statistics quantify how convergence is distributed
              across different attractors. A dominant root with a large share
              indicates that most initializations converge to that root,
              suggesting either geometric dominance or solver bias.
            </p>

            <p style={styles.paragraph}>
              Balanced basin shares indicate more uniform exploration and fair
              coverage, while strong imbalance may reveal difficulty in reaching
              certain roots or sensitivity to initialization.
            </p>
          </div>
        </div>
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
            {
              key: "method",
              label: "Method",
              render: (row) => prettyMethod(row.method),
            },
            {
              key: "success_rate",
              label: "Success",
              render: (row) => formatPercent(row.success_rate),
            },
            {
              key: "mean_iter",
              label: "Mean Iter",
              render: (row) => formatNumber(row.mean_iter),
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
              label: "Failures",
              render: (row) => formatNumber(row.failure_count),
            },
          ]}
          rows={comparisonRows}
          emptyText="No solver comparison data available."
        />

        {asArray(
          interpretationSummary?.comparison_interpretation?.notes
        ).length > 0 ? (
          <div style={styles.blockSpacer}>
            <div style={styles.innerPanel}>
              <div style={styles.innerPanelTitle}>
                Comparison Interpretation
              </div>
              <BulletList
                items={interpretationSummary.comparison_interpretation.notes}
                emptyText="No comparison interpretation available."
              />
            </div>
          </div>
        ) : null}

        <div style={styles.blockSpacer}>
          <div style={styles.innerPanel}>
            <div style={styles.innerPanelTitle}>
              Solver Comparison Interpretation
            </div>

            <p style={styles.paragraph}>
              This table summarizes global solver behavior across all sampled
              initializations. Success rate reflects robustness, while iteration
              statistics capture convergence efficiency.
            </p>

            <p style={styles.paragraph}>
              High success rate with low variance in iterations indicates stable
              and reliable performance. Methods with low iteration counts but
              higher failure rates may be faster but less dependable.
            </p>

            <p style={styles.paragraph}>
              The combination of success rate, iteration distribution, and
              failure count provides a comprehensive view of solver tradeoffs
              between speed and reliability.
            </p>
          </div>
        </div>
      </>
    ) : (
      <p style={styles.emptyText}>No solver comparison data available.</p>
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

    {(paretoMeanUrl || paretoMedianUrl) && (
      <div
        style={{
          marginTop: "10px",
          padding: "10px 12px",
          borderRadius: "8px",
          background: "#f9fafb",
          border: "1px solid #e5e7eb",
          color: "#374151",
          fontSize: "13px",
          lineHeight: "1.6",
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: "6px" }}>
          Pareto tradeoff interpretation
        </div>

        <div>
          These plots show the tradeoff between convergence speed (iterations)
          and reliability (failure rate). Each point represents a solver.
        </div>

        <div style={{ marginTop: "6px" }}>
          Methods closer to the lower-left region achieve both low iteration
          counts and low failure rates, representing stronger overall
          performance. Methods farther from this region exhibit clearer
          tradeoffs between speed and robustness.
        </div>

        <div style={{ marginTop: "6px" }}>
          This analysis highlights that no single solver is universally optimal:
          robust methods prioritize reliability, while aggressive methods
          prioritize speed at the cost of stability.
        </div>
      </div>
    )}
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
            </>
          )}
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

  rankingChartWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },

  rankingRow: {
    display: "grid",
    gridTemplateColumns: "260px minmax(220px, 1fr)",
    gap: 18,
    alignItems: "center",
  },

  rankingLabelBlock: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    minWidth: 0,
  },

  rankingRank: {
    minWidth: 34,
    height: 34,
    borderRadius: 999,
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    color: "#1d4ed8",
    fontWeight: 800,
    fontSize: 13,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  rankingMethod: {
    fontSize: 15,
    fontWeight: 700,
    color: "#0f172a",
    lineHeight: 1.4,
  },

  rankingSubtext: {
    fontSize: 12,
    color: "#64748b",
    marginTop: 4,
  },

  stackedBarWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },

  stackedBarOuter: {
    width: "100%",
    height: 18,
    borderRadius: 999,
    background: "#e2e8f0",
    overflow: "hidden",
    display: "flex",
  },

  stackedBarSuccess: {
    height: "100%",
    background: "#16a34a",
  },

  stackedBarFailure: {
    height: "100%",
    background: "#dc2626",
  },

  stackedBarLabels: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },

  successText: {
    fontSize: 13,
    fontWeight: 700,
    color: "#166534",
  },

  failureText: {
    fontSize: 13,
    fontWeight: 700,
    color: "#991b1b",
  },

  rankingBarOuter: {
    width: "100%",
    height: 16,
    borderRadius: 999,
    background: "#e2e8f0",
    overflow: "hidden",
  },

  rankingBarInner: {
    height: "100%",
    borderRadius: 999,
    background: "#2563eb",
    transition: "width 0.25s ease",
  },

  rankingValue: {
    fontSize: 14,
    fontWeight: 800,
    color: "#0f172a",
    textAlign: "right",
  },

  scatterWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },

  scatterSvg: {
    display: "block",
    width: "100%",
    maxWidth: 980,
    height: "auto",
    border: "1px solid #e2e8f0",
    borderRadius: 16,
    background: "#ffffff",
  },

  scatterCaption: {
    fontSize: 13,
    color: "#64748b",
    lineHeight: 1.5,
  },

  rootDistWrap: {
  display: "flex",
  flexDirection: "column",
  gap: 18,
},

  rootDistLegend: {
    display: "flex",
    flexWrap: "wrap",
    gap: 14,
    alignItems: "center",
  },

  rootLegendItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  },

  rootLegendSwatch: {
    width: 14,
    height: 14,
    borderRadius: 4,
    display: "inline-block",
  },

  rootLegendText: {
    fontSize: 13,
    color: "#334155",
    fontWeight: 600,
  },

  rootDistRows: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },

  rootDistRow: {
    display: "grid",
    gridTemplateColumns: "220px minmax(240px, 1fr)",
    gap: 18,
    alignItems: "start",
  },

  rootDistMethod: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },

  rootDistMethodName: {
    fontSize: 15,
    fontWeight: 800,
    color: "#0f172a",
  },

  rootDistMethodMeta: {
    fontSize: 12,
    color: "#64748b",
  },

  rootDistBarWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },

  rootDistBar: {
    width: "100%",
    height: 20,
    borderRadius: 999,
    overflow: "hidden",
    background: "#e2e8f0",
    display: "flex",
  },

  rootDistLabels: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
  },

  rootDistLabel: {
    fontSize: 12,
    fontWeight: 700,
    color: "#334155",
  },

  rootDistFailureLabel: {
    fontSize: 12,
    fontWeight: 700,
    color: "#991b1b",
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

  modeSwitchRow: {
    display: "flex",
    gap: 12,
    flexWrap: "wrap",
    marginBottom: 18,
  },

  radioPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 14px",
    borderRadius: 999,
    border: "1px solid #dbeafe",
    background: "#f8fbff",
    color: "#1e293b",
    fontWeight: 700,
    cursor: "pointer",
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

  metricSubValue: {
    fontSize: 13,
    color: "#334155",
    lineHeight: 1.55,
    marginTop: 4,
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

  kvLabel: {
  fontSize: 12,
  fontWeight: 800,
  color: "#64748b",
  textTransform: "uppercase",
  marginBottom: 4,
},

kvValue: {
  fontSize: 15,
  fontWeight: 700,
  color: "#0f172a",
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

  preBlock: {
    margin: 0,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontSize: 14,
    lineHeight: 1.7,
    color: "#1e293b",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    padding: 16,
    fontFamily: "monospace",
  },
};
