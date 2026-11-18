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
