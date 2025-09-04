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

    /** Right panel UI — responsive portraits */
    render() {
        const cfg: Config & {
            portraitSize?: number;   // optional, from config
            tightGrid?: boolean;     // optional, from config
            showBalance?: boolean;   // optional, from config
            currencyLabel?: string;  // optional, from config
        } = (this as any).config || { characters: [] };

        const isHidden = cfg.showPanel === false;
        const speakers: Character[] = ((this as any).state?.lastSpeakers) || [];

        // --- sizing knobs (you can override from config/cog) ---
        // 2× bigger than before: try 360px; tweak to taste.
        const PORTRAIT_PX = Math.max(120, cfg.portraitSize ?? 360);
        // If true -> keep everyone on one row by sharing space; they will shrink.
        // If false -> each item has a minimum width and will wrap to the next line.
        const TIGHT = cfg.tightGrid ?? true;

        // Try to find a number for “C” balance from a few likely places
        const guessNumber = (v: any) =>
            typeof v === "number" && isFinite(v) ? v :
                (typeof v === "string" && /^\d+(\.\d+)?$/.test(v) ? Number(v) : undefined);

        const cBalance =
            guessNumber((this as any)?.bot?.balanceC) ??
            guessNumber((this as any)?.bot?.coins) ??
            guessNumber((this as any)?.character?.balanceC) ??
            guessNumber((this as any)?.state?.balanceC);

        const currencyLabel = cfg.currencyLabel ?? "C";

        // grid definition:
        // - TIGHT  : everyone shares one row (repeat(<n>, 1fr)) and auto-shrinks
        // - RELAXED: auto-fit min columns; when too narrow, items wrap
        const gridTemplateColumns = TIGHT
            ? `repeat(${Math.max(1, speakers.length)}, 1fr)`
            : `repeat(auto-fit, minmax(${Math.min(220, PORTRAIT_PX)}px, 1fr))`;

        if (isHidden) return <></>;

        return (
            <div
                style={{
                    padding: 12,
                    // No magenta border anymore; keep it clean
                    borderRadius: 10,
                }}
            >
                {/* Header row with optional balance */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                    <div style={{ fontSize: 18, fontWeight: 800 }}>Now speaking</div>

                    {(cfg.showBalance ?? true) && cBalance !== undefined && (
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
                                fontSize: 14
                            }}
                        >
                            <span style={{
                                display: "inline-flex",
                                width: 22,
                                height: 22,
                                borderRadius: 999,
                                alignItems: "center",
                                justifyContent: "center",
                                background: "linear-gradient(135deg,#ffd54a,#ff9f1a)",
                                color: "#000",
                                fontWeight: 900
                            }}>
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
                            gap: 14,
                            gridTemplateColumns,
                            alignItems: "start"
                        }}
                    >
                        {speakers.map((c, i) => (
                            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                <div
                                    style={{
                                        // Portrait box respects aspect ratio (no cropping)
                                        width: "100%",
                                        maxWidth: PORTRAIT_PX,
                                        // Constrain the visual height a bit so 21:9 images don’t explode; tweak if you like
                                        maxHeight: PORTRAIT_PX * 1.2,
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
                                            width: "100%",
                                            height: "auto",
                                            objectFit: "contain",   // keep original aspect
                                            display: "block",
                                            background: "#0b0b0b"
                                        }}
                                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                                    />
                                </div>

                                <div
                                    style={{
                                        fontSize: 18,          // Bigger, more “speaking” feel
                                        fontWeight: 800,
                                        lineHeight: 1.15,
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                        overflow: "hidden",
                                        maxWidth: PORTRAIT_PX
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
