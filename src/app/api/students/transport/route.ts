import { NextRequest, NextResponse } from "next/server";
import { getStudentTransport, getStudentTransports, setStudentTransport } from "@/lib/sheets";

// GET /api/students/transport?studentId=... -> { transport }
// GET /api/students/transport (no studentId) -> { transports: [...] }
export async function GET(req: NextRequest) {
  const studentId = req.nextUrl.searchParams.get("studentId");
  try {
    if (!studentId) {
      const transports = await getStudentTransports();
      return NextResponse.json({ transports });
    }
    const transport = await getStudentTransport(studentId);
    return NextResponse.json({ transport });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch transport mode" }, { status: 500 });
  }
}

// PATCH /api/students/transport  { studentId, mode: "bus" | "self" | null }
// mode: null clears the setting (back to "not yet chosen").
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { studentId, mode } = body ?? {};

  if (typeof studentId !== "string" || !studentId) {
    return NextResponse.json({ error: "Missing studentId" }, { status: 400 });
  }
  if (mode !== null && mode !== "bus" && mode !== "self") {
    return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
  }

  try {
    await setStudentTransport(studentId, mode);
    return NextResponse.json({ ok: true, transport: mode ? { studentId, mode } : null });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update transport mode" }, { status: 500 });
  }
}
