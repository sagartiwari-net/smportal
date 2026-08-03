import { createCanvas } from "@napi-rs/canvas";
import { Chart, registerables, type ChartConfiguration } from "chart.js";

Chart.register(...registerables);

const COLORS = {
  green: "#16A34A",
  teal: "#0D9488",
  amber: "#F59E0B",
  rose: "#F43F5E",
  slate: "#64748B",
  yellow: "#EAB308",
};

const FONT = {
  title: { size: 20, weight: "bold" as const },
  legend: { size: 13 },
  tick: { size: 12 },
};

function renderChart(config: ChartConfiguration, width: number, height: number): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, width, height);

  const chart = new Chart(ctx as never, {
    ...config,
    options: {
      responsive: false,
      animation: false,
      layout: { padding: { top: 8, right: 12, bottom: 8, left: 8 } },
      ...(config.options || {}),
    },
  });
  const buf = canvas.toBuffer("image/png");
  chart.destroy();
  return buf;
}

export function monthlyAttendanceBarChart(
  months: { label: string; present: number; absent: number; leave: number; weekOff: number }[],
): Buffer {
  return renderChart(
    {
      type: "bar",
      data: {
        labels: months.map((m) => m.label),
        datasets: [
          { label: "Present", data: months.map((m) => m.present), backgroundColor: COLORS.green },
          { label: "Absent", data: months.map((m) => m.absent), backgroundColor: COLORS.rose },
          { label: "Leave", data: months.map((m) => m.leave), backgroundColor: COLORS.amber },
          { label: "Week off", data: months.map((m) => m.weekOff), backgroundColor: COLORS.yellow },
        ],
      },
      options: {
        plugins: {
          title: { display: true, text: "Monthly attendance", font: FONT.title, color: "#0F172A", padding: { bottom: 12 } },
          legend: { position: "bottom", labels: { font: FONT.legend, boxWidth: 14, padding: 14 } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: FONT.tick } },
          y: { beginAtZero: true, ticks: { precision: 0, font: FONT.tick } },
        },
      },
    },
    820,
    400,
  );
}

export function taskStatusDoughnut(counts: {
  assigned: number;
  submitted: number;
  needsImprovement: number;
  done: number;
}): Buffer {
  return renderChart(
    {
      type: "doughnut",
      data: {
        labels: ["Assigned", "Submitted", "Needs improvement", "Done"],
        datasets: [
          {
            data: [counts.assigned, counts.submitted, counts.needsImprovement, counts.done],
            backgroundColor: [COLORS.slate, COLORS.amber, COLORS.rose, COLORS.green],
            borderWidth: 3,
            borderColor: "#FFFFFF",
          },
        ],
      },
      options: {
        plugins: {
          title: { display: true, text: "Task status mix", font: FONT.title, color: "#0F172A", padding: { bottom: 10 } },
          legend: { position: "bottom", labels: { font: FONT.legend, boxWidth: 14, padding: 12 } },
        },
      },
    },
    520,
    400,
  );
}

export function attendanceStatusDoughnut(counts: {
  present: number;
  absent: number;
  leave: number;
  weekOff: number;
}): Buffer {
  return renderChart(
    {
      type: "doughnut",
      data: {
        labels: ["Present", "Absent", "Leave", "Week off"],
        datasets: [
          {
            data: [counts.present, counts.absent, counts.leave, counts.weekOff],
            backgroundColor: [COLORS.teal, COLORS.rose, COLORS.amber, COLORS.yellow],
            borderWidth: 3,
            borderColor: "#FFFFFF",
          },
        ],
      },
      options: {
        plugins: {
          title: {
            display: true,
            text: "Attendance status mix",
            font: FONT.title,
            color: "#0F172A",
            padding: { bottom: 10 },
          },
          legend: { position: "bottom", labels: { font: FONT.legend, boxWidth: 14, padding: 12 } },
        },
      },
    },
    520,
    400,
  );
}

export function taskCompletionBar(done: number, total: number): Buffer {
  const pending = Math.max(0, total - done);
  return renderChart(
    {
      type: "bar",
      data: {
        labels: ["Tasks"],
        datasets: [
          { label: "Done", data: [done], backgroundColor: COLORS.green },
          { label: "Remaining", data: [pending], backgroundColor: COLORS.slate },
        ],
      },
      options: {
        indexAxis: "y",
        plugins: {
          title: { display: true, text: "Task completion", font: FONT.title, color: "#0F172A", padding: { bottom: 10 } },
          legend: { position: "bottom", labels: { font: FONT.legend, boxWidth: 14, padding: 12 } },
        },
        scales: {
          x: { stacked: true, beginAtZero: true, ticks: { precision: 0, font: FONT.tick } },
          y: { stacked: true, grid: { display: false }, ticks: { font: FONT.tick } },
        },
      },
    },
    820,
    280,
  );
}

/** Horizontal score / attendance / tasks comparison for top students or colleges */
export function metricCompareBar(
  rows: { label: string; score: number; attendance: number; tasks: number }[],
  title = "Performance comparison",
): Buffer {
  const sliced = rows.slice(0, 15);
  return renderChart(
    {
      type: "bar",
      data: {
        labels: sliced.map((r) => r.label),
        datasets: [
          { label: "Score", data: sliced.map((r) => r.score), backgroundColor: COLORS.green },
          { label: "Attendance", data: sliced.map((r) => r.attendance), backgroundColor: COLORS.teal },
          { label: "Tasks", data: sliced.map((r) => r.tasks), backgroundColor: "#0284C8" },
        ],
      },
      options: {
        indexAxis: "y",
        plugins: {
          title: { display: true, text: title, font: FONT.title, color: "#0F172A", padding: { bottom: 10 } },
          legend: { position: "bottom", labels: { font: FONT.legend, boxWidth: 14, padding: 12 } },
        },
        scales: {
          x: { beginAtZero: true, max: 100, ticks: { font: FONT.tick } },
          y: { grid: { display: false }, ticks: { font: FONT.tick } },
        },
      },
    },
    860,
    Math.max(360, 48 + sliced.length * 28),
  );
}

