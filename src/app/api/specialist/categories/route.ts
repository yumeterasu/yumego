import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import {
  getSpecialistCategories,
  addSpecialistCategory,
  updateSpecialistCategory,
  deleteSpecialistCategory,
} from "@/lib/sheets";

// unit + its 3 per-grade defaults are all-or-nothing: a unit with no
// defaults (or vice versa) would silently behave as "legacy" in a
// confusing way, so reject a half-filled set outright.
function validateUnitDefaults(body: {
  unit?: unknown;
  defaultLong?: unknown;
  defaultChu?: unknown;
  defaultSho?: unknown;
}): string | null {
  const hasUnit = typeof body.unit === "string" && body.unit.trim() !== "";
  const defaults = [body.defaultLong, body.defaultChu, body.defaultSho];
  const providedCount = defaults.filter(
    (d) => typeof d === "number" && Number.isFinite(d) && d >= 0
  ).length;

  if (!hasUnit) {
    // unit blank -- defaults must also all be absent/blank
    if (defaults.some((d) => d !== undefined && d !== null)) {
      return "defaultLong/defaultChu/defaultSho require a non-blank unit";
    }
    return null;
  }
  if (providedCount !== 3) {
    return "unit requires all three of defaultLong/defaultChu/defaultSho";
  }
  return null;
}

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

// POST /api/specialist/categories  { branch, name, unit?, defaultLong?, defaultChu?, defaultSho? }
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { branch, name, unit, defaultLong, defaultChu, defaultSho } = body ?? {};

  if (!branch || !name) {
    return NextResponse.json({ error: "Missing branch or name" }, { status: 400 });
  }
  const validationError = validateUnitDefaults({ unit, defaultLong, defaultChu, defaultSho });
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  try {
    const categoryId = randomUUID();
    await addSpecialistCategory({
      categoryId,
      branch,
      name,
      unit: typeof unit === "string" ? unit : "",
      defaultLong: defaultLong ?? null,
      defaultChu: defaultChu ?? null,
      defaultSho: defaultSho ?? null,
    });
    return NextResponse.json({ categoryId });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to add category" }, { status: 500 });
  }
}

// PATCH /api/specialist/categories  { categoryId, name?, unit?, defaultLong?, defaultChu?, defaultSho? }
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { categoryId, name, unit, defaultLong, defaultChu, defaultSho } = body ?? {};

  if (!categoryId) {
    return NextResponse.json({ error: "Missing categoryId" }, { status: 400 });
  }
  // Only validate unit/defaults together when unit is actually part of this
  // edit -- a name-only rename (unit undefined) shouldn't require re-
  // sending the category's existing defaults.
  if (unit !== undefined) {
    const validationError = validateUnitDefaults({ unit, defaultLong, defaultChu, defaultSho });
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }
  }

  try {
    await updateSpecialistCategory(categoryId, {
      name: typeof name === "string" ? name : undefined,
      unit: typeof unit === "string" ? unit : undefined,
      defaultLong: defaultLong !== undefined ? defaultLong : undefined,
      defaultChu: defaultChu !== undefined ? defaultChu : undefined,
      defaultSho: defaultSho !== undefined ? defaultSho : undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to update category" }, { status: 500 });
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
