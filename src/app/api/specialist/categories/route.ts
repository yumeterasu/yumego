import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import {
  getSpecialistCategories,
  addSpecialistCategory,
  renameSpecialistCategory,
  deleteSpecialistCategory,
} from "@/lib/sheets";

// GET /api/specialist/categories?branch=プロンポン
export async function GET(req: NextRequest) {
  const branch = req.nextUrl.searchParams.get("branch");

  if (!branch) {
    return NextResponse.json({ error: "Missing 'branch' query param" }, { status: 400 });
  }

  try {
    const categories = await getSpecialistCategories(branch);
    return NextResponse.json({ categories });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch categories" }, { status: 500 });
  }
}

// POST /api/specialist/categories  { branch, name }
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { branch, name } = body ?? {};

  if (!branch || !name) {
    return NextResponse.json({ error: "Missing branch or name" }, { status: 400 });
  }

  try {
    const categoryId = randomUUID();
    await addSpecialistCategory({ categoryId, branch, name });
    return NextResponse.json({ categoryId });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to add category" }, { status: 500 });
  }
}

// PATCH /api/specialist/categories  { categoryId, name }
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { categoryId, name } = body ?? {};

  if (!categoryId || typeof name !== "string") {
    return NextResponse.json({ error: "Missing categoryId or name" }, { status: 400 });
  }

  try {
    await renameSpecialistCategory(categoryId, name);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to rename category" }, { status: 500 });
  }
}

// DELETE /api/specialist/categories?categoryId=...
export async function DELETE(req: NextRequest) {
  const categoryId = req.nextUrl.searchParams.get("categoryId");

  if (!categoryId) {
    return NextResponse.json({ error: "Missing 'categoryId' query param" }, { status: 400 });
  }

  try {
    await deleteSpecialistCategory(categoryId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to delete category" }, { status: 500 });
  }
}
