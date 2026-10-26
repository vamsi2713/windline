import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const API = import.meta.env.VITE_API_BASE || "http://localhost:8000";
const fmt = (n, d = 1) =>
  n == null
    ? "—"
    : Number(n).toLocaleString("en-GB", {
        maximumFractionDigits: d,
        minimumFractionDigits: d,
      });
const time = (s) =>
  s
    ? new Date(s).toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC",
        timeZoneName: "short",
      })
    : "—";
function Metric({ label, value, unit, help }) {
  return (
    <div className="metric">
      <div className="metric-top">
        <span>{label}</span>
        <button className="help" title={help} aria-label={`${label}: ${help}`}>
          i
        </button>
      </div>
      <div className="metric-value">
        {value}
        <small>{unit}</small>
      </div>
      <div className="metric-help">{help}</div>
    </div>
  );
}
function Chart({ rows }) {
  const [zoom, setZoom] = useState("all");
  const valid = rows.filter((r) => r.forecast != null && r.actual != null);
  const shown = zoom === "all" ? valid : valid.slice(-Number(zoom));
  if (!shown.length)
    return (
      <div className="empty">
        No matched forecast and actual records for this view. Check API
        availability and coverage.
      </div>
    );
  const W = 900,
    H = 270,
    L = 56,
    R = 18,
    T = 18,
    B = 35,
    vals = shown.flatMap((r) => [r.forecast, r.actual]);
  const min = Math.min(0, ...vals),
    max = Math.max(...vals) * 1.08 || 1;
  const x = (i) => L + (i * (W - L - R)) / Math.max(1, shown.length - 1),
    y = (v) => H - B - ((v - min) / (max - min || 1)) * (H - T - B);
  const line = (key) =>
    shown
      .map(
        (r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r[key]).toFixed(1)}`,
      )
      .join(" ");
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <div className="chart-wrap">
      <div className="chart-toolbar">
        <span>{shown.length.toLocaleString()} matched half-hours</span>
        <div className="segmented">
          {[
            ["all", "All"],
            ["96", "Last 48h"],
            ["48", "Last 24h"],
          ].map(([v, l]) => (
            <button
              key={v}
              className={zoom === v ? "selected" : ""}
              onClick={() => setZoom(v)}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Forecast versus actual wind generation in megawatts"
        className="chart"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={L}
              x2={W - R}
              y1={T + t * (H - T - B)}
              y2={T + t * (H - T - B)}
              stroke="#253443"
            />
            <text x={L - 10} y={T + t * (H - T - B) + 4} textAnchor="end">
              {fmt(max - (max - min) * t, 0)}
            </text>
          </g>
        ))}
        <path
          d={line("forecast")}
          fill="none"
          stroke="#53c7d6"
          strokeWidth="2.1"
        />
        <path
          d={line("actual")}
          fill="none"
          stroke="#e6b66a"
          strokeWidth="2.1"
        />
        {shown
          .filter(
            (r, i) => i % Math.max(1, Math.floor(shown.length / 20)) === 0,
          )
          .map((r) => {
            const i = shown.indexOf(r);
            return (
              <g key={r.startTime}>
                <circle cx={x(i)} cy={y(r.forecast)} r="3" fill="#53c7d6">
                  <title>{`${time(r.startTime)} · Forecast ${fmt(r.forecast)} MW`}</title>
                </circle>
                <circle cx={x(i)} cy={y(r.actual)} r="3" fill="#e6b66a">
                  <title>{`${time(r.startTime)} · Actual ${fmt(r.actual)} MW`}</title>
                </circle>
              </g>
            );
          })}
        <text x={L} y={H - 8}>
          {time(shown[0].startTime)}
        </text>
        <text x={W - R} y={H - 8} textAnchor="end">
          {time(shown[shown.length - 1].startTime)}
        </text>
      </svg>
      <div className="legend">
        <span>
          <i className="dot forecast" /> Selected forecast (MW)
        </span>
        <span>
          <i className="dot actual" /> Actual wind (MW)
        </span>
      </div>
    </div>
  );
}
export function App() {
  const [data, setData] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [sort, setSort] = useState("startTime"),
    [asc, setAsc] = useState(true),
    [page, setPage] = useState(0),
    [cutoff, setCutoff] = useState(9);
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`${API}/api/analysis?cutoff_hour_utc=${cutoff}`);
      if (!r.ok)
        throw new Error(
          (await r.json()).detail || `Request failed (${r.status})`,
        );
      setData(await r.json());
      setPage(0);
    } catch (e) {
      setData(null);
      setError(e.message || "Unable to retrieve Elexon data.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [cutoff]);
  const rows = useMemo(() => {
    if (!data) return [];
    return data.rows
      .filter(
        (r) =>
          (!query ||
            r.startTime.toLowerCase().includes(query.toLowerCase()) ||
            String(r.publishTime || "")
              .toLowerCase()
              .includes(query.toLowerCase())) &&
          (status === "all" || r.status === status),
      )
      .sort((a, b) => {
        const av = a[sort],
          bv = b[sort];
        const c =
          av == null
            ? bv == null
              ? 0
              : 1
            : bv == null
              ? -1
              : typeof av === "number"
                ? av - bv
                : String(av).localeCompare(String(bv));
        return asc ? c : -c;
      });
  }, [data, query, status, sort, asc]);
  const exportCsv = () => {
    const cols = [
      "startTime",
      "publishTime",
      "forecast",
      "actual",
      "error",
      "absoluteError",
      "status",
    ];
    const csv = [
      cols.join(","),
      ...rows.map((r) => cols.map((k) => JSON.stringify(r[k] ?? "")).join(",")),
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "windline-january-2026.csv";
    a.click();
    URL.revokeObjectURL(url);
  };
  const m = data?.metrics || {};
  const pages = Math.max(1, Math.ceil(rows.length / 20));
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">W</div>
          <div>
            <b>WINDLINE</b>
            <small>PROCUREMENT INTELLIGENCE</small>
          </div>
        </div>
        <div className="side-label">WORKSPACE</div>
        <div className="nav active">
          <span>◫</span> Forecast accuracy
        </div>
        <div className="nav muted">
          <span>⌁</span> Data provenance
        </div>
        <div className="sidebar-bottom">
          <div className="live-dot" /> ELEXON DATA SOURCE
          <small>National wind · Half-hourly</small>
          <small className="version">PILOT ANALYSIS / JAN 2026</small>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="crumb">
            ENERGY MARKETS <span>/</span> WIND FORECAST
          </div>
          <div className="top-actions">
            <span className="period-pill">01 — 31 JAN 2026</span>
            <button className="refresh" onClick={load} disabled={loading}>
              {loading ? "Refreshing…" : "↻ Refresh data"}
            </button>
          </div>
        </header>
        <section className="intro">
          <div>
            <div className="eyebrow">
              DAY-AHEAD PROCUREMENT · HISTORICAL REVIEW
            </div>
            <h1>Wind forecast intelligence</h1>
            <p>
              Understand what was knowable before delivery — and measure how
              closely it matched outturn.
            </p>
          </div>
          <div className="cutoff-control">
            <label htmlFor="cutoff">Decision cutoff (UTC)</label>
            <select
              id="cutoff"
              value={cutoff}
              onChange={(e) => setCutoff(Number(e.target.value))}
            >
              {[6, 7, 8, 9, 10, 11, 12].map((h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00 UTC · D−1
                </option>
              ))}
            </select>
            <small>Configurable assumption</small>
          </div>
        </section>
        {error && (
          <div className="error-banner">
            <strong>Data unavailable</strong>
            <span>{error}</span>
            <p>
              No sample values are substituted. Retry when the Elexon API is
              reachable.
            </p>
            <button onClick={load}>Retry request</button>
          </div>
        )}
        {loading && !data && !error && (
          <div className="loading">
            <span className="spinner" />
            Retrieving January records from Elexon…
          </div>
        )}
        {data && (
          <>
            <div className="statusline">
              <span className="status-dot" />{" "}
              {data.provenance.status === "success"
                ? "Historical analysis loaded"
                : "Data status unknown"}{" "}
              <span className="status-sep">·</span> Retrieved{" "}
              {time(data.provenance.retrievedAtUtc)}{" "}
              <span className="status-sep">·</span>{" "}
              {data.quality.actualPeriods.toLocaleString()} actual periods
            </div>
            <section className="metrics">
              <Metric
                label="Matched periods"
                value={m.matchedPeriods?.toLocaleString() ?? "—"}
                unit="/ 1,488"
                help="Half-hour periods with both an eligible forecast and valid wind actual."
              />
              <Metric
                label="Mean absolute error"
                value={fmt(m.mae)}
                unit="MW"
                help="Average absolute difference between forecast and actual for matched periods."
              />
              <Metric
                label="Mean bias error"
                value={fmt(m.mbe)}
                unit="MW"
                help="Mean forecast minus actual. Positive = overprediction; negative = underprediction."
              />
              <Metric
                label="Root mean square error"
                value={fmt(m.rmse)}
                unit="MW"
                help="Square root of mean squared forecast error; larger errors weigh more heavily."
              />
            </section>
            <section className="panel chart-panel">
              <div className="panel-head">
                <div>
                  <div className="eyebrow">OBSERVED PERFORMANCE</div>
                  <h2>Forecast vs actual generation</h2>
                  <p>
                    National wind generation · MW · half-hourly delivery periods
                  </p>
                </div>
                <span className="unit-tag">MW</span>
              </div>
              <Chart rows={data.rows} />
            </section>
            <section className="panel table-panel">
              <div className="panel-head table-heading">
                <div>
                  <div className="eyebrow">AUDITABLE RECORDS</div>
                  <h2>Settlement period detail</h2>
                  <p>
                    Selected publication time is shown for every eligible
                    forecast.
                  </p>
                </div>
                <button className="export" onClick={exportCsv}>
                  ↓ Export CSV
                </button>
              </div>
              <div className="filters">
                <input
                  aria-label="Search timestamps"
                  placeholder="Search target or publication timestamp…"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(0);
                  }}
                />
                <select
                  aria-label="Filter record status"
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setPage(0);
                  }}
                >
                  <option value="all">All statuses</option>
                  <option value="matched">Matched</option>
                  <option value="missing forecast">Missing forecast</option>
                  <option value="missing actual">Missing actual</option>
                  <option value="ambiguous forecast tie">Ambiguous tie</option>
                </select>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      {[
                        ["startTime", "Target period (UTC)"],
                        ["publishTime", "Forecast published (UTC)"],
                        ["forecast", "Forecast MW"],
                        ["actual", "Actual MW"],
                        ["error", "Error MW"],
                        ["status", "Record status"],
                      ].map(([k, l]) => (
                        <th key={k}>
                          <button
                            onClick={() => {
                              if (sort === k) setAsc(!asc);
                              else {
                                setSort(k);
                                setAsc(true);
                              }
                            }}
                          >
                            {l} {sort === k ? (asc ? "↑" : "↓") : ""}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(page * 20, (page + 1) * 20).map((r) => (
                      <tr key={r.startTime}>
                        <td className="mono">{time(r.startTime)}</td>
                        <td className="mono">{time(r.publishTime)}</td>
                        <td>{fmt(r.forecast)}</td>
                        <td>{fmt(r.actual)}</td>
                        <td
                          className={
                            r.error > 0
                              ? "positive"
                              : r.error < 0
                                ? "negative"
                                : ""
                          }
                        >
                          {fmt(r.error)}
                        </td>
                        <td>
                          <span
                            className={`record-status ${r.status === "matched" ? "ok" : "warn"}`}
                          >
                            {r.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!rows.length && (
                  <div className="empty">No records match these filters.</div>
                )}
              </div>
              <div className="pagination">
                <span>
                  {rows.length
                    ? `${page * 20 + 1}–${Math.min((page + 1) * 20, rows.length)} of ${rows.length}`
                    : "0 records"}
                </span>
                <div>
                  <button
                    disabled={page === 0}
                    onClick={() => setPage(page - 1)}
                  >
                    Previous
                  </button>
                  <button
                    disabled={page + 1 >= pages}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            </section>
            <section className="provenance">
              <div>
                <div className="eyebrow">METHODOLOGY & PROVENANCE</div>
                <h2>Every number has a traceable rule.</h2>
                <p>
                  Forecasts are selected per delivery period using only
                  publications available before the configured cutoff. Future
                  publications are excluded.
                </p>
              </div>
              <div className="provenance-grid">
                <div>
                  <span>ACTUAL DATASET</span>
                  <b>FUELHH · fuelType = WIND</b>
                  <a
                    href="https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/FUELHH/stream"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Official API documentation ↗
                  </a>
                </div>
                <div>
                  <span>FORECAST DATASET</span>
                  <b>WINDFOR · startTime + publishTime</b>
                  <a
                    href="https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/WINDFOR/stream"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Official API documentation ↗
                  </a>
                </div>
                <div>
                  <span>ELIGIBLE FORECAST RECORDS</span>
                  <b>{data.quality.eligibleForecastRecords.toLocaleString()}</b>
                  <small>Published at or before cutoff</small>
                </div>
                <div>
                  <span>DATA QUALITY</span>
                  <b>
                    {data.quality.rejectedActualRecords +
                      data.quality.rejectedForecastRecords}{" "}
                    rejected · {data.quality.ambiguousPeriods} ambiguous
                  </b>
                  <small>
                    Missing values remain missing, never coerced to zero.
                  </small>
                </div>
              </div>
              <div className="assumption">
                <b>Important assumption</b> January refers to delivery periods.
                The default decision cutoff is 09:00 UTC on D−1; this is an
                explicit configurable working assumption because the brief does
                not define the client's exact decision time. Metrics use only
                valid matched periods. Wind forecast accuracy alone does not
                determine the utility's total procurement requirement or
                monetary exposure.
              </div>
            </section>
            <footer>
              WINDLINE <span>·</span> ELEXON INSIGHTS API <span>·</span> UTC
              NORMALIZATION <span>·</span> NO SYNTHETIC PRODUCTION DATA
            </footer>
          </>
        )}
      </main>
    </div>
  );
}

const rootElement = document.getElementById("root");

if (rootElement) {
  createRoot(rootElement).render(<App />);
}
