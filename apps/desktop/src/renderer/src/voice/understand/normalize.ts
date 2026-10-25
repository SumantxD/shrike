// Tier 0 (docs/16): any transcript, any script, to canonical Roman tokens in well under a millisecond.
// NFKC, Unicode-safe lowercase, Devanagari to Roman, number words, a Hinglish and world-language lexicon,
// phonetic snapping to the command vocabulary. Tested in understand.test.ts.

const V: Record<string, string> = { अ: "a", आ: "aa", इ: "i", ई: "ee", उ: "u", ऊ: "oo", ऋ: "ri", ए: "e", ऐ: "ai", ओ: "o", औ: "au", ऑ: "o", ऍ: "e" };
const M: Record<string, string> = { "ा": "aa", "ि": "i", "ी": "ee", "ु": "u", "ू": "oo", "ृ": "ri", "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ॉ": "o", "ॅ": "e" };
const CONS = "कखगघङचछजझञटठडढणतथदधनपफबभमयरलवशषसह";
const ROMAN = ["k", "kh", "g", "gh", "n", "ch", "chh", "j", "jh", "n", "t", "th", "d", "dh", "n", "t", "th", "d", "dh", "n", "p", "f", "b", "bh", "m", "y", "r", "l", "v", "sh", "sh", "s", "h"];
const C: Record<string, string> = Object.fromEntries([...CONS].map((c, i) => [c, ROMAN[i]!]));
Object.assign(C, { "क़": "k", "ख़": "kh", "ग़": "g", "ज़": "z", "ड़": "r", "ढ़": "rh", "फ़": "f", "य़": "y" });
const DEVA = /[ऀ-ॿ]/;
const isDeva = (ch: string | undefined): boolean => !!ch && DEVA.test(ch);

/** Devanagari to rough Roman ("पुश करो" -> "push karo", "अगला" -> "aglaa"); other characters pass through. */
export function translit(input: string): string {
  const s = input.normalize("NFC");
  // units: a consonant with its vowel ("" after a virama, "a" inherent), or a bare vowel / other character
  const units: { c: string; v: string; inherent: boolean }[] = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === "\u093c") continue; // nukta
    const base = C[ch];
    if (base !== undefined) {
      let nx = s[i + 1];
      if (nx === "\u093c") nx = s[++i + 1];
      if (nx && M[nx]) (units.push({ c: base, v: M[nx]!, inherent: false }), i++);
      else if (nx === "\u094d") (units.push({ c: base, v: "", inherent: false }), i++);
      else units.push({ c: base, v: isDeva(nx) ? "a" : "", inherent: isDeva(nx) });
      continue;
    }
    units.push({ c: "", v: V[ch] ?? M[ch] ?? (ch === "\u0902" || ch === "\u0901" ? "n" : ch === "\u0903" ? "h" : ch === "\u0964" || ch === "\u0965" ? " " : ch), inherent: false });
  }
  // schwa deletion: a medial inherent "a" between a vowel and a consonant that carries a vowel goes silent (galati -> galti)
  for (let i = 1; i < units.length - 1; i++) {
    const u = units[i]!;
    const prev = units[i - 1]!;
    const next = units[i + 1]!;
    if (u.inherent && /^[a-z]+$/.test(prev.v) && next.c && next.v) u.v = "";
  }
  return units.map((u) => u.c + u.v).join("");
}

/** User-facing text in Roman script (docs/16): Devanagari is transliterated, anything else is unchanged. */
export const roman = (t: string): string => (DEVA.test(t) ? translit(t) : t);

/** Hinglish phonetic key: aspirates collapsed, long vowels shortened, w=v, z=j, trailing schwa dropped. */
export function hkey(w: string): string {
  let s = w.toLowerCase().replace(/chh/g, "c").replace(/ch/g, "c").replace(/sh/g, "s").replace(/([kgjtdpb])h/g, "$1").replace(/ph/g, "f");
  s = s.replace(/aa/g, "a").replace(/ee|ii|ie|ey/g, "i").replace(/oo|uu/g, "u").replace(/w/g, "v").replace(/z/g, "j").replace(/q/g, "k").replace(/ck/g, "k").replace(/c(?![aeiou]|$)/g, "k");
  s = s.replace(/(.)\1+/g, "$1").replace(/y$/, "i");
  return s.length > 3 ? s.replace(/[ae]$/, "") : s;
}

