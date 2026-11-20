export interface StreamingApp {
  id: string;
  name: string;
  url: string;
  accent: string;
  subtitle: string;
  userAgentMode: string;
  builtIn: boolean;
}

export interface PairingInfo {
  lanIp: string;
  port: number;
  baseUrl: string;
  qrUrl: string;
  pin: string;
  tunnelUrl: string | null;
  tunnelStatus: "off" | "starting" | "ready" | "error";
}

export interface SetupStatus {
  os: string;
  browserFound: boolean;
  browserName: string;
  browserPath: string | null;
  inputReady: boolean;
  inputNote: string;
  cloudflaredFound: boolean;
}

export interface TvSnapshot {
  activeAppId: string | null;
  activeAppName: string;
  apps: StreamingApp[];
  connectedPhones: number;
  trustedDeviceCount: number;
  pairing: PairingInfo;
  setup: SetupStatus;
}

export interface RemoteSync {
  activeAppId: string | null;
  activeAppName: string;
  apps: StreamingApp[];
  connectedPhones: number;
}

export type RemoteMessage =
  | {
      type: "nav";
      action:
        | "up"
        | "down"
        | "left"
        | "right"
        | "ok"
        | "back"
        | "browser_back"
        | "home"
        | "fullscreen";
    }
  | {
      type: "trackpad";
      action: "move" | "click" | "right_click" | "double_click" | "scroll";
      dx?: number;
      dy?: number;
    }
  | {
      type: "text";
      mode: "type" | "key";
      value: string;
      submit?: boolean;
    }
  | {
      type: "media";
      action:
        | "play_pause"
        | "seek_back"
        | "seek_forward"
        | "mute"
        | "vol_up"
        | "vol_down";
    }
  | {
      type: "app";
      action: "launch" | "close_active" | "open_url";
      app_id?: string;
      url?: string;
    }
  | {
      type: "power";
      action: "screen_off" | "sleep_system";
    };
