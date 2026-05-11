import React, { useEffect, useState, useRef } from "react";
import axios from "axios";
import { supabase } from "./supabase";

import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
  Title
} from "chart.js";

import zoomPlugin from "chartjs-plugin-zoom";
import { Line } from "react-chartjs-2";

ChartJS.register(
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
  Title,
  zoomPlugin
);

const CHANNEL_ID = "3247567";
const API_KEY = "ZZIYRVMIWV20VI3U";

// ── Normalize time to "HH:MM AM/PM" uppercase, no seconds ──────────
function toMinuteLabel(timeStr) {
  const parts = timeStr.trim().split(" ");
  const timeParts = parts[0].split(":");
  const ampm = (parts[1] || "").toUpperCase();
  return `${timeParts[0]}:${timeParts[1]} ${ampm}`.trim();
}

function deduplicateByMinute(arr) {
  const minuteMap = new Map();
  for (const d of arr) {
    const minuteKey = toMinuteLabel(d.time);
    if (!minuteMap.has(minuteKey)) {
      minuteMap.set(minuteKey, { ...d, displayTime: minuteKey });
    }
  }
  return Array.from(minuteMap.values());
}

// Returns array of last N date strings in "en-CA" format (YYYY-MM-DD), newest last
function getLastNDates(n, fromDate) {
  const dates = [];
  const base = fromDate ? new Date(fromDate + "T00:00:00") : new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(d.getDate() - i);
    dates.push(d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }));
  }
  return dates;
}

// Palette for 10 lines
const TEN_DAY_COLORS = [
  "#00ffd5", "#4dc9ff", "#00e5a0", "#a78bfa", "#f472b6",
  "#facc15", "#fb923c", "#34d399", "#60a5fa", "#f87171",
];