/** English-ish consonant skeleton for near-miss snapping ("kamit" ~ "commit", "state" ~ "stage"). */
export function skel(w: string): string {
  let s = w.toLowerCase();
  if (/^c[aoulr]/.test(s)) s = `k${s.slice(1)}`; // hard c: commit ~ kamit
  for (const [a, b] of [["chh", "c"], ["ch", "c"], ["ph", "f"], ["kh", "k"], ["gh", "g"], ["bh", "b"], ["th", "t"], ["dh", "d"], ["sh", "s"], ["ck", "k"], ["x", "ks"], ["q", "k"], ["w", "v"], ["z", "j"], ["ge", "je"], ["gi", "ji"]] as const) s = s.split(a).join(b);
  s = s[0] === "c" ? `c${s.slice(1).replace(/c/g, "k")}` : s.replace(/c/g, "k");
  s = s ? s[0] + s.slice(1).replace(/[aeiouy]/g, "") : s;
  return s.replace(/(.)\1+/g, "$1");
}

export function lev(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let p = d[0]!;
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j]!;
      d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, p + (a[i - 1] === b[j - 1] ? 0 : 1));
      p = t;
    }
  }
  return d[b.length]!;
}

// ---------- numbers ----------

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
// 1..100 in Roman Hindi, as Devanagari transliterates or people type them.
const HINDI_NUM =
  "ek do teen chaar paanch chhah saat aath nau das gyaarah baarah terah chaudah pandrah solah satrah athaarah unnees bees ikkees baais teis chaubees pachchees chhabbees sattaais atthaais untees tees ikattees battees taintees chauntees paintees chhattees saintees adtees untaalees chaalees iktaalees bayaalees taintaalees chauvaalees paintaalees chhiyaalees saintaalees adtaalees unchaas pachaas ikyaavan baavan tirpan chauvan pachpan chhappan sattaavan atthaavan unsath saath iksath baasath tirsath chausath painsath chhiyaasath sadsath adsath unhattar sattar ikhattar bahattar tihattar chauhattar pachhattar chhihattar sathattar athhattar unaasi assi ikyaasi bayaasi tiraasi chauraasi pachaasi chhiyaasi sattaasi atthaasi navaasi nabbe ikyaanave baanave tiraanave chauraanave pachaanave chhiyaanave sattaanave atthaanave ninyaanave sau".split(" ");
const HNUM = new Map<string, number>();
HINDI_NUM.forEach((w, i) => HNUM.set(hkey(w), i + 1));
for (const [w, n] of [["chhe", 6], ["chhai", 6], ["bayalis", 42], ["sattavan", 57], ["ikshath", 61], ["iksath", 61], ["igsath", 61]] as const) HNUM.set(hkey(w), n);
// Short Hindi numbers that are also everyday words ("kar do", "saath", "nau"): only right after pr / number / check.
const AMBIGUOUS = new Set(["do", "saath", "saat", "nau", "das", "ek", "bees", "tees", "sau", "assi"].map(hkey));
const WORLD_NUM: Record<string, number> = {
  uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, diez: 10, veinte: 20, cuarenta: 40, cincuenta: 50, sesenta: 60,
  un: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, dix: 10, vingt: 20, quarante: 40, cinquante: 50, soixante: 60,
  eins: 1, zwei: 2, drei: 3, vier: 4, "fünf": 5, zehn: 10, zwanzig: 20, vierzig: 40, "fünfzig": 50, sechzig: 60,
};
const NUM_CUE = new Set(["pr", "number", "no", "#", "check", "request", "requests", "pullrequest"]);

