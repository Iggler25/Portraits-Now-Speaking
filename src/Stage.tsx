import React from "react";
import { StageBase, type InitialData } from "@chub-ai/stages-ts";
import type { StageResponse } from "@chub-ai/stages-ts/dist/types/stage";

/** =================== Types =================== */
type Character = {
  name: string;
  aliases?: string[];
  imageUrl: string;
  traits?: string[];
};

type Config = {
  showPanel?: boolean;
  maxPerTurn?: number;
  fallbackToAuthor?: boolean;
  characters: Character[];

  // UI / parsing
  portraitSize?: number;
  currencyLabel?: string;
  showBalance?: boolean;
  balanceRegex?: string;

  // NEW: show portraits as soon as the panel loads
  defaultSpeakers?: string[];
};

/** =================== Default roster =================== */
/* Replace any REPLACE_*.jpg/png with real links when ready */
const DEFAULT_CHARACTERS: Character[] = [
  { name: "Lilith", aliases: ["Lady Lilith"], imageUrl: "https://files.catbox.moe/hpcqr0.jpg" },
  { name: "Ankha", aliases: [], imageUrl: "https://files.catbox.moe/akibog.jpg" },
  { name: "Widowmaker", aliases: ["Amelie", "Amélie", "Lacroix"], imageUrl: "https://files.catbox.moe/bzfzsg.jpg" },
  { name: "Rebecca", aliases: ["Becca"], imageUrl: "https://files.catbox.moe/qo4sg2.jpg" },
  { name: "Shadowheart", aliases: ["Shadow Heart"], imageUrl: "https://files.catbox.moe/f6salf.jpg" },
  { name: "Kaelen", aliases: ["Kael"], imageUrl: "https://files.catbox.moe/ce0c87.jpg" },
  { name: "Blair", aliases: [], imageUrl: "https://files.catbox.moe/wj9iyb.jpg" },
  { name: "Maya", aliases: [], imageUrl: "https://files.catbox.moe/hzbyt4.jpg" },
  { name: "Tracer", aliases: ["Lena", "Oxton", "Lena Oxton"], imageUrl: "https://files.catbox.moe/5nrczz.jpg" },
  { name: "Nyssia", aliases: [], imageUrl: "https://files.catbox.moe/59ops5.jpg" },
  { name: "Morgana", aliases: [], imageUrl: "https://files.catbox.moe/63ayl4.jpg" },
  { name: "Nami", aliases: [], imageUrl: "https://files.catbox.moe/g8v18s.jpg" },
  { name: "Nico Robin", aliases: ["Nico", "Robin", "NicoRobin"], imageUrl: "https://files.catbox.moe/sut7qk.jpg" },
  { name: "Maki Oze", aliases: ["Maki", "Oze", "MakiOze"], imageUrl: "https://files.catbox.moe/d3eitq.jpg" },

  // NEW additions
  { name: "Angela Orosco", aliases: ["Angela", "Orosco"], imageUrl: "https://files.catbox.moe/mjxkjp.jpg" },
  { name: "Boa Hancock", aliases: ["Hancock", "Boa"], imageUrl: "https://files.catbox.moe/u7tsop.jpg" },
  { name: "Cammy White", aliases: ["Cammy"], imageUrl: "https://files.catbox.moe/fnd4c1.jpg" },
  { name: "Quiet", aliases: [], imageUrl: "https://files.catbox.moe/zh6sdw.jpg" },
  { name: "Tifa", aliases: ["Tifa Lockhart", "Lockhart"], imageUrl: "https://files.catbox.moe/654jgo.jpg" },
  { name: "Yoruichi", aliases: ["Yoruichi Shihoin", "Yoruichi Shihōin", "Shihoin", "Shihōin"], imageUrl: "https://files.catbox.moe/jj3740.jpg" },
];

/** =================== Helpers =================== */
const normalize = (s: string) =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

const buildTokenMap = (roster: Character[]) => {
  const map = new Map<string, Character>();
  for (const c of roster || []) {
    const tokens = [c.name, ...(c.aliases || [])].filter(Boolean) as string[];
    for (const t of tokens) map.set(normalize(t), c);
  }
  return map;
};

