// Text -> sign sequence for the text/speech -> sign direction.
//
// Honest limitation (decisions.md #1/#4): this maps words to signs in the speaker's word order
// ("signed English"), not real ISL grammar. Unknown words are kept as text tokens — no fingerspelling,
// because the person watching may not read. Covers English plus common Hindi/Indian-English words.

export type GlossToken = { kind: "sign"; id: string; word: string } | { kind: "text"; word: string };

// Multi-word phrases first (longest match wins), then single words. Values are sign ids.
const PHRASES: Record<string, string> = {
  "thank you": "thank_you",
  "thanks a lot": "thank_you",
  "how are you": "how_are_you",
  "how r u": "how_are_you",
  "kaise ho": "how_are_you",
  "kaisa hai": "how_are_you",
  "good morning": "good_morning",
  "good night": "good_night",
  "shubh ratri": "good_night",
};

const WORDS: Record<string, string> = {
  hello: "hello", hi: "hello", hey: "hello", namaste: "hello", namaskar: "hello", vanakkam: "hello",
  thanks: "thank_you", thankyou: "thank_you", dhanyavad: "thank_you", shukriya: "thank_you",
  mother: "mother", mom: "mother", mummy: "mother", mum: "mother", maa: "mother", amma: "mother", ammi: "mother", mata: "mother",
  father: "father", dad: "father", daddy: "father", papa: "father", appa: "father", pita: "father", abba: "father",
  brother: "brother", bro: "brother", bhai: "brother", bhaiya: "brother", anna: "brother",
  sister: "sister", sis: "sister", didi: "sister", behen: "sister", akka: "sister",
  grandmother: "grandmother", grandma: "grandmother", granny: "grandmother", nani: "grandmother", dadi: "grandmother", paati: "grandmother",
  grandfather: "grandfather", grandpa: "grandfather", nana: "grandfather", dada: "grandfather", thatha: "grandfather",
  friend: "friend", friends: "friend", dost: "friend", yaar: "friend",
  baby: "baby", child: "baby", bachcha: "baby", kid: "baby",
  family: "family", parivar: "family",
  i: "i", me: "i", my: "i", mine: "i", myself: "i", main: "i", mera: "i", meri: "i",
  you: "you", your: "you", yours: "you", u: "you", tum: "you", aap: "you", tu: "you", tera: "you", tumhara: "you",
  sick: "sick", ill: "sick", unwell: "sick", fever: "sick", bimar: "sick", beemar: "sick",
  healthy: "healthy", fit: "healthy", well: "healthy",
  doctor: "doctor", dr: "doctor", daktar: "doctor",
  hospital: "hospital", clinic: "hospital", aspatal: "hospital",
  medicine: "medicine", medicines: "medicine", tablet: "medicine", tablets: "medicine", dawai: "medicine", dava: "medicine",
  hot: "hot", garam: "hot", warm: "hot",
  cold: "cold", thanda: "cold", thandi: "cold",
  good: "good", fine: "good", ok: "good", okay: "good", nice: "good", great: "good", accha: "good", achha: "good", theek: "good",
  bad: "bad", bura: "bad", kharab: "bad",
  happy: "happy", khush: "happy", glad: "happy",
  sad: "sad", dukhi: "sad", upset: "sad",
  home: "house", house: "house", ghar: "house",
  school: "school", college: "school",
  shop: "shop", store: "shop", market: "shop", dukaan: "shop", dukan: "shop", bazaar: "shop",
  bathroom: "bathroom", toilet: "bathroom", washroom: "bathroom", restroom: "bathroom",
  bed: "bed", sleep: "bed", sleeping: "bed", sona: "bed",
  phone: "telephone", telephone: "telephone", mobile: "telephone", call: "telephone",
  money: "money", paisa: "money", paise: "money", rupees: "money", cash: "money",
  today: "today", aaj: "today",
  tomorrow: "tomorrow",
  yesterday: "yesterday",
  morning: "morning", subah: "morning",
  night: "night", raat: "night", tonight: "night",
};

// Function words that carry no sign of their own in this vocabulary.
const SKIP = new Set([
  "a", "an", "the", "is", "am", "are", "was", "were", "be", "to", "of", "and", "or", "so", "do", "did", "does",
  "it", "this", "that", "will", "can", "please", "just", "very", "really", "also", "at", "in", "on", "for",
  "with", "have", "has", "had", "ji", "hai", "hain", "ho", "ka", "ki", "ke", "ko", "se", "bhi", "na",
]);

export function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Convert text to a sequence of sign clips and leftover words, in reading order. */
export function textToGloss(text: string, known?: Set<string>): GlossToken[] {
  const words = normalize(text);
  const out: GlossToken[] = [];
  const has = (id: string) => !known || known.has(id);
  const maxPhrase = Math.max(...Object.keys(PHRASES).map((p) => p.split(" ").length));

  for (let i = 0; i < words.length; ) {
    let matched = false;
    for (let n = Math.min(maxPhrase, words.length - i); n >= 2; n--) {
      const phrase = words.slice(i, i + n).join(" ");
      const id = PHRASES[phrase];
      if (id && has(id)) {
        out.push({ kind: "sign", id, word: phrase });
        i += n;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    const word = words[i++];
    const id = WORDS[word];
    if (id && has(id)) {
      // Don't repeat the same sign back-to-back ("my mom, mom!" -> one MOTHER).
      const prev = out[out.length - 1];
      if (!(prev?.kind === "sign" && prev.id === id)) out.push({ kind: "sign", id, word });
    } else if (!SKIP.has(word)) {
      out.push({ kind: "text", word });
    }
  }
  return out;
}