const EN_ALIAS: Record<string, string> = { too: "two", tu: "two", van: "one", wan: "one", thri: "three", faiv: "five", siks: "six", sevan: "seven", sevn: "seven", eit: "eight", nain: "nine", twentee: "twenty", thartee: "thirty", fortee: "forty", fiftee: "fifty", sikstee: "sixty", seventee: "seventy", eitee: "eighty", naintee: "ninety" };

function numberWords(input: string[]): string[] {
  const out: string[] = [];
  const tokens = input.map((w) => EN_ALIAS[w] ?? w);
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i]!;
    const tens = TENS.indexOf(w);
    if (tens >= 2) {
      const next = tokens[i + 1];
      const one = next ? ONES.indexOf(next) : -1;
      if (one >= 1 && one <= 9) {
        out.push(String(tens * 10 + one));
        i++;
      } else out.push(String(tens * 10));
      continue;
    }
    const m = /^(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)-(one|two|three|four|five|six|seven|eight|nine)$/.exec(w);
    if (m) {
      out.push(String(TENS.indexOf(m[1]!) * 10 + ONES.indexOf(m[2]!)));
      continue;
    }
    const prev = out.at(-1) ?? "";
    const one = ONES.indexOf(w);
    if (one >= 0 && (one > 1 || NUM_CUE.has(prev))) {
      out.push(String(one));
      continue;
    }
    const wn = WORLD_NUM[w];
    if (wn !== undefined && (wn >= 20 || NUM_CUE.has(prev) || (/^[2-9]0$/.test(out.at(-2) ?? "") && /^(y|und|et)$/.test(prev)))) {
      if (wn < 10 && /^(y|und|et)$/.test(prev)) out.pop();
      out.push(String(wn));
      continue;
    }
    const hk = hkey(w);
    const h = w.length >= 3 || NUM_CUE.has(prev) ? HNUM.get(hk) : undefined;
    if (h !== undefined && (!AMBIGUOUS.has(hk) || NUM_CUE.has(prev))) {
      out.push(String(h));
      continue;
    }
    out.push(w);
  }
  // "40 2" (cuarenta y dos) -> 42; "2 und 40" (zwei und vierzig) -> 42
  return out.reduce<string[]>((acc, w) => {
    const last = acc.at(-1);
    if (last && /^[2-9]0$/.test(last) && /^[1-9]$/.test(w)) acc[acc.length - 1] = String(Number(last) + Number(w));
    else if (/^[2-9]0$/.test(w) && last === "und" && /^[1-9]$/.test(acc.at(-2) ?? "")) acc.splice(-2, 2, String(Number(w) + Number(acc.at(-2))));
    else acc.push(w);
    return acc;
  }, []);
}

// ---------- lexicon ----------

