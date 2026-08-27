/**
 * Best-effort romaji -> hiragana transliteration, used to pre-fill a
 * student's Hiragana name from whatever Romaji was typed at registration.
 * Deliberately not perfect -- Japanese readings are genuinely ambiguous
 * from romaji alone (e.g. long vowels, name-specific kanji readings) -- the
 * result is meant as a starting point the operator reviews/fixes via the
 * name-edit screen, not an authoritative reading.
 */

// Longest-match-first table: 3-letter youon combos, then 2-letter, then
// 1-letter. Includes common alternate romanizations (si/shi, ti/chi, etc.)
// since names get typed inconsistently.
const ROMAJI_TABLE: Record<string, string> = {
  // youon (3-letter)
  kya: "きゃ", kyu: "きゅ", kyo: "きょ",
  gya: "ぎゃ", gyu: "ぎゅ", gyo: "ぎょ",
  sha: "しゃ", shu: "しゅ", sho: "しょ",
  sya: "しゃ", syu: "しゅ", syo: "しょ",
  ja: "じゃ", ju: "じゅ", jo: "じょ", // also 2-letter, kept here harmlessly
  jya: "じゃ", jyu: "じゅ", jyo: "じょ",
  zya: "じゃ", zyu: "じゅ", zyo: "じょ",
  cha: "ちゃ", chu: "ちゅ", cho: "ちょ",
  tya: "ちゃ", tyu: "ちゅ", tyo: "ちょ",
  nya: "にゃ", nyu: "にゅ", nyo: "にょ",
  hya: "ひゃ", hyu: "ひゅ", hyo: "ひょ",
  bya: "びゃ", byu: "びゅ", byo: "びょ",
  pya: "ぴゃ", pyu: "ぴゅ", pyo: "ぴょ",
  mya: "みゃ", myu: "みゅ", myo: "みょ",
  rya: "りゃ", ryu: "りゅ", ryo: "りょ",
  dya: "ぢゃ", dyu: "ぢゅ", dyo: "ぢょ",

  // 2-letter
  ka: "か", ki: "き", ku: "く", ke: "け", ko: "こ",
  ga: "が", gi: "ぎ", gu: "ぐ", ge: "げ", go: "ご",
  sa: "さ", shi: "し", si: "し", su: "す", se: "せ", so: "そ",
  za: "ざ", ji: "じ", zi: "じ", zu: "ず", ze: "ぜ", zo: "ぞ",
  ta: "た", chi: "ち", ti: "ち", tsu: "つ", tu: "つ", te: "て", to: "と",
  da: "だ", di: "ぢ", du: "づ", de: "で", do: "ど",
  na: "な", ni: "に", nu: "ぬ", ne: "ね", no: "の",
  ha: "は", hi: "ひ", fu: "ふ", hu: "ふ", he: "へ", ho: "ほ",
  ba: "ば", bi: "び", bu: "ぶ", be: "べ", bo: "ぼ",
  pa: "ぱ", pi: "ぴ", pu: "ぷ", pe: "ぺ", po: "ぽ",
  ma: "ま", mi: "み", mu: "む", me: "め", mo: "も",
  ya: "や", yu: "ゆ", yo: "よ",
  ra: "ら", ri: "り", ru: "る", re: "れ", ro: "ろ",
  wa: "わ", wo: "を",

  // 1-letter
  a: "あ", i: "い", u: "う", e: "え", o: "お",
};

const CONSONANTS = new Set("bcdfghjklmpqrstvwxyz".split(""));

function convertWord(word: string): string {
  let result = "";
  let i = 0;
  while (i < word.length) {
    // Sokuon: a doubled consonant (never "n", handled separately below)
    // becomes a small っ and consumes one of the two letters.
    const ch = word[i];
    if (
      ch !== "n" &&
      CONSONANTS.has(ch) &&
      word[i + 1] === ch
    ) {
      result += "っ";
      i += 1;
      continue;
    }

    let matched = false;
    for (const len of [3, 2, 1]) {
      const chunk = word.slice(i, i + len);
      if (chunk.length === len && ROMAJI_TABLE[chunk]) {
        result += ROMAJI_TABLE[chunk];
        i += len;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    if (ch === "n") {
      // Not part of a matched na/ni/nu/ne/no/nya-etc syllable (those were
      // already caught above) -- a bare "n" before a consonant or at the
      // end of a word is the syllabic ん.
      result += "ん";
      i += 1;
      continue;
    }

    // Unrecognized character (digits, punctuation, stray letters) -- pass
    // it through as-is rather than silently dropping it, so a mistake is
    // visible and easy to spot/fix rather than hidden.
    result += ch;
    i += 1;
  }
  return result;
}

/** Converts a Romaji name (spaces preserved between words) to Hiragana. */
export function romajiToHiragana(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  return trimmed
    .toLowerCase()
    // Japanese phonology doesn't distinguish l/r -- names spelled with an
    // "l" (foreign-origin names romanized informally, e.g. "ELINA") are
    // conventionally read with ラ行 all the same.
    .replace(/l/g, "r")
    // "oh" before a consonant is a common way to spell a long o in surnames
    // (Ohta 太田, Ohno 大野, Kohno 河野...) rather than an actual は行 sound
    // -- rewritten to "oo" so it reads as long-o (おお) instead of leaving
    // a stray, un-convertible "h" in the output.
    .replace(/oh(?=[^aeiou\s]|$)/g, "oo")
    .split(/\s+/)
    .map(convertWord)
    .join(" ");
}
