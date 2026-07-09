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
  Layers3,
  Loader2,
  Play,
  Plus,
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
  CaptureSession,
  PipelineArtifact,
  Project,
  QualityReport,
  ScanConfiguration,
  ScanProgress,
  SpectrumEnvelope,
  SpectrumCapture,
  SpectrometerDevice,
  TransportKind,
} from "@/domain/types";
import { buildExport, exportTextFile } from "@/storage/export";
import { CaptureStore } from "@/storage/captureStore";
import { LocalQualityEngine } from "@/runtime/quality";
import { PortableNirs4allInferenceEngine } from "@/runtime/inference";
import { buildSpectrumEnvelope } from "@/domain/spectrum";

type ViewId = "connect" | "capture" | "quality" | "predict" | "library";

const store = new CaptureStore();
const qualityEngine = new LocalQualityEngine();
const inferenceEngine = new PortableNirs4allInferenceEngine();
const ACTIVE_PROJECT_KEY = "nirs4all-device.activeProjectId";
const ACTIVE_SESSION_KEY = "nirs4all-device.activeSessionId";
const ACTIVE_PIPELINE_KEY = "nirs4all-device.activePipelineId";

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
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<CaptureSession[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refreshStore();
  }, []);

  useEffect(() => {
    if (selectedProjectId) localStorage.setItem(ACTIVE_PROJECT_KEY, selectedProjectId);
  }, [selectedProjectId]);

  useEffect(() => {
    if (selectedSessionId) localStorage.setItem(ACTIVE_SESSION_KEY, selectedSessionId);
  }, [selectedSessionId]);

  useEffect(() => {
    if (selectedPipelineId) localStorage.setItem(ACTIVE_PIPELINE_KEY, selectedPipelineId);
  }, [selectedPipelineId]);

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? projects[0] ?? null;
  const projectSessions = sessions.filter((session) => session.projectId === selectedProject?.id);
  const selectedSession = projectSessions.find((session) => session.id === selectedSessionId) ?? projectSessions[0] ?? null;
  const scopedCaptures = captures.filter((capture) => !selectedProject || capture.projectId === selectedProject.id || !capture.projectId);
  const selectedCapture = scopedCaptures.find((capture) => capture.id === selectedCaptureId) ?? scopedCaptures[0] ?? null;
  const projectPipelines = pipelines.filter((pipeline) => !selectedProject || !pipeline.projectId || pipeline.projectId === selectedProject.id);
  const selectedPipeline =
    projectPipelines.find((pipeline) => pipeline.id === selectedPipelineId) ??
    projectPipelines.find((pipeline) => pipeline.id === selectedProject?.activePipelineId) ??
    projectPipelines[0] ??
    null;
  const projectEnvelope = useMemo(
    () => buildOverlay(scopedCaptures.filter((capture) => capture.id !== selectedCapture?.id), selectedCapture, "Project"),
    [scopedCaptures, selectedCapture],
  );
  const sessionEnvelope = useMemo(
    () =>
      buildOverlay(
        scopedCaptures.filter((capture) => capture.sessionId === selectedSession?.id && capture.id !== selectedCapture?.id),
        selectedCapture,
        "Session",
      ),
    [scopedCaptures, selectedCapture, selectedSession?.id],
  );
  const spectrumOverlays = [projectEnvelope, sessionEnvelope].filter(Boolean) as SpectrumEnvelope[];
  const connected = state === "connected" || state === "busy";
  const logo = useMemo(
    () => brand.generateNirs4allBrandSvg("nirs4all", { variant: "icon", title: "nirs4all Device" }),
    [],
  );

  async function refreshStore() {
    let [storedCaptures, storedPipelines, storedProjects, storedSessions] = await Promise.all([
      store.listCaptures(),
      store.listPipelines(),
      store.listProjects(),
      store.listSessions(),
    ]);
    if (storedProjects.length === 0) {
      const project = createProject("Field project");
      await store.saveProject(project);
      storedProjects = [project];
    }
    if (storedSessions.filter((session) => session.projectId === storedProjects[0].id).length === 0) {
      const session = createSession(storedProjects[0].id, "Session 1");
      await store.saveSession(session);
      storedSessions = [session, ...storedSessions];
    }
    const activeProjectId = localStorage.getItem(ACTIVE_PROJECT_KEY);
    const projectId = storedProjects.find((project) => project.id === activeProjectId)?.id ?? storedProjects[0].id;
    const activeSessionId = localStorage.getItem(ACTIVE_SESSION_KEY);
    const sessionId =
      storedSessions.find((session) => session.projectId === projectId && session.id === activeSessionId)?.id ??
      storedSessions.find((session) => session.projectId === projectId)?.id ??
      null;
    setCaptures(storedCaptures);
    setPipelines(storedPipelines);
    setProjects(storedProjects);
    setSessions(storedSessions);
    setSelectedProjectId(projectId);
    setSelectedSessionId(sessionId);
    setSelectedCaptureId((prev) => prev ?? storedCaptures.find((capture) => capture.projectId === projectId)?.id ?? storedCaptures[0]?.id ?? null);
    setSelectedPipelineId((prev) => prev ?? localStorage.getItem(ACTIVE_PIPELINE_KEY) ?? storedProjects.find((project) => project.id === projectId)?.activePipelineId ?? storedPipelines[0]?.id ?? null);
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

  const selectProject = useCallback((id: string) => {
    const nextProject = projects.find((project) => project.id === id);
    const nextSession = sessions.find((session) => session.projectId === id) ?? null;
    setSelectedProjectId(id);
    setSelectedSessionId(nextSession?.id ?? null);
    setSelectedCaptureId(captures.find((capture) => capture.projectId === id)?.id ?? null);
    setSelectedPipelineId(nextProject?.activePipelineId ?? pipelines.find((pipeline) => !pipeline.projectId || pipeline.projectId === id)?.id ?? null);
  }, [captures, pipelines, projects, sessions]);

  const createNewProject = useCallback(async () => {
    const name = window.prompt("Project name", `Project ${projects.length + 1}`)?.trim();
    if (!name) return;
    const project = createProject(name);
    const session = createSession(project.id, "Session 1");
    await Promise.all([store.saveProject(project), store.saveSession(session)]);
    setProjects((prev) => [...prev, project]);
    setSessions((prev) => [session, ...prev]);
    setSelectedProjectId(project.id);
    setSelectedSessionId(session.id);
    setSelectedCaptureId(null);
    setSelectedPipelineId(null);
  }, [projects.length]);

  const createNewSession = useCallback(async () => {
    if (!selectedProject) return;
    const count = sessions.filter((session) => session.projectId === selectedProject.id).length + 1;
    const name = window.prompt("Session name", `Session ${count}`)?.trim();
    if (!name) return;
    const session = createSession(selectedProject.id, name);
    await store.saveSession(session);
    setSessions((prev) => [session, ...prev]);
    setSelectedSessionId(session.id);
    setSelectedCaptureId(null);
  }, [selectedProject, sessions]);

  const selectPipeline = useCallback(async (id: string) => {
    setSelectedPipelineId(id);
    if (!selectedProject) return;
    const project = { ...selectedProject, activePipelineId: id };
    await store.saveProject(project);
    setProjects((prev) => prev.map((item) => (item.id === project.id ? project : item)));
  }, [selectedProject]);

  const saveCompletedCapture = useCallback(async (rawCapture: SpectrumCapture): Promise<SpectrumCapture> => {
    const quality = await qualityEngine.evaluate(rawCapture);
    let capture: SpectrumCapture = {
      ...rawCapture,
      projectId: selectedProject?.id,
      sessionId: selectedSession?.id,
      quality,
    };
    if (selectedPipeline?.runnable) {
      try {
        capture = { ...capture, prediction: await inferenceEngine.predict(capture, selectedPipeline) };
      } catch (err) {
        setError(`Capture saved; prediction skipped: ${formatError(err)}`);
      }
    }
    await store.saveCapture(capture);
    setCaptures((prev) => [capture, ...prev.filter((item) => item.id !== capture.id)]);
    setSelectedCaptureId(capture.id);
    return capture;
  }, [selectedPipeline, selectedProject?.id, selectedSession?.id]);

  const runScan = useCallback(async () => {
    if (!device) return;
    setError(null);
    setState("busy");
    try {
      await device.setActiveConfiguration(configId);
      const rawCapture = await device.startScan({ saveToDevice, sampleId }, setProgress);
      await saveCompletedCapture(rawCapture);
      setView("capture");
    } catch (err) {
      setError(formatError(err));
    } finally {
      setProgress(null);
      setState("connected");
    }
  }, [configId, device, sampleId, saveToDevice, saveCompletedCapture]);

  const loadStored = useCallback(async (index: number) => {
    if (!device) return;
    setState("busy");
    setError(null);
    try {
      const rawCapture = await device.readStoredScan(index, setProgress);
      await saveCompletedCapture(rawCapture);
      setView("library");
    } catch (err) {
      setError(formatError(err));
    } finally {
      setProgress(null);
      setState("connected");
    }
  }, [device, saveCompletedCapture]);

  const importPipeline = useCallback(async (file: File) => {
    setError(null);
    try {
      const artifact = { ...inferenceEngine.importArtifact(await file.text(), file.name), projectId: selectedProject?.id };
      await store.savePipeline(artifact);
      if (selectedProject) {
        const project = { ...selectedProject, activePipelineId: artifact.id };
        await store.saveProject(project);
        setProjects((prev) => prev.map((item) => (item.id === project.id ? project : item)));
      }
      setPipelines((prev) => [artifact, ...prev.filter((item) => item.id !== artifact.id)]);
      setSelectedPipelineId(artifact.id);
    } catch (err) {
      setError(formatError(err));
    }
  }, [selectedProject]);

  const fitDemoPipeline = useCallback(async () => {
    setError(null);
    try {
      const artifact = { ...(await inferenceEngine.fitDemoArtifact(scopedCaptures)), projectId: selectedProject?.id };
      await store.savePipeline(artifact);
      if (selectedProject) {
        const project = { ...selectedProject, activePipelineId: artifact.id };
        await store.saveProject(project);
        setProjects((prev) => prev.map((item) => (item.id === project.id ? project : item)));
      }
      setPipelines((prev) => [artifact, ...prev.filter((item) => item.id !== artifact.id)]);
      setSelectedPipelineId(artifact.id);
    } catch (err) {
      setError(formatError(err));
    }
  }, [scopedCaptures, selectedProject]);

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
    const target = kind === "single-csv" && selectedCapture ? [selectedCapture] : scopedCaptures;
    await exportTextFile(buildExport(target, kind));
  }, [scopedCaptures, selectedCapture]);

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
            <section className="capture-workbench">
              <div className="control-column">
                <Panel title="Context" icon={Layers3}>
                  <ProjectSessionPanel
                    projects={projects}
                    sessions={projectSessions}
                    selectedProjectId={selectedProject?.id ?? ""}
                    selectedSessionId={selectedSession?.id ?? ""}
                    onProjectChange={selectProject}
                    onSessionChange={setSelectedSessionId}
                    onNewProject={createNewProject}
                    onNewSession={createNewSession}
                  />
                </Panel>
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
                  <button className="primary-button scan-button" disabled={!connected || state === "busy" || !selectedSession} onClick={runScan}>
                    {state === "busy" ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
                    Start scan
                  </button>
                  {progress && <ProgressBar progress={progress} />}
                </Panel>
                <Panel title="Pipeline" icon={Sparkles}>
                  <FileImportButton label="Load .n4a" onFile={importPipeline} />
                  <PipelineContext artifact={selectedPipeline} />
                </Panel>
                <Panel title="Device Status" icon={Info}>
                  <DeviceStatusView status={status} />
                </Panel>
              </div>

              <div className="capture-stack">
                <Panel title="Spectrum" icon={Activity} wide>
                  <SpectrumView capture={selectedCapture} overlays={spectrumOverlays} />
                </Panel>
                <div className="analysis-grid">
                  <Panel title="Quality Gate" icon={Gauge}>
                    <QualityView report={selectedCapture?.quality ?? null} compact />
                  </Panel>
                  <Panel title="Prediction" icon={Sparkles}>
                    <PredictionPanel capture={selectedCapture} artifact={selectedPipeline} onPredict={predict} />
                  </Panel>
                </div>
              </div>
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
                <PipelineList pipelines={projectPipelines} selectedId={selectedPipeline?.id ?? null} onSelect={(id) => void selectPipeline(id)} />
              </Panel>
              <Panel title="Inference" icon={Cpu} wide>
                <SpectrumView capture={selectedCapture} overlays={spectrumOverlays} />
                <div className="button-row">
                  <button className="primary-button" disabled={!selectedCapture?.spectrum || !selectedPipeline?.runnable} onClick={predict}>
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
                  <button className="ghost-button" onClick={() => exportCaptures("matrix-csv")} disabled={scopedCaptures.length === 0}>
                    <Save size={17} />
                    Matrix CSV
                  </button>
                  <button className="ghost-button" onClick={() => exportCaptures("json")} disabled={scopedCaptures.length === 0}>
                    <FileJson size={17} />
                    JSON
                  </button>
                </div>
                <CaptureList captures={scopedCaptures} selectedId={selectedCapture?.id ?? null} onSelect={setSelectedCaptureId} onDelete={removeCapture} />
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

function ProjectSessionPanel({
  projects,
  sessions,
  selectedProjectId,
  selectedSessionId,
  onProjectChange,
  onSessionChange,
  onNewProject,
  onNewSession,
}: {
  projects: Project[];
  sessions: CaptureSession[];
  selectedProjectId: string;
  selectedSessionId: string;
  onProjectChange: (id: string) => void;
  onSessionChange: (id: string) => void;
  onNewProject: () => void;
  onNewSession: () => void;
}) {
  return (
    <div className="context-stack">
      <div className="select-action">
        <Field label="Project">
          <select value={selectedProjectId} onChange={(event) => onProjectChange(event.target.value)}>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </Field>
        <button className="icon-button context-add" title="New project" onClick={onNewProject}>
          <Plus size={16} />
        </button>
      </div>
      <div className="select-action">
        <Field label="Session">
          <select value={selectedSessionId} onChange={(event) => onSessionChange(event.target.value)}>
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>{session.name}</option>
            ))}
          </select>
        </Field>
        <button className="icon-button context-add" title="New session" onClick={onNewSession}>
          <Plus size={16} />
        </button>
      </div>
    </div>
  );
}

