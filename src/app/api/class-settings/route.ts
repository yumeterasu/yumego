import { NextRequest, NextResponse } from "next/server";
import {
  getClassCheckLabels,
  updateClassCheckLabel,
  ClassCheckLabels,
} from "@/lib/sheets";

const LABEL_COLUMNS: (keyof ClassCheckLabels)[] = [
  "check1Label",
  "check2Label",
  "check3Label",
];

// GET /api/class-settings?class=...&month=2026-08
export async function GET(req: NextRequest) {
  const className = req.nextUrl.searchParams.get("class");
  const month = req.nextUrl.searchParams.get("month");

  if (!className || !month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json(
      { error: "Missing or invalid 'class'/'month' query params" },
      { status: 400 }
    );
  }

  try {
    const labels = await getClassCheckLabels(className, month);
    return NextResponse.json({ labels });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch class settings" },
      { status: 500 }
    );
  }
}

// PATCH /api/class-settings  { className, month, column, label }
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { className, month, column, label } = body ?? {};

  if (
    !className ||
    !month ||
    !/^\d{4}-\d{2}$/.test(month) ||
    typeof label !== "string" ||
    !LABEL_COLUMNS.includes(column)
  ) {
    return NextResponse.json(
      { error: "Missing className, month, column, or label" },
      { status: 400 }
    );
  }

  try {
    await updateClassCheckLabel(className, month, column, label);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to update class settings" },
      { status: 500 }
    );
  }
}