export default function Dashboard() {
  const chartRef = useRef(null);
  const cumulativeChartRef = useRef(null);

  const [data, setData] = useState([]);
  const [zoomMode, setZoomMode] = useState("wheel");
  const [isZoomed, setIsZoomed] = useState(false);
  const [cumZoomMode, setCumZoomMode] = useState("wheel");
  const [cumIsZoomed, setCumIsZoomed] = useState(false);

  const todayIST = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Kolkata"
  });

  const [selectedDate, setSelectedDate] = useState(todayIST);
  const [feedback, setFeedback] = useState("");
  const [savedFeedback, setSavedFeedback] = useState([]);

  const fetchData = async () => {
    const res = await axios.get(
      `https://api.thingspeak.com/channels/${CHANNEL_ID}/feeds.json?api_key=${API_KEY}&results=100`
    );
    const feeds = res.data.feeds;

    const formatted = feeds
      .filter(f => f.field1 !== null)
      .map(f => {
        const utcDate = new Date(f.created_at);
        const istDate = new Date(
          utcDate.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
        );

        // ── Normalize time: uppercase, no seconds, strip extra spaces ──
        const rawTime = istDate.toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        });
        const normalizedTime = toMinuteLabel(rawTime); // store only HH:MM AM/PM

        return {
          time: normalizedTime,
          date: istDate.toLocaleDateString("en-CA"),
          value: Number(f.field1)
        };
      });

    // ── Deduplicate fetched data itself before hitting Supabase ──────
    const fetchedDeduped = [];
    const fetchedKeys = new Set();
    for (const d of formatted) {
      const key = `${d.date}-${d.time}-${d.value}`;
      if (!fetchedKeys.has(key)) {
        fetchedKeys.add(key);
        fetchedDeduped.push(d);
      }
    }

    // ── Check what already exists in Supabase ────────────────────────
    const { data: existing } = await supabase
      .from("sensordata")
      .select("date, time, value");

    const existingSet = new Set(
      (existing || []).map(d => `${d.date}-${d.time}-${d.value}`)
    );

    const newData = fetchedDeduped.filter(
      d => !existingSet.has(`${d.date}-${d.time}-${d.value}`)
    );

    if (newData.length > 0) {
      await supabase.from("sensordata").insert(newData);
    }

    // ── Load all data from Supabase, deduplicate in memory ───────────
    const { data: dbData } = await supabase.from("sensordata").select("*");

    if (dbData) {
      // Extra safety: deduplicate DB data in memory by date+time key
      const seen = new Set();
      const cleanData = [];
      for (const row of dbData) {
        const key = `${row.date}-${toMinuteLabel(row.time)}`;
        if (!seen.has(key)) {
          seen.add(key);
          cleanData.push({ ...row, time: toMinuteLabel(row.time) });
        }
      }
      setData(cleanData);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, []);

  // ── Daily chart data ─────────────────────────────────────────────
  const filtered = data
    .filter(d => d.date === selectedDate)
    .sort((a, b) =>
      new Date(`1970-01-01 ${a.time}`) - new Date(`1970-01-01 ${b.time}`)
    );

  const deduplicatedData = deduplicateByMinute(filtered);

  const max = deduplicatedData.length ? Math.max(...deduplicatedData.map(d => d.value)) : 0;
  const min = deduplicatedData.length ? Math.min(...deduplicatedData.map(d => d.value)) : 0;
  const avg = deduplicatedData.length
    ? (deduplicatedData.reduce((a, b) => a + b.value, 0) / deduplicatedData.length).toFixed(2)
    : 0;

  // ── Cumulative 10-day chart data ─────────────────────────────────
 const last10Dates = getLastNDates(10, selectedDate);

  const perDateData = last10Dates.map(date => {
    const dayRaw = data
      .filter(d => d.date === date)
      .sort((a, b) =>
        new Date(`1970-01-01 ${a.time}`) - new Date(`1970-01-01 ${b.time}`)
      );
    return { date, points: deduplicateByMinute(dayRaw) };
  });

  const allMinuteLabels = Array.from(
    new Set(perDateData.flatMap(d => d.points.map(p => p.displayTime)))
  ).sort((a, b) => {
    const toMs = t => new Date(`1970-01-01 ${t}`).getTime();
    return toMs(a) - toMs(b);
  });

  const cumulativeDatasets = perDateData.map((d, i) => {
    const valueMap = new Map(d.points.map(p => [p.displayTime, p.value]));
    return {
      label: d.date,
      data: allMinuteLabels.map(lbl => valueMap.get(lbl) ?? null),
      borderColor: TEN_DAY_COLORS[i % TEN_DAY_COLORS.length],
      backgroundColor: `${TEN_DAY_COLORS[i % TEN_DAY_COLORS.length]}12`,
      pointBackgroundColor: TEN_DAY_COLORS[i % TEN_DAY_COLORS.length],
      pointBorderColor: `${TEN_DAY_COLORS[i % TEN_DAY_COLORS.length]}55`,
      pointBorderWidth: 1,
      borderWidth: 2,
      pointRadius: 2.5,
      pointHoverRadius: 6,
      pointHoverBackgroundColor: "#fff",
      pointHoverBorderColor: TEN_DAY_COLORS[i % TEN_DAY_COLORS.length],
      pointHoverBorderWidth: 2,
      tension: 0.4,
      fill: false,
      spanGaps: false,
    };
  });

  // ── Feedback ─────────────────────────────────────────────────────
  const loadFeedback = async () => {
    const { data, error } = await supabase
      .from("feedbacks")
      .select("id, feedback")
      .eq("date", selectedDate)
      .order("id", { ascending: false });

    if (error) {
      console.error(error);
      setSavedFeedback([]);
    } else {
      setSavedFeedback(data || []);
    }
  };

  useEffect(() => {
    if (selectedDate) loadFeedback();
  }, [selectedDate]);

  const handleFeedbackSubmit = async () => {
    if (!selectedDate) { alert("Select date first"); return; }
    if (!feedback.trim()) return;
    await supabase.from("feedbacks").insert([{ date: selectedDate, feedback }]);
    setFeedback("");
    await loadFeedback();
  };

  const handleDeleteFeedback = async (id) => {
    const confirmDelete = window.confirm("Delete this feedback?");
    if (!confirmDelete) return;
    const { error } = await supabase.from("feedbacks").delete().eq("id", id);
    if (error) { console.error(error); } else { loadFeedback(); }
  };

  // ── Zoom handlers — daily chart ──────────────────────────────────
  const handleZoomIn = () => { if (chartRef.current) { chartRef.current.zoom(1.3); setIsZoomed(true); } };
  const handleZoomOut = () => { if (chartRef.current) { chartRef.current.zoom(0.77); } };
  const handleResetZoom = () => { if (chartRef.current) { chartRef.current.resetZoom(); setIsZoomed(false); } };
  const toggleZoomMode = () => setZoomMode(prev => prev === "wheel" ? "drag" : "wheel");

  // ── Zoom handlers — cumulative chart ────────────────────────────
  const handleCumZoomIn = () => { if (cumulativeChartRef.current) { cumulativeChartRef.current.zoom(1.3); setCumIsZoomed(true); } };
  const handleCumZoomOut = () => { if (cumulativeChartRef.current) { cumulativeChartRef.current.zoom(0.77); } };
  const handleCumResetZoom = () => { if (cumulativeChartRef.current) { cumulativeChartRef.current.resetZoom(); setCumIsZoomed(false); } };
  const toggleCumZoomMode = () => setCumZoomMode(prev => prev === "wheel" ? "drag" : "wheel");

  // ── Chart options factory ────────────────────────────────────────
  const makeChartOptions = (title, zMode, setZoomed) => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 250 },
    plugins: {
      legend: {
        display: true,
        position: "top",
        labels: {
          color: "#7eddd0",
          font: { family: "'DM Sans', sans-serif", size: 13, weight: "500" },
          boxWidth: 14,
          padding: 20
        }
      },
      title: {
        display: true,
        text: title,
        color: "#00ffd5",
        font: { family: "'Rajdhani', sans-serif", size: 17, weight: "600" },
        padding: { bottom: 16 }
      },
      tooltip: {
        enabled: true,
        backgroundColor: "#071e28",
        borderColor: "rgba(0, 255, 213, 0.4)",
        borderWidth: 1,
        titleColor: "#00ffd5",
        bodyColor: "#c8f5ee",
        padding: 14,
        cornerRadius: 10,
        titleFont: { family: "'Rajdhani', sans-serif", size: 13, weight: "600" },
        bodyFont: { family: "'DM Sans', sans-serif", size: 13 }
      },
      zoom: {
        limits: { x: { min: "original", max: "original", minRange: 2 } },
        pan: {
          enabled: true, mode: "x", threshold: 3,
          onPanComplete() { setZoomed(true); }
        },
        zoom: {
          wheel: { enabled: zMode === "wheel", speed: 0.12 },
          pinch: { enabled: true },
          drag: {
            enabled: zMode === "drag",
            backgroundColor: "rgba(0, 255, 213, 0.08)",
            borderColor: "#00ffd5",
            borderWidth: 1
          },
          mode: "x",
          onZoomComplete() { setZoomed(true); }
        }
      }
    },
    scales: {
      x: {
        ticks: {
          color: "#7eddd0",
          font: { family: "'DM Sans', sans-serif", size: 12 },
          maxTicksLimit: 10,
          maxRotation: 45
        },
        grid: { color: "rgba(0, 255, 213, 0.07)", borderColor: "rgba(0, 255, 213, 0.2)" }
      },
      y: {
        beginAtZero: false,
        ticks: { color: "#7eddd0", font: { family: "'DM Sans', sans-serif", size: 12 } },
        grid: { color: "rgba(0, 255, 213, 0.07)", borderColor: "rgba(0, 255, 213, 0.2)" }
      }
    }
  });

  const chartOptions = makeChartOptions(`Sensor Trend — ${selectedDate}`, zoomMode, setIsZoomed);
  const cumulativeChartOptions = makeChartOptions("Cumulative Trend — Last 10 Days", cumZoomMode, setCumIsZoomed);

  const modeLabel = zoomMode === "wheel"
    ? "🖱 Scroll = zoom at cursor · Drag = pan"
    : "⬜ Drag to select area · Drag after = pan";
  const cumModeLabel = cumZoomMode === "wheel"
    ? "🖱 Scroll = zoom at cursor · Drag = pan"
    : "⬜ Drag to select area · Drag after = pan";

  return (
    <div className="dashboard">
      <h1 className="title">📡 Sensor Dashboard</h1>

      {/* Date Picker */}
      <div className="card date-card">
        <label>Select Date</label>
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
        />
      </div>

      {/* Daily Chart */}
      <div className="card chart-card">
        <h3>Sensor Trend</h3>
        <div className="zoom-controls">
          <button
            className={`zoom-icon-btn ${zoomMode === "wheel" ? "active" : ""}`}
            onClick={toggleZoomMode} title="Toggle zoom mode"
          >
            {zoomMode === "wheel" ? "🖱" : "⬜"}
          </button>
          <button className="zoom-icon-btn" onClick={handleZoomIn} title="Zoom In">＋</button>
          <button className="zoom-icon-btn" onClick={handleZoomOut} title="Zoom Out">－</button>
          {isZoomed && <button className="reset-btn" onClick={handleResetZoom}>↺ Reset</button>}
          <span className="zoom-level">{modeLabel}</span>
        </div>

        {deduplicatedData.length === 0 ? (
          <div className="no-data">⚠ No data available</div>
        ) : (
          <div style={{ height: "350px" }}>
            <Line
              ref={chartRef}
              data={{
                labels: deduplicatedData.map(d => d.displayTime),
                datasets: [{
                  label: "Sensor Value",
                  data: deduplicatedData.map(d => d.value),
                  borderColor: "#00ffd5",
                  backgroundColor: "rgba(0, 255, 213, 0.07)",
                  pointBackgroundColor: "#00ffd5",
                  pointBorderColor: "rgba(0, 255, 213, 0.3)",
                  pointBorderWidth: 1,
                  borderWidth: 2.5,
                  pointRadius: 3,
                  pointHoverRadius: 7,
                  pointHoverBackgroundColor: "#fff",
                  pointHoverBorderColor: "#00ffd5",
                  pointHoverBorderWidth: 2,
                  tension: 0.4,
                  fill: true
                }]
              }}
              options={chartOptions}
            />
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="stats">
        <div className="card stat"><h4>MAX</h4><p>{max}</p></div>
        <div className="card stat"><h4>MIN</h4><p>{min}</p></div>
        <div className="card stat"><h4>AVG</h4><p>{avg}</p></div>
      </div>

      {/* Cumulative 10-Day Chart */}
      <div className="card chart-card cumulative-card">
        <h3>Cumulative — Past 10 Days</h3>
        <div className="zoom-controls">
          <button
            className={`zoom-icon-btn ${cumZoomMode === "wheel" ? "active" : ""}`}
            onClick={toggleCumZoomMode} title="Toggle zoom mode"
          >
            {cumZoomMode === "wheel" ? "🖱" : "⬜"}
          </button>
          <button className="zoom-icon-btn" onClick={handleCumZoomIn} title="Zoom In">＋</button>
          <button className="zoom-icon-btn" onClick={handleCumZoomOut} title="Zoom Out">－</button>
          {cumIsZoomed && <button className="reset-btn" onClick={handleCumResetZoom}>↺ Reset</button>}
          <span className="zoom-level">{cumModeLabel}</span>
        </div>

        {allMinuteLabels.length === 0 ? (
          <div className="no-data">⚠ No data available for past 10 days</div>
        ) : (
          <div style={{ height: "420px" }}>
            <Line
              ref={cumulativeChartRef}
              data={{ labels: allMinuteLabels, datasets: cumulativeDatasets }}
              options={cumulativeChartOptions}
            />
          </div>
        )}

        {perDateData.some(d => d.points.length > 0) && (
          <div className="ten-day-stats">
            {perDateData.map((d, i) => {
              if (d.points.length === 0) return null;
              const dMax = Math.max(...d.points.map(p => p.value));
              const dMin = Math.min(...d.points.map(p => p.value));
              const dAvg = (d.points.reduce((a, b) => a + b.value, 0) / d.points.length).toFixed(1);
              return (
                <div className="ten-day-stat-row" key={d.date}>
                  <span className="ten-day-dot" style={{ background: TEN_DAY_COLORS[i % TEN_DAY_COLORS.length] }} />
                  <span className="ten-day-date">{d.date}</span>
                  <span className="ten-day-badge max-badge">↑ {dMax}</span>
                  <span className="ten-day-badge min-badge">↓ {dMin}</span>
                  <span className="ten-day-badge avg-badge">~ {dAvg}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="card table">
        <h3>Recent Data</h3>
        <table>
          <thead><tr><th>Time</th><th>Value</th></tr></thead>
          <tbody>
            {[...deduplicatedData].reverse().map((d, i) => (
              <tr key={i}><td>{d.displayTime}</td><td>{d.value}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Feedback */}
      <div className="card feedback">
        <h3>📝 Feedback</h3>
        {savedFeedback.length > 0 ? (
          savedFeedback.map((f) => (
            <div key={f.id} className="feedback-item">
              <div className="feedback-text">{f.feedback}</div>
              <button className="delete-btn" onClick={() => handleDeleteFeedback(f.id)}>❌</button>
            </div>
          ))
        ) : (
          <p className="no-feedback">No feedback for this day</p>
        )}
        <textarea
          placeholder="Write feedback for this day..."
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
        />
        <button onClick={handleFeedbackSubmit}>Submit</button>
      </div>
    </div>
  );
}