/** Multi-word phrases first, matched on whole words, longest first. Right side may be "" (drop). */
const PHRASES: [string, string][] = [
  // meta
  ["what can i say", "help"], ["what can you do", "help"], ["stop listening", "voiceoff"], ["undo that", "undo"], ["wapas karo", "undo"], ["wapas kar do", "undo"], ["ulta karo", "undo"],
  ["phir se", "again"], ["fir se", "again"], ["ek baar aur", "again"], ["one more time", "again"], ["do it again", "again"], ["rehne do", "cancel"], ["jane do", "cancel"], ["never mind", "back"], ["nevermind", "back"],
  ["theek hai", "yes"], ["thik hai", "yes"], ["kar do", "do"], ["kar dijiye", "do"], ["go ahead", "yes"], ["do it", "yes"], ["sounds good", "yes"], ["mat karo", "no"], ["nahi karo", "no"], ["don't", "no"],
  ["what does this do", "explain"], ["what does this step do", "explain step"], ["what does it do", "explain"], ["what is this", "explain"], ["what's this", "explain"], ["what changed", "compare"], ["what's next", "next"], ["whats next", "next"],
  ["make ci green", "fix failing check"], ["ci red", "failing check"], ["ci is red", "failing check"], ["ci failing", "failing check"],
  // git, PRs
  ["pull requests", "pr"], ["pool requests", "pr"], ["pool request", "pr"], ["pul rikvest", "pr"], ["pul request", "pr"], ["pull request", "pr"], ["pull-request", "pr"], ["merge request", "pr"], ["pee aar", "pr"], ["p r", "pr"], ["pr s", "pr"], ["peeaar", "pr"], ["piaar", "pr"],
  ["throw away", "discard"], ["get rid of", "discard"], ["hata do", "discard"], ["undo the commit", "undo commit"], ["up to date", "latest"], ["catch up", "sync"],
  ["check out", "switch"], ["ship it", "create pr"], ["send it", "create pr"],
  ["start recording", "record"], ["recording shuru", "record"], ["up next", "queue"], ["after it finishes", "queue"], ["quick open", "quickopen"], ["find file", "quickopen"], ["search files", "quickopen"], ["file dhundo", "quickopen"],
  ["write it up", "issue"], ["write this up", "issue"], ["point mode", "point"], ["let me point", "point"], ["try both", "tryboth"], ["try two", "tryboth"], ["try 2", "tryboth"], ["keep watching", "watch"], ["find the cause", "cause"], ["find cause", "cause"],
  // views
  ["api client", "api"], ["console ka output", "logs"], ["logs ka output", "logs"], ["api explorer", "api"], ["console output", "logs"], ["server logs", "logs"], ["network requests", "network"], ["network calls", "network"], ["network tab", "network"], ["server output", "terminal"],
  ["time view", "time"], ["my app", "app"], ["dev server", "server"], ["dive in", "dive"], ["zoom in", "dive"], ["drill down", "dive"], ["zoom out", "back"], ["go back", "back"], ["play again", "replay"], ["play it again", "replay"],
  ["pull up", "show"], ["bring up", "show"], ["look at", "show"], ["take me to", "go"], ["jump to", "go"], ["switch over to", "switch"], ["kill", "stop"], ["shut down", "stop"], ["shut it down", "stop"],
  ["new trip", "newtrip"], ["new request", "new request"], ["trip list", "triplist"], ["trips list", "triplist"], ["keyboard shortcuts", "shortcuts"], ["what went wrong", "where error"], ["went wrong", "error"],
  // agent
  ["the agent", "agent"], ["claude code", "claude"], ["have claude", "ask claude"], ["have the agent", "agent"],
  // world
  ["en échec", "failing"], ["fehlgeschlagenen", "failing"], ["pull requests abiertos", "pr open"],
];

