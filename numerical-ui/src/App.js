import React from "react";
import { BrowserRouter as Router, Routes, Route, NavLink, useParams } from "react-router-dom";
import Home from "./Home";
import RunViewer from "./RunViewer";
import ExperimentsDashboard from "./ExperimentsDashboard";
import ExperimentJobs from "./ExperimentJobs";
import { API } from "./api"

function TopNav() {
  const linkStyle = ({ isActive }) => ({
    padding: "10px 14px",
    borderRadius: 10,
    textDecoration: "none",
    fontWeight: 700,
    color: isActive ? "#1d4ed8" : "#374151",
    background: isActive ? "#eff6ff" : "transparent",
    border: isActive ? "1px solid #bfdbfe" : "1px solid transparent",
  });

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 100,
        background: "#ffffff",
        borderBottom: "1px solid #e5e7eb",
        padding: "12px 20px",
      }}
    >
      <div
        style={{
          maxWidth: 1500,
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#111827" }}>
            GRASP
          </div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>
            Solver Reliability Analysis & Validation Framework
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <NavLink to="/" style={linkStyle}>
            Home
          </NavLink>
          <NavLink to="/experiments" style={linkStyle}>
            Experiments
          </NavLink>
          <NavLink to="/experiment-jobs" style={linkStyle}>
            Experiment Jobs
          </NavLink>
        </div>
      </div>
    </div>
  );
}

class ExperimentJobDetail extends React.Component {
  state = {
    loading: true,
    error: "",
    data: null,
  };

  componentDidMount() {
    this.load();
  }

  async load() {
    try {
      const { jobId } = this.props;
      this.setState({ loading: true, error: "", data: null });

      const res = await fetch(`${API}/experiments/jobs/${jobId}`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to load job: ${res.status} ${text}`);
      }

      const data = await res.json();
      this.setState({ data, loading: false });
    } catch (err) {
      this.setState({
        error: err.message || "Failed to load job",
        loading: false,
      });
    }
  }

  render() {
    const { loading, error, data } = this.state;

    return (
      <div style={{ maxWidth: 1500, margin: "0 auto", padding: "32px 20px" }}>
        <h1 style={{ marginTop: 0 }}>Experiment Job Detail</h1>

        {loading ? (
          <p style={{ color: "#6b7280" }}>Loading job details...</p>
        ) : error ? (
          <div
            style={{
              padding: 14,
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: 12,
              color: "#7f1d1d",
            }}
          >
            {error}
          </div>
        ) : (
          <pre
            style={{
              background: "#ffffff",
              border: "1px solid #e5e7eb",
              borderRadius: 16,
              padding: 20,
              overflowX: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
            {JSON.stringify(data, null, 2)}
          </pre>
        )}
      </div>
    );
  }
}

function ExperimentJobDetailRoute() {
  const { jobId } = useParams();
  return <ExperimentJobDetail jobId={jobId} />;
}

export default function App() {
  return (
    <Router>
      <TopNav />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/run/:runId" element={<RunViewer />} />
        <Route path="/experiments" element={<ExperimentsDashboard />} />
        <Route path="/experiment-jobs" element={<ExperimentJobs />} />
        <Route path="/experiment-jobs/:jobId" element={<ExperimentJobDetailRoute />} />
      </Routes>
    </Router>
  );
}