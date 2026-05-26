import {
  DEFAULT_WEB_SERIAL_SETTINGS,
  type WebSerialSettings,
} from "@/lib/web-serial-transport";

export type TracerDriverId =
  | "nidek-lt900"
  | "oma-serial"
  | "oma-lan"
  | "oma-usb"
  | "nidek-serial"
  | "hoya-serial"
  | "hoya3-serial"
  | "essilor-serial"
  | "hoya3-usb"
  | "huvitz-serial"
  | "takubo-serial"
  | "tableau-serial"
  | "weco-serial";

export type TracerSupportStatus =
  | "tested"
  | "expected"
  | "not-supported";

export type TracerConnection = "serial" | "lan" | "usb";

export interface TracerProfile {
  id: string;
  manufacturer: string;
  model: string;
  variant?: string;
  connection: TracerConnection;
  driver: TracerDriverId;
  supportStatus: TracerSupportStatus;
  serial?: WebSerialSettings;
}

const serial = (
  baudRate: number,
  parity: WebSerialSettings["parity"] = "none",
  stopBits: WebSerialSettings["stopBits"] = 1,
  flowControl: WebSerialSettings["flowControl"] = "none",
): WebSerialSettings => ({
  ...DEFAULT_WEB_SERIAL_SETTINGS,
  baudRate,
  parity,
  stopBits,
  flowControl,
});

const expectedOma = (
  id: string,
  manufacturer: string,
  model: string,
  baudRate: number,
  options: {
    parity?: WebSerialSettings["parity"];
    flowControl?: WebSerialSettings["flowControl"];
    variant?: string;
  } = {},
): TracerProfile => ({
  id,
  manufacturer,
  model,
  variant: options.variant ?? "Serial OMA",
  connection: "serial",
  driver: "oma-serial",
  supportStatus: "expected",
  serial: serial(
    baudRate,
    options.parity ?? "none",
    1,
    options.flowControl ?? "none",
  ),
});

const unsupported = (
  id: string,
  manufacturer: string,
  model: string,
  connection: TracerConnection,
  driver: TracerDriverId,
  variant?: string,
  serialSettings?: WebSerialSettings,
): TracerProfile => ({
  id,
  manufacturer,
  model,
  variant,
  connection,
  driver,
  supportStatus: "not-supported",
  serial: serialSettings,
});