/** One word to its canonical command word. "" drops it (filler). */
const LEX: Record<string, string> = {
  // show / open / hide
  show: "show", display: "show", view: "show", see: "show", list: "show", dikhao: "show", dikha: "show", dikhaao: "show", dikhaiye: "show", dikhana: "show", dekho: "show", dekhna: "show", batao: "show",
  muestra: "show", "muéstrame": "show", "enséñame": "show", ensename: "show", affiche: "show", montre: "show", zeig: "show", zeige: "show", zeigt: "show", anzeigen: "show",
  open: "open", opan: "open", kholo: "open", colo: "open", kolo: "open", khol: "open", kholiye: "open", khole: "open", kholna: "open", kholdo: "open", abre: "open", ouvre: "open", "öffne": "open", oeffne: "open",
  hide: "hide", close: "close", dismiss: "close", chhupao: "hide", cierra: "close", ferme: "close", "schließe": "close",
  // run / stop
  run: "run", start: "run", launch: "run", boot: "run", chalao: "run", chala: "run", chalaao: "run", chalaiye: "run", shuru: "run", ejecuta: "run", lance: "run", "démarre": "run", demarre: "run", starte: "run", execute: "run",
  stop: "stop", roko: "stop", rok: "stop", ruko: "stop", band: "stop", bas: "stop", "detén": "stop", deten: "stop", arrête: "stop", arrete: "stop", stoppe: "stop", stopp: "stop", halt: "stop",
  restart: "restart", reload: "restart", reboot: "restart", refresh: "restart", reinicia: "restart", "redémarre": "restart",
  again: "again", dobara: "again", repeat: "repeat", nochmal: "again",
  // navigation
  next: "next", agla: "next", agle: "next", agli: "next", forward: "next", continue: "next", aage: "next", siguiente: "next", suivante: "next", suivant: "next", "nächster": "next", naechster: "next",
  previous: "previous", prev: "previous", pichla: "previous", pichhla: "previous", pichli: "previous", pichle: "previous", before: "previous", earlier: "previous", anterior: "previous", "précédente": "previous", vorheriger: "previous",
  back: "back", peeche: "back", pichhe: "back", wapas: "back", volver: "back", retour: "back", "zurück": "back", exit: "back", escape: "back",
  step: "step", kadam: "step", steps: "step", paso: "step", "étape": "step", schritt: "step",
  trip: "trip", trips: "trip", request: "request", requests: "request", rikvest: "request", rikvests: "request",
  triplist: "triplist",
  shortcuts: "shortcuts", shortcut: "shortcuts",
  dive: "dive", andar: "dive", inside: "dive", expand: "dive", enter: "dive",
  replay: "replay", rejouer: "replay",
  go: "go", jao: "go", jaao: "go", chalo: "go", chaliye: "go", jump: "go", head: "go", move: "go", take: "go", ve: "go", va: "go", wechsle: "switch", cambia: "switch", switch: "switch",
  // errors
  where: "where", kahan: "where", kahaan: "where", kaha: "where", "dónde": "where", donde: "where", "où": "where", wo: "where",
  error: "error", errors: "error", galti: "error", galat: "error", gadbad: "error", bug: "error", bugs: "error", fehler: "error", failure: "error", break: "error", broke: "error", broken: "error", wrong: "error", tuta: "error", toota: "error", tooti: "error", "falló": "error", fallo: "error", "cassé": "error", casse: "error",
  failing: "failing", failed: "failing", fail: "failing", fails: "failing", red: "failing", fallido: "failing", fallida: "failing",
  passing: "passing", passed: "passing", green: "passing", pending: "pending", running: "pending",
  // panels and things
  logs: "logs", log: "logs", console: "logs", registros: "logs", konsole: "logs",
  network: "network", netvark: "network", netvarks: "network", netzwerk: "network", netzwerkanfragen: "network", "réseau": "network",
  terminal: "terminal", shell: "terminal", output: "terminal",
  details: "details", detail: "details", info: "details", inspector: "details", values: "details",
  app: "app", aip: "app", aipp: "app", ep: "app", epp: "app", eppa: "app", application: "app", "aplicación": "app", aplicacion: "app", appli: "app", anwendung: "app",
  server: "server", servidor: "server", serveur: "server",
  skills: "skills", playbooks: "skills", skill: "skill",
  flows: "flows", flow: "flow",
  tools: "tools", mcp: "tools",
  changes: "changes", change: "changes", badlav: "changes", badlaav: "changes", cambios: "changes", changements: "changes", "änderungen": "changes",
  timeline: "time", timing: "time", time: "time",
  api: "api", eppee: "api", epi: "api", client: "client", klaaint: "client", klaayant: "client", endpoints: "routes", routes: "routes", route: "route", postman: "api", bruno: "api",
  ship: "ship", race: "race", worktrees: "worktree", worktree: "worktree",
  file: "file", files: "files", faail: "file", phaail: "file", faails: "files", faailen: "files", failen: "files", phailen: "files", phaailen: "files", faailon: "files", archivo: "file", fichier: "file", datei: "file", dateien: "files", fichiers: "files", archivos: "files",
  code: "code", source: "code", edit: "edit",
  // git
  stage: "stage", staged: "stage", stej: "stage", steej: "stage", add: "add", index: "stage", indexe: "stage", prepara: "stage", stagen: "stage", unstage: "unstage",
  commit: "commit", commits: "commit", committe: "commit",
  push: "push", pushe: "push", pousse: "push", origin: "origin",
  pull: "pull", pul: "pull", fetch: "pull", pullrequest: "pr", pullrequests: "pr", latest: "latest", newest: "latest", "neuesten": "latest", "últimos": "latest", derniers: "latest",
  discard: "discard", revert: "discard", hatao: "discard",
  undo: "undo", merge: "merge", approve: "approve", review: "review", rerun: "rerun", retry: "rerun", sync: "sync", rebase: "sync", resolve: "resolve", conflicts: "conflicts", conflict: "conflicts",
  branch: "branch", branches: "branch", main: "main", master: "main",
  pr: "pr", prs: "pr", mr: "pr", peeaar: "pr", peeaars: "pr",
  check: "check", "chèque": "check", cheque: "check", chek: "check", checks: "checks", ci: "ci", build: "ci",
  workspace: "workspace", workspaces: "workspace", espacio: "workspace", espace: "workspace",
  comments: "comments", comment: "comments",
  // tests and agent
  test: "tests", tests: "tests", testing: "tests", pruebas: "tests", prueba: "tests",
  agent: "agent", ejent: "agent", ejant: "agent", agente: "agent", agenten: "agent", claude: "claude", klod: "claude", klaud: "claude", klaaud: "claude", claud: "claude", cloud: "claude", clawed: "claude", clod: "claude", ai: "agent",
  ask: "ask", tell: "ask", pucho: "ask", poocho: "ask", puchho: "ask", poochho: "ask", pregunta: "ask", demande: "ask", frag: "ask", frage: "ask",
  explain: "explain", samjhao: "explain", samjhaao: "explain", samajhao: "explain", explica: "explain", explique: "explain", "erkläre": "explain", erklaere: "explain",
  fix: "fix", fixes: "fix", fiks: "fix", phiks: "fix", repair: "fix", theek: "fix", thik: "fix", sudharo: "fix", arregla: "fix", "répare": "fix", repare: "fix", repariere: "fix", address: "fix",
  why: "why", kyun: "why", kyon: "why", kyu: "why", "por qué": "why", pourquoi: "why", warum: "why", how: "how", kaise: "how",
  compare: "compare", record: "record", clip: "clip", issue: "issue", point: "point", options: "options", cause: "cause", rewind: "rewind", checkpoint: "checkpoint", save: "save", watch: "watch", queue: "queue",
  create: "create", make: "create", banao: "create", bana: "create", crea: "create", "crée": "create", erstelle: "create",
  new: "new", naya: "new", nayi: "new", naye: "new", nuevo: "new", nouveau: "new", neu: "new", neue: "new",
  called: "called", named: "called", naam: "called",
  send: "send", bhejo: "send", get: "get", post: "post", put: "put", delete: "delete", patch: "patch",
  help: "help", commands: "help", which: "which", kaunse: "which", kaunsa: "which", kaun: "which", konse: "which",
  khule: "open", khula: "open", abiertos: "open", ouvertes: "open", offen: "open", offenen: "open",
  // answers
  yes: "yes", yeah: "yes", yep: "yes", yup: "yes", sure: "yes", haan: "yes", han: "yes", ha: "yes", confirm: "yes", "sí": "yes", si: "yes", oui: "yes", ja: "yes",
  no: "no", not: "no", mat: "no", nope: "no", nah: "no", nahi: "no", nahin: "no", non: "no", nein: "no",
  cancel: "cancel", abort: "cancel",
  all: "all", saadee: "all", saadi: "all", everything: "all", sab: "all", sabhi: "all", saari: "all", sari: "all", saare: "all", sare: "all", saara: "all", sara: "all", tous: "all", toutes: "all", alle: "all", every: "all",
  // fillers
  the: "", a: "", an: "", panel: "", pane: "", tab: "", kya: "", me: "", my: "", please: "", pls: "", zara: "", na: "", yaar: "", bhai: "", just: "", now: "", ok: "", okay: "", hey: "", shrike: "", ji: "", jee: "", um: "", uh: "", hmm: "",
  can: "", could: "", would: "", will: "", you: "", i: "", want: "", to: "", for: "", of: "", in: "", on: "", at: "", is: "", are: "", was: "", it: "", this: "", that: "", them: "", these: "", those: "",
  karo: "", kar: "", kare: "", kariye: "", karna: "", karen: "", do: "", de: "", dena: "", dijiye: "", lo: "", le: "", lena: "", ko: "", ki: "", ka: "", ke: "", hai: "", hain: "", hui: "", hua: "", huee: "", huaa: "", ho: "", raha: "",
  ye: "", yeh: "", wala: "", wale: "", wali: "", mein: "", pe: "", par: "", se: "", tak: "", kuch: "", kuchh: "", kuchch: "", ek: "", baar: "", bhi: "", toh: "", abhi: "", ise: "", isko: "", usko: "",
  up: "", over: "", right: "", here: "", there: "", local: "", dev: "", some: "", did: "", does: "", went: "", let: "", "let's": "", lets: "", number: "", quickly: "", real: "", quick: "",
  el: "", la: "", los: "", las: "", les: "", die: "", der: "", das: "", den: "", dem: "", mir: "", moi: "", du: "", al: "", mich: "",
};
const CANON = new Set(Object.values(LEX).filter(Boolean));
const LEX_KEYS = new Map<string, string>();
for (const [w, c] of Object.entries(LEX)) if (c && w.length >= 4 ) LEX_KEYS.set(hkey(w), LEX_KEYS.get(hkey(w)) ?? c);
const SKELS = new Map<string, string>();
for (const c of CANON) if (c.length >= 4) SKELS.set(skel(c), SKELS.get(skel(c)) ?? c);

