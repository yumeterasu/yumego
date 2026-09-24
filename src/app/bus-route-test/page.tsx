"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

// Standalone prototype for school-bus route optimization. Deliberately NOT
// linked from any menu -- reachable only by typing the URL, but still
// behind the app's normal login (proxy.ts protects every route by default).
// Everything here is mock data in localStorage; nothing is ever written to
// the real StudentLocations/Students sheets -- the address lookup below
// only ever calls the existing /api/students/location endpoint in
// mode:"lookup" (resolve-only, no write, doesn't require a real studentId).

const STORAGE_KEY = "yumego.busRouteTest";

type Branch = "プロンポン" | "トンロー";

type ResolvedLocation = {
  address: string;
  lat: number;
  lng: number;
  displayName: string;
};

type Child = {
  id: string;
  name: string;
  addressInput: string;
  resolved: ResolvedLocation | null;
};

type TripResult = {
  order: number[];
  legs: { distance: number; duration: number }[];
  geometry: { type: string; coordinates: [number, number][] } | null;
  totalDistance: number;
  totalDuration: number;
};

type StopMeta = { label: string; lat: number; lng: number };

type PersistedState = {
  branchInputs: Record<Branch, string>;
  branchResolved: Record<Branch, ResolvedLocation | null>;
  children: Child[];
  startBranch: Branch;
  endBranch: Branch;
  stopAtOtherBranch: boolean;
};

function loadPersisted(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function savePersisted(state: PersistedState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // non-fatal -- just means the test setup won't survive a reload
  }
}

async function lookupAddress(mockId: string, address: string): Promise<ResolvedLocation> {
  const res = await fetch("/api/students/location", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studentId: mockId, address, mode: "lookup" }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Lookup failed");
  return { address: data.address, lat: data.lat, lng: data.lng, displayName: data.displayName };
}

function fmtKm(meters: number) {
  return `${(meters / 1000).toFixed(1)} km`;
}
function fmtMin(seconds: number) {
  return `${Math.round(seconds / 60)} min`;
}

/** Free, no-API-key map preview embed (OpenStreetMap's official iframe
 *  export) -- same technique already used for real student addresses in
 *  students/page.tsx, so a resolved pin can be visually confirmed here too. */
function osmEmbedUrl(lat: number, lng: number): string {
  const delta = 0.004; // roughly a few hundred meters of context around the pin
  const bbox = `${lng - delta},${lat - delta},${lng + delta},${lat + delta}`;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
}