function PipelineContext({ artifact }: { artifact: PipelineArtifact | null }) {
  if (!artifact) return <EmptyState text="No pipeline in context." />;
  return (
    <div className={artifact.runnable ? "pipeline-context ready" : "pipeline-context definition"}>
      <strong>{artifact.name}</strong>
      <span>{artifact.runnable ? `${artifact.nFeatures} features` : "definition only"}</span>
      {artifact.validationMessage && <small>{artifact.validationMessage}</small>}
    </div>
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

function SpectrumView({ capture, overlays = [] }: { capture: SpectrumCapture | null; overlays?: SpectrumEnvelope[] }) {
  if (!capture?.spectrum) {
    return <EmptyState text={capture?.rawPayloadBase64 ? "Raw Nano payload captured." : "No decoded spectrum selected."} />;
  }
  const { axis, values } = capture.spectrum;
  const overlayValues = overlays.flatMap((overlay) => [...overlay.lower, ...overlay.median, ...overlay.upper]).filter(Number.isFinite);
  const minY = Math.min(...values, ...overlayValues);
  const maxY = Math.max(...values, ...overlayValues);
  const point = (value: number, i: number) => {
    const x = (i / Math.max(1, values.length - 1)) * 100;
    const y = 100 - ((value - minY) / Math.max(1e-12, maxY - minY)) * 84 - 8;
    return `${x.toFixed(3)},${y.toFixed(3)}`;
  };
  const points = values.map(point).join(" ");
  return (
    <div className="spectrum-view">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Spectrum">
        {overlays.map((overlay) => {
          const cls = overlay.label.toLowerCase();
          const upper = overlay.upper.map(point);
          const lower = overlay.lower.map(point).reverse();
          const median = overlay.median.map(point).join(" ");
          return (
            <g key={overlay.label} className={`quantile-overlay ${cls}`}>
              <polygon points={[...upper, ...lower].join(" ")} />
              <polyline points={median} />
            </g>
          );
        })}
        <polyline points={points} />
      </svg>
      <div className="spectrum-meta">
        <span>{axis[0]?.toFixed(0)}-{axis.at(-1)?.toFixed(0)} {capture.spectrum.axisUnit}</span>
        <span>{values.length} bands</span>
        <span>{capture.spectrum.signalType}</span>
        {overlays.map((overlay) => (
          <span key={overlay.label}>{overlay.label} q10-q90</span>
        ))}
      </div>
    </div>
  );
}

function QualityView({ report, compact = false }: { report: QualityReport | null; compact?: boolean }) {
  if (!report) return <EmptyState text="No quality report selected." />;
  return (
    <div className={compact ? "quality-view compact" : "quality-view"}>
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

function PredictionPanel({
  capture,
  artifact,
  onPredict,
}: {
  capture: SpectrumCapture | null;
  artifact: PipelineArtifact | null;
  onPredict: () => void;
}) {
  if (!artifact) return <EmptyState text="No n4a loaded." />;
  if (!artifact.runnable) {
    return (
      <div className="prediction-stack">
        <PipelineContext artifact={artifact} />
      </div>
    );
  }
  return (
    <div className="prediction-stack">
      <PipelineContext artifact={artifact} />
      <button className="primary-button" disabled={!capture?.spectrum} onClick={onPredict}>
        <Sparkles size={18} />
        Predict
      </button>
      {capture?.prediction ? (
        <div className="prediction-result">
          <span>{capture.prediction.pipelineName}</span>
          <strong>{formatNumber(capture.prediction.value)}</strong>
        </div>
      ) : (
        <EmptyState text="No prediction for selected capture." />
      )}
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
          <span>{pipeline.runnable ? `${pipeline.nFeatures} features` : "definition only"}</span>
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

function buildOverlay(captures: SpectrumCapture[], selectedCapture: SpectrumCapture | null, label: string): SpectrumEnvelope | null {
  if (!selectedCapture?.spectrum) return null;
  return buildSpectrumEnvelope(captures, selectedCapture.spectrum.axis, label);
}

function createProject(name: string): Project {
  return {
    id: makeEntityId("project"),
    name,
    createdAt: new Date().toISOString(),
  };
}

function createSession(projectId: string, name: string): CaptureSession {
  return {
    id: makeEntityId("session"),
    projectId,
    name,
    createdAt: new Date().toISOString(),
  };
}

function makeEntityId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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
