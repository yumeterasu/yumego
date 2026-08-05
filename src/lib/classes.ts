export const CLASSES = [
  "プロンポン　年長",
  "プロンポン　年中",
  "プロンポン　年少",
  "トンロー　年長",
  "トンロー　年中",
  "トンロー　年少",
] as const;

export type ClassName = (typeof CLASSES)[number];

export const SELECTED_CLASS_KEY = "yumego.selectedClass";