/** Joiners between clauses. "then" is the marker the splitter cuts on. */
const JOIN = new Set(["and", "then", "aur", "phir", "fir", "karke", "karkay", "karake", "karkar", "y", "luego", "et", "puis", "und", "dann", "also", "plus"]);
const JOIN_PHRASES: [RegExp, string][] = [[/\b(and then|after that|kar ke|ke baad|uske baad|iske baad|and also)\b/g, " then "], [/\s*[,;]\s*/g, " then "], [/(そして|それから|して、)/g, " then "], [/\bto do(s?)\b/g, "todo$1"]]; // ASR writes "to do" for todo

// Japanese has no spaces: swap known words for Roman ones before tokenising.
const CJK: [RegExp, string][] = [
  [/プルリクエスト|プルリク/g, " pr "], [/ログ/g, " logs "], [/ネットワーク/g, " network "], [/ターミナル/g, " terminal "], [/アプリ/g, " app "], [/テスト/g, " tests "], [/エージェント/g, " agent "],
  [/表示して|表示|見せて/g, " show "], [/開いて|開く/g, " open "], [/起動して|起動|実行して|実行|走らせて|動かして/g, " run "], [/止めて|停止して|停止/g, " stop "], [/次の|次/g, " next "], [/前の/g, " previous "], [/ステップ/g, " step "],
  [/プッシュして|プッシュ/g, " push "], [/コミットして|コミット/g, " commit "], [/ステージして|ステージ/g, " stage "], [/全部/g, " all "], [/チェック/g, " check "], [/失敗した/g, " failing "], [/直して/g, " fix "], [/説明して/g, " explain "],
  [/戻って/g, " back "], [/もう一度再生/g, " replay "], [/一覧/g, " show "], [/(を|は|が|に|の|で|して|ください)/g, " "], [/四十二/g, " 42 "],
];

