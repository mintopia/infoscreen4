"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Image from "next/image";
import * as fabric from "fabric";
import { BundleMeta, BundleSlideEntry } from "../interfaces/BundleMeta";
import "./FabricVideo"; // side-effect: registers FabricVideo in classRegistry
import { loadFabricJsonSafely } from "./fabricLoadHelpers";

interface Props {
    json: object | null;
    bundleMeta: BundleMeta | null;
    autoScale?: boolean;      // overrides bundleMeta.autoScale (e.g. admin preview always scales)
    showMissingAssetWarning?: boolean;
    activeEntry?: BundleSlideEntry | null;
    announcement?: string | null;
    onReady?: () => void;
    hideBackground?: boolean;
}

const DEFAULT_W = 1920;
const DEFAULT_H = 1080;

const VIDEO_EXTS = new Set(["mp4", "webm", "ogg"]);
function isVideo(name: string) {
    return VIDEO_EXTS.has(name.split(".").pop()?.toLowerCase() ?? "");
}

export default function DisplaySlide({ json, bundleMeta, autoScale: autoScaleOverride, showMissingAssetWarning = false, activeEntry, announcement, onReady, hideBackground = false }: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasWrapRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fabricRef = useRef<fabric.StaticCanvas | null>(null);
    const loadSeqRef = useRef(0);

    const background = bundleMeta?.backgroundColor;
    const backgroundFile = bundleMeta?.backgroundFile;
    const designWidth = bundleMeta?.width;
    const designHeight = bundleMeta?.height;
    const autoScale = autoScaleOverride ?? bundleMeta?.autoScale;

    // Init canvas once
    useEffect(() => {
        if (!canvasRef.current) return;
        const c = new fabric.StaticCanvas(canvasRef.current, {
            selection: false,
            interactive: false,
        });
        fabricRef.current = c;

        // Drive video frame updates
        let running = true;
        const render = () => {
            if (!running || fabricRef.current !== c) return;
            try {
                c.requestRenderAll();
            } catch {
                // Keep the loop alive; some browsers can throw transiently during media decode.
            }
            fabric.util.requestAnimFrame(render);
        };
        fabric.util.requestAnimFrame(render);

        return () => {
            running = false;
            if (fabricRef.current === c) fabricRef.current = null;
            c.dispose();
        };
    }, []);

    // Scale canvas to fill container (or set to exact design size)
    useEffect(() => {
        const container = containerRef.current;
        const c = fabricRef.current;
        if (!container || !c) return;

        const dw = designWidth ?? DEFAULT_W;
        const dh = designHeight ?? DEFAULT_H;

        const resize = () => {
            if (fabricRef.current !== c) return;
            let canvasW: number;
            let canvasH: number;
            if (autoScale) {
                const cw = container.clientWidth;
                const ch = container.clientHeight;
                const scale = Math.min(cw / dw, ch / dh);
                canvasW = dw * scale;
                canvasH = dh * scale;
                c.setDimensions({ width: canvasW, height: canvasH });
                c.setZoom(scale);
            } else {
                canvasW = dw;
                canvasH = dh;
                c.setDimensions({ width: canvasW, height: canvasH });
                c.setZoom(1);
            }
            if (canvasWrapRef.current) {
                canvasWrapRef.current.style.width = `${canvasW}px`;
                canvasWrapRef.current.style.height = `${canvasH}px`;
            }
            try {
                c.requestRenderAll();
            } catch {
                // Canvas may be disposed between resize observation and render call.
            }
        };

        const ro = new ResizeObserver(resize);
        ro.observe(container);
        resize();
        return () => ro.disconnect();
    }, [designWidth, designHeight, autoScale]);

    const [hasMissingAssets, setHasMissingAssets] = useState(false);
    const [localTime, setLocalTime] = useState("");
    const announcementRef = useRef<HTMLDivElement>(null);
    const announcementInnerRef = useRef<HTMLSpanElement>(null);

    const fitAnnouncementText = useCallback(() => {
        const outer = announcementRef.current;
        const inner = announcementInnerRef.current;
        if (!outer || !inner) return;
        inner.style.transform = "";
        const style = getComputedStyle(outer);
        const pad = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        const available = outer.clientWidth - pad;
        const natural = inner.scrollWidth;
        if (natural > available && available > 0) {
            inner.style.transform = `scale(${available / natural})`;
        }
        outer.style.visibility = "visible";
    }, []);

    useEffect(() => {
        if (!announcement) return;
        requestAnimationFrame(fitAnnouncementText);
    }, [announcement, fitAnnouncementText]);

    useEffect(() => {
        if (!announcement) return;
        const container = containerRef.current;
        if (!container) return;
        const ro = new ResizeObserver(fitAnnouncementText);
        ro.observe(container);
        return () => ro.disconnect();
    }, [announcement, fitAnnouncementText]);

    useEffect(() => {
        if (!bundleMeta?.showLocalTime) return;
        const updateTime = () => {
            const now = new Date();
            setLocalTime(now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false}));
        };
        updateTime();
        const interval = setInterval(updateTime, 1000);
        return () => clearInterval(interval);
    }, [bundleMeta?.showLocalTime]);

    const canvasReadyRef = useRef(false);
    const videoReadyRef = useRef(false);
    const readyFiredRef = useRef(false);

    const fileUrl = backgroundFile
        ? `/api/files/backgrounds/${encodeURIComponent(backgroundFile)}`
        : null;
    const fileIsVideo = backgroundFile ? isVideo(backgroundFile) : false;

    const checkReady = useCallback(() => {
        if (readyFiredRef.current) return;
        const needsVideo = fileUrl && fileIsVideo;
        if (canvasReadyRef.current && (!needsVideo || videoReadyRef.current)) {
            readyFiredRef.current = true;
            onReady?.();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fileUrl, fileIsVideo]);

    // Load JSON whenever it changes
    useEffect(() => {
        const c = fabricRef.current;
        if (!c) return;
        const seq = ++loadSeqRef.current;
        canvasReadyRef.current = false;
        videoReadyRef.current = false;
        readyFiredRef.current = false;
        if (!json) {
            try {
                c.clear();
                if (fabricRef.current === c) c.requestRenderAll();
            } catch {
                // Ignore dispose races.
            }
            queueMicrotask(() => setHasMissingAssets(false));
            canvasReadyRef.current = true;
            checkReady();
            return;
        }
        loadFabricJsonSafely(c, json)
            .then((result) => {
                if (fabricRef.current !== c || loadSeqRef.current !== seq) return;
                setHasMissingAssets(result.missingAssets);
                try {
                    c.requestRenderAll();
                } catch {
                    // Ignore dispose races.
                }
                canvasReadyRef.current = true;
                checkReady();
            });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [json]);

    return (
        <div
            ref={containerRef}
            className="slide-preview-container"
            style={!hideBackground && !fileUrl && background ? { background } : undefined}
        >
            {(() => {
                const showClock = bundleMeta?.showLocalTime;
                const clockPos = bundleMeta?.localTimePosition || "bottom-right";
                const clockAtTop = clockPos.includes("top");
                const clockAtBottom = clockPos.includes("bottom");
                const clockOnRight = clockPos.includes("right");

                const pillStyle: React.CSSProperties = {
                    padding: "4px 12px",
                    backgroundColor: "rgba(0,0,0,0.5)",
                    backdropFilter: "blur(4px)",
                    color: "white",
                    fontFamily: "Inter",
                    fontSize: "min(3vw, 48px)",
                    fontWeight: 900,
                    letterSpacing: "1px",
                    lineHeight: 1.2,
                    borderRadius: "8px",
                    pointerEvents: "none",
                    textShadow: "2px 2px 2px black",
                    boxShadow: "0 4px 6px rgba(0,0,0,0.9)",
                    whiteSpace: "nowrap",
                };

                const showTopClock = showClock && clockAtTop;
                const showBottomBar = announcement || (showClock && clockAtBottom);

                return (
                    <>
                        {showTopClock && (
                            <div style={{
                                position: "absolute",
                                margin: 0,
                                top: "min(20px, 2%)",
                                left: clockOnRight ? "auto" : "min(30px, 3%)",
                                right: clockOnRight ? "min(30px, 3%)" : "auto",
                                zIndex: 10,
                                ...pillStyle,
                            }}>
                                {localTime}
                            </div>
                        )}
                        {showBottomBar && (
                            <div style={{
                                position: "absolute",
                                bottom: "min(20px, 2%)",
                                left: "min(30px, 3%)",
                                right: "min(30px, 3%)",
                                zIndex: 10,
                                display: "flex",
                                alignItems: "stretch",
                                gap: "8px",
                                pointerEvents: "none",
                                flexDirection: (showClock && clockAtBottom && clockOnRight) ? "row" : "row-reverse",
                            }}>
                                {announcement && (
                                    <div style={{ ...pillStyle, flex: 1, padding: "4px 24px", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", visibility: "hidden" }} ref={announcementRef}>
                                        <span ref={announcementInnerRef} style={{ transformOrigin: "center", whiteSpace: "nowrap" }}>{announcement}</span>
                                    </div>
                                )}
                                {showClock && clockAtBottom && (
                                    <div style={{ ...pillStyle, flexShrink: 0 }}>
                                        {localTime}
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                );
            })()}
            <div ref={canvasWrapRef} className="ds-canvas-wrap" style={{ position: "relative" }}>
                {!hideBackground && fileUrl && fileIsVideo && (
                    <video
                        key={fileUrl}
                        src={fileUrl}
                        autoPlay
                        loop
                        muted
                        playsInline
                        className="ds-bg-media"
                        onCanPlay={() => {
                            videoReadyRef.current = true;
                            checkReady();
                        }}
                    />
                )}
                {!hideBackground && fileUrl && !fileIsVideo && (
                    <Image src={fileUrl} className="ds-bg-media" alt="" fill />
                )}
                {activeEntry?.type === "website" && (
                    <iframe
                        key={activeEntry.data}
                        src={activeEntry.data}
                        className="ds-iframe ds-iframe-loading"
                        style={{ width: "100%", height: "100%", border: "none", position: "absolute", inset: 0, zIndex: 1, backgroundColor: "transparent" }}
                        allow="autoplay; fullscreen"
                        onLoad={(e) => e.currentTarget.classList.remove("ds-iframe-loading")}
                    />
                )}
                <canvas ref={canvasRef} className="ds-canvas" style={activeEntry?.type === "website" ? { display: "none" } : undefined} />
                {showMissingAssetWarning && hasMissingAssets && (
                    <div
                        style={{
                            position: "absolute",
                            inset: 0,
                            display: "flex",
                            justifyContent: "center",
                            alignItems: "center",
                            background: "rgba(0, 0, 0, 0.45)",
                            color: "white",
                            padding: "0 12px",
                            textAlign: "center",
                            zIndex: 2,
                            pointerEvents: "none",
                        }}
                    >
                        Some image assets were missing and have been skipped.
                    </div>
                )}
            </div>
        </div>
    );
}
