// Word, sentence and character counting shared by the Word counter and Character counter.
import { normalizeNewlines } from "./textcore.js?v=11";
import { tx, EN, LANG } from "./i18n.js?v=11";

export const STOP = new Set(("a about above after again against all also am an and any are aren't as at be because been before being below between both but by can could did do does doing don't down during each few for from further had has have having he her here hers him his how i if in into is isn't it its just me more most my no nor not of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up us very was we were what when where which while who whom why will with would you your").split(" "));

/* Common function words for the "Skip common words" filter on localized pages (used together with the English list). */
const STOP_BY_LANG = {
  es: "a al algo algunas algunos ante antes aquel aquella aquellas aquello aquellos aquí así aun aunque bajo bien cada como con contra cual cuando de del desde donde dos durante e el ella ellas ello ellos en entre era eran eres es esa esas ese eso esos esta están estaba estado estar este esto estos fue fueron ha había han hasta hay la las le les lo los me mi mis mucho muy más mí ni no nos nosotros nuestra nuestro o otra otro otros para pero poco por porque que quien quienes qué se sea según ser si sido sin sobre sois somos son soy su sus también tan tanto te tengo ti tiene tienen todo todos tu tus tú un una unas uno unos usted ustedes va vamos van y ya yo él éste",
  pt: "a ao aos aquela aquele aquilo as até com como da das de dela dele deles depois do dos e é ela elas ele eles em entre era eram essa esse esta está estão estar este estava eu foi foram há isso isto já lhe lhes mais mas me mesmo meu meus minha minhas muito na nas nem no nos nós nossa nosso não o os ou para pela pelas pelo pelos por qual quando que quem se sem ser seu seus são só sua suas também te tem têm tinha tu tua um uma umas uns você vocês vos à às",
  fr: "à au aux avec ce ceci cela celle celles celui ces cet cette ceux chaque comme dans de des donc dont du elle elles en encore entre est et étaient était été être eu il ils je la le les leur leurs lui ma mais me même mes moi mon ne ni nos notre nous on ont ou où par pas pour qu que quel quelle qui sa sans se ses si son sont sur ta te tes toi ton tu un une vos votre vous y c'est j'ai n'est qu'il qu'elle qu'on d'un d'une l'on a ai as avait avez avons ça fait plus aussi bien tout tous très",
  de: "aber alle allem allen aller alles als also am an ander andere anderen auch auf aus bei bin bis bist da damit dann das dass daß dein deine dem den der des dich die dies diese diesem diesen dieser dieses doch dort du durch ein eine einem einen einer eines er es euch euer eure für gegen gewesen hab habe haben hat hatte hatten hier hin hinter ich ihm ihn ihnen ihr ihre im in indem ist jede jedem jeden jeder jedes jetzt kann kein keine man mehr mein meine mich mir mit muss nach nicht nichts noch nun nur ob oder ohne sehr sein seine sich sie sind so solche soll sollte sondern sonst über um und uns unser unter vom von vor war waren warst was weil weiter wenn wer werde werden wie wieder wir wird wirst wo wollen worden wurde wurden zu zum zur zwar zwischen",
  id: "ada adalah adanya agar akan aku anda antara apa apakah atau atas bagi bahwa banyak beberapa belum benar berbagai bisa buat bukan dalam dan dapat dari dengan di dia dirinya disini dua guna hanya harus hingga ia ini itu jadi jika juga kami kamu karena kata ke kepada kita lagi lain lalu lebih maka mereka merupakan mungkin nya oleh pada para pernah pun saat saja sama sampai sangat saya sebagai sebuah sedang sejak sekarang sekitar selain selalu semua serta setelah suatu sudah tanpa tapi tetapi tentang tersebut tiap tidak untuk telah yaitu yakni yang",
};
const stopFor = (lang) => {
  const base = lang.split("-")[0];
  const extra = STOP_BY_LANG[base];
  if (!extra) return STOP;
  const set = new Set(STOP);
  for (const w of extra.split(" ")) { set.add(w); set.add(w.replace(/'/g, "\u2019")); }
  return set;
};
const STOP_PAGE = EN ? STOP : stopFor(LANG);

/* Scripts written without spaces between words need the Intl.Segmenter (or a per-character fallback). */
const UNSPACED = /[฀-໿က-႟ក-៿぀-ヿ㐀-䶿一-鿿豈-﫿\u{20000}-\u{2FA1F}]/u;
const WORD_RE = /[\p{L}\p{N}\p{M}]+(?:(?:['’-][\p{L}\p{N}\p{M}]+)|(?:(?<=\p{N})[.,](?=\p{N})\p{N}+))*/gu;
const segmenter = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: "word" }) : null;

export function getWords(text) {
  if (!UNSPACED.test(text)) return text.match(WORD_RE) || [];
  const words = [];
  if (segmenter) {
    let prevEnd = -1, joinNext = false;
    for (const s of segmenter.segment(text)) {
      if (s.isWordLike) {
        if (joinNext && s.index === prevEnd && words.length) words[words.length - 1] += "-" + s.segment;
        else words.push(s.segment);
        joinNext = false;
        prevEnd = s.index + s.segment.length;
      } else if (s.segment === "-" && s.index === prevEnd && /[A-Za-z0-9]$/.test(words[words.length - 1] || "")) {
        joinNext = true; prevEnd = s.index + 1;
      } else joinNext = false;
    }
    return words;
  }
  // Fallback: each CJK/Thai character counts as a word, other runs by regex.
  for (const m of text.matchAll(/[\p{L}\p{N}\p{M}]+/gu)) {
    const run = m[0];
    if (UNSPACED.test(run)) for (const ch of run) words.push(ch);
    else words.push(...(run.match(WORD_RE) || []));
  }
  return words;
}

const SENT_END = /(?:[.!?…]+["'”’)\]]*(?=\s|$)|[。！？]+[」』）"]*)/gu;
export function countSentences(text) {
  let n = 0, last = 0;
  SENT_END.lastIndex = 0;
  let m;
  while ((m = SENT_END.exec(text)) !== null) {
    if (/[\p{L}\p{N}]/u.test(text.slice(last, m.index))) n++;
    last = m.index + m[0].length;
  }
  if (/[\p{L}\p{N}]/u.test(text.slice(last))) n++;
  return n;
}

export function countParagraphs(text) {
  let n = 0;
  for (const block of text.split(/\n[ \t]*\n/)) if (/\S/.test(block)) n++;
  return n;
}

export function countLines(text) {
  if (!text) return 0;
  const n = text.split("\n").length;
  return text.endsWith("\n") ? n - 1 : n;
}

const surrogates = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;
export const cpLength = (s) => s.length - (s.match(surrogates) || []).length;

export function syllables(word) {
  let w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 1;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|[^laeiouytd]ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const g = w.match(/[aeiouy]{1,2}/g);
  return Math.max(1, g ? g.length : 1);
}

export function fmtTime(seconds) {
  const s = Math.round(seconds);
  if (s < 60) return tx("{s}s", { s });
  const m = Math.floor(s / 60);
  return tx("{m}m {s}s", { m, s: s % 60 });
}

export function analyse(raw) {
  const text = normalizeNewlines(raw);
  const words = getWords(text);
  const nWords = words.length;
  const letters = words.reduce((n, w) => n + cpLength(w.replace(/[-'’.,]/g, "")), 0);
  return {
    text, words,
    nWords,
    chars: cpLength(text),
    charsNoSpace: cpLength(text.replace(/\s/g, "")),
    sentences: countSentences(text),
    paragraphs: countParagraphs(text),
    lines: countLines(text),
    avg: nWords ? letters / nWords : 0,
  };
}

export function readability(a) {
  const englishy = a.words.filter((w) => /^[A-Za-z'’-]+$/.test(w)).length / (a.nWords || 1);
  if (a.nWords < 100 || englishy < 0.85 || !a.sentences) return null;
  let syl = 0;
  for (const w of a.words) syl += syllables(w);
  const wps = a.nWords / a.sentences, spw = syl / a.nWords;
  return { ease: 206.835 - 1.015 * wps - 84.6 * spw, grade: 0.39 * wps + 11.8 * spw - 15.59 };
}

export function easeLabel(e) {
  if (e >= 90) return tx("very easy");
  if (e >= 70) return tx("easy");
  if (e >= 60) return tx("plain English");
  if (e >= 50) return tx("fairly difficult");
  if (e >= 30) return tx("difficult");
  return tx("very difficult");
}

export function density(words, n, skipStop) {
  const lower = words.map((w) => w.toLocaleLowerCase());
  const counts = new Map();
  const total = Math.max(0, lower.length - n + 1);
  for (let i = 0; i < total; i++) {
    if (skipStop && (STOP_PAGE.has(lower[i]) || STOP_PAGE.has(lower[i + n - 1]))) continue;
    const key = n === 1 ? lower[i] : lower.slice(i, i + n).join(" ");
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let rows = Array.from(counts, ([k, c]) => [k, c]);
  if (n > 1) rows = rows.filter((r) => r[1] > 1);
  rows.sort((x, y) => y[1] - x[1]);
  return { rows: rows.slice(0, 10), total };
}

