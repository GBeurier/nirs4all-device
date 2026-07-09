import {
  Activity,
  Battery,
  Bluetooth,
  Cable,
  CheckCircle2,
  Cpu,
  Database,
  Download,
  FileJson,
  FlaskConical,
  Gauge,
  HardDrive,
  Info,
  Loader2,
  Play,
  RadioTower,
  Save,
  ScanLine,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  Usb,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { brand } from "nirs4all-ui";
import { CapacitorBleTransport } from "@/device/capacitorBleTransport";
import { DlpNirscanNanoDevice } from "@/device/nano/nanoDevice";
import { SimulatedNirscanNanoDevice } from "@/device/simulatedDevice";
import { BrowserUsbTransport } from "@/device/webUsbTransport";
import type {
  DeviceConnectionState,
  DeviceStatus,
  PipelineArtifact,
  QualityReport,
  ScanConfiguration,
  ScanProgress,
  SpectrumCapture,
  SpectrometerDevice,
  TransportKind,
} from "@/domain/types";
import { buildExport, exportTextFile } from "@/storage/export";
import { CaptureStore } from "@/storage/captureStore";
import { LocalQualityEngine } from "@/runtime/quality";
import { PortableNirs4allInferenceEngine } from "@/runtime/inference";

type ViewId = "connect" | "capture" | "quality" | "predict" | "library";

const store = new CaptureStore();
const qualityEngine = new LocalQualityEngine();
const inferenceEngine = new PortableNirs4allInferenceEngine();

const views: Array<{ id: ViewId; label: string; icon: typeof RadioTower }> = [
  { id: "connect", label: "Connect", icon: RadioTower },
  { id: "capture", label: "Capture", icon: ScanLine },
  { id: "quality", label: "Quality", icon: Gauge },
  { id: "predict", label: "Predict", icon: Sparkles },
  { id: "library", label: "Library", icon: Database },
];

export default function App() {
  const [view, setView] = useState<ViewId>("connect");
  const [transport, setTransport] = useState<TransportKind>("simulator");
  const [state, setState] = useState<DeviceConnectionState>("idle");
  const [device, setDevice] = useState<SpectrometerDevice | null>(null);
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [configs, setConfigs] = useState<ScanConfiguration[]>([]);
  const [configId, setConfigId] = useState("0");
  const [sampleId, setSampleId] = useState("sample-001");
  const [saveToDevice, setSaveToDevice] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [captures, setCaptures] = useState<SpectrumCapture[]>([]);
  const [selectedCaptureId, setSelectedCaptureId] = useState<string | null>(null);
  const [pipelines, setPipelines] = useState<PipelineArtifact[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refreshStore();
  }, []);

  const selectedCapture = captures.find((capture) => capture.id === selectedCaptureId) ?? captures[0] ?? null;
  const selectedPipeline = pipelines.find((pipeline) => pipeline.id === selectedPipelineId) ?? pipelines[0] ?? null;
  const connected = state === "connected" || state === "busy";
  const logo = useMemo(
    () => brand.generateNirs4allBrandSvg("nirs4all", { variant: "icon", title: "nirs4all Device" }),
    [],
  );

  async function refreshStore() {
    const [storedCaptures, storedPipelines] = await Promise.all([store.listCaptures(), store.listPipelines()]);
    setCaptures(storedCaptures);
    setPipelines(storedPipelines);
    setSelectedCaptureId((prev) => prev ?? storedCaptures[0]?.id ?? null);
    setSelectedPipelineId((prev) => prev ?? storedPipelines[0]?.id ?? null);
  }

  const connect = useCallback(async () => {
    setError(null);
    setState("connecting");
    try {
      let nextDevice: SpectrometerDevice;
      if (transport === "simulator") {
        nextDevice = new SimulatedNirscanNanoDevice();
      } else if (transport === "ble") {
        nextDevice = await DlpNirscanNanoDevice.request(new CapacitorBleTransport());
      } else {
        const usb = new BrowserUsbTransport();
        throw new Error(usb.explainUnavailable() ?? "USB HID transport is detected but the native Nano adapter is not enabled in this build.");
      }
      const nextStatus = await nextDevice.connect();
      const nextConfigs = await nextDevice.listConfigurations();
      setDevice(nextDevice);
      setStatus(nextStatus);
      setConfigs(nextConfigs);
      setConfigId(nextConfigs.find((config) => config.active)?.id ?? nextConfigs[0]?.id ?? "0");
      setState("connected");
      setView("capture");
    } catch (err) {
      setState("error");
      setError(formatError(err));
    }
  }, [transport]);

  const disconnect = useCallback(async () => {
    await device?.disconnect();
    setDevice(null);
    setStatus(null);
    setConfigs([]);
    setState("idle");
    setView("connect");
  }, [device]);

  const runScan = useCallback(async () => {
    if (!device) return;
    setError(null);
    setState("busy");
    try {
      await device.setActiveConfiguration(configId);
      const rawCapture = await device.startScan({ saveToDevice, sampleId }, setProgress);
      const quality = await qualityEngine.evaluate(rawCapture);
      const capture: SpectrumCapture = { ...rawCapture, quality };
      await store.saveCapture(capture);
      setCaptures((prev) => [capture, ...prev.filter((item) => item.id !== capture.id)]);
      setSelectedCaptureId(capture.id);
      setView("quality");
    } catch (err) {
      setError(formatError(err));
    } finally {
      setProgress(null);
      setState("connected");
    }
  }, [configId, device, sampleId, saveToDevice]);

  const loadStored = useCallback(async (index: number) => {
    if (!device) return;
    setState("busy");
    setError(null);
    try {
      const rawCapture = await device.readStoredScan(index, setProgress);
      const quality = await qualityEngine.evaluate(rawCapture);
      const capture: SpectrumCapture = { ...rawCapture, quality };
      await store.saveCapture(capture);
      setCaptures((prev) => [capture, ...prev.filter((item) => item.id !== capture.id)]);
      setSelectedCaptureId(capture.id);
      setView("library");
    } catch (err) {
      setError(formatError(err));
    } finally {
      setProgress(null);
      setState("connected");
    }
  }, [device]);

  const importPipeline = useCallback(async (file: File) => {
    setError(null);
    try {
      const artifact = inferenceEngine.importArtifact(await file.text(), file.name);
      await store.savePipeline(artifact);
      setPipelines((prev) => [artifact, ...prev.filter((item) => item.id !== artifact.id)]);
      setSelectedPipelineId(artifact.id);
    } catch (err) {
      setError(formatError(err));
    }
  }, []);

  const fitDemoPipeline = useCallback(async () => {
    setError(null);
    try {
      const artifact = await inferenceEngine.fitDemoArtifact(captures);
      await store.savePipeline(artifact);
      setPipelines((prev) => [artifact, ...prev.filter((item) => item.id !== artifact.id)]);
      setSelectedPipelineId(artifact.id);
    } catch (err) {
      setError(formatError(err));
    }
  }, [captures]);

  const predict = useCallback(async () => {
    if (!selectedCapture || !selectedPipeline) return;
    setError(null);
    try {
      const prediction = await inferenceEngine.predict(selectedCapture, selectedPipeline);
      const capture = { ...selectedCapture, prediction };
      await store.saveCapture(capture);
      setCaptures((prev) => prev.map((item) => (item.id === capture.id ? capture : item)));
      setSelectedCaptureId(capture.id);
    } catch (err) {
      setError(formatError(err));
    }
  }, [selectedCapture, selectedPipeline]);

  const removeCapture = useCallback(async (id: string) => {
    await store.deleteCapture(id);
    setCaptures((prev) => prev.filter((item) => item.id !== id));
    setSelectedCaptureId((prev) => (prev === id ? null : prev));
  }, []);

  const exportCaptures = useCallback(async (kind: "single-csv" | "matrix-csv" | "json") => {
    const target = kind === "single-csv" && selectedCapture ? [selectedCapture] : captures;
    await exportTextFile(buildExport(target, kind));
  }, [captures, selectedCapture]);

  return (
    <div className="app-shell">
      <div className="spectrum-strip" />
      <header className="topbar">
        <div className="brand-mark" dangerouslySetInnerHTML={{ __html: logo }} />
        <div className="brand-copy">
          <strong>nirs4all</strong>
          <span>device</span>
        </div>
        <div className="topbar-status">
          <StatusPill state={state} />
          {status?.batteryPct != null && <MiniStat icon={Battery} text={`${status.batteryPct}%`} />}
          {selectedCapture?.quality && <QualityBadge report={selectedCapture.quality} />}
        </div>
      </header>

      <div className="main-layout">
        <nav className="rail" aria-label="Workflow">
          {views.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={view === item.id ? "rail-item active" : "rail-item"} onClick={() => setView(item.id)}>
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <main className="workspace">
          {error && (
            <div className="error-banner">
              <XCircle size={18} />
              <span>{error}</span>
            </div>
          )}

          {view === "connect" && (
            <section className="screen-grid connect-screen">
              <Panel title="Device" icon={RadioTower}>
                <div className="transport-grid">
                  <TransportButton active={transport === "simulator"} icon={Cpu} title="Simulator" onClick={() => setTransport("simulator")} />
                  <TransportButton active={transport === "ble"} icon={Bluetooth} title="Bluetooth LE" onClick={() => setTransport("ble")} />
                  <TransportButton active={transport === "usb"} icon={Usb} title="USB/HID" onClick={() => setTransport("usb")} />
                </div>
                <div className="button-row">
                  <button className="primary-button" onClick={connect} disabled={state === "connecting" || state === "busy"}>
                    {state === "connecting" ? <Loader2 className="spin" size={18} /> : <RadioTower size={18} />}
                    Connect
                  </button>
                  {connected && (
                    <button className="ghost-button" onClick={disconnect}>
                      Disconnect
                    </button>
                  )}
                </div>
              </Panel>

              <Panel title="Runtime" icon={Cpu}>
                <RuntimeStack />
              </Panel>
            </section>
          )}

          {view === "capture" && (
            <section className="screen-grid capture-screen">
              <Panel title="Scan Control" icon={ScanLine}>
                <Field label="Sample ID">
                  <input value={sampleId} onChange={(event) => setSampleId(event.target.value)} />
                </Field>
                <Field label="Configuration">
                  <select value={configId} onChange={(event) => setConfigId(event.target.value)}>
                    {configs.map((config) => (
                      <option key={config.id} value={config.id}>
                        {config.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <label className="switch-line">
                  <input type="checkbox" checked={saveToDevice} onChange={(event) => setSaveToDevice(event.target.checked)} />
                  <span>Save on device SD</span>
                </label>
                <button className="primary-button scan-button" disabled={!connected || state === "busy"} onClick={runScan}>
                  {state === "busy" ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
                  Start scan
                </button>
                {progress && <ProgressBar progress={progress} />}
              </Panel>

              <Panel title="Spectrum" icon={Activity} wide>
                <SpectrumView capture={selectedCapture} />
              </Panel>

              <Panel title="Device Status" icon={Info}>
                <DeviceStatusView status={status} />
              </Panel>
            </section>
          )}

          {view === "quality" && (
            <section className="screen-grid quality-screen">
              <Panel title="Quality Gate" icon={Gauge} wide>
                <QualityView report={selectedCapture?.quality ?? null} />
              </Panel>
              <Panel title="Capture" icon={FileJson}>
                <CaptureMeta capture={selectedCapture} />
              </Panel>
            </section>
          )}

          {view === "predict" && (
            <section className="screen-grid predict-screen">
              <Panel title="Pipeline" icon={Sparkles}>
                <FileImportButton label="Import .n4a JSON" onFile={importPipeline} />
                <button className="ghost-button full" onClick={fitDemoPipeline}>
                  <FlaskConical size={17} />
                  Fit demo from captures
                </button>
                <PipelineList pipelines={pipelines} selectedId={selectedPipeline?.id ?? null} onSelect={setSelectedPipelineId} />
              </Panel>
              <Panel title="Inference" icon={Cpu} wide>
                <SpectrumView capture={selectedCapture} />
                <div className="button-row">
                  <button className="primary-button" disabled={!selectedCapture || !selectedPipeline} onClick={predict}>
                    <Sparkles size={18} />
                    Predict
                  </button>
                  {selectedCapture?.prediction && (
                    <div className="prediction-result">
                      <span>{selectedCapture.prediction.pipelineName}</span>
                      <strong>{formatNumber(selectedCapture.prediction.value)}</strong>
                    </div>
                  )}
                </div>
              </Panel>
            </section>
          )}

          {view === "library" && (
            <section className="screen-grid library-screen">
              <Panel title="Captures" icon={Database} wide>
                <div className="toolbar">
                  <button className="ghost-button" onClick={() => exportCaptures("single-csv")} disabled={!selectedCapture}>
                    <Download size={17} />
                    CSV
                  </button>
                  <button className="ghost-button" onClick={() => exportCaptures("matrix-csv")} disabled={captures.length === 0}>
                    <Save size={17} />
                    Matrix CSV
                  </button>
                  <button className="ghost-button" onClick={() => exportCaptures("json")} disabled={captures.length === 0}>
                    <FileJson size={17} />
                    JSON
                  </button>
                </div>
                <CaptureList captures={captures} selectedId={selectedCapture?.id ?? null} onSelect={setSelectedCaptureId} onDelete={removeCapture} />
              </Panel>
              <Panel title="Stored Scans" icon={HardDrive}>
                <StoredScans device={device} onLoad={loadStored} />
              </Panel>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

function Panel({ title, icon: Icon, wide = false, children }: { title: string; icon: typeof RadioTower; wide?: boolean; children: React.ReactNode }) {
  return (
    <section className={wide ? "panel wide" : "panel"}>
      <div className="panel-header">
        <Icon size={18} />
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function TransportButton({ active, icon: Icon, title, onClick }: { active: boolean; icon: typeof Bluetooth; title: string; onClick: () => void }) {
  return (
    <button className={active ? "transport-button active" : "transport-button"} onClick={onClick}>
      <Icon size={22} />
      <span>{title}</span>
    </button>
  );
}

function StatusPill({ state }: { state: DeviceConnectionState }) {
  const text = state === "busy" ? "busy" : state === "connected" ? "connected" : state === "error" ? "attention" : state;
  return <span className={`status-pill ${state}`}>{text}</span>;
}

function MiniStat({ icon: Icon, text }: { icon: typeof Battery; text: string }) {
  return (
    <span className="mini-stat">
      <Icon size={15} />
      {text}
    </span>
  );
}

function QualityBadge({ report }: { report: QualityReport }) {
  const Icon = report.status === "pass" ? CheckCircle2 : report.status === "warn" ? Info : XCircle;
  return (
    <span className={`quality-badge ${report.status}`}>
      <Icon size={15} />
      {report.score}
    </span>
  );
}

function RuntimeStack() {
  const manifest = inferenceEngine.capabilities();
  return (
    <div className="runtime-stack">
      <div><strong>{manifest.aggregate}</strong><span>{manifest.controllers.length} controllers</span></div>
      <div><strong>nirs4all-ui</strong><span>brand + contracts</span></div>
      <div><strong>Capacitor</strong><span>Android / iOS / Web shell</span></div>
      <div><strong>BLE GATT</strong><span>DLP NIRscan Nano profile</span></div>
    </div>
  );
}

function DeviceStatusView({ status }: { status: DeviceStatus | null }) {
  if (!status) return <EmptyState text="No device connected." />;
  const rows = [
    ["Battery", status.batteryPct == null ? "n/a" : `${status.batteryPct}%`],
    ["Temperature", status.temperatureC == null ? "n/a" : `${status.temperatureC.toFixed(1)} C`],
    ["Humidity", status.humidityPct == null ? "n/a" : `${status.humidityPct.toFixed(1)}%`],
    ["Firmware", status.firmware ?? "n/a"],
    ["Serial", status.serialNumber ?? "n/a"],
    ["Stored scans", status.storedScans == null ? "n/a" : String(status.storedScans)],
  ];
  return (
    <dl className="status-grid">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ProgressBar({ progress }: { progress: ScanProgress }) {
  return (
    <div className="progress-block">
      <div className="progress-label">
        <span>{progress.phase}</span>
        <span>{Math.round(progress.pct)}%</span>
      </div>
      <div className="progress-track">
        <div style={{ width: `${progress.pct}%` }} />
      </div>
    </div>
  );
}

function SpectrumView({ capture }: { capture: SpectrumCapture | null }) {
  if (!capture?.spectrum) {
    return <EmptyState text={capture?.rawPayloadBase64 ? "Raw Nano payload captured." : "No decoded spectrum selected."} />;
  }
  const { axis, values } = capture.spectrum;
  const minY = Math.min(...values);
  const maxY = Math.max(...values);
  const points = values.map((value, i) => {
    const x = (i / Math.max(1, values.length - 1)) * 100;
    const y = 100 - ((value - minY) / Math.max(1e-12, maxY - minY)) * 84 - 8;
    return `${x.toFixed(3)},${y.toFixed(3)}`;
  }).join(" ");
  return (
    <div className="spectrum-view">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Spectrum">
        <polyline points={points} />
      </svg>
      <div className="spectrum-meta">
        <span>{axis[0]?.toFixed(0)}-{axis.at(-1)?.toFixed(0)} {capture.spectrum.axisUnit}</span>
        <span>{values.length} bands</span>
        <span>{capture.spectrum.signalType}</span>
      </div>
    </div>
  );
}

function QualityView({ report }: { report: QualityReport | null }) {
  if (!report) return <EmptyState text="No quality report selected." />;
  return (
    <div className="quality-view">
      <div className={`quality-score ${report.status}`}>
        <strong>{report.score}</strong>
        <span>{report.status}</span>
      </div>
      <div className="metric-grid">
        {report.metrics.map((metric) => (
          <div key={metric.id} className={metric.pass ? "metric pass" : "metric fail"}>
            <span>{metric.label}</span>
            <strong>{formatNumber(metric.value)}</strong>
            {metric.threshold != null && <small>limit {formatNumber(metric.threshold)}</small>}
          </div>
        ))}
      </div>
    </div>
  );
}

function CaptureMeta({ capture }: { capture: SpectrumCapture | null }) {
  if (!capture) return <EmptyState text="No capture selected." />;
  return (
    <dl className="status-grid">
      <div><dt>Sample</dt><dd>{capture.sampleId}</dd></div>
      <div><dt>Device</dt><dd>{capture.device.name}</dd></div>
      <div><dt>Config</dt><dd>{capture.configuration?.name ?? "n/a"}</dd></div>
      <div><dt>Source</dt><dd>{capture.source}</dd></div>
      <div><dt>Tags</dt><dd>{capture.tags.join(", ") || "n/a"}</dd></div>
    </dl>
  );
}

function PipelineList({ pipelines, selectedId, onSelect }: { pipelines: PipelineArtifact[]; selectedId: string | null; onSelect: (id: string) => void }) {
  if (pipelines.length === 0) return <EmptyState text="No pipeline loaded." />;
  return (
    <div className="list compact">
      {pipelines.map((pipeline) => (
        <button key={pipeline.id} className={pipeline.id === selectedId ? "list-item active" : "list-item"} onClick={() => onSelect(pipeline.id)}>
          <strong>{pipeline.name}</strong>
          <span>{pipeline.nFeatures} features</span>
        </button>
      ))}
    </div>
  );
}

function CaptureList({
  captures,
  selectedId,
  onSelect,
  onDelete,
}: {
  captures: SpectrumCapture[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (captures.length === 0) return <EmptyState text="No captures stored." />;
  return (
    <div className="list">
      {captures.map((capture) => (
        <div key={capture.id} className={capture.id === selectedId ? "capture-row active" : "capture-row"}>
          <button onClick={() => onSelect(capture.id)}>
            <strong>{capture.sampleId}</strong>
            <span>{new Date(capture.createdAt).toLocaleString()}</span>
            <span>{capture.spectrum ? `${capture.spectrum.values.length} bands` : "raw payload"}</span>
          </button>
          <button className="icon-button" title="Delete capture" onClick={() => onDelete(capture.id)}>
            <Trash2 size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

function StoredScans({ device, onLoad }: { device: SpectrometerDevice | null; onLoad: (index: number) => void }) {
  const [indices, setIndices] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const refresh = async () => {
    if (!device) return;
    setLoading(true);
    try {
      setIndices(await device.listStoredScans());
    } finally {
      setLoading(false);
    }
  };
  return (
    <div>
      <button className="ghost-button full" disabled={!device || loading} onClick={refresh}>
        {loading ? <Loader2 className="spin" size={17} /> : <HardDrive size={17} />}
        Refresh slots
      </button>
      <div className="slot-grid">
        {indices.map((index) => (
          <button key={index} onClick={() => onLoad(index)}>{index}</button>
        ))}
      </div>
    </div>
  );
}

function FileImportButton({ label, onFile }: { label: string; onFile: (file: File) => void }) {
  return (
    <label className="file-button">
      <Upload size={17} />
      <span>{label}</span>
      <input type="file" accept=".json,.n4a,application/json" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void onFile(file);
        event.currentTarget.value = "";
      }} />
    </label>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  if (Math.abs(value) >= 100) return value.toFixed(1);
  if (Math.abs(value) >= 1) return value.toFixed(3);
  return value.toExponential(2);
}
