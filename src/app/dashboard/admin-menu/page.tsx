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
];

export default function AdminMenuPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-3 p-4">
      <div className="w-full max-w-md flex items-center justify-between">
        <Link
          href="/select-class"
          className="rounded-full bg-gray-100 text-gray-600 px-4 py-2.5 text-sm font-semibold"
        >
          ← 戻る
          <span className="block text-[10px] font-normal opacity-70">Back</span>
        </Link>
      </div>

      <h1 className="text-xl font-bold text-center">
        <Bi
          ja="管理メニュー"
          en="Management Menu"
          enClassName="block text-sm font-normal text-gray-500 mt-1"
        />
      </h1>

      <div className="flex flex-col gap-3 w-full max-w-md">
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
