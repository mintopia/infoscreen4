"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { useSocket } from "../hooks/useSocket";
import { BundleMeta, BundleSlideEntry } from "../interfaces/BundleMeta";

const DisplaySlide = dynamic(() => import("./DisplaySlide"), { ssr: false });

const PC_CONFIG: RTCConfiguration = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

interface ActiveStream {
    streamId: string;
    streamName: string;
    streamSocketId: string;
}

interface SlideLayer {
    key: number;
    json: object | null;
    bundleMeta: BundleMeta;
    activeEntry: BundleSlideEntry | null;
}

interface DisplayPageProps {
    displayId?: string;
}

export default function DisplayPage({ displayId = "1" }: DisplayPageProps) {
    const defer = (fn: () => void) => queueMicrotask(fn);
    const { state, bundleMetaUpdate, socketRef, connected, announcement } = useSocket("display", displayId);
    const [displayJson, setDisplayJson] = useState<object | null>(null);
    const [bundleMeta, setBundleMeta] = useState<BundleMeta>({});
    const loadSeqRef = useRef(0);
    const layerKeyRef = useRef(0);

    const [currentLayer, setCurrentLayer] = useState<SlideLayer | null>(null);
    const [prevLayer, setPrevLayer] = useState<SlideLayer | null>(null);
    const [transitioning, setTransitioning] = useState(false);
    const currentLayerRef = useRef<SlideLayer | null>(null);
    const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        currentLayerRef.current = currentLayer;
    }, [currentLayer]);

    // WebRTC stream state
    const [activeStream, setActiveStream] = useState<ActiveStream | null>(null);
    const activeStreamRef = useRef<ActiveStream | null>(null);
    const streamVideoRef = useRef<HTMLVideoElement>(null);
    const pcRef = useRef<RTCPeerConnection | null>(null);

    useEffect(() => {
        activeStreamRef.current = activeStream;
    }, [activeStream]);

    const commitLayer = useCallback((json: object | null, meta: BundleMeta, slideId: string | undefined) => {
        const entry = meta.slides?.find(s => s.id === slideId) ?? null;
        const newLayer: SlideLayer = {
            key: ++layerKeyRef.current,
            json,
            bundleMeta: meta,
            activeEntry: entry,
        };

        const transition = meta.transition ?? "cut";
        const duration = meta.transitionDuration ?? 0.5;

        if (transitionTimerRef.current) {
            clearTimeout(transitionTimerRef.current);
            transitionTimerRef.current = null;
        }

        if (transition === "dissolve" && currentLayerRef.current) {
            setPrevLayer(currentLayerRef.current);
            setCurrentLayer(newLayer);
            setTransitioning(true);
            transitionTimerRef.current = setTimeout(() => {
                setPrevLayer(null);
                setTransitioning(false);
            }, duration * 1000);
        } else {
            setPrevLayer(null);
            setCurrentLayer(newLayer);
            setTransitioning(false);
        }
    }, []);

    // Slide loading
    useEffect(() => {
        const active = state.activeSlide;
        if (!active) {
            defer(() => {
                setDisplayJson(null);
                setBundleMeta({});
                if (transitionTimerRef.current) {
                    clearTimeout(transitionTimerRef.current);
                    transitionTimerRef.current = null;
                }
                setPrevLayer(null);
                setCurrentLayer(null);
                setTransitioning(false);
            });
            return;
        }

        const hasSocketJson = active.json != null;
        const hasSocketMeta = active.bundleMeta != null;
        if (hasSocketJson && hasSocketMeta) {
            const meta = active.bundleMeta as BundleMeta;
            const json = active.json as object;
            defer(() => {
                setBundleMeta(meta);
                setDisplayJson(json);
                commitLayer(json, meta, active.slide);
            });
            return;
        }

        const seq = ++loadSeqRef.current;

        Promise.all([
            hasSocketMeta
                ? Promise.resolve(active.bundleMeta as BundleMeta)
                : fetch(`/api/bundles/${encodeURIComponent(active.bundle)}`)
                    .then((r) => r.json()).catch(() => ({})),
            hasSocketJson
                ? Promise.resolve(active.json)
                : fetch(`/api/bundles/${encodeURIComponent(active.bundle)}/slides/${encodeURIComponent(active.slide)}`)
                    .then((r) => r.json()).catch(() => null),
        ]).then(([meta, json]) => {
            if (loadSeqRef.current !== seq) return;
            const m = (meta ?? {}) as BundleMeta;
            setBundleMeta(m);
            if (json) setDisplayJson(json);
            commitLayer(json, m, active.slide);
        });
    }, [state.activeSlide, commitLayer]);

    useEffect(() => {
        if (!bundleMetaUpdate) return;
        const active = state.activeSlide;
        if (!active || active.bundle !== bundleMetaUpdate.bundle) return;
        defer(() => setBundleMeta(bundleMetaUpdate.meta as BundleMeta));
    }, [bundleMetaUpdate, state.activeSlide]);

    // WebRTC stream handling
    useEffect(() => {
        const socket = socketRef.current;
        if (!socket) return;

        function teardown() {
            const currentStream = activeStreamRef.current;
            if (currentStream) {
                socket?.emit("stream:unwatch", { streamId: currentStream.streamId });
            }
            pcRef.current?.close();
            pcRef.current = null;
            if (streamVideoRef.current) streamVideoRef.current.srcObject = null;
            activeStreamRef.current = null;
            setActiveStream(null);
        }

        function onStreamIncoming(data: ActiveStream) {
            teardown();
            activeStreamRef.current = data;
            setActiveStream(data);

            const pc = new RTCPeerConnection(PC_CONFIG);
            pcRef.current = pc;

            pc.ontrack = (e) => {
                const ms = e.streams[0] ?? new MediaStream([e.track]);
                if (streamVideoRef.current) streamVideoRef.current.srcObject = ms;
            };

            const sock = socketRef.current;
            pc.onicecandidate = (e) => {
                if (e.candidate) {
                    sock?.emit("stream:signal", {
                        to: data.streamSocketId,
                        data: { type: "candidate", candidate: e.candidate },
                    });
                }
            };

            sock?.emit("stream:watch", { streamId: data.streamId });
        }

        function onStreamSignal({ from, data: sigData }: { from: string; data: RTCSessionDescriptionInit | { type: "candidate"; candidate: RTCIceCandidateInit } }) {
            const pc = pcRef.current;
            if (!pc) return;
            if (sigData.type === "offer") {
                pc.setRemoteDescription(new RTCSessionDescription(sigData as RTCSessionDescriptionInit))
                    .then(() => pc.createAnswer())
                    .then((answer) => pc.setLocalDescription(answer))
                    .then(() => {
                        socketRef.current?.emit("stream:signal", { to: from, data: pc.localDescription });
                    });
            } else if (sigData.type === "candidate" && "candidate" in sigData && sigData.candidate) {
                pc.addIceCandidate(new RTCIceCandidate(sigData.candidate));
            }
        }

        function onStreamCleared() { teardown(); }
        function onStreamEnded() { teardown(); }

        socket.on("stream:incoming", onStreamIncoming);
        socket.on("stream:signal", onStreamSignal);
        socket.on("stream:cleared", onStreamCleared);
        socket.on("stream:ended", onStreamEnded);

        return () => {
            socket.off("stream:incoming", onStreamIncoming);
            socket.off("stream:signal", onStreamSignal);
            socket.off("stream:cleared", onStreamCleared);
            socket.off("stream:ended", onStreamEnded);
            teardown();
        };
    }, [connected, socketRef]);

    const transitionDuration = bundleMeta.transitionDuration ?? 0.5;

    return (
        <div className="display-root">
            {!state.activeSlide && !activeStream && (
                <div className="display-standby">
                    <span className="display-standby-text">Standby</span>
                </div>
            )}
            {prevLayer && (
                <div className="ds-transition-layer" style={{ zIndex: 1 }}>
                    <DisplaySlide
                        key={prevLayer.key}
                        json={prevLayer.json}
                        bundleMeta={prevLayer.bundleMeta}
                        activeEntry={prevLayer.activeEntry}
                        announcement={announcement}
                    />
                </div>
            )}
            {currentLayer && (
                <div
                    className={`ds-transition-layer ${transitioning ? "ds-dissolve-in" : ""}`}
                    style={{
                        zIndex: 2,
                        ...(transitioning ? { animationDuration: `${transitionDuration}s` } : {}),
                    }}
                >
                    <DisplaySlide
                        key={currentLayer.key}
                        json={currentLayer.json}
                        bundleMeta={currentLayer.bundleMeta}
                        activeEntry={currentLayer.activeEntry}
                        announcement={announcement}
                    />
                </div>
            )}
            {!currentLayer && (
                <DisplaySlide
                    json={displayJson}
                    bundleMeta={bundleMeta}
                    activeEntry={bundleMeta.slides?.find(s => s.id === state.activeSlide?.slide) ?? null}
                    announcement={announcement}
                />
            )}
            {activeStream && (
                <div className="absolute inset-0 z-50 bg-black flex items-center justify-center">
                    <video
                        ref={streamVideoRef}
                        autoPlay
                        playsInline
                        className="w-full h-full object-contain"
                    />
                </div>
            )}
        </div>
    );
}