export const TRACER_PROFILES: TracerProfile[] = [
  expectedOma("briot-accura-cx-oma", "Briot", "Accura CX", 9600, { flowControl: "hardware" }),
  expectedOma("briot-alta-xs-oma", "Briot", "Alta XS", 9600, { flowControl: "hardware" }),
  expectedOma("briot-attitude-oma", "Briot", "Attitude", 57600),
  expectedOma("briot-evolution-oma", "Briot", "Evolution", 9600),
  expectedOma("briot-evolution-gt-oma", "Briot", "Evolution GT Optical", 57600),
  expectedOma("briot-scan8-oma", "Briot", "Scan8", 9600),
  expectedOma("briot-scanform-net2-oma", "Briot", "Scanform NET 2", 19200),
  unsupported("briot-couture-lan", "Briot", "Couture", "lan", "oma-lan", "LAN OMA"),
  unsupported("briot-scan8-lan", "Briot", "Scan8", "lan", "oma-lan", "LAN OMA"),

  expectedOma("essilor-kappa-oma", "Essilor", "Kappa", 19200, { flowControl: "hardware" }),
  expectedOma("essilor-mr-blue-oma", "Essilor", "Mr. Blue", 9600),
  expectedOma("essilor-mr-orange-oma", "Essilor", "Mr. Orange", 9600),
  expectedOma("essilor-neksia-oma", "Essilor", "Neksia", 9600),
  expectedOma("essilor-tcb800-oma", "Essilor", "TCB 800", 9600),
  expectedOma("essilor-tess-oma", "Essilor", "Tess", 19200, { flowControl: "hardware" }),
  unsupported("essilor-kappa-serial", "Essilor", "Kappa", "serial", "essilor-serial", "Essilor serial", serial(19200)),
  unsupported("essilor-phi-serial", "Essilor", "Phi", "serial", "essilor-serial", "Essilor serial", serial(19200)),
  unsupported("essilor-tess-serial", "Essilor", "Tess", "serial", "essilor-serial", "Essilor serial", serial(19200)),
  unsupported("essilor-mr-blue-lan", "Essilor", "Mr. Blue", "lan", "oma-lan", "LAN OMA"),
  unsupported("essilor-mr-orange-lan", "Essilor", "Mr. Orange", "lan", "oma-lan", "LAN OMA"),
  unsupported("essilor-neksia-lan", "Essilor", "Neksia", "lan", "oma-lan", "LAN OMA"),
  unsupported("essilor-tcb800-lan", "Essilor", "TCB 800", "lan", "oma-lan", "LAN OMA"),
  unsupported("essilor-tess-lan", "Essilor", "Tess", "lan", "oma-lan", "LAN OMA"),

  unsupported("hoya-gt1000-serial", "Hoya", "GT 1000", "serial", "hoya-serial", "Hoya serial", serial(9600, "even", 2)),
  unsupported("hoya-gt3000-serial", "Hoya", "GT 3000", "serial", "hoya-serial", "Hoya serial", serial(19200, "even", 2)),
  expectedOma("hoya-gt3000-oma", "Hoya", "GT 3000", 9600),
  unsupported("hoya-gt5000-hoya3", "Hoya", "GT 5000", "serial", "hoya3-serial", "HOYA3 serial", serial(19200)),
  expectedOma("hoya-gt5000-oma", "Hoya", "GT 5000", 19200),
  expectedOma("hoya-gt7000-oma", "Hoya", "GT 7000", 38400),
  expectedOma("hoya-ut1000-generic-oma", "Hoya", "UT 1000", 9600),
  expectedOma("hoya-ut1000-oma", "Hoya", "UT 1000", 9600, { parity: "even", variant: "Serial OMA (even parity)" }),
  unsupported("hoya-gt5000-usb-hoya3", "Hoya", "GT 5000", "usb", "hoya3-usb", "USB HOYA3"),
  unsupported("hoya-gt5000-usb-oma", "Hoya", "GT 5000", "usb", "oma-usb", "USB OMA"),

  expectedOma("huvitz-dcs-oma", "Huvitz", "DCS", 115200),
  expectedOma("huvitz-cfr4000-dcs-oma", "Huvitz", "CFR 4000 DCS", 115200),
  expectedOma("huvitz-hfr8000-dcs-oma", "Huvitz", "HFR 8000 DCS", 115200),
  unsupported("huvitz-generic", "Huvitz", "Generic", "serial", "huvitz-serial", "Huvitz serial", serial(115200)),
  unsupported("huvitz-cfr4000", "Huvitz", "CFR 4000", "serial", "huvitz-serial", "Huvitz serial", serial(115200)),
  unsupported("huvitz-hfr8000", "Huvitz", "HFR 8000", "serial", "huvitz-serial", "Huvitz serial", serial(115200)),
  unsupported("huvitz-kaiser", "Huvitz", "Kaiser", "serial", "huvitz-serial", "Huvitz serial", serial(115200)),

  unsupported("indo-cnc3da", "Indo/Schone", "CNC 3DA", "serial", "nidek-serial", "Nidek serial", serial(9600)),
  unsupported("indo-combimax", "Indo/Schone", "Combimax", "serial", "nidek-serial", "Nidek serial", serial(9600)),
  unsupported("indo-tracer3d", "Indo/Schone", "Tracer 3D Teleform", "serial", "nidek-serial", "Nidek serial", serial(9600)),

  unsupported("nidek-generic", "Nidek", "Generic", "serial", "nidek-serial", "Nidek serial", serial(38400)),
  unsupported("nidek-generic-lan", "Nidek", "Generic", "lan", "oma-lan", "LAN Nidek"),
  unsupported("nidek-ice1200", "Nidek", "ICE 1200", "serial", "nidek-serial", "Nidek serial", serial(9600)),
  unsupported("nidek-ice-mini", "Nidek", "ICE Mini", "serial", "nidek-serial", "Nidek serial", serial(38400)),
  unsupported("nidek-le7070sx", "Nidek", "LE-7070 SX", "serial", "nidek-serial", "Nidek serial", serial(38400)),
  unsupported("nidek-le9000sx", "Nidek", "LE-9000 SX", "serial", "nidek-serial", "Nidek serial", serial(38400)),
  unsupported("nidek-lex1000", "Nidek", "Lex 1000", "serial", "nidek-serial", "Nidek serial", serial(9600)),
  expectedOma("nidek-lt1200-oma", "Nidek", "LT-1200", 9600),
  unsupported("nidek-lt700", "Nidek", "LT-700", "serial", "nidek-serial", "Nidek serial", serial(9600)),
  {
    id: "nidek-lt900-std",
    manufacturer: "Nidek",
    model: "LT-900",
    variant: "STD serial",
    connection: "serial",
    driver: "nidek-lt900",
    supportStatus: "tested",
    serial: serial(9600),
  },
  unsupported("nidek-lt910", "Nidek", "LT-910", "serial", "nidek-serial", "Nidek serial", serial(9600)),
  expectedOma("nidek-lt910-vcab-oma", "Nidek", "LT-910", 9600, { variant: "Serial VCAB/OMA" }),
  unsupported("nidek-lt980", "Nidek", "LT-980", "serial", "nidek-serial", "Nidek serial", serial(9600)),
  expectedOma("nidek-lt980-vcab-oma", "Nidek", "LT-980", 9600, { variant: "Serial VCAB/OMA" }),

  unsupported("tableau-serial", "Tableau", "Tableau", "serial", "tableau-serial", "Tableau serial", serial(9600)),
  unsupported("takubomatic-serial", "Takubomatic", "Takubomatic", "serial", "takubo-serial", "Takubomatic serial", serial(9600, "none", 2, "hardware")),
  expectedOma("takubomatic-oma", "Takubomatic", "Takubomatic", 9600),
  expectedOma("topcon-fr20-oma", "Topcon", "FR-20", 9600),
  expectedOma("topcon-fr50-oma", "Topcon", "FR-50", 19200, { flowControl: "hardware" }),
  expectedOma("unicos-generic-oma", "Unicos", "Generic", 19200),
  expectedOma("visslo-st88-oma", "Visslo", "ST-88", 57600),

  expectedOma("weco-c6-oma", "Weco", "C6", 9600),
  expectedOma("weco-ct7-oma", "Weco", "CT7", 9600),
  expectedOma("weco-edge310-oma", "Weco", "Edge 310", 9600),
  expectedOma("weco-t6-oma", "Weco", "T.6", 9600),
  expectedOma("weco-trace3-oma", "Weco", "Trace 3", 9600, { flowControl: "hardware" }),
  unsupported("weco-ft3d-plus", "Weco", "FT 3D+", "serial", "weco-serial", "Weco serial", serial(19200)),
  unsupported("weco-trace2", "Weco", "Trace 2", "serial", "weco-serial", "Weco serial", serial(19200)),
  unsupported("weco-c6-lan", "Weco", "C6", "lan", "oma-lan", "LAN OMA"),
  unsupported("weco-t6-lan", "Weco", "T.6", "lan", "oma-lan", "LAN OMA"),
];

export function getTracerProfile(id: string) {
  return TRACER_PROFILES.find((profile) => profile.id === id) ?? TRACER_PROFILES[0];
}

export function isRunnableProfile(profile: TracerProfile) {
  return profile.driver === "nidek-lt900" || profile.driver === "oma-serial";
}

export function tracerProfileLabel(profile: TracerProfile) {
  return [profile.manufacturer, profile.model, profile.variant].filter(Boolean).join(" - ");
}

export function groupTracerProfiles() {
  const groups = TRACER_PROFILES.reduce<Record<string, TracerProfile[]>>(
    (current, profile) => ({
      ...current,
      [profile.manufacturer]: [...(current[profile.manufacturer] ?? []), profile],
    }),
    {},
  );

  return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
}
