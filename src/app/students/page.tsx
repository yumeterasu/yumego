"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSelectedClass } from "@/hooks/useSelectedClass";
import { useExtraClasses } from "@/hooks/useExtraClasses";
import { CLASSES, classNameToBranchGrade, classNameToEnglish } from "@/lib/classes";
import type { Student, StudentLocation, TransportMode } from "@/lib/sheets";

type AddMode = "single" | "bulk";

/**
 * Parses the bulk-add textarea: one student per line. Accepts either a
 * straight paste of two adjacent spreadsheet columns (kanji + English,
 * which browsers paste as tab-separated) or manually typed "漢字,English"
 * (English optional either way).
 */
function parseBulkNames(text: string): { nameKanji: string; nameEnglish: string }[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const sepIdx = line.includes("\t") ? line.indexOf("\t") : line.indexOf(",");
      if (sepIdx === -1) return { nameKanji: line, nameEnglish: "" };
      return {
        nameKanji: line.slice(0, sepIdx).trim(),
        nameEnglish: line.slice(sepIdx + 1).trim(),
      };
    })
    .filter((s) => s.nameKanji.length > 0);
}

/**
 * Parses the bulk-add textarea for a "名前" column copied straight out of a
 * roster where each cell has kanji and romaji on two lines (an Alt+Enter
 * line break inside the cell) -- pasting that whole column as plain text
 * loses the cell boundaries and becomes a flat sequence of lines, so every
 * pair of lines (kanji, then romaji) is treated as one student.
 */
function parseBulkNamesTwoLine(text: string): { nameKanji: string; nameEnglish: string }[] {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const result: { nameKanji: string; nameEnglish: string }[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    if (!lines[i]) continue;
    result.push({ nameKanji: lines[i], nameEnglish: lines[i + 1] ?? "" });
  }
  return result;
}

/** Free, no-API-key map preview embed (OpenStreetMap's official iframe export). */
function osmEmbedUrl(lat: number, lng: number): string {
  const delta = 0.004; // roughly a few hundred meters of context around the pin
  const bbox = `${lng - delta},${lat - delta},${lng + delta},${lat + delta}`;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
}

