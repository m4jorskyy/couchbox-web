import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CornerDownLeft,
  Delete,
  Gamepad2,
  Grid2x2,
  Home,
  Keyboard,
  Maximize2,
  MousePointer2,
  Play,
  Power,
  RotateCcw,
  RotateCw,
  Send,
  Undo2,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { RemoteMessage, TvSnapshot } from "./types";

const TOKEN_STORAGE_KEY = "couchbox_device_token";

function haptic(ms = 10) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(ms);
  }
}

export default function App() {
  const [deviceToken, setDeviceToken] = useState<string | null>(() =>
    localStorage.getItem(TOKEN_STORAGE_KEY)
  );
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [pinInput, setPinInput] = useState("");

  const [wsStatus, setWsStatus] = useState<"connecting" | "connected" | "offline">(
    "offline"
  );
  const [snapshot, setSnapshot] = useState<TvSnapshot | null>(null);
  const [mode, setMode] = useState<"dpad" | "trackpad">("dpad");

  const [sheet, setSheet] = useState<"none" | "keyboard" | "apps" | "power">("none");
  const [textValue, setTextValue] = useState("");
  const [submitEnter, setSubmitEnter] = useState(true);
  const [customUrl, setCustomUrl] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);

  // Trackpad touch state
  const touchState = useRef<{
    active: boolean;
    fingers: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    startTime: number;
    moved: number;
    pendingDx: number;
    pendingDy: number;
    pendingScrollY: number;
    rafId: number | null;
  }>({
    active: false,
    fingers: 0,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    startTime: 0,
    moved: 0,
    pendingDx: 0,
    pendingDy: 0,
    pendingScrollY: 0,
    rafId: null,
  });

  const sendMsg = useCallback((msg: RemoteMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const performPair = useCallback(async (payload: { pairToken?: string; pin?: string }) => {
    setPairingBusy(true);
    setPairError(null);
    try {
      const res = await fetch("/api/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Invalid QR code or PIN");
      }
      const data = await res.json();
      localStorage.setItem(TOKEN_STORAGE_KEY, data.deviceToken);
      setDeviceToken(data.deviceToken);
      if (data.snapshot) {
        setSnapshot(data.snapshot);
      }
      if (window.location.search.includes("pair=")) {
        window.history.replaceState({}, "", "/");
      }
    } catch (err) {
      setPairError(err instanceof Error ? err.message : "Pairing failed");
    } finally {
      setPairingBusy(false);
    }
  }, []);

  // Auto-pair if opened via QR link `/?pair=...`
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pairToken = params.get("pair");
    if (pairToken) {
      performPair({ pairToken });
    }
  }, [performPair]);

  // Persistent WebSocket with auto-reconnect
  useEffect(() => {
    if (!deviceToken) return;
    let cancelled = false;
    let retryTimer: number | null = null;

    const connect = () => {
      if (cancelled) return;
      setWsStatus("connecting");
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(
        `${proto}//${window.location.host}/ws?token=${encodeURIComponent(deviceToken)}`
      );
      wsRef.current = ws;

      ws.onopen = () => {
        if (!cancelled) setWsStatus("connected");
      };

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.type === "state_sync" && data.snapshot) {
            setSnapshot(data.snapshot);
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = (ev) => {
        if (cancelled) return;
        wsRef.current = null;
        setWsStatus("offline");
        // If server rejected token (e.g., revoked), reset to pairing screen
        if (ev.code === 1008 || ev.code === 4001) {
          localStorage.removeItem(TOKEN_STORAGE_KEY);
          setDeviceToken(null);
          return;
        }
        retryTimer = window.setTimeout(connect, 1500);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    const onVisible = () => {
      if (document.visibilityState === "visible" && (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN)) {
        if (retryTimer) window.clearTimeout(retryTimer);
        connect();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (retryTimer) window.clearTimeout(retryTimer);
      wsRef.current?.close();
    };
  }, [deviceToken]);

  // Focus text input whenever keyboard sheet opens
  useEffect(() => {
    if (sheet === "keyboard") {
      window.setTimeout(() => textInputRef.current?.focus(), 60);
    }
  }, [sheet]);

  const flushTrackpad = useCallback(() => {
    const st = touchState.current;
    st.rafId = null;
    if (st.pendingDx !== 0 || st.pendingDy !== 0) {
      sendMsg({
        type: "trackpad",
        action: "move",
        dx: Math.round(st.pendingDx),
        dy: Math.round(st.pendingDy),
      });
      st.pendingDx = 0;
      st.pendingDy = 0;
    }
    if (Math.abs(st.pendingScrollY) >= 1) {
      const step = Math.trunc(st.pendingScrollY);
      sendMsg({
        type: "trackpad",
        action: "scroll",
        dy: step,
      });
      st.pendingScrollY -= step;
    }
  }, [sendMsg]);

  const scheduleFlush = useCallback(() => {
    const st = touchState.current;
    if (st.rafId === null) {
      st.rafId = window.requestAnimationFrame(flushTrackpad);
    }
  }, [flushTrackpad]);

  const onTouchStart = (e: React.TouchEvent) => {
    const st = touchState.current;
    const t = e.touches[0];
    st.active = true;
    st.fingers = Math.max(st.fingers, e.touches.length);
    st.startX = t.clientX;
    st.startY = t.clientY;
    st.lastX = t.clientX;
    st.lastY = t.clientY;
    st.startTime = Date.now();
    st.moved = 0;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const st = touchState.current;
    if (!st.active) return;
    const t = e.touches[0];
    const rawDx = t.clientX - st.lastX;
    const rawDy = t.clientY - st.lastY;
    st.lastX = t.clientX;
    st.lastY = t.clientY;
    st.moved += Math.hypot(rawDx, rawDy);

    if (e.touches.length >= 2) {
      st.fingers = 2;
      st.pendingScrollY += rawDy * 0.16;
    } else {
      // Gentle speed acceleration for comfortable 1080p/4K traversal
      const speed = Math.hypot(rawDx, rawDy);
      const gain = speed > 14 ? 2.4 : speed > 6 ? 1.85 : 1.35;
      st.pendingDx += rawDx * gain;
      st.pendingDy += rawDy * gain;
    }
    scheduleFlush();
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const st = touchState.current;
    if (e.touches.length > 0) return;
    const duration = Date.now() - st.startTime;
    if (st.active && st.moved < 10 && duration < 230) {
      haptic(12);
      if (st.fingers >= 2) {
        sendMsg({ type: "trackpad", action: "right_click" });
      } else {
        sendMsg({ type: "trackpad", action: "click" });
      }
    }
    st.active = false;
    st.fingers = 0;
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textValue) return;
    haptic(12);
    sendMsg({
      type: "text",
      mode: "type",
      value: textValue,
      submit: submitEnter,
    });
    setTextValue("");
  };

  const handleCustomUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customUrl.trim()) return;
    haptic(12);
    sendMsg({
      type: "app",
      action: "open_url",
      url: customUrl.trim(),
    });
    setCustomUrl("");
    setSheet("none");
  };

  if (!deviceToken) {
    return (
      <div className="pair-screen">
        <div>
          <h1 className="pair-title">CouchBox Remote</h1>
          <p className="pair-sub">
            Scan the QR code on your laptop TV screen, or enter the 4-digit PIN shown
            in the corner.
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (pinInput.trim().length >= 4) {
              performPair({ pin: pinInput.trim() });
            }
          }}
          style={{ display: "flex", flexDirection: "column", gap: 14 }}
        >
          <input
            className="pin-input"
            type="tel"
            inputMode="numeric"
            maxLength={4}
            placeholder="0000"
            value={pinInput}
            onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ""))}
            autoFocus
          />
          <button
            className="pair-btn"
            type="submit"
            disabled={pairingBusy || pinInput.length < 4}
          >
            {pairingBusy ? "Pairing..." : "Pair Phone"}
          </button>
        </form>

        {pairError && <div className="pair-error">{pairError}</div>}
      </div>
    );
  }

  const activeName = snapshot?.activeAppName || "Home";

  return (
    <div className="remote-shell">
      {/* Top Bar */}
      <div className="top-bar">
        <div className="status-pill">
          <span
            className={`status-dot ${
              wsStatus === "connected"
                ? "connected"
                : wsStatus === "offline"
                ? "offline"
                : ""
            }`}
          />
          <span className="status-label">
            {wsStatus === "connected" ? activeName : "Reconnecting..."}
          </span>
        </div>

        <div className="top-actions">
          <button
            className="icon-pill home-btn"
            onClick={() => {
              haptic(14);
              sendMsg({ type: "nav", action: "home" });
            }}
            aria-label="Home"
          >
            <Home size={16} />
            <span>Home</span>
          </button>
          <button
            className="icon-pill"
            onClick={() => {
              haptic(8);
              setSheet("apps");
            }}
            aria-label="Apps"
          >
            <Grid2x2 size={16} />
          </button>
          <button
            className="icon-pill"
            onClick={() => {
              haptic(8);
              setSheet("power");
            }}
            aria-label="Power"
          >
            <Power size={16} />
          </button>
        </div>
      </div>

      {/* Mode Switch */}
      <div className="mode-switch">
        <button
          className={`mode-tab ${mode === "dpad" ? "active" : ""}`}
          onClick={() => {
            haptic(8);
            setMode("dpad");
          }}
        >
          <Gamepad2 size={16} />
          <span>D-Pad</span>
        </button>
        <button
          className={`mode-tab ${mode === "trackpad" ? "active" : ""}`}
          onClick={() => {
            haptic(8);
            setMode("trackpad");
          }}
        >
          <MousePointer2 size={16} />
          <span>Trackpad</span>
        </button>
      </div>

      {/* Center Interactive Surface */}
      <div className="center-stage">
        {mode === "dpad" ? (
          <div className="dpad-wrap">
            <div className="dpad-ring">
              <button
                className="dpad-dir dpad-up"
                onClick={() => {
                  haptic(10);
                  sendMsg({ type: "nav", action: "up" });
                }}
                aria-label="Up"
              >
                <ChevronUp size={30} />
              </button>
              <button
                className="dpad-dir dpad-down"
                onClick={() => {
                  haptic(10);
                  sendMsg({ type: "nav", action: "down" });
                }}
                aria-label="Down"
              >
                <ChevronDown size={30} />
              </button>
              <button
                className="dpad-dir dpad-left"
                onClick={() => {
                  haptic(10);
                  sendMsg({ type: "nav", action: "left" });
                }}
                aria-label="Left"
              >
                <ChevronLeft size={30} />
              </button>
              <button
                className="dpad-dir dpad-right"
                onClick={() => {
                  haptic(10);
                  sendMsg({ type: "nav", action: "right" });
                }}
                aria-label="Right"
              >
                <ChevronRight size={30} />
              </button>
              <button
                className="dpad-ok"
                onClick={() => {
                  haptic(16);
                  sendMsg({ type: "nav", action: "ok" });
                }}
              >
                OK
              </button>
            </div>

            <div className="dpad-subrow">
              <button
                className="sub-btn"
                onClick={() => {
                  haptic(10);
                  sendMsg({ type: "nav", action: "back" });
                }}
              >
                <Undo2 size={17} />
                <span>Back</span>
              </button>
              <button
                className="sub-btn"
                onClick={() => {
                  haptic(10);
                  sendMsg({ type: "nav", action: "fullscreen" });
                }}
              >
                <Maximize2 size={17} />
                <span>Fullscreen</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="trackpad-wrap">
            <div
              className="trackpad-surface"
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
              onTouchCancel={onTouchEnd}
            >
              <MousePointer2 size={24} style={{ opacity: 0.45 }} />
              <div className="trackpad-hint">
                Drag to move cursor • Tap to click • 2-finger drag to scroll
              </div>
            </div>
            <div className="trackpad-nav-row">
              <button
                className="trackpad-nav-btn"
                onClick={() => {
                  haptic(10);
                  sendMsg({ type: "nav", action: "browser_back" });
                }}
              >
                <Undo2 size={15} />
                <span>Back</span>
              </button>
              <button
                className="trackpad-nav-btn"
                onClick={() => {
                  haptic(10);
                  sendMsg({ type: "nav", action: "back" });
                }}
              >
                <span>Esc</span>
              </button>
              <button
                className="trackpad-nav-btn"
                onClick={() => {
                  haptic(10);
                  sendMsg({ type: "nav", action: "fullscreen" });
                }}
              >
                <Maximize2 size={15} />
                <span>Full</span>
              </button>
            </div>
            <div className="click-row">
              <button
                className="click-btn"
                onClick={() => {
                  haptic(12);
                  sendMsg({ type: "trackpad", action: "click" });
                }}
              >
                Left Click
              </button>
              <button
                className="click-btn"
                onClick={() => {
                  haptic(12);
                  sendMsg({ type: "trackpad", action: "right_click" });
                }}
              >
                Right
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Crucial Always-Reachable Keyboard Trigger */}
      <button
        className="keyboard-cta"
        onClick={() => {
          haptic(10);
          setSheet("keyboard");
        }}
      >
        <Keyboard size={18} color="#F59E0B" />
        <span>Type on TV</span>
      </button>

      {/* Bottom Media & Volume Deck */}
      <div className="media-deck">
        <button
          className="deck-btn"
          onClick={() => {
            haptic(10);
            sendMsg({ type: "media", action: "seek_back" });
          }}
        >
          <RotateCcw size={17} />
          <span>-10s</span>
        </button>
        <button
          className="deck-btn primary"
          onClick={() => {
            haptic(14);
            sendMsg({ type: "media", action: "play_pause" });
          }}
        >
          <Play size={18} />
          <span>Play</span>
        </button>
        <button
          className="deck-btn"
          onClick={() => {
            haptic(10);
            sendMsg({ type: "media", action: "seek_forward" });
          }}
        >
          <RotateCw size={17} />
          <span>+10s</span>
        </button>
        <button
          className="deck-btn"
          onClick={() => {
            haptic(10);
            sendMsg({ type: "media", action: "mute" });
          }}
        >
          <VolumeX size={18} />
          <span>Mute</span>
        </button>
        <button
          className="deck-btn"
          onClick={() => {
            haptic(8);
            sendMsg({ type: "media", action: "vol_down" });
          }}
        >
          <Volume1 size={18} />
          <span>Vol -</span>
        </button>
        <button
          className="deck-btn"
          onClick={() => {
            haptic(8);
            sendMsg({ type: "media", action: "vol_up" });
          }}
        >
          <Volume2 size={18} />
          <span>Vol +</span>
        </button>
      </div>

      {/* Keyboard Sheet */}
      {sheet === "keyboard" && (
        <div className="sheet-backdrop" onClick={() => setSheet("none")}>
          <div className="sheet-card" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <h2 className="sheet-title">Type to TV</h2>
              <button className="close-btn" onClick={() => setSheet("none")}>
                <X size={18} />
              </button>
            </div>

            <form className="text-form" onSubmit={handleTextSubmit}>
              <input
                ref={textInputRef}
                className="text-input"
                type="text"
                placeholder="Search YouTube, Netflix, Twitch..."
                value={textValue}
                onChange={(e) => setTextValue(e.target.value)}
                autoComplete="off"
              />
              <button className="send-btn" type="submit">
                <Send size={17} />
              </button>
            </form>

            <label className="toggle-row">
              <span>Press Enter automatically after sending</span>
              <input
                type="checkbox"
                checked={submitEnter}
                onChange={(e) => setSubmitEnter(e.target.checked)}
              />
            </label>

            <div className="quick-keys">
              <button
                className="qkey"
                onClick={() => {
                  haptic(8);
                  sendMsg({ type: "text", mode: "key", value: "backspace" });
                }}
              >
                <Delete size={15} />
                <span>Backspace</span>
              </button>
              <button
                className="qkey"
                onClick={() => {
                  haptic(10);
                  sendMsg({ type: "text", mode: "key", value: "clear_all" });
                }}
              >
                <span>Clear All</span>
              </button>
              <button
                className="qkey"
                onClick={() => {
                  haptic(8);
                  sendMsg({ type: "text", mode: "key", value: "enter" });
                }}
              >
                <CornerDownLeft size={15} />
                <span>Enter</span>
              </button>
              <button
                className="qkey"
                onClick={() => {
                  haptic(8);
                  sendMsg({ type: "text", mode: "key", value: "space" });
                }}
              >
                <span>Space</span>
              </button>
              <button
                className="qkey"
                onClick={() => {
                  haptic(8);
                  sendMsg({ type: "text", mode: "key", value: "escape" });
                }}
              >
                <span>Esc</span>
              </button>
              <button
                className="qkey"
                onClick={() => {
                  haptic(8);
                  sendMsg({ type: "text", mode: "key", value: "tab" });
                }}
              >
                <span>Tab</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Apps & Send URL Sheet */}
      {sheet === "apps" && (
        <div className="sheet-backdrop" onClick={() => setSheet("none")}>
          <div className="sheet-card" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <h2 className="sheet-title">Launch on TV</h2>
              <button className="close-btn" onClick={() => setSheet("none")}>
                <X size={18} />
              </button>
            </div>

            <div className="app-list">
              {(snapshot?.apps || []).map((app) => (
                <button
                  key={app.id}
                  className="app-row"
                  onClick={() => {
                    haptic(14);
                    sendMsg({ type: "app", action: "launch", app_id: app.id });
                    setSheet("none");
                  }}
                >
                  <div className="app-meta">
                    <span
                      className="app-badge"
                      style={{ background: app.accent }}
                    />
                    <div>
                      <div className="app-name">{app.name}</div>
                      <div className="app-sub">{app.subtitle}</div>
                    </div>
                  </div>
                  <ChevronRight size={18} color="#8A94A6" />
                </button>
              ))}
            </div>

            <form className="text-form" onSubmit={handleCustomUrlSubmit}>
              <input
                className="text-input"
                type="url"
                placeholder="Paste any URL to open on TV..."
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
              />
              <button className="send-btn" type="submit">
                Open
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Power Sheet */}
      {sheet === "power" && (
        <div className="sheet-backdrop" onClick={() => setSheet("none")}>
          <div className="sheet-card" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <h2 className="sheet-title">Laptop Power</h2>
              <button className="close-btn" onClick={() => setSheet("none")}>
                <X size={18} />
              </button>
            </div>

            <button
              className="app-row"
              onClick={() => {
                haptic(14);
                sendMsg({ type: "power", action: "screen_off" });
                setSheet("none");
              }}
            >
              <div>
                <div className="app-name">Turn Screen Off</div>
                <div className="app-sub">Dims/sleeps display (move trackpad to wake)</div>
              </div>
            </button>

            <button
              className="app-row"
              onClick={() => {
                haptic(18);
                sendMsg({ type: "power", action: "sleep_system" });
                setSheet("none");
              }}
            >
              <div>
                <div className="app-name">Sleep Laptop</div>
                <div className="app-sub">Puts the laptop into suspend mode</div>
              </div>
            </button>

            <button
              className="app-row"
              onClick={() => {
                localStorage.removeItem(TOKEN_STORAGE_KEY);
                setDeviceToken(null);
                setSheet("none");
              }}
            >
              <div>
                <div className="app-name" style={{ color: "#FCA5A5" }}>
                  Disconnect & Re-pair
                </div>
                <div className="app-sub">Clear saved device token on this phone</div>
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
