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

// GET /api/class-settings?class=...
export async function GET(req: NextRequest) {
  const className = req.nextUrl.searchParams.get("class");

  if (!className) {
    return NextResponse.json(
      { error: "Missing 'class' query param" },
      { status: 400 }
    );
  }

  try {
    const labels = await getClassCheckLabels(className);
    return NextResponse.json({ labels });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to fetch class settings" },
      { status: 500 }
    );
  }
}

// PATCH /api/class-settings  { className, column, label }
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { className, column, label } = body ?? {};

  if (
    !className ||
    typeof label !== "string" ||
    !LABEL_COLUMNS.includes(column)
  ) {
    return NextResponse.json(
      { error: "Missing className, column, or label" },
      { status: 400 }
    );
  }

  try {
    await updateClassCheckLabel(className, column, label);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to update class settings" },
      { status: 500 }
    );
  }
}