export default function StudentsPage() {
  const router = useRouter();
  const { selectedClass, loaded } = useSelectedClass();
  const { activeClasses, enNames: extraClassEnNames } = useExtraClasses();
  const allClassNames = [
    ...CLASSES,
    ...activeClasses.map((c) => `${c.branch}　${c.suffix}`),
  ];

  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [addMode, setAddMode] = useState<AddMode>("single");
  const [nameKanji, setNameKanji] = useState("");
  const [nameEnglish, setNameEnglish] = useState("");
  const [bulkText, setBulkText] = useState("");
  // For pasting a "名前" column where each cell has kanji+romaji on 2 lines
  // (e.g. the school's own roster spreadsheet) -- see parseBulkNamesTwoLine.
  const [bulkTwoLineMode, setBulkTwoLineMode] = useState(true);
  const [saving, setSaving] = useState(false);

  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);

  // 名前の修正 — takes effect everywhere the name is shown, since every
  // page reads nameKanji/nameEnglish live from the same Students row.
  const [editNameModal, setEditNameModal] = useState<{
    studentId: string;
    nameKanji: string;
    nameEnglish: string;
  } | null>(null);
  const [editNameSaving, setEditNameSaving] = useState(false);
  const [editNameError, setEditNameError] = useState<string | null>(null);

  // クラス変更 — a real transfer to a different class (not withdraw+re-add).
  const [moveClassModal, setMoveClassModal] = useState<{
    studentId: string;
    nameKanji: string;
    targetClass: string;
  } | null>(null);
  const [moveClassSaving, setMoveClassSaving] = useState(false);
  const [moveClassError, setMoveClassError] = useState<string | null>(null);

  // 送迎バス住所登録 — per-student home address, geocoded server-side.
  const [addressModal, setAddressModal] = useState<{
    studentId: string;
    nameKanji: string;
    input: string;
    // If opened because バス was picked with no address on file yet, saving
    // successfully here also sets the transport mode to バス -- see
    // setTransportMode() and confirmSaveAddress().
    autoSetBusOnSave?: boolean;
  } | null>(null);
  const [addressLoading, setAddressLoading] = useState(false);
  const [addressLookingUp, setAddressLookingUp] = useState(false);
  const [addressSaving, setAddressSaving] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);
  // Result of "Look up" -- not saved yet until 保存 is pressed separately.
  const [pendingResult, setPendingResult] = useState<{
    address: string;
    lat: number;
    lng: number;
    displayName: string;
  } | null>(null);
  const [addressConfirmRemove, setAddressConfirmRemove] = useState(false);
  const [savedLocation, setSavedLocation] = useState<StudentLocation | null>(null);
  // For the roster list itself -- which students already have an address
  // saved, and what it is, so that's visible without opening each one.
  const [locationsByStudent, setLocationsByStudent] = useState<Record<string, StudentLocation>>(
    {}
  );
  // 通学方法 — バス (fills in an address) vs 自分で送迎 (no address needed,
  // used elsewhere later per the school's own request).
  const [transportByStudent, setTransportByStudent] = useState<Record<string, TransportMode>>({});
  const [transportSavingId, setTransportSavingId] = useState<string | null>(null);

  const [showInactive, setShowInactive] = useState(false);
  const [inactiveStudents, setInactiveStudents] = useState<Student[]>([]);
  const [loadingInactive, setLoadingInactive] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const [showRemoveAllModal, setShowRemoveAllModal] = useState(false);
  const [removingAll, setRemovingAll] = useState(false);
  const [removeAllError, setRemoveAllError] = useState<string | null>(null);

  // End-of-term Reset: two-step confirm, then backup-download-then-delete.
  const [showResetModal1, setShowResetModal1] = useState(false);
  const [showResetModal2, setShowResetModal2] = useState(false);
  const [resetStage, setResetStage] = useState<
    "idle" | "backing-up" | "deleting" | "done" | "error"
  >("idle");
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<{
    studentsRemoved: number;
    scheduleRowsDeleted: number;
    headcountRowsDeleted: number;
  } | null>(null);

  // Same idea, scoped to 専門コーチ only -- roster stays untouched (e.g.
  // when a class's students are moving elsewhere, not being withdrawn).
  const [showCoachResetModal1, setShowCoachResetModal1] = useState(false);
  const [showCoachResetModal2, setShowCoachResetModal2] = useState(false);
  const [coachResetStage, setCoachResetStage] = useState<
    "idle" | "backing-up" | "deleting" | "done" | "error"
  >("idle");
  const [coachResetError, setCoachResetError] = useState<string | null>(null);
  const [coachResetResult, setCoachResetResult] = useState<{
    scheduleRowsDeleted: number;
    headcountRowsDeleted: number;
  } | null>(null);

  useEffect(() => {
    if (!loaded) return;
    if (!selectedClass) {
      router.replace("/select-class");
      return;
    }
    loadStudents(selectedClass);
    loadLocations();
    loadTransports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, selectedClass]);

  async function loadLocations() {
    try {
      const res = await fetch("/api/students/location");
      if (!res.ok) return;
      const data = await res.json();
      const map: Record<string, StudentLocation> = {};
      for (const loc of (data.locations ?? []) as StudentLocation[]) map[loc.studentId] = loc;
      setLocationsByStudent(map);
    } catch {
      // non-critical -- the roster just won't show address previews
    }
  }

  async function loadTransports() {
    try {
      const res = await fetch("/api/students/transport");
      if (!res.ok) return;
      const data = await res.json();
      const map: Record<string, TransportMode> = {};
      for (const t of (data.transports ?? []) as { studentId: string; mode: TransportMode }[]) {
        map[t.studentId] = t.mode;
      }
      setTransportByStudent(map);
    } catch {
      // non-critical -- the roster just won't show the bus/self toggle state
    }
  }

  async function setTransportMode(student: Student, mode: TransportMode) {
    // バス requires an address on file -- if there isn't one yet, open the
    // address modal instead of setting the mode directly; the mode only
    // actually gets set once that address is looked up and saved (see
    // confirmSaveAddress()). Cancelling out of the modal leaves the mode
    // untouched.
    if (mode === "bus" && transportByStudent[student.studentId] !== "bus" && !locationsByStudent[student.studentId]) {
      openAddressModal(student, { autoSetBusOnSave: true });
      return;
    }

    // Toggling the same mode again clears it back to "not yet chosen".
    const nextMode: TransportMode | null = transportByStudent[student.studentId] === mode ? null : mode;
    setTransportSavingId(student.studentId);
    try {
      const res = await fetch("/api/students/transport", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: student.studentId, mode: nextMode }),
      });
      if (!res.ok) throw new Error("failed");
      setTransportByStudent((prev) => {
        const next = { ...prev };
        if (nextMode === null) delete next[student.studentId];
        else next[student.studentId] = nextMode;
        return next;
      });
    } catch {
      setError("通学方法の更新に失敗しました / Failed to update transport mode");
    } finally {
      setTransportSavingId(null);
    }
  }

  async function loadStudents(className: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/students?class=${encodeURIComponent(className)}`
      );
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setStudents(data.students ?? []);
    } catch {
      setError("生徒一覧の取得に失敗しました / Failed to load students");
    } finally {
      setLoading(false);
    }
  }

  async function loadInactiveStudents(className: string) {
    setLoadingInactive(true);
    try {
      const res = await fetch(
        `/api/students?class=${encodeURIComponent(className)}&includeInactive=true`
      );
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      const all: Student[] = data.students ?? [];
      setInactiveStudents(all.filter((s) => !s.active));
    } catch {
      setError("非表示の生徒一覧の取得に失敗しました / Failed to load withdrawn students");
    } finally {
      setLoadingInactive(false);
    }
  }

  function toggleShowInactive() {
    const next = !showInactive;
    setShowInactive(next);
    if (next && selectedClass) loadInactiveStudents(selectedClass);
  }

  async function handleAddSingle(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedClass || !nameKanji.trim()) return;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nameKanji: nameKanji.trim(),
          nameEnglish: nameEnglish.trim(),
          className: selectedClass,
        }),
      });
      if (!res.ok) throw new Error("failed");
      setNameKanji("");
      setNameEnglish("");
      await loadStudents(selectedClass);
    } catch {
      setError("生徒の追加に失敗しました / Failed to add student");
    } finally {
      setSaving(false);
    }
  }

  const bulkParsed = bulkTwoLineMode ? parseBulkNamesTwoLine(bulkText) : parseBulkNames(bulkText);

  async function handleAddBulk() {
    if (!selectedClass || bulkParsed.length === 0) return;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/students/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ className: selectedClass, students: bulkParsed }),
      });
      if (!res.ok) throw new Error("failed");
      setBulkText("");
      await loadStudents(selectedClass);
    } catch {
      setError("一括追加に失敗しました / Failed to bulk-add students");
    } finally {
      setSaving(false);
    }
  }

  function openEditName(student: Student) {
    setEditNameModal({
      studentId: student.studentId,
      nameKanji: student.nameKanji,
      nameEnglish: student.nameEnglish,
    });
    setEditNameError(null);
  }

  async function saveEditName() {
    if (!editNameModal || !editNameModal.nameKanji.trim()) return;
    setEditNameSaving(true);
    setEditNameError(null);
    try {
      const res = await fetch("/api/students", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: editNameModal.studentId,
          nameKanji: editNameModal.nameKanji.trim(),
          nameEnglish: editNameModal.nameEnglish.trim(),
        }),
      });
      if (!res.ok) throw new Error("failed");
      setStudents((prev) =>
        prev.map((s) =>
          s.studentId === editNameModal.studentId
            ? { ...s, nameKanji: editNameModal.nameKanji.trim(), nameEnglish: editNameModal.nameEnglish.trim() }
            : s
        )
      );
      setEditNameModal(null);
    } catch {
      setEditNameError("保存に失敗しました / Failed to save");
    } finally {
      setEditNameSaving(false);
    }
  }

  function openMoveClass(student: Student) {
    const firstOther = allClassNames.find((c) => c !== selectedClass) ?? "";
    setMoveClassModal({
      studentId: student.studentId,
      nameKanji: student.nameKanji,
      targetClass: firstOther,
    });
    setMoveClassError(null);
  }

  async function saveMoveClass() {
    if (!moveClassModal || !moveClassModal.targetClass) return;
    setMoveClassSaving(true);
    setMoveClassError(null);
    try {
      const res = await fetch("/api/students", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: moveClassModal.studentId,
          moveToClassName: moveClassModal.targetClass,
        }),
      });
      if (!res.ok) throw new Error("failed");
      // They no longer belong on this class's roster once moved.
      setStudents((prev) => prev.filter((s) => s.studentId !== moveClassModal.studentId));
      setMoveClassModal(null);
    } catch {
      setMoveClassError("移動に失敗しました / Failed to move");
    } finally {
      setMoveClassSaving(false);
    }
  }

  async function handleWithdraw(student: Student) {
    if (
      !window.confirm(
        `${student.nameKanji} を削除しますか？（卒園・退会・登録ミスなど理由は問いません）\n\n一覧から見えなくなりますが、過去の出席記録は残ります。\n\nRemove ${student.nameKanji}? (For any reason — graduated, withdrew, entered by mistake, etc.) They'll disappear from the roster, but past attendance stays intact.`
      )
    ) {
      return;
    }
    setWithdrawingId(student.studentId);
    setError(null);
    try {
      const res = await fetch("/api/students", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: student.studentId, active: false }),
      });
      if (!res.ok) throw new Error("failed");
      setStudents((prev) => prev.filter((s) => s.studentId !== student.studentId));
    } catch {
      setError("更新に失敗しました / Failed to update");
    } finally {
      setWithdrawingId(null);
    }
  }

  async function handleRemoveAll() {
    if (!selectedClass) return;
    setRemovingAll(true);
    setRemoveAllError(null);
    try {
      const res = await fetch("/api/students/remove-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ className: selectedClass }),
      });
      if (!res.ok) throw new Error("failed");
      setStudents([]);
      setShowRemoveAllModal(false);
    } catch {
      setRemoveAllError("削除に失敗しました / Failed to remove");
    } finally {
      setRemovingAll(false);
    }
  }

  // Step 1: fetch the backup as a blob and trigger a real local download —
  // only once that fetch genuinely succeeds (HTTP 200, non-empty body) do
  // we move on to the permanent-delete step. A plain `window.location.href`
  // navigation (used by the print/Excel buttons elsewhere) can't be
  // awaited or checked this way, which is why this flow uses fetch+blob
  // instead, even though the end result — a file landing in Downloads —
  // looks the same to the user.
  async function handleReset() {
    if (!selectedClass) return;
    setResetStage("backing-up");
    setResetError(null);
    try {
      const backupRes = await fetch(
        `/api/export/reset-backup?class=${encodeURIComponent(selectedClass)}`
      );
      if (!backupRes.ok) throw new Error("backup failed");
      const blob = await backupRes.blob();
      if (blob.size === 0) throw new Error("empty backup");

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selectedClass.replace(/\s+/g, "_")}_reset-backup_${new Date()
        .toISOString()
        .slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setResetStage("deleting");
      const resetRes = await fetch("/api/students/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ className: selectedClass }),
      });
      if (!resetRes.ok) throw new Error("reset failed");
      const data = await resetRes.json();
      setResetResult(data);
      setResetStage("done");
      setStudents([]);
    } catch {
      setResetStage("error");
      setResetError(
        "処理に失敗しました。バックアップが保存されていない場合、生徒やコーチの記録は削除されていません / Failed — if the backup wasn't saved, nothing was deleted"
      );
    }
  }

  async function handleCoachReset() {
    if (!selectedClass) return;
    setCoachResetStage("backing-up");
    setCoachResetError(null);
    try {
      const backupRes = await fetch(
        `/api/export/reset-backup?class=${encodeURIComponent(selectedClass)}`
      );
      if (!backupRes.ok) throw new Error("backup failed");
      const blob = await backupRes.blob();
      if (blob.size === 0) throw new Error("empty backup");

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selectedClass.replace(/\s+/g, "_")}_coach-reset-backup_${new Date()
        .toISOString()
        .slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setCoachResetStage("deleting");
      const resetRes = await fetch("/api/students/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ className: selectedClass, rosterToo: false }),
      });
      if (!resetRes.ok) throw new Error("reset failed");
      const data = await resetRes.json();
      setCoachResetResult(data);
      setCoachResetStage("done");
    } catch {
      setCoachResetStage("error");
      setCoachResetError(
        "処理に失敗しました。バックアップが保存されていない場合、コーチの記録は削除されていません / Failed — if the backup wasn't saved, nothing was deleted"
      );
    }
  }

  async function handleRestore(student: Student) {
    setRestoringId(student.studentId);
    setError(null);
    try {
      const res = await fetch("/api/students", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: student.studentId, active: true }),
      });
      if (!res.ok) throw new Error("failed");
      setInactiveStudents((prev) => prev.filter((s) => s.studentId !== student.studentId));
      if (selectedClass) await loadStudents(selectedClass);
    } catch {
      setError("復帰に失敗しました / Failed to restore");
    } finally {
      setRestoringId(null);
    }
  }

  async function openAddressModal(
    student: Student,
    options?: { autoSetBusOnSave?: boolean }
  ) {
    setAddressModal({
      studentId: student.studentId,
      nameKanji: student.nameKanji,
      input: "",
      autoSetBusOnSave: options?.autoSetBusOnSave,
    });
    setAddressError(null);
    setPendingResult(null);
    setAddressConfirmRemove(false);
    setSavedLocation(null);
    setAddressLoading(true);
    try {
      const res = await fetch(
        `/api/students/location?studentId=${encodeURIComponent(student.studentId)}`
      );
      if (res.ok) {
        const data = await res.json();
        setSavedLocation(data.location ?? null);
        if (data.location) {
          setAddressModal({
            studentId: student.studentId,
            nameKanji: student.nameKanji,
            input: data.location.address,
            autoSetBusOnSave: options?.autoSetBusOnSave,
          });
        }
      }
    } catch {
      // no saved address yet, or fetch failed — modal still usable to enter a new one
    } finally {
      setAddressLoading(false);
    }
  }

  async function lookupAddress() {
    if (!addressModal || !addressModal.input.trim()) return;
    setAddressLookingUp(true);
    setAddressError(null);
    setPendingResult(null);
    try {
      const res = await fetch("/api/students/location", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: addressModal.studentId,
          address: addressModal.input.trim(),
          mode: "lookup",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddressError(data.error ?? "検索に失敗しました / Look up failed");
        return;
      }
      setPendingResult({
        address: data.address,
        lat: data.lat,
        lng: data.lng,
        displayName: data.displayName,
      });
    } catch {
      setAddressError("検索に失敗しました / Look up failed");
    } finally {
      setAddressLookingUp(false);
    }
  }

  async function confirmSaveAddress() {
    if (!addressModal || !pendingResult) return;
    setAddressSaving(true);
    setAddressError(null);
    try {
      const res = await fetch("/api/students/location", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: addressModal.studentId,
          address: pendingResult.address,
          lat: pendingResult.lat,
          lng: pendingResult.lng,
          mode: "save",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddressError(data.error ?? "保存に失敗しました / Failed to save");
        return;
      }
      setSavedLocation(data.location);
      setLocationsByStudent((prev) => ({ ...prev, [addressModal.studentId]: data.location }));
      setPendingResult(null);

      // バス requires an address -- if this save happened because バス was
      // picked with no address yet, the mode gets set now that one exists.
      if (addressModal.autoSetBusOnSave) {
        const transportRes = await fetch("/api/students/transport", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentId: addressModal.studentId, mode: "bus" }),
        });
        if (transportRes.ok) {
          setTransportByStudent((prev) => ({ ...prev, [addressModal.studentId]: "bus" }));
        }
      }
    } catch {
      setAddressError("保存に失敗しました / Failed to save");
    } finally {
      setAddressSaving(false);
    }
  }

  async function removeAddress() {
    if (!addressModal) return;
    setAddressSaving(true);
    setAddressError(null);
    try {
      const res = await fetch("/api/students/location", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: addressModal.studentId, address: null }),
      });
      if (!res.ok) throw new Error("failed");
      setSavedLocation(null);
      setAddressModal({ ...addressModal, input: "" });
      setPendingResult(null);
      setAddressConfirmRemove(false);
      setLocationsByStudent((prev) => {
        const next = { ...prev };
        delete next[addressModal.studentId];
        return next;
      });

      // バス requires an address -- removing it clears the mode back to
      // "not yet chosen" rather than leaving a バス student with no address.
      if (transportByStudent[addressModal.studentId] === "bus") {
        const transportRes = await fetch("/api/students/transport", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentId: addressModal.studentId, mode: null }),
        });
        if (transportRes.ok) {
          setTransportByStudent((prev) => {
            const next = { ...prev };
            delete next[addressModal.studentId];
            return next;
          });
        }
      }
    } catch {
      setAddressError("削除に失敗しました / Failed to delete");
    } finally {
      setAddressSaving(false);
    }
  }

  if (!loaded || !selectedClass) return null;

  // Reset deletes Coach Schedule/Headcount by branch+grade, which only
  // exists for 長/中/少 classes — 小学生 has no grade row there, so hide
  // the button rather than let it fail on a class it can't ever resolve.
  const hasBranchGrade = classNameToBranchGrade(selectedClass) !== null;

  return (
    <main className="min-h-screen p-6 max-w-5xl mx-auto flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">{selectedClass}｜生徒管理</h1>
          <p className="text-xs text-gray-500">
            {classNameToEnglish(selectedClass, extraClassEnNames)} · Student Management
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard"
            className="rounded-full bg-gray-100 text-gray-600 px-4 py-2.5 text-sm font-semibold"
          >
            ← 出席簿に戻る
            <span className="block text-[10px] font-normal opacity-70">
              Back to attendance
            </span>
          </Link>
          <Link
            href="/select-class"
            className="rounded-full bg-gray-100 text-gray-600 w-9 h-9 flex items-center justify-center shrink-0"
            aria-label="トップページ / Home"
          >
            🏠
          </Link>
        </div>
      </div>

      <div className="border rounded-xl p-4 flex flex-col gap-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setAddMode("single")}
            className={`flex-1 rounded-full py-1.5 text-sm font-semibold ${
              addMode === "single"
                ? "bg-green-600 text-white"
                : "bg-gray-100 text-gray-500"
            }`}
          >
            1人ずつ追加 / One at a time
          </button>
          <button
            type="button"
            onClick={() => setAddMode("bulk")}
            className={`flex-1 rounded-full py-1.5 text-sm font-semibold ${
              addMode === "bulk"
                ? "bg-green-600 text-white"
                : "bg-gray-100 text-gray-500"
            }`}
          >
            まとめて追加 / Add many at once
          </button>
        </div>

        {addMode === "single" ? (
          <form onSubmit={handleAddSingle} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              名前（漢字）
              <span className="text-xs font-normal text-gray-500">Name (Kanji)</span>
              <input
                value={nameKanji}
                onChange={(e) => setNameKanji(e.target.value)}
                className="border rounded px-3 py-2"
                placeholder="山田 太郎"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              英語名（任意）
              <span className="text-xs font-normal text-gray-500">English name (optional)</span>
              <input
                value={nameEnglish}
                onChange={(e) => setNameEnglish(e.target.value)}
                className="border rounded px-3 py-2"
                placeholder="TARO YAMADA"
              />
            </label>
            <button
              type="submit"
              disabled={saving || !nameKanji.trim()}
              className="rounded-full bg-green-600 text-white py-2 disabled:opacity-40"
            >
              {saving ? "追加中... / Adding..." : "生徒を追加 / Add student"}
            </button>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={bulkTwoLineMode}
                onChange={(e) => setBulkTwoLineMode(e.target.checked)}
              />
              名前が1つのセルに2行（漢字→ローマ字）で入っている「名前」列をそのまま貼り付ける
              <span className="block text-xs font-normal text-gray-500">
                Check this when pasting a "名前" column copied directly from a roster where
                each cell has kanji on one line and romaji on the next (e.g. Alt+Enter inside
                the cell)
              </span>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {bulkTwoLineMode
                ? "名前列をそのまま貼り付けてください（1人あたり2行：漢字→ローマ字）"
                : "1行に1人ずつ貼り付けてください（表計算ソフトの2列をそのまま貼り付けてもOK）"}
              <span className="text-xs font-normal text-gray-500">
                {bulkTwoLineMode
                  ? "Paste the name column as-is — 2 lines per student (kanji, then romaji)"
                  : "Paste one student per line — works with two spreadsheet columns pasted " +
                    'directly (kanji + English), or manually typed "漢字,English" (English ' +
                    "optional either way)"}
              </span>
              <textarea
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                rows={6}
                placeholder={
                  bulkTwoLineMode
                    ? "山田 太郎\nTARO YAMADA\n佐藤 花子\nHANAKO SATO"
                    : "山田 太郎, TARO YAMADA\n佐藤 花子, HANAKO SATO\n鈴木 次郎"
                }
                className="border rounded px-3 py-2 font-mono text-sm"
              />
            </label>

            {bulkParsed.length > 0 && (
              <div className="border rounded-lg p-2 max-h-40 overflow-y-auto">
                <p className="text-xs font-semibold text-gray-500 mb-1">
                  プレビュー（この内容で登録されます）/ Preview (this is what will be added)
                </p>
                <ul className="text-xs flex flex-col divide-y">
                  {bulkParsed.map((p, i) => (
                    <li key={i} className="py-1 flex justify-between gap-2">
                      <span>{p.nameKanji}</span>
                      <span className="text-gray-400">{p.nameEnglish || "—"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-xs text-gray-500">
              {bulkParsed.length}人を追加します / {bulkParsed.length} student(s) will be added
            </p>
            <button
              type="button"
              onClick={handleAddBulk}
              disabled={saving || bulkParsed.length === 0}
              className="rounded-full bg-green-600 text-white py-2 disabled:opacity-40"
            >
              {saving
                ? "追加中... / Adding..."
                : `${bulkParsed.length}人を追加 / Add ${bulkParsed.length}`}
            </button>
          </div>
        )}
        {error && <p className="text-red-600 text-sm">{error}</p>}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2 gap-2">
          <h2 className="font-semibold">
            現在の生徒一覧 {!loading && `(${students.length}名)`}
            <span className="block text-xs font-normal text-gray-500">
              Current student list{!loading && ` (${students.length})`}
            </span>
          </h2>
          {students.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setRemoveAllError(null);
                setShowRemoveAllModal(true);
              }}
              className="shrink-0 rounded-full border border-red-300 text-red-600 px-3 py-1 text-xs font-semibold"
            >
              全員削除 / Remove all
            </button>
          )}
        </div>
        {loading ? (
          <p className="text-gray-500 text-sm">読み込み中... / Loading...</p>
        ) : students.length === 0 ? (
          <p className="text-gray-500 text-sm">
            まだ生徒が登録されていません / No students registered yet
          </p>
        ) : (
          <ul className="flex flex-col divide-y border rounded-xl overflow-hidden">
            {students.map((s) => (
              <li
                key={s.studentId}
                className="px-4 py-2.5 leading-tight flex items-center gap-3 flex-wrap"
              >
                <div className="min-w-0 flex-1 basis-48">
                  <span className="font-medium block">{s.nameKanji}</span>
                  {s.nameEnglish && (
                    <span className="text-xs text-gray-500 block">{s.nameEnglish}</span>
                  )}
                  {transportByStudent[s.studentId] === "self" ? (
                    <p className="text-[10px] text-amber-600">🚗 自分で送迎（住所不要）/ Self drop-off</p>
                  ) : locationsByStudent[s.studentId] ? (
                    <p className="text-[10px] text-green-700 truncate max-w-xs">
                      📍 {locationsByStudent[s.studentId].address}
                    </p>
                  ) : (
                    transportByStudent[s.studentId] === "bus" && (
                      <p className="text-[10px] text-red-600 font-semibold">
                        ⚠️ 住所が未登録です / Address missing
                      </p>
                    )
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setTransportMode(s, "bus")}
                    disabled={transportSavingId === s.studentId}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold border disabled:opacity-40 ${
                      transportByStudent[s.studentId] === "bus"
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-white text-gray-500 border-gray-300"
                    }`}
                  >
                    🚌 バス
                  </button>
                  <button
                    onClick={() => setTransportMode(s, "self")}
                    disabled={transportSavingId === s.studentId}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold border disabled:opacity-40 ${
                      transportByStudent[s.studentId] === "self"
                        ? "bg-amber-500 text-white border-amber-500"
                        : "bg-white text-gray-500 border-gray-300"
                    }`}
                  >
                    🚗 送迎
                  </button>
                  {transportByStudent[s.studentId] !== "self" && (
                    <button
                      onClick={() => openAddressModal(s)}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold border ${
                        locationsByStudent[s.studentId]
                          ? "bg-green-50 text-green-700 border-green-300"
                          : transportByStudent[s.studentId] === "bus"
                            ? "bg-red-50 text-red-600 border-red-300"
                            : "bg-white text-gray-500 border-gray-300"
                      }`}
                    >
                      {locationsByStudent[s.studentId]
                        ? "🏠 住所 ✓"
                        : transportByStudent[s.studentId] === "bus"
                          ? "🏠 住所 ⚠️"
                          : "🏠 住所"}
                    </button>
                  )}
                  <button
                    onClick={() => openEditName(s)}
                    className="text-xs text-gray-400 hover:text-blue-500 underline"
                  >
                    ✏️ 名前
                  </button>
                  <button
                    onClick={() => openMoveClass(s)}
                    className="text-xs text-gray-400 hover:text-blue-500 underline"
                  >
                    🔀 クラス変更
                  </button>
                  <button
                    onClick={() => handleWithdraw(s)}
                    disabled={withdrawingId === s.studentId}
                    className="text-xs text-gray-400 hover:text-red-500 underline disabled:opacity-40"
                  >
                    削除する / Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <button
          type="button"
          onClick={toggleShowInactive}
          className="text-xs text-gray-400 underline"
        >
          {showInactive ? "非表示の生徒を隠す" : "削除した生徒を表示"} / {showInactive ? "Hide" : "Show"} removed students
        </button>
        {showInactive && (
          <div className="mt-2">
            {loadingInactive ? (
              <p className="text-gray-400 text-xs">読み込み中... / Loading...</p>
            ) : inactiveStudents.length === 0 ? (
              <p className="text-gray-400 text-xs">
                削除した生徒はいません / No removed students
              </p>
            ) : (
              <ul className="flex flex-col divide-y border rounded-xl overflow-hidden">
                {inactiveStudents.map((s) => (
                  <li
                    key={s.studentId}
                    className="px-4 py-1.5 leading-tight flex items-center justify-between gap-2 bg-gray-50 text-gray-500"
                  >
                    <div>
                      <span className="font-medium block">{s.nameKanji}</span>
                      {s.nameEnglish && (
                        <span className="text-xs block">{s.nameEnglish}</span>
                      )}
                    </div>
                    <button
                      onClick={() => handleRestore(s)}
                      disabled={restoringId === s.studentId}
                      className="shrink-0 text-xs text-blue-500 underline disabled:opacity-40"
                    >
                      復帰させる / Restore
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {hasBranchGrade && (
        <div className="border-2 border-red-300 rounded-xl p-4 flex flex-col gap-2 bg-red-50/40">
          <h2 className="font-semibold text-red-700">
            学期末リセット
            <span className="block text-xs font-normal text-red-500">End-of-term reset</span>
          </h2>
          <p className="text-xs text-gray-500">
            バックアップを保存してから、このクラスの生徒と専門コーチの記録をまとめてリセットします
            <span className="block">
              Backs up this class, then clears its roster and Coach Schedule/Headcount records
            </span>
          </p>
          <button
            type="button"
            onClick={() => {
              setResetStage("idle");
              setResetError(null);
              setResetResult(null);
              setShowResetModal1(true);
            }}
            className="self-start rounded-full bg-red-600 text-white px-4 py-2 text-sm font-semibold"
          >
            🔄 リセット / Reset
          </button>

          <div className="border-t border-red-200 pt-3 mt-1 flex flex-col gap-2">
            <h3 className="font-semibold text-red-700 text-sm">
              専門コーチ記録のみ削除
              <span className="block text-xs font-normal text-red-500">
                Coach records only (roster untouched)
              </span>
            </h3>
            <p className="text-xs text-gray-500">
              バックアップを保存してから、このクラスのコーチスケジュール・コーチ人数の記録だけを削除します。生徒名簿はそのまま残ります
              <span className="block">
                Backs up, then clears only Coach Schedule/Headcount records — the student roster
                is left untouched (e.g. students are moving to another class, not withdrawing)
              </span>
            </p>
            <button
              type="button"
              onClick={() => {
                setCoachResetStage("idle");
                setCoachResetError(null);
                setCoachResetResult(null);
                setShowCoachResetModal1(true);
              }}
              className="self-start rounded-full border border-red-400 text-red-600 px-4 py-2 text-sm font-semibold"
            >
              🗑 コーチ記録のみ削除 / Delete coach records only
            </button>
          </div>
        </div>
      )}

      {showRemoveAllModal && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50"
          onClick={() => !removingAll && setShowRemoveAllModal(false)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-sm max-h-[85vh] overflow-y-auto flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-center text-red-600">
              全員削除の確認
              <span className="block text-sm font-normal text-gray-500">
                Confirm remove all
              </span>
            </h2>

            <div className="bg-gray-50 rounded-xl p-4 flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">対象クラス / Class</span>
                <span className="font-semibold">{selectedClass}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">対象人数 / Students</span>
                <span className="font-semibold">{students.length}名 / {students.length}</span>
              </div>
            </div>

            <p className="text-xs text-gray-400 text-center">
              このクラスの生徒{students.length}名を全員一覧から削除します。過去の出席記録は残ります。よろしいですか？
              <span className="block">
                Removes all {students.length} students in this class from the roster. Past
                attendance stays intact. Continue?
              </span>
            </p>

            {removeAllError && (
              <p className="text-red-600 text-sm text-center">{removeAllError}</p>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setShowRemoveAllModal(false)}
                disabled={removingAll}
                className="rounded-full border border-gray-300 py-3 font-semibold disabled:opacity-40"
              >
                キャンセル / Cancel
              </button>
              <button
                onClick={handleRemoveAll}
                disabled={removingAll}
                className="rounded-full bg-red-600 text-white py-3 font-semibold disabled:opacity-40"
              >
                {removingAll ? "削除中... / Removing..." : "全員削除する / Remove all"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset step 1/2 — explains exactly what will happen before asking for final confirmation. */}
      {showResetModal1 && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50"
          onClick={() => setShowResetModal1(false)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-sm max-h-[85vh] overflow-y-auto flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-center text-red-600">
              学期末リセットの確認（1/2）
              <span className="block text-sm font-normal text-gray-500">
                Confirm reset (1/2)
              </span>
            </h2>

            <div className="bg-gray-50 rounded-xl p-4 flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">対象クラス / Class</span>
                <span className="font-semibold">{selectedClass}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">対象人数 / Students</span>
                <span className="font-semibold">
                  {students.length}名 / {students.length}
                </span>
              </div>
            </div>

            <ul className="text-xs text-gray-600 list-disc pl-4 flex flex-col gap-2">
              <li>
                まずこのクラスの記録をバックアップとしてダウンロードします（生徒名簿・出席記録・コーチスケジュール・コーチ人数）
                <span className="block text-gray-400">
                  First, downloads a backup (roster, attendance, Coach Schedule, Coach Headcount)
                </span>
              </li>
              <li>
                生徒{students.length}名を一覧から削除します（後で「削除した生徒を表示」から復帰できます）
                <span className="block text-gray-400">
                  Removes all {students.length} students (recoverable later via &quot;show
                  removed students&quot;)
                </span>
              </li>
              <li className="text-red-600 font-semibold">
                このクラスのコーチスケジュール・コーチ人数の記録は完全に削除され、復元できません
                <span className="block text-red-400 font-normal">
                  This class&apos;s Coach Schedule/Headcount records are permanently deleted —
                  cannot be undone
                </span>
              </li>
              <li>
                専門コーチの種目リスト自体は削除しません（他の学年でも使うため）
                <span className="block text-gray-400">
                  The Coach category list itself is kept (other grades still use it)
                </span>
              </li>
            </ul>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setShowResetModal1(false)}
                className="rounded-full border border-gray-300 py-3 font-semibold"
              >
                キャンセル / Cancel
              </button>
              <button
                onClick={() => {
                  setShowResetModal1(false);
                  setShowResetModal2(true);
                }}
                className="rounded-full bg-red-600 text-white py-3 font-semibold"
              >
                次へ / Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset step 2/2 — final confirmation, then shows live progress and the result. */}
      {showResetModal2 && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50"
          onClick={() => resetStage === "idle" && setShowResetModal2(false)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            {resetStage === "done" ? (
              <>
                <h2 className="text-lg font-bold text-center text-green-700">
                  完了しました
                  <span className="block text-sm font-normal text-gray-500">Done</span>
                </h2>
                <div className="bg-gray-50 rounded-xl p-4 flex flex-col gap-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">削除した生徒 / Students removed</span>
                    <span className="font-semibold">{resetResult?.studentsRemoved}名</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">
                      削除したスケジュール記録 / Schedule rows deleted
                    </span>
                    <span className="font-semibold">{resetResult?.scheduleRowsDeleted}件</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">
                      削除した人数記録 / Headcount rows deleted
                    </span>
                    <span className="font-semibold">{resetResult?.headcountRowsDeleted}件</span>
                  </div>
                </div>
                <p className="text-xs text-gray-400 text-center">
                  バックアップファイルはダウンロードフォルダに保存されました
                  <span className="block">
                    The backup file was saved to your downloads folder
                  </span>
                </p>
                <button
                  onClick={() => setShowResetModal2(false)}
                  className="rounded-full bg-green-600 text-white py-3 font-semibold"
                >
                  閉じる / Close
                </button>
              </>
            ) : (
              <>
                <h2 className="text-lg font-bold text-center text-red-600">
                  学期末リセットの確認（2/2）
                  <span className="block text-sm font-normal text-gray-500">
                    Confirm reset (2/2)
                  </span>
                </h2>

                <div className="bg-red-50 border border-red-300 rounded-xl p-4">
                  <p className="text-sm text-red-800 font-semibold text-center">
                    ⚠ まずバックアップを保存します。保存が終わり次第、このクラスのコーチスケジュール・コーチ人数の記録は完全に削除され、二度と元に戻せません
                    <span className="block text-xs font-normal mt-1">
                      We&apos;ll back up the data first. Once that&apos;s done, this class&apos;s
                      Coach Schedule/Headcount records are permanently deleted — there is no undo.
                    </span>
                  </p>
                </div>

                {resetStage === "backing-up" && (
                  <p className="text-sm text-center text-gray-600">
                    📥 バックアップを保存中... / Saving backup...
                  </p>
                )}
                {resetStage === "deleting" && (
                  <p className="text-sm text-center text-gray-600">
                    🗑 削除中... / Deleting...
                  </p>
                )}
                {resetStage === "error" && resetError && (
                  <p className="text-red-600 text-sm text-center">{resetError}</p>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setShowResetModal2(false)}
                    disabled={resetStage === "backing-up" || resetStage === "deleting"}
                    className="rounded-full border border-gray-300 py-3 font-semibold disabled:opacity-40"
                  >
                    キャンセル / Cancel
                  </button>
                  <button
                    onClick={handleReset}
                    disabled={resetStage === "backing-up" || resetStage === "deleting"}
                    className="rounded-full bg-red-600 text-white py-3 font-semibold disabled:opacity-40"
                  >
                    {resetStage === "backing-up" || resetStage === "deleting"
                      ? "処理中... / Processing..."
                      : "リセットする / Reset"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Coach-records-only reset, step 1/2 */}
      {showCoachResetModal1 && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50"
          onClick={() => setShowCoachResetModal1(false)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-sm max-h-[85vh] overflow-y-auto flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-center text-red-600">
              専門コーチ記録削除の確認（1/2）
              <span className="block text-sm font-normal text-gray-500">
                Confirm coach-records delete (1/2)
              </span>
            </h2>

            <div className="bg-gray-50 rounded-xl p-4 flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">対象クラス / Class</span>
                <span className="font-semibold">{selectedClass}</span>
              </div>
            </div>

            <ul className="text-xs text-gray-600 list-disc pl-4 flex flex-col gap-2">
              <li>
                まずこのクラスの記録をバックアップとしてダウンロードします（生徒名簿・出席記録・コーチスケジュール・コーチ人数）
                <span className="block text-gray-400">
                  First, downloads a backup (roster, attendance, Coach Schedule, Coach Headcount)
                </span>
              </li>
              <li className="text-green-700 font-semibold">
                生徒名簿・出席記録は削除しません
                <span className="block text-green-600 font-normal">
                  The student roster and attendance history are NOT touched
                </span>
              </li>
              <li className="text-red-600 font-semibold">
                このクラスのコーチスケジュール・コーチ人数の記録は完全に削除され、復元できません
                <span className="block text-red-400 font-normal">
                  This class&apos;s Coach Schedule/Headcount records are permanently deleted —
                  cannot be undone
                </span>
              </li>
              <li>
                専門コーチの種目リスト自体は削除しません（他の学年でも使うため）
                <span className="block text-gray-400">
                  The Coach category list itself is kept (other grades still use it)
                </span>
              </li>
            </ul>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setShowCoachResetModal1(false)}
                className="rounded-full border border-gray-300 py-3 font-semibold"
              >
                キャンセル / Cancel
              </button>
              <button
                onClick={() => {
                  setShowCoachResetModal1(false);
                  setShowCoachResetModal2(true);
                }}
                className="rounded-full bg-red-600 text-white py-3 font-semibold"
              >
                次へ / Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Coach-records-only reset, step 2/2 */}
      {showCoachResetModal2 && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50"
          onClick={() => coachResetStage === "idle" && setShowCoachResetModal2(false)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            {coachResetStage === "done" ? (
              <>
                <h2 className="text-lg font-bold text-center text-green-700">
                  完了しました
                  <span className="block text-sm font-normal text-gray-500">Done</span>
                </h2>
                <div className="bg-gray-50 rounded-xl p-4 flex flex-col gap-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">
                      削除したスケジュール記録 / Schedule rows deleted
                    </span>
                    <span className="font-semibold">{coachResetResult?.scheduleRowsDeleted}件</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">
                      削除した人数記録 / Headcount rows deleted
                    </span>
                    <span className="font-semibold">{coachResetResult?.headcountRowsDeleted}件</span>
                  </div>
                </div>
                <p className="text-xs text-gray-400 text-center">
                  バックアップファイルはダウンロードフォルダに保存されました。生徒名簿は変更されていません
                  <span className="block">
                    The backup file was saved to your downloads folder. The student roster is
                    unchanged.
                  </span>
                </p>
                <button
                  onClick={() => setShowCoachResetModal2(false)}
                  className="rounded-full bg-green-600 text-white py-3 font-semibold"
                >
                  閉じる / Close
                </button>
              </>
            ) : (
              <>
                <h2 className="text-lg font-bold text-center text-red-600">
                  専門コーチ記録削除の確認（2/2）
                  <span className="block text-sm font-normal text-gray-500">
                    Confirm coach-records delete (2/2)
                  </span>
                </h2>

                <div className="bg-red-50 border border-red-300 rounded-xl p-4">
                  <p className="text-sm text-red-800 font-semibold text-center">
                    ⚠ まずバックアップを保存します。保存が終わり次第、このクラスのコーチスケジュール・コーチ人数の記録は完全に削除され、二度と元に戻せません（生徒名簿は削除されません）
                    <span className="block text-xs font-normal mt-1">
                      We&apos;ll back up the data first. Once that&apos;s done, this class&apos;s
                      Coach Schedule/Headcount records are permanently deleted — there is no undo.
                      (The student roster is not deleted.)
                    </span>
                  </p>
                </div>

                {coachResetStage === "backing-up" && (
                  <p className="text-sm text-center text-gray-600">
                    📥 バックアップを保存中... / Saving backup...
                  </p>
                )}
                {coachResetStage === "deleting" && (
                  <p className="text-sm text-center text-gray-600">
                    🗑 削除中... / Deleting...
                  </p>
                )}
                {coachResetStage === "error" && coachResetError && (
                  <p className="text-red-600 text-sm text-center">{coachResetError}</p>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setShowCoachResetModal2(false)}
                    disabled={coachResetStage === "backing-up" || coachResetStage === "deleting"}
                    className="rounded-full border border-gray-300 py-3 font-semibold disabled:opacity-40"
                  >
                    キャンセル / Cancel
                  </button>
                  <button
                    onClick={handleCoachReset}
                    disabled={coachResetStage === "backing-up" || coachResetStage === "deleting"}
                    className="rounded-full bg-red-600 text-white py-3 font-semibold disabled:opacity-40"
                  >
                    {coachResetStage === "backing-up" || coachResetStage === "deleting"
                      ? "処理中... / Processing..."
                      : "削除する / Delete"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {addressModal && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50"
          onClick={() => !addressSaving && setAddressModal(null)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-sm sm:max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-bold text-lg text-center">
              {addressModal.nameKanji}
              <span className="block text-sm font-normal text-gray-500">
                送迎バス用の住所 / Home address for bus routing
              </span>
              {addressModal.autoSetBusOnSave && (
                <span className="block text-xs font-normal text-amber-600 mt-1">
                  🚌 バスを選ぶには住所が必要です — 保存すると自動でバスに設定されます
                  <span className="block">
                    An address is required to select バス — saving one will set it automatically
                  </span>
                </span>
              )}
            </h2>

            {addressLoading ? (
              <p className="text-gray-400 text-sm text-center">読み込み中... / Loading...</p>
            ) : (
              <div className="flex flex-col sm:grid sm:grid-cols-2 sm:gap-6 gap-3">
                <div className="flex flex-col gap-3">
                  <label className="flex flex-col gap-1 text-sm">
                    住所（できればGoogle Mapsのリンク／GPS座標）
                    <span className="text-xs font-normal text-gray-500">
                      For best accuracy, use a Google Maps "Copy link" or right-click coordinates
                      instead of typing a plain address — free-text search often can't pinpoint
                      the exact building in Thailand
                    </span>
                    <textarea
                      value={addressModal.input}
                      onChange={(e) => {
                        setAddressModal({ ...addressModal, input: e.target.value });
                        setPendingResult(null);
                      }}
                      placeholder="例：123 ถนนสุขุมวิท กรุงเทพฯ　または　13.7563, 100.5018"
                      rows={3}
                      autoFocus
                      className="border border-gray-300 rounded-lg px-3 py-2 resize-none"
                    />
                  </label>

                  <button
                    onClick={lookupAddress}
                    disabled={addressLookingUp || !addressModal.input.trim()}
                    className="rounded-full bg-blue-50 border border-blue-300 text-blue-700 py-2.5 font-semibold disabled:opacity-40"
                  >
                    {addressLookingUp ? "検索中... / Searching..." : "🔍 検索 / Look up"}
                  </button>

                  {pendingResult && (
                    <div className="bg-green-50 border border-green-300 rounded-lg p-3 text-xs text-green-800">
                      見つかりました（まだ保存されていません）
                      <span className="block">Found — not saved yet, press 保存 below</span>
                      <span className="block font-medium mt-0.5">{pendingResult.displayName}</span>
                    </div>
                  )}
                  {addressError && (
                    <p className="text-red-600 text-sm text-center">{addressError}</p>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setAddressModal(null)}
                      disabled={addressSaving}
                      className="rounded-full bg-gray-100 text-gray-600 py-2.5 font-semibold disabled:opacity-40"
                    >
                      閉じる / Close
                    </button>
                    <button
                      onClick={confirmSaveAddress}
                      disabled={addressSaving || !pendingResult}
                      className="rounded-full bg-green-600 text-white py-2.5 font-semibold disabled:opacity-40"
                    >
                      {addressSaving ? "保存中... / Saving..." : "💾 保存 / Save"}
                    </button>
                  </div>

                  {savedLocation &&
                    (addressConfirmRemove ? (
                      <div className="flex flex-col gap-2 items-center">
                        <p className="text-xs text-red-600 font-semibold">
                          登録済みの住所を削除しますか？ / Remove the saved address?
                        </p>
                        <div className="grid grid-cols-2 gap-2 w-full">
                          <button
                            onClick={() => setAddressConfirmRemove(false)}
                            disabled={addressSaving}
                            className="rounded-full bg-gray-100 text-gray-600 py-2 text-sm font-semibold disabled:opacity-40"
                          >
                            キャンセル / Cancel
                          </button>
                          <button
                            onClick={removeAddress}
                            disabled={addressSaving}
                            className="rounded-full bg-red-600 text-white py-2 text-sm font-semibold disabled:opacity-40"
                          >
                            削除する / Remove
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setAddressConfirmRemove(true)}
                        className="text-xs text-red-500 underline text-center"
                    >
                      登録済みの住所を削除 / Remove saved address
                    </button>
                  ))}
                </div>

                <div className="flex flex-col gap-2">
                  <p className="text-xs font-semibold text-gray-500">
                    {pendingResult
                      ? "地図で確認（まだ保存されていません） / Confirm on the map (not saved yet)"
                      : "地図で確認 / Confirm on the map"}
                  </p>
                  {pendingResult || savedLocation ? (
                    <>
                      <iframe
                        key={`${(pendingResult ?? savedLocation)!.lat},${(pendingResult ?? savedLocation)!.lng}`}
                        title="住所の地図 / Address map"
                        src={osmEmbedUrl(
                          (pendingResult ?? savedLocation)!.lat,
                          (pendingResult ?? savedLocation)!.lng
                        )}
                        className={`w-full h-64 sm:h-full min-h-64 rounded-lg border ${
                          pendingResult ? "border-2 border-green-400" : "border-gray-300"
                        }`}
                      />
                      <a
                        href={`https://www.google.com/maps?q=${(pendingResult ?? savedLocation)!.lat},${(pendingResult ?? savedLocation)!.lng}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-blue-600 underline text-center"
                      >
                        Google Mapsで開く / Open in Google Maps
                      </a>
                    </>
                  ) : (
                    <div className="w-full h-64 sm:h-full min-h-64 rounded-lg border border-dashed border-gray-300 flex items-center justify-center text-center px-4">
                      <p className="text-xs text-gray-400">
                        検索するとここに地図が表示されます
                        <span className="block">The map appears here once you look up an address</span>
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {editNameModal && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50"
          onClick={() => !editNameSaving && setEditNameModal(null)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-sm flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-bold text-lg text-center">
              名前を修正
              <span className="block text-sm font-normal text-gray-500">Edit name</span>
            </h2>
            <label className="flex flex-col gap-1 text-sm">
              名前（漢字）
              <span className="text-xs font-normal text-gray-500">Name (Kanji)</span>
              <input
                type="text"
                value={editNameModal.nameKanji}
                onChange={(e) =>
                  setEditNameModal({ ...editNameModal, nameKanji: e.target.value })
                }
                autoFocus
                className="border border-gray-300 rounded-lg px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              英語名（任意）
              <span className="text-xs font-normal text-gray-500">English name (optional)</span>
              <input
                type="text"
                value={editNameModal.nameEnglish}
                onChange={(e) =>
                  setEditNameModal({ ...editNameModal, nameEnglish: e.target.value })
                }
                className="border border-gray-300 rounded-lg px-3 py-2"
              />
            </label>
            <p className="text-[10px] text-gray-400 text-center">
              保存すると出席簿・出席確認・送迎管理など全ページの表示に反映されます
              <span className="block">
                Takes effect on the Dashboard, check-in, pickup, and everywhere else this
                student's name is shown
              </span>
            </p>
            {editNameError && (
              <p className="text-red-600 text-sm text-center">{editNameError}</p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setEditNameModal(null)}
                disabled={editNameSaving}
                className="rounded-full bg-gray-100 text-gray-600 py-2.5 font-semibold disabled:opacity-40"
              >
                キャンセル / Cancel
              </button>
              <button
                onClick={saveEditName}
                disabled={editNameSaving || !editNameModal.nameKanji.trim()}
                className="rounded-full bg-green-600 text-white py-2.5 font-semibold disabled:opacity-40"
              >
                {editNameSaving ? "保存中... / Saving..." : "保存 / Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {moveClassModal && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50"
          onClick={() => !moveClassSaving && setMoveClassModal(null)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-sm flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-bold text-lg text-center">
              {moveClassModal.nameKanji}
              <span className="block text-sm font-normal text-gray-500">
                クラス変更 / Move to a different class
              </span>
            </h2>
            <label className="flex flex-col gap-1 text-sm">
              移動先クラス
              <span className="text-xs font-normal text-gray-500">Destination class</span>
              <select
                value={moveClassModal.targetClass}
                onChange={(e) =>
                  setMoveClassModal({ ...moveClassModal, targetClass: e.target.value })
                }
                className="border border-gray-300 rounded-lg px-3 py-2"
              >
                {allClassNames
                  .filter((c) => c !== selectedClass)
                  .map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
              </select>
            </label>
            <p className="text-[10px] text-gray-400 text-center">
              過去の出席記録はそのまま{selectedClass}に残ります。移動後の記録から新しいクラスになります
              <span className="block">
                Past attendance history stays under {selectedClass}; records from after the move
                will be under the new class
              </span>
            </p>
            {moveClassError && (
              <p className="text-red-600 text-sm text-center">{moveClassError}</p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setMoveClassModal(null)}
                disabled={moveClassSaving}
                className="rounded-full bg-gray-100 text-gray-600 py-2.5 font-semibold disabled:opacity-40"
              >
                キャンセル / Cancel
              </button>
              <button
                onClick={saveMoveClass}
                disabled={moveClassSaving || !moveClassModal.targetClass}
                className="rounded-full bg-green-600 text-white py-2.5 font-semibold disabled:opacity-40"
              >
                {moveClassSaving ? "移動中... / Moving..." : "移動する / Move"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
