import React, { useEffect, useMemo, useState } from "react";
import type { FC } from "react";

/**
 * Minimal local test runner for your Stage.
 * - Accepts a factory that returns your Stage (new Stage(initialData))
 * - Calls stage.load() and logs success
 * - Renders stage.render() in a simple container
 */

type TestStageRunnerProps = {
    factory: (data: any) => any;   // keep permissive to avoid template type clashes
    config?: any;                  // optional override for initial config
};

export const TestStageRunner: FC<TestStageRunnerProps> = ({ factory, config }) => {
    const [stage, setStage] = useState<any>(null);

    // Provide a minimal InitialData shape; StageBase will read .config from this
    const initialData = useMemo(() => ({ config: config ?? {} }), [config]);

    useEffect(() => {
        const s = factory(initialData);
        setStage(s);

        if (s && typeof s.load === "function") {
            Promise.resolve(s.load())
                .then((res: any) => {
                    // These logs help during dev; harmless in build
                    console.info(`Test StageBase Runner load success result was ${res?.success}`);
                    if (!res?.success && res?.error) {
                        console.error(`Error from stage during load, error: ${res.error}`);
                    }
                })
                .catch((e: any) => {
                    console.error("Stage load failed:", e);
                });
        }
    }, [factory, initialData]);

    return (
        <div style={{ height: "100%", width: "100%", display: "flex", alignItems: "stretch" }}>
            <div style={{ flex: 1, borderLeft: "1px solid rgba(0,0,0,0.08)" }}>
                {stage ? stage.render() : <div style={{ padding: 12 }}>Stage loading…</div>}
            </div>
        </div>
    );
};
