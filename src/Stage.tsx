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
        .replace(/\u2013|\u2014/g, "-")     // en/em dashes -> hyphen
        .replace(/\uFF1A/g, ":");           // full-width colon -> colon

    for (let ln of normalized.split(/\r?\n/)) {
        // strip leading markdown bullets/quotes/spacing
        ln = ln.replace(/^\s*(?:>|\*|-|\d+\.)\s*/, "");   // >, *, -, "1." at start
        ln = ln.replace(/^\s*(\*\*|__|\*)/, "");          // opening bold/italic
        ln = ln.replace(/(\*\*|__|\*)\s*$/, "");          // trailing bold/italic

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
            state: { lastSpeakers: [] as Character[] }
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

    /** Runs after the assistant replies — detect & store speakers */
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

        // persist state; host reads what we set
        const nextState = { ...(this as any).state, lastSpeakers: speakers };
        await this.setState(nextState);

        // typed empty StageResponse
        return {} as Partial<StageResponse<any, any>>;
    }

    /** Right panel UI — must return a ReactElement */
    /** Right panel UI — simple debug panel so we can see it mounted */
    render() {
        const cfg: Config = (this as any).config || { characters: [] };
        const isHidden = cfg.showPanel === false;
        const speakers: Character[] = ((this as any).state?.lastSpeakers) || [];

        // debug log so we can see what the panel received
        try { console.log("[Portraits] render", { speakers: speakers.map(s => s.name), cfg }); } catch { }

        return (
            <div style={{ minHeight: 120, padding: 12, border: "2px dashed magenta", borderRadius: 10 }}>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>
                    Portraits panel loaded {isHidden ? "(hidden by config)" : ""}
                </div>

                {!isHidden && (
                    <>
                        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Now speaking</div>

                        {speakers.length ? (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                                {speakers.map((c, i) => (
                                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        <img
                                            src={c.imageUrl}
                                            alt={c.name}
                                            loading="lazy"
                                            referrerPolicy="no-referrer"
                                            style={{ width: 56, height: 56, borderRadius: 12, objectFit: "cover", background: "#111" }}
                                            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                                        />
                                        <div style={{ fontSize: 13, fontWeight: 600, maxWidth: 180, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
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
                    </>
                )}
            </div>
        );
    }
}
