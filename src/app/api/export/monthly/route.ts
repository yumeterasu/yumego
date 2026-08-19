import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import {
  getStudentsByClass,
  getAttendanceForMonth,
  getClassCheckLabels,
  countsAsPresent,
  type AttendanceStatus,
} from "@/lib/sheets";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: "出",
  absent: "欠",
  late: "遅",
  early_leave: "早",
  suspended: "出停",
};

// ARGB hex, matches the on-screen status colors (and the app's new brand green).
const STATUS_COLOR: Record<AttendanceStatus, string> = {
  present: "FF16A34A",
  absent: "FFDC2626",
  late: "FFD97706",
  early_leave: "FF2563EB",
  suspended: "FF7E22CE",
};

// GET /api/export/monthly?class=...&month=2026-08
export async function GET(req: NextRequest) {
  const className = req.nextUrl.searchParams.get("class");
  const yearMonth = req.nextUrl.searchParams.get("month");

  if (!className || !yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
    return NextResponse.json(
      { error: "Missing or invalid 'class'/'month' query params" },
      { status: 400 }
    );
  }

  try {
    const [students, records, checkLabels] = await Promise.all([
      getStudentsByClass(className),
      getAttendanceForMonth(className, yearMonth),
      getClassCheckLabels(className),
    ]);

    const [year, month] = yearMonth.split("-").map(Number);
    const numDays = daysInMonth(year, month);
    const dayNumbers = Array.from({ length: numDays }, (_, i) => i + 1);

    // studentId -> day -> status/reason, deduped by day (a Map.set with the
    // same key naturally collapses stray duplicate rows to one, matching
    // what the Dashboard itself shows).
    const statusByStudentDay = new Map<string, Map<number, AttendanceStatus>>();
    const reasonByStudentDay = new Map<string, Map<number, string>>();
    for (const r of records) {
      const day = Number(r.date.slice(8, 10));
      if (!statusByStudentDay.has(r.studentId)) statusByStudentDay.set(r.studentId, new Map());
      statusByStudentDay.get(r.studentId)!.set(day, r.status);
      if (r.reason) {
        if (!reasonByStudentDay.has(r.studentId)) reasonByStudentDay.set(r.studentId, new Map());
        reasonByStudentDay.get(r.studentId)!.set(day, r.reason);
      }
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Yumego";
    workbook.created = new Date();
    const sheet = workbook.addWorksheet(`${yearMonth}`, {
      views: [{ state: "frozen", xSplit: 2, ySplit: 1 }],
    });

    const checkHeaders = [
      checkLabels.check1Label || "チェック1",
      checkLabels.check2Label || "チェック2",
      checkLabels.check3Label || "チェック3",
    ];

    const headerRowValues = [
      "#",
      "名前",
      ...dayNumbers.map((d) => `${d}(${WEEKDAY_LABELS[new Date(year, month - 1, d).getDay()]})`),
      "出",
      "欠",
      "欠席理由",
      ...checkHeaders,
      "備考",
    ];
    const headerRow = sheet.addRow(headerRowValues);
    headerRow.font = { bold: true };
    headerRow.eachCell((cell, colNumber) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      // day columns start at index 3 (1-based colNumber 3..3+numDays-1)
      const dayIdx = colNumber - 3;
      if (dayIdx >= 0 && dayIdx < dayNumbers.length) {
        const day = dayNumbers[dayIdx];
        const dow = new Date(year, month - 1, day).getDay();
        if (dow === 0 || dow === 6) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF0DC" } };
          cell.font = { bold: true, color: { argb: "FFC2410C" } };
        }
      }
    });

    students.forEach((s, i) => {
      const dayMap = statusByStudentDay.get(s.studentId) ?? new Map<number, AttendanceStatus>();
      const reasonMap = reasonByStudentDay.get(s.studentId) ?? new Map<number, string>();

      let presentCount = 0;
      let absentCount = 0;
      for (const status of dayMap.values()) {
        if (countsAsPresent(status)) presentCount++;
        else absentCount++;
      }

      const reasonCounts = new Map<string, number>();
      for (const reason of reasonMap.values()) {
        reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
      }
      const reasonSummary = Array.from(reasonCounts.entries())
        .map(([reason, count]) => `${reason} ${count}`)
        .join(", ");

      const nameCell = s.nameEnglish ? `${s.nameKanji}\n${s.nameEnglish}` : s.nameKanji;

      const rowValues = [
        i + 1,
        nameCell,
        ...dayNumbers.map((day) => {
          const status = dayMap.get(day);
          return status ? STATUS_LABEL[status] : "";
        }),
        presentCount || "",
        absentCount || "",
        reasonSummary,
        s.check1 ? "✓" : "",
        s.check2 ? "✓" : "",
        s.check3 ? "✓" : "",
        s.remark ?? "",
      ];
      const row = sheet.addRow(rowValues);
      row.getCell(2).alignment = { wrapText: true, vertical: "middle" };

      dayNumbers.forEach((day, idx) => {
        const status = dayMap.get(day);
        const cell = row.getCell(3 + idx);
        cell.alignment = { horizontal: "center", vertical: "middle" };
        if (status) {
          cell.font = { bold: true, color: { argb: STATUS_COLOR[status] } };
        }
        const dow = new Date(year, month - 1, day).getDay();
        if ((dow === 0 || dow === 6) && !status) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF7ED" } };
        }
      });
    });

    // Column widths: #, name, day columns, present/absent, reason, checks x3, remark
    sheet.columns = [
      { width: 4 },
      { width: 20 },
      ...dayNumbers.map(() => ({ width: 5 })),
      { width: 5 },
      { width: 5 },
      { width: 20 },
      { width: 10 },
      { width: 10 },
      { width: 10 },
      { width: 24 },
    ];

    const buffer = await workbook.xlsx.writeBuffer();
    const fileName = `${className.replace(/\s+/g, "_")}_${yearMonth}.xlsx`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to export" }, { status: 500 });
  }
}
