import Link from "next/link";
import { Bi } from "@/components/Bilingual";

// 送迎管理 lives directly on the top page (used often enough to deserve its
// own buttons there). This menu is for less-frequent admin tools — more
// will likely be added here over time.
const ADMIN_LINKS: { href: string; icon: string; ja: string; en: string }[] = [
  {
    href: "/dashboard/calendar-master",
    icon: "📅",
    ja: "祝日カレンダー",
    en: "Master Holiday Calendar",
  },
  {
    href: "/dashboard/admin-menu/absence-reasons",
    icon: "📋",
    ja: "欠席理由設定",
    en: "Absence Reason Settings",
  },
  {
    href: "/dashboard/admin-menu/class-management",
    icon: "🏫",
    ja: "クラス管理",
    en: "Class Management & Colors",
  },
  {
    href: "/dashboard/admin-menu/buses",
    icon: "🚌",
    ja: "バス管理",
    en: "Bus Management",
  },
  {
    href: "/dashboard/admin-menu/teachers",
    icon: "👩‍🏫",
    ja: "先生登録",
    en: "Teacher Registration",
  },
];

export default function AdminMenuPage() {
  return (
    <main className="min-h-screen p-4 sm:p-6 flex flex-col gap-4 max-w-md mx-auto w-full">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold">
          <Bi ja="管理メニュー" en="Management Menu" enClassName="block text-sm font-normal text-gray-400" />
        </h1>
        <Link
          href="/select-class"
          className="rounded-full bg-gray-100 text-gray-600 w-9 h-9 flex items-center justify-center shrink-0"
          aria-label="トップページ / Home"
        >
          🏠
        </Link>
      </div>

      <div className="flex flex-col gap-3 w-full">
        {ADMIN_LINKS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-xl border border-gray-300 px-6 py-4 text-lg font-semibold hover:bg-gray-100 active:scale-95 transition text-center"
          >
            <span className="block">
              {item.icon} {item.ja}
            </span>
            <span className="block text-xs font-normal opacity-70">{item.en}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