const detectSpeakersByPrefixes = (text: string, roster: Character[]): Character[] => {
  if (!text) return [];
  const tokenMap = buildTokenMap(roster);
  const hits: Character[] = [];
  const seen = new Set<string>();

  const normalized = text
    .replace(/\u2013|\u2014/g, "-")
    .replace(/\uFF1A/g, ":");

  for (let ln of normalized.split(/\r?\n/)) {
    ln = ln.replace(/^\s*(?:>|\*|-|\d+\.)\s*/, "");
    ln = ln.replace(/^\s*(\*\*|__|\*)/, "");
    ln = ln.replace(/(\*\*|__|\*)\s*$/, "");

    const m = ln.match(/^\s*([A-Za-z][\w .'\-]{0,40})\s*[:\-]\s*(?:.+)?$/);
    if (!m) continue;

    const key = normalize(m[1]);
    const c = tokenMap.get(key);
    if (c && !seen.has(c.name)) {
      hits.push(c);
      seen.add(c.name);
    }
  }

  return hits;
};

/** =================== Stage class =================== */
export class Stage extends StageBase<any, any, any, Config> {
  constructor(data: InitialData<any, any, any, Config>) {
    super(data);
  }

  /** Show Lilith (or configured defaults) immediately */
  async load() {
    const cfg: Config = (this as any).config || { characters: [] };
    const roster = cfg.characters && cfg.characters.length ? cfg.characters : DEFAULT_CHARACTERS;

    let initialSpeakers: Character[] = [];
    if (Array.isArray(cfg.defaultSpeakers) && cfg.defaultSpeakers.length) {
      const map = buildTokenMap(roster);
      for (const n of cfg.defaultSpeakers) {
        const c = map.get(normalize(n));
        if (c && !initialSpeakers.find(s => s.name === c.name)) {
          initialSpeakers.push(c);
        }
      }
    } else {
      const lilith = roster.find(c => normalize(c.name) === normalize("Lilith"));
      if (lilith) initialSpeakers = [lilith];
    }

    return {
      success: true,
      ui: { visible: true },
      state: {
        lastSpeakers: initialSpeakers,
        balanceC: 0,
      },
    };
  }

  async setState(state: any) {
    (this as any).state = state;
  }

  async beforePrompt(_input: any) {
    return {};
  }

  /** Detect speakers & parse balance after each assistant reply */
  async afterResponse(botMessage: any): Promise<Partial<StageResponse<any, any>>> {
    const cfg: Config = (this as any).config || { characters: [] };
    const roster = cfg.characters && cfg.characters.length ? cfg.characters : DEFAULT_CHARACTERS;

    const role = (botMessage?.role || botMessage?.author?.role || "").toLowerCase();
    if (role === "user") return {} as Partial<StageResponse<any, any>>;

    const text: string = botMessage?.text ?? botMessage?.content ?? botMessage?.body ?? "";

    let speakers = detectSpeakersByPrefixes(text, roster);

    if (!speakers.length && cfg.fallbackToAuthor) {
      const author =
        botMessage?.author?.name ||
        botMessage?.character?.name ||
        (this as any)?.bot?.name ||
        "";
      const c = buildTokenMap(roster).get(normalize(author));
      if (c) speakers = [c];
    }

    const limit = Math.max(1, cfg.maxPerTurn ?? 4); // 2×2 grid target
    if (speakers.length > limit) speakers = speakers.slice(0, limit);

    // Balance parse (absolute number visible in the text)
    let balanceC: number = (this as any).state?.balanceC ?? 0;
    if (cfg.showBalance !== false) {
      try {
        const pattern = cfg.balanceRegex || "C\\s*([0-9][0-9,\\.]*)";
        const re = new RegExp(pattern, "i");
        const m = re.exec(text);
        if (m && m[1]) {
          const cleaned = String(m[1]).replace(/[,\s]/g, "");
          const num = Number(cleaned);
          if (!Number.isNaN(num)) balanceC = num;
        }
      } catch {}
    }

    await this.setState({ ...(this as any).state, lastSpeakers: speakers, balanceC });
    return {} as Partial<StageResponse<any, any>>;
  }

  /** 1 col for 1 speaker, 2×2 grid for 2–4 speakers */
  render() {
    const cfg: Config = (this as any).config || { characters: [] };
    if (cfg.showPanel === false) return <></>;

    const speakers: Character[] = ((this as any).state?.lastSpeakers) || [];

    const currencyLabel = cfg.currencyLabel ?? "C";
    const showBalance = cfg.showBalance !== false;
    const cBalance = (this as any)?.state?.balanceC ?? 0;

    const cols = speakers.length <= 1 ? 1 : 2;
    const gridTemplateColumns = cols === 1 ? "1fr" : "1fr 1fr";

    return (
      <div style={{ padding: 12 }}>
        {/* Header with optional balance pill */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 800 }}>Now speaking</div>

          {showBalance && (
            <div
              title={`${currencyLabel} balance`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 10px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.08)",
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  width: 22,
                  height: 22,
                  borderRadius: 999,
                  alignItems: "center",
                  justifyContent: "center",
                  background: "linear-gradient(135deg,#ffd54a,#ff9f1a)",
                  color: "#000",
                  fontWeight: 900,
                }}
              >
                {currencyLabel}
              </span>
              <span>{cBalance}</span>
            </div>
          )}
        </div>

        {speakers.length ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns,
              gap: 14,
              alignItems: "start",
            }}
          >
            {speakers.map((c, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div
                  style={{
                    width: "100%",
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: 14,
                    overflow: "hidden",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <img
                    src={c.imageUrl}
                    alt={c.name}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    style={{
                      display: "block",
                      width: "100%",
                      height: "auto",     // keep aspect
                      objectFit: "contain",
                      background: "#0b0b0b",
                    }}
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  />
                </div>

                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 800,
                    lineHeight: 1.15,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title={c.name}
                >
                  {c.name}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 13, opacity: 0.7 }}>
            No speakers detected. Dialogue lines must start with <code>Name:</code>.
          </div>
        )}
      </div>
    );
  }
}
