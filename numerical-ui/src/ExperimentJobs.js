import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";

const API =
  process.env.REACT_APP_API_BASE_URL || "http://127.0.0.1:8000";

export default function ExperimentJobs() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadJobs() {
    try {
      setLoading(true);
      setError("");

      const res = await fetch(`${API}/experiments/jobs`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to load experiment jobs: ${res.status} ${text}`);
      }

      const data = await res.json();
      setJobs(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || "Failed to load experiment jobs.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadJobs();
  }, []);

  return (
    <div style={styles.page}>
      <div style={styles.breadcrumbRow}>
        <Link to="/" style={styles.navButton}>
          ← Home
        </Link>
        <Link to="/experiments" style={styles.navButtonSecondary}>
          Experiments
        </Link>
      </div>

      <div style={styles.headerBlock}>
        <h1 style={styles.pageTitle}>Experiment Jobs</h1>
        <p style={styles.pageSubtitle}>
          View recent sweep experiment jobs, monitor their status, and open results.
        </p>
      </div>

      <div style={styles.card}>
        <div style={styles.toolbar}>
          <button onClick={loadJobs} style={styles.refreshButton}>
            Refresh
          </button>
        </div>

        {loading ? (
          <p style={styles.mutedText}>Loading experiment jobs...</p>
        ) : error ? (
          <div style={styles.errorBox}>
            <h3 style={styles.errorTitle}>Error</h3>
            <p style={styles.errorText}>{error}</p>
          </div>
        ) : jobs.length === 0 ? (
          <p style={styles.mutedText}>No experiment jobs found yet.</p>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Job ID</th>
                  <th style={styles.th}>Type</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Progress</th>
                  <th style={styles.th}>Message</th>
                  <th style={styles.th}>Open</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.job_id}>
                    <td style={styles.tdMono}>{job.job_id || "-"}</td>
                    <td style={styles.td}>{job.job_type || "-"}</td>
                    <td style={styles.td}>
                      <span style={statusBadge(job.status)}>{job.status || "-"}</span>
                    </td>
                    <td style={styles.td}>
                      {Number.isFinite(Number(job.progress))
                        ? `${Math.round(Number(job.progress) * 100)}%`
                        : "-"}
                    </td>
                    <td style={styles.td}>{job.message || "-"}</td>
                    <td style={styles.td}>
                      <Link to={`/experiment-jobs/${job.job_id}`} style={styles.openLink}>
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function statusBadge(status) {
  const base = {
    display: "inline-block",
    padding: "6px 10px",
    borderRadius: 999,
    fontWeight: 700,
    fontSize: 12,
    textTransform: "capitalize",
  };

  if (status === "completed") {
    return {
      ...base,
      background: "#ecfdf5",
      color: "#065f46",
      border: "1px solid #a7f3d0",
    };
  }

  if (status === "failed" || status === "error") {
    return {
      ...base,
      background: "#fef2f2",
      color: "#991b1b",
      border: "1px solid #fecaca",
    };
  }

  if (status === "running") {
    return {
      ...base,
      background: "#eff6ff",
      color: "#1d4ed8",
      border: "1px solid #bfdbfe",
    };
  }

  return {
    ...base,
    background: "#f8fafc",
    color: "#374151",
    border: "1px solid #e5e7eb",
  };
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

  card: {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: 16,
    padding: 20,
    boxShadow: "0 6px 18px rgba(15, 23, 42, 0.06)",
  },

  toolbar: {
    display: "flex",
    justifyContent: "flex-end",
    marginBottom: 16,
  },

  refreshButton: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "none",
    background: "#2563eb",
    color: "#ffffff",
    fontWeight: 700,
    cursor: "pointer",
  },

  tableWrap: {
    overflowX: "auto",
  },

  table: {
    width: "100%",
    borderCollapse: "collapse",
    minWidth: 920,
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
    verticalAlign: "top",
  },

  tdMono: {
    textAlign: "left",
    padding: "12px 14px",
    borderBottom: "1px solid #eef2f7",
    fontSize: 14,
    verticalAlign: "top",
    fontFamily: "monospace",
    wordBreak: "break-all",
  },

  openLink: {
    color: "#1d4ed8",
    textDecoration: "none",
    fontWeight: 700,
  },

  mutedText: {
    color: "#6b7280",
    margin: 0,
  },

  errorBox: {
    marginTop: 8,
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
};