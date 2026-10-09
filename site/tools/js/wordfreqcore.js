// Word and phrase frequency. Pure functions (no DOM, no UI strings).

/* Stop words for the twelve site languages (function words that carry little meaning: articles, pronouns, prepositions, conjunctions,
   common auxiliaries). Lowercase; the lists are matched against lowercased words. */
export const STOP = {
  en: "a about above after again all also am an and any are aren't as at be because been before being below between both but by can can't could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't have haven't having he he'd he'll he's her here hers herself him himself his how i i'd i'll i'm i've if in into is isn't it it's its itself just let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves then there there's these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd we'll we're we've were weren't what what's when when's where where's which while who who's whom why why's will with won't would wouldn't you you'd you'll you're you've your yours yourself yourselves",
  es: "a al algo algunas algunos ante antes como con contra cual cuando de del desde donde durante e el ella ellas ellos en entre era erais eran eras eres es esa esas ese eso esos esta estaba estado estamos estan estar este esto estos estoy fue fueron fui ha había han has hasta hay la las le les lo los me mi mis mucho muy más mí ni no nos nosotros nuestra nuestro o os otra otro para pero poco por porque que quien quienes qué se sea sean ser si sido sin sobre sois somos son soy su sus también tanto te tengo ti tiene tienen todo todos tu tus tú un una uno unos vosotros y ya yo él",
  fr: "à au aux avec ce ces cet cette ceux chez comme dans de des du elle elles en et étaient était été être eu il ils je j' la le les leur leurs lui ma mais me même mes moi mon ne ni nos notre nous on ou où par pas pour qu que quel quelle qui sa sans se ses si son sur ta te tes toi ton tu un une vos votre vous y d l m n s t c qu' j' l' d' n' s' c' m' t' est sont suis es sommes êtes ai as avons avez ont avait avaient fait plus aussi donc car très tout tous toute toutes",
  de: "aber alle allem allen aller alles als also am an ander andere anderen auch auf aus bei bin bis bist da damit dann das dass daß dein deine dem den der des dich die dies diese diesem diesen dieser dieses dir doch dort du durch ein eine einem einen einer eines er es euch euer eure für gegen gewesen hab habe haben hat hatte hatten hier hin hinter ich ihm ihn ihnen ihr ihre im in indem ins ist jede jedem jeden jeder jedes jetzt kann kein keine man mehr mein meine mich mir mit muss nach nicht noch nun nur ob oder ohne sehr sein seine sich sie sind so solche sollte sondern sonst um und uns unser unter vom von vor war waren warst was weil weiter wenn wer werden wie wieder will wir wird wirst wo wollen zu zum zur zwar zwischen über",
  "pt-BR": "a ao aos aquela aquele aqui as até com como da das de dela dele deles depois do dos e ela elas ele eles em entre era essa esse esta este eu foi for há isso isto já lhe mais mas me mesmo meu minha muito na nas nem no nos nós o os ou para pela pelas pelo pelos por qual quando que quem se seu seus só sua suas também te tem tinha um uma você vocês à é são",
  it: "a ad al alla alle allo anche avere ben che chi ci come con contro cui da dal dalla dalle dei del della delle dello di dove e ed era essere fra gli ha hai hanno ho i il in io la le lei lo loro lui ma me mi mia mio ne nei nel nella nelle non noi nostro o per perché più qua quale quando quello questa questo qui se sei si sia siamo sono su sua sue sul sulla suo tra tu tua tuo tutti tutto un una uno vi voi è",
  id: "ada adalah adanya agar akan aku anda apa atau bagi bahwa banyak beberapa belum benar bisa buat dalam dan dari dapat dengan di dia dia-lah dua ini itu jadi jika juga kami kamu karena ke kepada kita lagi lain lebih lalu mereka mau masih namun oleh pada para pernah saat saja sangat sebagai sebuah sedang sekali setelah seperti sini suatu sudah tanpa telah tentang tersebut tetapi tidak untuk yang",
  tr: "acaba ama ancak artık aslında az bana bazı belki ben beni benim bir biri birkaç birçok biz bizi bizim bu buna bunu bunun da daha de değil diye en fakat gibi hem hep hepsi her hiç ise için ile ise kadar kendi ki kim mi mı mu mü ne neden nerede ne zaman niçin o olarak olan olduğu oldu olmak ona onu onun onlar ve veya ya yani yine çok çünkü şey şu şunu",
  vi: "à ai anh ba bạn bị bởi cả các cái cần càng cho chỉ chưa có còn của cùng cũng da đã đang đây để đến đều đó được em gì hay hoặc khi không là lại lên lúc mà mỗi một nên này nếu ngay nhiều như nhưng những nơi phải qua ra rằng rất rồi sau sẽ so sự tại theo thì trên trước từ và vẫn vào vì với vừa",
  ru: "а будет бы был была были было быть в вам вас весь во вот все всё всего вы где да даже для до его ее её если есть ещё же за здесь и из или им их к как ко когда кто ли либо мне может мы на над надо наш не него нет ни них но ну о об однако он она они оно от очень по под при про с со так также такой там те тем то того тоже той только том ты у уже хотя чего чей чем что чтобы чье чья эта эти это я",
  pl: "a aby ale am są bardzo bez był była było były być co czy dla do gdy go i ich ja jak jako je jego jej jest już każdy kiedy która które który lub ma mi mnie mogą może my na nad nam nas nasz nie nich nim niż o od on ona oni ono po pod przed przez przy się są ta tak także tam te tego tej ten to tu ty tylko u w we wiele wszystko z za ze że",
  hi: "अत अपना अपनी अपने अभी आप इन इनका इन्हें इन्हों इस इसका इसकी इसके इसमें इसी इसे उन उनका उनकी उनके उनको उन्हें उस उसके उसी उसे एक एवं और कई कर करता करते करना करने करें कहते कहा का काफ़ी किन किया किर किस किसी की कुछ कुल के को कोई कौन कौनसा गया घर जब जहाँ जा जितना जिन जिस जैसा जैसे जो तक तब तरह तो था थी थे दिया दो दूसरे नहीं ने पर पहले पूरा फिर बहुत बाद बिलकुल भी भीतर मगर में यदि यह यहाँ यही या ये रहा रहे लिए लिये लेकिन व वह वहाँ वहीं वाले वे वो सकता सकते सबसे सभी साथ सारा से सो संग ही हुआ हुई हुए है हैं हो होता होती होते होना होने",
};
const SETS = {};
for (const [k, v] of Object.entries(STOP)) SETS[k] = new Set(v.split(/\s+/).filter(Boolean));
export const STOP_LANGS = Object.keys(STOP);