export default function BusRouteTestPage() {
  const [branchInputs, setBranchInputs] = useState<Record<Branch, string>>({
    プロンポン: "",
    トンロー: "",
  });
  const [branchResolved, setBranchResolved] = useState<Record<Branch, ResolvedLocation | null>>({
    プロンポン: null,
    トンロー: null,
  });
  const [branchLookingUp, setBranchLookingUp] = useState<Branch | null>(null);
  const [branchError, setBranchError] = useState<Record<Branch, string | null>>({
    プロンポン: null,
    トンロー: null,
  });

  const [children, setChildren] = useState<Child[]>([]);
  const [newChildName, setNewChildName] = useState("");
  const [newChildAddress, setNewChildAddress] = useState("");
  const [addingChild, setAddingChild] = useState(false);
  const [addChildError, setAddChildError] = useState<string | null>(null);

  const [startBranch, setStartBranch] = useState<Branch>("プロンポン");
  const [endBranch, setEndBranch] = useState<Branch>("プロンポン");
  const [stopAtOtherBranch, setStopAtOtherBranch] = useState(false);

  const [result, setResult] = useState<TripResult | null>(null);
  const [stops, setStops] = useState<StopMeta[]>([]);
  const [calculating, setCalculating] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);

  const [hydrated, setHydrated] = useState(false);

  // Load persisted mock setup once on mount.
  useEffect(() => {
    const persisted = loadPersisted();
    if (persisted) {
      setBranchInputs(persisted.branchInputs);
      setBranchResolved(persisted.branchResolved);
      setChildren(persisted.children);
      setStartBranch(persisted.startBranch);
      setEndBranch(persisted.endBranch);
      setStopAtOtherBranch(persisted.stopAtOtherBranch);
    }
    setHydrated(true);
  }, []);

  // Persist on every change (after initial hydration, so we don't
  // immediately overwrite a just-loaded save with the pre-load defaults).
  useEffect(() => {
    if (!hydrated) return;
    savePersisted({ branchInputs, branchResolved, children, startBranch, endBranch, stopAtOtherBranch });
  }, [hydrated, branchInputs, branchResolved, children, startBranch, endBranch, stopAtOtherBranch]);

  async function handleLookupBranch(branch: Branch) {
    const address = branchInputs[branch].trim();
    if (!address) return;
    setBranchLookingUp(branch);
    setBranchError((prev) => ({ ...prev, [branch]: null }));
    try {
      const resolved = await lookupAddress(`mock-branch-${branch}`, address);
      setBranchResolved((prev) => ({ ...prev, [branch]: resolved }));
    } catch (err) {
      setBranchError((prev) => ({
        ...prev,
        [branch]: err instanceof Error ? err.message : "Lookup failed",
      }));
    } finally {
      setBranchLookingUp(null);
    }
  }

  async function handleAddChild() {
    const name = newChildName.trim();
    const address = newChildAddress.trim();
    if (!name || !address) {
      setAddChildError("名前と住所の両方を入力してください / Enter both a name and an address");
      return;
    }
    setAddingChild(true);
    setAddChildError(null);
    try {
      const id = `mock-child-${Date.now()}`;
      const resolved = await lookupAddress(id, address);
      setChildren((prev) => [...prev, { id, name, addressInput: address, resolved }]);
      setNewChildName("");
      setNewChildAddress("");
    } catch (err) {
      setAddChildError(err instanceof Error ? err.message : "Lookup failed");
    } finally {
      setAddingChild(false);
    }
  }

  function removeChild(id: string) {
    setChildren((prev) => prev.filter((c) => c.id !== id));
  }

  const bothBranchesResolved = branchResolved.プロンポン && branchResolved.トンロー;
  const canStop = startBranch === endBranch; // "the other branch" is only meaningful for a round trip
  const otherBranch: Branch = startBranch === "プロンポン" ? "トンロー" : "プロンポン";
  const canCalculate =
    children.length > 0 &&
    branchResolved[startBranch] &&
    branchResolved[endBranch] &&
    (!stopAtOtherBranch || !canStop || branchResolved[otherBranch]);

  async function handleCalculate() {
    setCalculating(true);
    setCalcError(null);
    setResult(null);
    try {
      const startLoc = branchResolved[startBranch]!;
      const endLoc = branchResolved[endBranch]!;
      const meta: StopMeta[] = [
        { label: `${startBranch} (出発 / Start)`, lat: startLoc.lat, lng: startLoc.lng },
        ...children.map((c) => ({
          label: c.name,
          lat: c.resolved!.lat,
          lng: c.resolved!.lng,
        })),
      ];
      if (stopAtOtherBranch && canStop) {
        const midLoc = branchResolved[otherBranch]!;
        meta.push({ label: `${otherBranch} (経由 / Stop by)`, lat: midLoc.lat, lng: midLoc.lng });
      }
      meta.push({ label: `${endBranch} (到着 / End)`, lat: endLoc.lat, lng: endLoc.lng });

      const res = await fetch("/api/bus-route-test/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points: meta.map((m) => ({ lat: m.lat, lng: m.lng })) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Route calculation failed");
      setResult(data);
      setStops(meta);
    } catch (err) {
      setCalcError(err instanceof Error ? err.message : "Route calculation failed");
    } finally {
      setCalculating(false);
    }
  }

  const orderedStops = result ? result.order.map((i) => stops[i]) : [];

  // --- Leaflet map (loaded dynamically -- touches window/document) ---
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const layerGroupRef = useRef<import("leaflet").LayerGroup | null>(null);

  // The map <div> only exists once `result` is set (see the conditionally
  // rendered result section below) -- depend on that transition so this
  // effect actually retries once the ref has something to attach to,
  // instead of running once at mount (when the ref is still null) and
  // never again.
  const hasResult = result !== null;
  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !mapContainerRef.current || mapRef.current) return;
      const map = L.map(mapContainerRef.current).setView([13.7563, 100.5018], 12); // Bangkok
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);
      mapRef.current = map;
      layerGroupRef.current = L.layerGroup().addTo(map);
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [hasResult]);

  useEffect(() => {
    if (!mapRef.current || !layerGroupRef.current) return;
    import("leaflet").then((L) => {
      const layerGroup = layerGroupRef.current;
      const map = mapRef.current;
      if (!layerGroup || !map) return;
      layerGroup.clearLayers();
      if (orderedStops.length === 0) return;

      const bounds: [number, number][] = [];
      orderedStops.forEach((s, i) => {
        const marker = L.marker([s.lat, s.lng], {
          icon: L.divIcon({
            className: "",
            html: `<div style="background:#2563eb;color:white;border-radius:9999px;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.4)">${i + 1}</div>`,
            iconSize: [26, 26],
            iconAnchor: [13, 13],
          }),
        }).bindPopup(`${i + 1}. ${s.label}`);
        marker.addTo(layerGroup);
        bounds.push([s.lat, s.lng]);
      });

      if (result?.geometry?.coordinates) {
        const latlngs = result.geometry.coordinates.map(
          ([lng, lat]) => [lat, lng] as [number, number]
        );
        L.polyline(latlngs, { color: "#2563eb", weight: 4, opacity: 0.7 }).addTo(layerGroup);
      }

      if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [30, 30] });
      }
    });
  }, [orderedStops, result]);

  return (
    <main className="min-h-screen p-4 sm:p-6 max-w-4xl mx-auto flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold">🚌 送迎バス ルート最適化テスト</h1>
        <p className="text-xs text-gray-400">
          Bus route optimization prototype — mock data only, nothing here is saved to the real
          student roster
        </p>
      </div>

      {/* Section 1: branch coordinates */}
      <section className="border rounded-xl p-4 flex flex-col gap-3">
        <h2 className="font-semibold text-sm text-gray-700">
          支店の住所 / Branch addresses
          <span className="block text-xs font-normal text-gray-400">
            Resolved once, reused across test runs
          </span>
        </h2>
        {(["プロンポン", "トンロー"] as Branch[]).map((branch) => (
          <div key={branch} className="flex flex-col gap-1">
            <label className="text-sm font-semibold">{branch}</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={branchInputs[branch]}
                onChange={(e) =>
                  setBranchInputs((prev) => ({ ...prev, [branch]: e.target.value }))
                }
                placeholder="住所 / Google Maps link / GPS座標"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              <button
                onClick={() => handleLookupBranch(branch)}
                disabled={branchLookingUp === branch || !branchInputs[branch].trim()}
                className="rounded-full bg-blue-600 text-white px-4 py-2 text-sm font-semibold disabled:opacity-40 shrink-0"
              >
                {branchLookingUp === branch ? "検索中... / Looking up..." : "検索 / Look up"}
              </button>
            </div>
            {branchResolved[branch] && (
              <>
                <p className="text-xs text-green-700">
                  ✓ {branchResolved[branch]!.displayName} ({branchResolved[branch]!.lat.toFixed(5)},{" "}
                  {branchResolved[branch]!.lng.toFixed(5)})
                </p>
                <iframe
                  key={`${branchResolved[branch]!.lat},${branchResolved[branch]!.lng}`}
                  src={osmEmbedUrl(branchResolved[branch]!.lat, branchResolved[branch]!.lng)}
                  className="w-full h-48 rounded-lg border"
                  title={`${branch} map preview`}
                />
              </>
            )}
            {branchError[branch] && <p className="text-xs text-red-600">{branchError[branch]}</p>}
          </div>
        ))}
      </section>

      {/* Section 2: mock children */}
      <section className="border rounded-xl p-4 flex flex-col gap-3">
        <h2 className="font-semibold text-sm text-gray-700">
          テスト用の子ども / Mock children
          <span className="block text-xs font-normal text-gray-400">
            {children.length} 人 / {children.length} added
          </span>
        </h2>
        {children.length > 0 && (
          <div className="flex flex-col gap-2">
            {children.map((c) => (
              <div key={c.id} className="border rounded-lg px-3 py-2 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{c.name}</p>
                    <p className="text-xs text-gray-500">{c.resolved?.displayName}</p>
                  </div>
                  <button
                    onClick={() => removeChild(c.id)}
                    className="text-xs text-red-600 border border-red-300 rounded-full px-3 py-1 shrink-0"
                  >
                    削除 / Remove
                  </button>
                </div>
                {c.resolved && (
                  <iframe
                    key={`${c.resolved.lat},${c.resolved.lng}`}
                    src={osmEmbedUrl(c.resolved.lat, c.resolved.lng)}
                    className="w-full h-40 rounded-lg border"
                    title={`${c.name} map preview`}
                  />
                )}
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={newChildName}
            onChange={(e) => setNewChildName(e.target.value)}
            placeholder="名前 / Name"
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm sm:w-40"
          />
          <input
            type="text"
            value={newChildAddress}
            onChange={(e) => setNewChildAddress(e.target.value)}
            placeholder="住所 / Google Maps link / GPS座標"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <button
            onClick={handleAddChild}
            disabled={addingChild || !newChildName.trim() || !newChildAddress.trim()}
            className="rounded-full bg-green-600 text-white px-4 py-2 text-sm font-semibold disabled:opacity-40 shrink-0"
          >
            {addingChild ? "検索中... / Looking up..." : "＋ 追加 / Add"}
          </button>
        </div>
        {addChildError && <p className="text-xs text-red-600">{addChildError}</p>}
      </section>

      {/* Section 3: route settings */}
      <section className="border rounded-xl p-4 flex flex-col gap-3">
        <h2 className="font-semibold text-sm text-gray-700">ルート設定 / Route settings</h2>
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1 text-sm">
            出発 / Start
            <select
              value={startBranch}
              onChange={(e) => setStartBranch(e.target.value as Branch)}
              className="border border-gray-300 rounded-lg px-3 py-2"
            >
              <option value="プロンポン">プロンポン</option>
              <option value="トンロー">トンロー</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            到着 / End
            <select
              value={endBranch}
              onChange={(e) => setEndBranch(e.target.value as Branch)}
              className="border border-gray-300 rounded-lg px-3 py-2"
            >
              <option value="プロンポン">プロンポン</option>
              <option value="トンロー">トンロー</option>
            </select>
          </label>
        </div>
        <label
          className={`flex items-center gap-2 text-sm ${canStop ? "" : "opacity-40"}`}
        >
          <input
            type="checkbox"
            checked={stopAtOtherBranch && canStop}
            disabled={!canStop}
            onChange={(e) => setStopAtOtherBranch(e.target.checked)}
          />
          途中でもう片方の支店に立ち寄る / Stop by the other branch along the way
          {!canStop && (
            <span className="text-xs text-gray-400">
              (出発と到着がすでに違う支店です / Start and end are already different branches)
            </span>
          )}
        </label>
        <button
          onClick={handleCalculate}
          disabled={!canCalculate || calculating}
          className="self-start rounded-full bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 font-semibold disabled:opacity-40"
        >
          {calculating ? "計算中... / Calculating..." : "ルートを計算する / Calculate route"}
        </button>
        {calcError && <p className="text-sm text-red-600">{calcError}</p>}
      </section>

      {/* Section 4: result */}
      {result && (
        <section className="border rounded-xl p-4 flex flex-col gap-3">
          <h2 className="font-semibold text-sm text-gray-700">
            結果 / Result
            <span className="block text-xs font-normal text-gray-400">
              合計 {fmtKm(result.totalDistance)} ・ {fmtMin(result.totalDuration)} / Total{" "}
              {fmtKm(result.totalDistance)} · {fmtMin(result.totalDuration)}
            </span>
          </h2>
          <ol className="flex flex-col gap-1">
            {orderedStops.map((s, i) => (
              <li key={i} className="text-sm flex items-center gap-2">
                <span className="rounded-full bg-blue-600 text-white w-5 h-5 flex items-center justify-center text-xs font-bold shrink-0">
                  {i + 1}
                </span>
                {s.label}
                {i < result.legs.length && (
                  <span className="text-xs text-gray-400">
                    → {fmtKm(result.legs[i].distance)} / {fmtMin(result.legs[i].duration)}
                  </span>
                )}
              </li>
            ))}
          </ol>
          <div ref={mapContainerRef} className="w-full h-96 rounded-lg border" />
        </section>
      )}
    </main>
  );
}
