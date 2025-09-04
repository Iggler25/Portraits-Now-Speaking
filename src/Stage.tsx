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

    // NEW (optional) – you can expose these in config.schema.json later
    showBalance?: boolean;              // default true
    balanceRegex?: string;              // default: "C\\s*([0-9][0-9,\\.]*)"
};

/** =================== Roster (put your real URLs) =================== */
const DEFAULT_CHARACTERS: Character[] = [
    { name: "Lilith", aliases: ["Lady Lilith"], imageUrl: "https://files.catbox.moe/hpcqr0.jpg" },
    { name: "Ankha", aliases: [], imageUrl: "https://files.catbox.moe/akibog.jpg" },
    { name: "Widowmaker", aliases: ["Amelie", "Amélie", "Lacroix"], imageUrl: "https://files.catbox.moe/bzfzsg.jpg" },
    { name: "Rebecca", aliases: ["Becca"], imageUrl: "https://files.catbox.moe/qo4sg2.jpg" },
    { name: "Shadowheart", aliases: ["Shadow Heart"], imageUrl: "https://files.catbox.moe/f6salf.jpg" },
    { name: "Kaelen", aliases: ["Kael"], imageUrl: "https://files.catbox.moe/ce0c87.jpg" },
    { name: "Blair", aliases: [], imageUrl: "https://files.catbox.moe/wj9iyb.jpg" },
    { name: "Maya", aliases: [], imageUrl: "https://files.catbox.moe/REPLACE_MAYA.png" },
    { name: "Tracer", aliases: ["Lena", "Oxton", "Lena Oxton"], imageUrl: "https://files.catbox.moe/REPLACE_TRACER.png" },
    { name: "Nyssia", aliases: [], imageUrl: "https://files.catbox.moe/REPLACE_NYSSIA.png" },
    { name: "Morgana", aliases: [], imageUrl: "https://files.catbox.moe/REPLACE_MORGANA.png" },
    { name: "Nami", aliases: [], imageUrl: "https://files.catbox.moe/REPLACE_NAMI.png" },
    { name: "Nico Robin", aliases: ["Nico", "Robin", "NicoRobin"], imageUrl: "https://files.catbox.moe/REPLACE_NICO_ROBIN.png" },
    { name: "Maki Oze", aliases: ["Maki", "Oze", "MakiOze"], imageUrl: "https://files.catbox.moe/REPLACE_MAKI_OZE.png" }
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

    // Normalize smart punctuation + strip common markdown wrappers
    const normalized = text
        .replace(/\u2013|\u2014/g, "-")  // en/em dashes -> hyphen
        .replace(/\uFF1A/g, ":");        // full-width colon -> colon

    for (let ln of normalized.split(/\r?\n/)) {
        // strip leading markdown bullets/quotes/spacing
        ln = ln.replace(/^\s*(?:>|\*|-|\d+\.)\s*/, "");          // >, *, -, "1." at start
        ln = ln.replace(/^\s*(\*\*|__|\*)/, "");                 // opening bold/italic
        ln = ln.replace(/(\*\*|__|\*)\s*$/, "");                 // trailing bold/italic

        // Match: Name:  or  Name -   (allow quotes or nothing after punctuation)
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

    /** Required by StageBase */
    async load() {
        return {
            success: true,
            ui: { visible: true },
            state: {
                lastSpeakers: [] as Character[],
                balanceC: null as number | null
            }
        };
    }

    /** Required by StageBase */
    async setState(state: any) {
        (this as any).state = state;
    }

    /** Required by StageBase (we do no pre-processing) */
    async beforePrompt(_input: any) {
        return {};
    }

    /** Runs after the assistant replies — detect & store speakers, and parse balance */
    async afterResponse(botMessage: any): Promise<Partial<StageResponse<any, any>>> {
        const cfg: Config = (this as any).config || { characters: [] };
        const roster =
            cfg.characters && cfg.characters.length ? cfg.characters : DEFAULT_CHARACTERS;

        // ignore user messages
        const role = (botMessage?.role || botMessage?.author?.role || "").toLowerCase();
        if (role === "user") return {} as Partial<StageResponse<any, any>>;

        const text: string =
            botMessage?.text ??
            botMessage?.content ??
            botMessage?.body ??
            "";

        let speakers = detectSpeakersByPrefixes(text, roster);

        // optional fallback to author if nothing detected
        if (!speakers.length && cfg.fallbackToAuthor) {
            const author =
                botMessage?.author?.name ||
                botMessage?.character?.name ||
                (this as any)?.bot?.name ||
                "";
            const c = buildTokenMap(roster).get(normalize(author));
            if (c) speakers = [c];
        }

        // cap portraits per turn
        const limit = Math.max(1, cfg.maxPerTurn ?? 3);
        if (speakers.length > limit) speakers = speakers.slice(0, limit);

        // ---- Balance detection (simple absolute parser) ----
        const showBalance = cfg.showBalance !== false; // default true
        let balanceC = (this as any).state?.balanceC ?? null;
        if (showBalance) {
            try {
                const pattern = cfg.balanceRegex || "C\\s*([0-9][0-9,\\.]*)";
                const re = new RegExp(pattern, "i");
                const m = re.exec(text);
                if (m && m[1]) {
                    // strip commas/spaces, keep dot as decimal separator
                    const cleaned = String(m[1]).replace(/[,\s]/g, "");
                    const num = Number(cleaned);
                    if (!Number.isNaN(num)) balanceC = num;
                }
            } catch {
                // ignore invalid regex
            }
        }

        // persist state; host reads what we set
        const nextState = { ...(this as any).state, lastSpeakers: speakers, balanceC };
        await this.setState(nextState);

        // typed empty StageResponse
        return {} as Partial<StageResponse<any, any>>;
    }

    /** Right panel UI — must return a ReactElement */
    render() {
        const cfg: Config = (this as any).config || { characters: [] };
        const isHidden = cfg.showPanel === false;
        const speakers: Character[] = ((this as any).state?.lastSpeakers) || [];
        const balanceC: number | null = (this as any).state?.balanceC ?? null;
        const showBalance = cfg.showBalance !== false;

        // Container (no magenta border)
        return (
            <div style={{
                minHeight: 120,
                padding: 12,
                borderRadius: 12
            }}>
                <div style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 8
                }}>
                    <div style={{ fontWeight: 800, fontSize: 18 }}>
                        {isHidden ? "Portraits panel (hidden by config)" : "Now speaking"}
                    </div>

                    {showBalance && balanceC != null && !isHidden && (
                        <div
                            title="Corruption Ether"
                            style={{
                                padding: "6px 10px",
                                borderRadius: 999,
                                border: "1px solid rgba(255,255,255,0.15)",
                                background: "rgba(0,0,0,0.25)",
                                backdropFilter: "blur(4px)",
                                fontWeight: 700,
                                fontSize: 14
                            }}
                        >
                            C {balanceC.toLocaleString()}
                        </div>
                    )}
                </div>

                {!isHidden && (
                    <>
                        {speakers.length ? (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
                                {speakers.map((c, i) => (
                                    <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                                        {/* BIG, aspect-preserving image */}
                                        <div style={{
                                            borderRadius: 12,
                                            overflow: "hidden",
                                            border: "1px solid rgba(255,255,255,0.10)",
                                            boxShadow: "0 6px 20px rgba(0,0,0,0.35)"
                                        }}>
                                            <img
                                                src={c.imageUrl}
                                                alt={c.name}
                                                loading="lazy"
                                                referrerPolicy="no-referrer"
                                                style={{
                                                    display: "block",
                                                    width: "min(40vw, 560px)", // ~10× larger than 56px, responsive
                                                    height: "auto",             // keep aspect ratio
                                                    objectFit: "contain",
                                                    background: "#111"
                                                }}
                                                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                                            />
                                        </div>
                                        {/* Bigger name text */}
                                        <div style={{ marginTop: 10, fontSize: 18, fontWeight: 700, textAlign: "center", maxWidth: 560 }}>
                                            {c.name}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div style={{ fontSize: 18, opacity: 0.7 }}>
                                No speakers detected. Dialogue lines must start with <code>Name:</code>.
                            </div>
                        )}
                    </>
                )}
            </div>
        );
    }
}