const RE_WORD = /[\p{L}\p{M}\p{N}]+(?:['’\-][\p{L}\p{M}\p{N}]+)*/gu;
/* sentence and line ends: phrases do not run across them */
const RE_BREAK = /[.!?…;:\n\r।॥。！？]+|\s[-–—]+\s/u;

const norm = (w) => w.replace(/’/g, "'");

/* Split into words. Returns an array of chunks (arrays of words) so phrases stay inside a sentence. caseSensitive false lowercases. */
export function tokenize(text, { lower = true } = {}) {
  const chunks = [];
  for (const part of text.split(RE_BREAK)) {
    if (!part) continue;
    const words = (part.match(RE_WORD) || []).map((w) => norm(lower ? w.toLocaleLowerCase() : w));
    if (words.length) chunks.push(words);
  }
  return chunks;
}

export function isStop(word, lang) {
  const set = SETS[lang];
  return !!set && set.has(word.toLowerCase());
}

/* Frequencies. opts: lang (stop-word list code or "" for none), n (1, 2 or 3 words), numbers (false drops number-only words),
   minLen (shortest word kept), lower (true).
   Words that are stop words are dropped for n = 1; for phrases a phrase is dropped when it starts or ends with a stop word.
   Returns { rows: [{ phrase, count, pct }] sorted by count desc then A-Z, total (words or phrases counted), unique, words (all words in the text) }. */
export function frequencies(text, { lang = "", n = 1, numbers = true, minLen = 1, lower = true } = {}) {
  const chunks = tokenize(text, { lower });
  let words = 0;
  const counts = new Map();
  let total = 0;
  const numOk = (w) => numbers || !/^[\p{N}\-'.,]+$/u.test(w);
  for (const chunk of chunks) {
    words += chunk.length;
    for (let i = 0; i + n <= chunk.length; i++) {
      const gram = chunk.slice(i, i + n);
      if (!gram.every(numOk)) continue;
      if (n === 1) { if (Array.from(gram[0]).length < minLen || (lang && isStop(gram[0], lang))) continue; }
      else if (lang && (isStop(gram[0], lang) || isStop(gram[n - 1], lang))) continue;
      const key = gram.join(" ");
      counts.set(key, (counts.get(key) || 0) + 1);
      total++;
    }
  }
  const rows = [...counts].map(([phrase, count]) => ({ phrase, count, pct: total ? (count / total) * 100 : 0 }))
    .sort((a, b) => b.count - a.count || (a.phrase < b.phrase ? -1 : a.phrase > b.phrase ? 1 : 0));
  return { rows, total, unique: rows.length, words };
}

/* CSV: rank,phrase,count,percent (percent with two decimals, dot). */
export function frequencyCsv(rows) {
  const q = (s) => (/[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
  return ["rank,word,count,percent", ...rows.map((r, i) => `${i + 1},${q(r.phrase)},${r.count},${r.pct.toFixed(2)}`)].join("\r\n") + "\r\n";
}