export interface Norm {
  /** Canonical words, clause joiners as "then". */
  words: string[];
  /** The Roman words each canonical word came from (same length as words): file names, paths, free text. */
  src: string[];
  /** Lowercased Roman text with every word kept. */
  roman: string;
}

const cache = new Map<string, Norm>();
const PHRASE_TOKS = PHRASES.map(([p, to]) => [p.split(" "), to.split(" ").filter(Boolean)] as const).sort((a, b) => b[0].length - a[0].length);

/** Any transcript to canonical tokens. Pure, cached (the same partial arrives many times). */
export function normalize(text: string): Norm {
  const hit = cache.get(text);
  if (hit) return hit;
  let s = text.normalize("NFKC").toLowerCase().replace(/[’‘`]/g, "'");
  for (const [re, to] of CJK) s = s.replace(re, to);
  s = s.replace(/[\u0900-\u097f]+/g, (m) => translit(m));
  s = s.replace(/#\s*(\d+)/g, " number $1 ").replace(/\bp\.?\s?r\.?(?=\s|\d|$)/g, "pr").replace(/\bpr(\d+)/g, "pr $1").replace(/\b(\d+)(st|nd|rd|th)\b/g, "$1");
  for (const [re, to] of JOIN_PHRASES) s = s.replace(re, to);
  // keep . / - _ inside words (cart.ts, /api/todos); everything else outside letters and digits is a space
  s = s.replace(/[^\p{L}\p{N}\p{M}'./_\- ]+/gu, " ").replace(/(^|\s)[.\-_']+|[.\-_']+(?=\s|$)/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/(^|\s)[ldjcmnst]'(?=\p{L})/gu, "$1"); // fr elision: l'application
  const roman = s;
  const toks = numberWords(s.split(" ").filter(Boolean));
  const words: string[] = [];
  const src: string[] = [];
  const push = (w: string, from: string) => {
    if (w === "then") {
      if (words.length && words.at(-1) !== "then") (words.push("then"), src.push(from));
    } else if (w) (words.push(w), src.push(from));
  };
  for (let i = 0; i < toks.length; i++) {
    const ph = PHRASE_TOKS.find(([p]) => p.every((x, j) => toks[i + j] === x));
    if (ph) {
      const from = toks.slice(i, i + ph[0].length).join(" ");
      ph[1].forEach((w, j) => push(w, j === 0 ? from : ""));
      i += ph[0].length - 1;
      continue;
    }
    const w = toks[i]!;
    push(JOIN.has(w) ? "then" : canon(w), w);
  }
  for (let i = 0; i < words.length - 1; i++)
    if ((words[i] === "pull" && words[i + 1] === "request") || (words[i] === "api" && words[i + 1] === "client") || (words[i] === "network" && words[i + 1] === "request")) {
      words.splice(i, 2, words[i] === "pull" ? "pr" : words[i]!);
      src.splice(i, 2, `${src[i]} ${src[i + 1]}`);
    }
  if (words[0] === "yes" && words[1] === "then") (words.splice(1, 1), src.splice(1, 1)); // "Yes, ship it" is one yes, not two clauses
  while (words.at(-1) === "then") (words.pop(), src.pop());
  const out = { words, src, roman };
  if (cache.size > 500) cache.clear();
  cache.set(text, out);
  return out;
}

function canon(w: string): string {
  if (/^\d+$/.test(w) || /[/_-]/.test(w) || /\.\w{1,4}$/.test(w)) return w;
  if (w in LEX) return LEX[w]!;
  if (CANON.has(w)) return w;
  if (w.length < 4) return w;
  const hk = LEX_KEYS.get(hkey(w));
  if (hk) return hk;
  const sk = skel(w);
  const exact = SKELS.get(sk);
  if (exact) return exact;
  if (w.length >= 5 && sk.length >= 3) {
    let best: [number, string] = [9, ""];
    for (const [k, v] of SKELS) if (Math.abs(k.length - sk.length) <= 1 && k.length >= 3 && k[0] === sk[0]) {
      const d = lev(k, sk);
      if (d < best[0]) best = [d, v];
    }
    if (best[0] <= 1) return best[1];
  }
  return w;
}

/** Content words the command vocabulary knows: the garbled-input guard counts these. */
export const known = (w: string): boolean => CANON.has(w) || /^\d+$/.test(w);
