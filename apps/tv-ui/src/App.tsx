import React, { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { QRCodeSVG } from "qrcode.react";
import {
  Globe,
  Maximize2,
  Plus,
  QrCode,
  RefreshCw,
  Settings,
  Smartphone,
  Trash2,
  Tv,
  X,
} from "lucide-react";
import type { TvSnapshot } from "./types";

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

function formatClock(date: Date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function App() {
  const [snapshot, setSnapshot] = useState<TvSnapshot | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [clock, setClock] = useState(() => formatClock(new Date()));
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [showQr, setShowQr] = useState(true);
  const [showSetup, setShowSetup] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [ambientMode, setAmbientMode] = useState(false);

  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newUaMode, setNewUaMode] = useState("default");

  const gridRef = useRef<HTMLDivElement | null>(null);

  const wakeUp = useCallback(() => {
    setAmbientMode(false);
  }, []);

  // Load initial snapshot & subscribe once with strict-mode safe cleanup
  useEffect(() => {
    let disposed = false;
    let unlistenSnap: (() => void) | undefined;

    invoke<TvSnapshot>("get_tv_snapshot")
      .then((snap) => {
        if (disposed) return;
        setSnapshot(snap);
        if (snap.connectedPhones > 0) setShowQr(false);
      })
      .catch((err) => {
        if (!disposed) setErrorMsg(String(err));
      });

    listen<TvSnapshot>("tv:snapshot", (event) => {
      if (disposed) return;
      setSnapshot(event.payload);
      if (event.payload.connectedPhones > 0) {
        setShowQr(false);
      }
    }).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlistenSnap = fn;
      }
    });

    return () => {
      disposed = true;
      unlistenSnap?.();
    };
  }, []);

  // Clock tick
  useEffect(() => {
    const id = window.setInterval(() => setClock(formatClock(new Date())), 15000);
    return () => window.clearInterval(id);
  }, []);

  // Ambient screensaver after idle on Home
  useEffect(() => {
    let timer = window.setTimeout(() => {
      if (!snapshot?.activeAppId) {
        setAmbientMode(true);
      }
    }, IDLE_TIMEOUT_MS);

    const reset = () => {
      setAmbientMode(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!snapshot?.activeAppId) {
          setAmbientMode(true);
        }
      }, IDLE_TIMEOUT_MS);
    };

    window.addEventListener("mousemove", reset);
    window.addEventListener("keydown", reset);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("mousemove", reset);
      window.removeEventListener("keydown", reset);
    };
  }, [snapshot?.activeAppId]);

  const apps = snapshot?.apps ?? [];
  const totalTiles = apps.length + 1; // +1 for "Add Site" tile

  const getGridCols = useCallback(() => {
    if (!gridRef.current) return 2;
    const cols = window
      .getComputedStyle(gridRef.current)
      .gridTemplateColumns.split(" ")
      .filter((s) => s.trim().length > 0).length;
    return Math.max(1, cols);
  }, []);

  const handleLaunch = useCallback(async (appId: string) => {
    setErrorMsg(null);
    try {
      const updated = await invoke<TvSnapshot>("launch_app", { appId });
      setSnapshot(updated);
    } catch (err) {
      setErrorMsg(String(err));
    }
  }, []);

  const handleToggleTunnel = useCallback(async () => {
    setErrorMsg(null);
    const isRunning =
      snapshot?.pairing.tunnelStatus === "ready" ||
      snapshot?.pairing.tunnelStatus === "starting";
    try {
      const updated = await invoke<TvSnapshot>("toggle_remote_tunnel", {
        enable: !isRunning,
      });
      setSnapshot(updated);
    } catch (err) {
      setErrorMsg(String(err));
    }
  }, [snapshot?.pairing.tunnelStatus]);

  const toggleFullscreen = useCallback(async () => {
    try {
      const win = getCurrentWindow();
      const isFull = await win.isFullscreen();
      await win.setFullscreen(!isFull);
    } catch {
      // ignore if outside tauri
    }
  }, []);

  const handleNavAction = useCallback(
    (action: string) => {
      wakeUp();
      if (showAddModal || showSetup) {
        if (action === "back" || action === "browser_back") {
          setShowAddModal(false);
          setShowSetup(false);
        }
        return;
      }

      const cols = getGridCols();

      if (action === "left") {
        setFocusedIndex((i) => (i - 1 + totalTiles) % totalTiles);
      } else if (action === "right") {
        setFocusedIndex((i) => (i + 1) % totalTiles);
      } else if (action === "up") {
        setFocusedIndex((i) => (i - cols >= 0 ? i - cols : i));
      } else if (action === "down") {
        setFocusedIndex((i) => (i + cols < totalTiles ? i + cols : i));
      } else if (action === "ok") {
        if (focusedIndex < apps.length) {
          handleLaunch(apps[focusedIndex].id);
        } else {
          setShowAddModal(true);
        }
      } else if (action === "fullscreen") {
        toggleFullscreen();
      }
    },
    [
      apps,
      focusedIndex,
      getGridCols,
      handleLaunch,
      showAddModal,
      showSetup,
      toggleFullscreen,
      totalTiles,
      wakeUp,
    ]
  );

  // Keep a ref to latest handler so Tauri event listener is registered ONCE (no duplicate/dropped arrows)
  const navHandlerRef = useRef(handleNavAction);
  navHandlerRef.current = handleNavAction;

  useEffect(() => {
    let disposed = false;
    let unlistenNav: (() => void) | undefined;

    listen<string>("remote:nav", (event) => {
      if (!disposed) {
        navHandlerRef.current(event.payload);
      }
    }).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlistenNav = fn;
      }
    });

    return () => {
      disposed = true;
      unlistenNav?.();
    };
  }, []);

  // Physical laptop keyboard arrows/Enter/F
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (showAddModal) {
        if (e.key === "Escape") setShowAddModal(false);
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        navHandlerRef.current("left");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        navHandlerRef.current("right");
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        navHandlerRef.current("up");
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        navHandlerRef.current("down");
      } else if (e.key === "Enter") {
        e.preventDefault();
        navHandlerRef.current("ok");
      } else if (e.key === "Escape") {
        navHandlerRef.current("back");
      } else if (e.key.toLowerCase() === "f" && !showSetup) {
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showAddModal, showSetup, toggleFullscreen]);

  const handleAddApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newUrl.trim()) return;
    setErrorMsg(null);
    try {
      const updated = await invoke<TvSnapshot>("add_custom_app", {
        name: newName,
        url: newUrl,
        userAgentMode: newUaMode,
      });
      setSnapshot(updated);
      setNewName("");
      setNewUrl("");
      setNewUaMode("default");
      setShowAddModal(false);
    } catch (err) {
      setErrorMsg(String(err));
    }
  };

  const handleRemoveApp = async (e: React.MouseEvent, appId: string) => {
    e.stopPropagation();
    const updated = await invoke<TvSnapshot>("remove_custom_app", { appId });
    setSnapshot(updated);
    setFocusedIndex(0);
  };

  const focusedApp = focusedIndex < apps.length ? apps[focusedIndex] : null;
  const glowColor = focusedApp?.accent || "#F59E0B";
  const tunnelStatus = snapshot?.pairing.tunnelStatus ?? "off";

  return (
    <div className="tv-stage" onClick={wakeUp}>
      <div
        className="ambient-glow"
        style={{
          background: `radial-gradient(circle at 28% 35%, ${glowColor}, transparent 68%)`,
        }}
      />

      {/* Top Bar */}
      <header className="tv-header">
        <div className="brand-block">
          <Tv size={26} color="#F59E0B" />
          <span className="brand-name">CouchBox</span>
          <span className="tv-clock">{clock}</span>
        </div>

        <div className="header-actions">
          <button className="pill-btn" onClick={() => setShowQr((v) => !v)}>
            <span
              className={`led ${
                (snapshot?.connectedPhones ?? 0) > 0 ? "connected" : ""
              }`}
            />
            <Smartphone size={16} />
            <span>
              {(snapshot?.connectedPhones ?? 0) > 0
                ? `${snapshot?.connectedPhones} phone connected`
                : "Pair phone"}
            </span>
            <QrCode size={15} color="#8A94A6" />
          </button>

          <button className="pill-btn" onClick={() => setShowSetup(true)}>
            <Settings size={16} />
            <span>Setup</span>
          </button>

          <button className="pill-btn" onClick={toggleFullscreen}>
            <Maximize2 size={16} />
            <span>Fullscreen</span>
          </button>
        </div>
      </header>

      {/* Main Stage */}
      <main className="tv-center">
        <section className="stage-left">
          <div>
            <h1 className="hero-headline">
              {focusedApp ? focusedApp.name : "Add streaming site"}
            </h1>
            <p className="hero-sub">
              {focusedApp
                ? focusedApp.subtitle
                : "Pin Disney+, Max, Kick, or any streaming URL to your home screen"}
            </p>
          </div>

          {errorMsg && <div className="error-banner">{errorMsg}</div>}

          <div className="apps-grid" ref={gridRef}>
            {apps.map((app, idx) => (
              <button
                key={app.id}
                className={`app-tile ${focusedIndex === idx ? "focused" : ""}`}
                onMouseEnter={() => setFocusedIndex(idx)}
                onClick={() => handleLaunch(app.id)}
              >
                <div className="tile-top">
                  <span
                    className="tile-dot"
                    style={{ background: app.accent }}
                  />
                  <span className="tile-tag">
                    {app.userAgentMode === "tv" ? "TV Mode" : "Browser Kiosk"}
                  </span>
                </div>

                {!app.builtIn && (
                  <span
                    className="tile-remove"
                    role="button"
                    aria-label={`Remove ${app.name}`}
                    onClick={(e) => handleRemoveApp(e, app.id)}
                  >
                    <Trash2 size={14} />
                  </span>
                )}

                <div>
                  <div className="tile-title">{app.name}</div>
                  <div className="tile-desc">{app.subtitle}</div>
                </div>
              </button>
            ))}

            <button
              className={`app-tile add-tile ${
                focusedIndex === apps.length ? "focused" : ""
              }`}
              onMouseEnter={() => setFocusedIndex(apps.length)}
              onClick={() => setShowAddModal(true)}
            >
              <Plus size={30} />
              <span style={{ fontSize: 16, fontWeight: 600 }}>Add Site</span>
            </button>
          </div>
        </section>

        {/* QR Pairing Panel */}
        {showQr && snapshot && (
          <aside className="pair-card">
            <h2 className="pair-heading">Phone Remote</h2>
            <p className="pair-copy">
              {tunnelStatus === "ready"
                ? "Public tunnel active — works from 5G or any Wi-Fi."
                : "Scan on the same Wi-Fi, or enable Remote Tunnel for 5G / other networks."}
            </p>
            <div className="qr-frame">
              <QRCodeSVG
                value={snapshot.pairing.qrUrl}
                size={180}
                bgColor="#FFFFFF"
                fgColor="#090B10"
                level="M"
              />
            </div>
            <div className="pin-display">
              <span>PIN fallback</span>
              <span className="pin-code">{snapshot.pairing.pin}</span>
            </div>
            <div className="lan-url">{snapshot.pairing.baseUrl}</div>
            <button
              className="btn-secondary"
              style={{
                width: "100%",
                height: 38,
                fontSize: 13,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
              onClick={handleToggleTunnel}
            >
              <Globe size={15} color={tunnelStatus === "ready" ? "#22C55E" : "#F59E0B"} />
              <span>
                {tunnelStatus === "ready"
                  ? "Disable 5G Tunnel (use LAN)"
                  : tunnelStatus === "starting"
                  ? "Starting tunnel..."
                  : "Enable 5G / Any-Network Tunnel"}
              </span>
            </button>
          </aside>
        )}
      </main>

      {/* Footer */}
      <footer className="tv-footer">
        <div className="footer-left">
          <span>
            Browser:{" "}
            <strong style={{ color: "#F5F7FA" }}>
              {snapshot?.setup.browserFound
                ? snapshot.setup.browserName
                : "Not found (install Chrome/Edge)"}
            </strong>
          </span>
          {snapshot?.activeAppId && (
            <button
              className="pill-btn"
              style={{ height: 34, padding: "0 14px", fontSize: 13 }}
              onClick={() => invoke<TvSnapshot>("return_home").then(setSnapshot)}
            >
              Close active app ({snapshot.activeAppName})
            </button>
          )}
        </div>
        <span>Press Home on your phone anytime to return here</span>
      </footer>

      {/* Setup Check Modal */}
      {showSetup && snapshot && (
        <div className="modal-backdrop" onClick={() => setShowSetup(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2 className="modal-title">Setup & Diagnostics</h2>
              <button className="pill-btn" onClick={() => setShowSetup(false)}>
                <X size={16} />
              </button>
            </div>

            <div className="setup-row">
              <div>
                <div className="setup-label">Streaming Browser (DRM & Kiosk)</div>
                <div className="setup-detail">
                  {snapshot.setup.browserPath ||
                    "Install Google Chrome, Microsoft Edge, or Brave"}
                </div>
              </div>
              <span
                className={
                  snapshot.setup.browserFound ? "badge-ok" : "badge-warn"
                }
              >
                {snapshot.setup.browserFound ? snapshot.setup.browserName : "Missing"}
              </span>
            </div>

            <div className="setup-row">
              <div>
                <div className="setup-label">OS Input & Keyboard Control</div>
                <div className="setup-detail">{snapshot.setup.inputNote}</div>
              </div>
              <span
                className={
                  snapshot.setup.inputReady ? "badge-ok" : "badge-warn"
                }
              >
                {snapshot.setup.inputReady ? "Ready" : "Check OS"}
              </span>
            </div>

            <div className="setup-row">
              <div>
                <div className="setup-label">Remote 5G / Any-Network Tunnel</div>
                <div className="setup-detail">
                  {snapshot.setup.cloudflaredFound
                    ? snapshot.pairing.tunnelUrl ||
                      "cloudflared ready — click toggle to generate an HTTPS link for 5G/other Wi-Fi"
                    : snapshot.setup.os === "windows"
                    ? "Install via: winget install Cloudflare.cloudflared (or use Tailscale)"
                    : "Install via: brew install cloudflared (or use Tailscale)"}
                </div>
              </div>
              <button
                className="btn-secondary"
                style={{ height: 36, fontSize: 13 }}
                onClick={handleToggleTunnel}
              >
                {tunnelStatus === "ready" || tunnelStatus === "starting"
                  ? "Stop"
                  : "Start"}
              </button>
            </div>

            <div className="setup-row">
              <div>
                <div className="setup-label">Paired Phones</div>
                <div className="setup-detail">
                  {snapshot.trustedDeviceCount} trusted device(s) •{" "}
                  {snapshot.pairing.baseUrl}
                </div>
              </div>
              <button
                className="btn-secondary"
                style={{ height: 36, fontSize: 13 }}
                onClick={() =>
                  invoke<TvSnapshot>("regenerate_pairing").then(setSnapshot)
                }
              >
                <RefreshCw size={14} />
              </button>
            </div>

            <div className="modal-actions">
              <button
                className="btn-secondary"
                style={{ color: "#FCA5A5" }}
                onClick={() =>
                  invoke<TvSnapshot>("revoke_trusted_devices").then(setSnapshot)
                }
              >
                Revoke All Phones
              </button>
              <button className="btn-primary" onClick={() => setShowSetup(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Custom Site Modal */}
      {showAddModal && (
        <div className="modal-backdrop" onClick={() => setShowAddModal(false)}>
          <form
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleAddApp}
          >
            <div className="modal-head">
              <h2 className="modal-title">Add Streaming Site</h2>
              <button
                type="button"
                className="pill-btn"
                onClick={() => setShowAddModal(false)}
              >
                <X size={16} />
              </button>
            </div>

            <div className="field">
              <label>Name</label>
              <input
                type="text"
                placeholder="e.g. Disney+, Max, Kick, CDA"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
                required
              />
            </div>

            <div className="field">
              <label>Website URL</label>
              <input
                type="text"
                placeholder="https://www.disneyplus.com"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                required
              />
            </div>

            <div className="field">
              <label>Browser Mode</label>
              <select
                value={newUaMode}
                onChange={(e) => setNewUaMode(e.target.value)}
              >
                <option value="default">
                  Standard Desktop (Best for DRM / Netflix / Twitch)
                </option>
                <option value="tv">
                  Smart TV User-Agent (For TV-specific web UIs)
                </option>
              </select>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowAddModal(false)}
              >
                Cancel
              </button>
              <button type="submit" className="btn-primary">
                Add Tile
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Ambient Screensaver */}
      {ambientMode && (
        <div className="ambient-screen" onClick={wakeUp}>
          <div className="ambient-time">{clock}</div>
          <div className="ambient-hint">
            CouchBox • Press any remote button to wake
          </div>
        </div>
      )}
    </div>
  );
}
