import {
  Activity,
  Battery,
  Bluetooth,
  CheckCircle2,
  ClipboardList,
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
  Sparkles,
  Trash2,
  Upload,
  Usb,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { brand } from "nirs4all-ui";
import { CapacitorBleTransport } from "@/device/capacitorBleTransport";
import { DlpNirscanNanoDevice } from "@/device/nano/nanoDevice";
import { SimulatedNirscanNanoDevice } from "@/device/simulatedDevice";
import { BrowserUsbTransport } from "@/device/webUsbTransport";
import type {
  CaptureSession,
  DeviceConnectionState,
  DeviceStatus,
  PipelineArtifact,
  Project,
  QualityReport,
  ScanConfiguration,
  ScanProgress,
  SpectrometerDevice,
  SpectrumCapture,
  SpectrumEnvelope,
  TransportKind,
} from "@/domain/types";
import { buildSpectrumEnvelope } from "@/domain/spectrum";
import { summarizeDatasetQuality, type DatasetQualitySummary } from "@/runtime/datasetQuality";
import { PortableNirs4allInferenceEngine } from "@/runtime/inference";
import { LocalQualityEngine } from "@/runtime/quality";
import { nextSampleId } from "@/runtime/sampleIds";
import { CaptureStore } from "@/storage/captureStore";
import { buildExport, exportTextFile, type ExportKind } from "@/storage/export";

type ViewId = "projects" | "connection" | "scan";

type MetadataField = {
  key: string;
  label: string;
  multiline?: boolean;
};

type DeviceOption = {
  transport: TransportKind;
  title: string;
  description: string;
  icon: LucideIcon;
  enabled: boolean;
  badge: string;
};

const store = new CaptureStore();
const qualityEngine = new LocalQualityEngine();
const inferenceEngine = new PortableNirs4allInferenceEngine();
const ACTIVE_PROJECT_KEY = "nirs4all-device.activeProjectId";
const ACTIVE_SESSION_KEY = "nirs4all-device.activeSessionId";
const ACTIVE_PIPELINE_KEY = "nirs4all-device.activePipelineId";

const views: Array<{ id: ViewId; label: string; icon: LucideIcon }> = [
  { id: "projects", label: "Projects", icon: Database },
  { id: "connection", label: "Connection", icon: RadioTower },
  { id: "scan", label: "Scan", icon: ScanLine },
];

const projectMetadataFields: MetadataField[] = [
  { key: "description", label: "Description", multiline: true },
  { key: "operator", label: "Default operator" },
  { key: "location", label: "Location" },
  { key: "protocol", label: "Protocol" },
  { key: "notes", label: "Notes", multiline: true },
];

const sessionMetadataFields: MetadataField[] = [
  { key: "operator", label: "Operator" },
  { key: "location", label: "Location" },
  { key: "sample_set", label: "Sample set" },
  { key: "notes", label: "Notes", multiline: true },
];

const captureMetadataFields: MetadataField[] = [
  { key: "observation", label: "Observation", multiline: true },
  { key: "sample_label", label: "Sample label" },
  { key: "lot", label: "Lot" },
  { key: "operator", label: "Operator" },
  { key: "notes", label: "Notes", multiline: true },
];

const nextCaptureMetadataFields: MetadataField[] = [
  { key: "observation", label: "Observation", multiline: true },
  { key: "sample_label", label: "Sample label" },
  { key: "lot", label: "Lot" },
];

const INITIAL_PROJECT: Project = {
  id: "project_field_default",
  name: "Field project",
  createdAt: new Date().toISOString(),
  metadata: {},
};

const INITIAL_SESSION: CaptureSession = {
  id: "session_field_default_1",
  projectId: INITIAL_PROJECT.id,
  name: "Session 1",
  createdAt: INITIAL_PROJECT.createdAt,
  metadata: {},
};

export default function App() {
  const [view, setView] = useState<ViewId>("projects");
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
  const [projects, setProjects] = useState<Project[]>([INITIAL_PROJECT]);
  const [sessions, setSessions] = useState<CaptureSession[]>([INITIAL_SESSION]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(INITIAL_PROJECT.id);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(INITIAL_SESSION.id);
  const [nextCaptureMetadata, setNextCaptureMetadata] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refreshStore().catch((err) => setError(formatError(err)));
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

  const isNativeShell = Capacitor.isNativePlatform();
  const webBluetoothAvailable = isWebBluetoothAvailable();
  const deviceOptions = useMemo<DeviceOption[]>(
    () => [
      {
        transport: "simulator",
        title: "Simulator",
        description: "Runs the full workflow without hardware.",
        icon: Cpu,
        enabled: true,
        badge: "available",
      },
      {
        transport: "ble",
        title: "DLP NIRscan Nano",
        description: isNativeShell ? "Native BLE through Capacitor." : "Bluetooth LE through Web Bluetooth when the browser supports it.",
        icon: Bluetooth,
        enabled: isNativeShell || webBluetoothAvailable,
        badge: isNativeShell ? "native" : webBluetoothAvailable ? "web ble" : "unsupported",
      },
      {
        transport: "usb",
        title: "USB spectrometer",
        description: "Adapter slot for future WebUSB/WebHID or native USB support.",
        icon: Usb,
        enabled: false,
        badge: "planned",
      },
    ],
    [isNativeShell, webBluetoothAvailable],
  );

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? projects[0] ?? null;
  const projectSessions = sessions.filter((session) => session.projectId === selectedProject?.id);
  const selectedSession = projectSessions.find((session) => session.id === selectedSessionId) ?? projectSessions[0] ?? null;
  const projectCaptures = captures.filter((capture) => !selectedProject || capture.projectId === selectedProject.id || !capture.projectId);
  const sessionCaptures = projectCaptures.filter((capture) => capture.sessionId === selectedSession?.id);
  const selectedCapture = projectCaptures.find((capture) => capture.id === selectedCaptureId) ?? projectCaptures[0] ?? null;
  const projectPipelines = pipelines.filter((pipeline) => !selectedProject || !pipeline.projectId || pipeline.projectId === selectedProject.id);
  const selectedPipeline =
    projectPipelines.find((pipeline) => pipeline.id === selectedPipelineId) ??
    projectPipelines.find((pipeline) => pipeline.id === selectedProject?.activePipelineId) ??
    projectPipelines[0] ??
    null;
  const selectedDeviceOption = deviceOptions.find((option) => option.transport === transport) ?? deviceOptions[0];
  const connected = state === "connected" || state === "busy";
  const canConnect = selectedDeviceOption.enabled && state !== "connecting" && state !== "busy";
  const datasetQuality = useMemo(
    () => summarizeDatasetQuality(projectCaptures, projectSessions),
    [projectCaptures, projectSessions],
  );
  const projectEnvelope = useMemo(
    () => buildOverlay(projectCaptures.filter((capture) => capture.id !== selectedCapture?.id), selectedCapture, "Project"),
    [projectCaptures, selectedCapture],
  );
  const sessionEnvelope = useMemo(
    () => buildOverlay(sessionCaptures.filter((capture) => capture.id !== selectedCapture?.id), selectedCapture, "Session"),
    [sessionCaptures, selectedCapture],
  );
  const spectrumOverlays = [projectEnvelope, sessionEnvelope].filter(Boolean) as SpectrumEnvelope[];
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
      const project = INITIAL_PROJECT;
      await store.saveProject(project);
      storedProjects = [project];
    }
    if (storedSessions.filter((session) => session.projectId === storedProjects[0].id).length === 0) {
      const session = storedProjects[0].id === INITIAL_PROJECT.id ? INITIAL_SESSION : createSession(storedProjects[0].id, "Session 1");
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
    setSelectedPipelineId(
      (prev) =>
        prev ??
        localStorage.getItem(ACTIVE_PIPELINE_KEY) ??
        storedProjects.find((project) => project.id === projectId)?.activePipelineId ??
        storedPipelines[0]?.id ??
        null,
    );
  }

  const connect = useCallback(async () => {
    setError(null);
    setState("connecting");
    try {
      let nextDevice: SpectrometerDevice;
      if (transport === "simulator") {
        nextDevice = new SimulatedNirscanNanoDevice();
      } else if (transport === "ble") {
        if (!isNativeShell && !webBluetoothAvailable) {
          throw new Error("Web Bluetooth is not available in this browser. Use Chrome/Edge on HTTPS or the native Capacitor app for mobile BLE.");
        }
        nextDevice = await DlpNirscanNanoDevice.request(new CapacitorBleTransport());
      } else {
        const usb = new BrowserUsbTransport();
        throw new Error(usb.explainUnavailable() ?? "USB spectrometer support is an adapter slot in this build.");
      }
      const nextStatus = await nextDevice.connect();
      const nextConfigs = await nextDevice.listConfigurations();
      setDevice(nextDevice);
      setStatus(nextStatus);
      setConfigs(nextConfigs);
      setConfigId(nextConfigs.find((config) => config.active)?.id ?? nextConfigs[0]?.id ?? "0");
      setState("connected");
      setView("scan");
    } catch (err) {
      setState("error");
      setError(formatError(err));
    }
  }, [isNativeShell, transport, webBluetoothAvailable]);

  const disconnect = useCallback(async () => {
    await device?.disconnect();
    setDevice(null);
    setStatus(null);
    setConfigs([]);
    setState("idle");
    setView("connection");
  }, [device]);

  const selectProject = useCallback(
    (id: string) => {
      const nextProject = projects.find((project) => project.id === id);
      const nextSession = sessions.find((session) => session.projectId === id) ?? null;
      setSelectedProjectId(id);
      setSelectedSessionId(nextSession?.id ?? null);
      setSelectedCaptureId(captures.find((capture) => capture.projectId === id)?.id ?? null);
      setSelectedPipelineId(nextProject?.activePipelineId ?? pipelines.find((pipeline) => !pipeline.projectId || pipeline.projectId === id)?.id ?? null);
    },
    [captures, pipelines, projects, sessions],
  );

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
    setView("projects");
  }, [projects.length]);

  const createNewSession = useCallback(async () => {
    if (!selectedProject) return;
    const count = sessions.filter((session) => session.projectId === selectedProject.id).length + 1;
    const name = window.prompt("Session name", `Session ${count}`)?.trim();
    if (!name) return;
    const session = createSession(selectedProject.id, name, selectedProject.metadata?.operator);
    await store.saveSession(session);
    setSessions((prev) => [session, ...prev]);
    setSelectedSessionId(session.id);
    setSelectedCaptureId(null);
  }, [selectedProject, sessions]);

  const updateProject = useCallback(
    async (patch: Partial<Project>) => {
      if (!selectedProject) return;
      const project = { ...selectedProject, ...patch };
      await store.saveProject(project);
      setProjects((prev) => prev.map((item) => (item.id === project.id ? project : item)));
    },
    [selectedProject],
  );

  const updateProjectMetadata = useCallback(
    async (key: string, value: string) => {
      if (!selectedProject) return;
      const metadata = cleanMetadata({ ...selectedProject.metadata, [key]: value });
      await updateProject({ metadata });
    },
    [selectedProject, updateProject],
  );

  const updateSession = useCallback(
    async (patch: Partial<CaptureSession>) => {
      if (!selectedSession) return;
      const session = { ...selectedSession, ...patch };
      await store.saveSession(session);
      setSessions((prev) => prev.map((item) => (item.id === session.id ? session : item)));
    },
    [selectedSession],
  );

  const updateSessionMetadata = useCallback(
    async (key: string, value: string) => {
      if (!selectedSession) return;
      const metadata = cleanMetadata({ ...selectedSession.metadata, [key]: value });
      await updateSession({ metadata });
    },
    [selectedSession, updateSession],
  );

  const updateSelectedCaptureMetadata = useCallback(
    async (key: string, value: string) => {
      if (!selectedCapture) return;
      const capture = { ...selectedCapture, metadata: cleanMetadata({ ...selectedCapture.metadata, [key]: value }) };
      await store.saveCapture(capture);
      setCaptures((prev) => prev.map((item) => (item.id === capture.id ? capture : item)));
    },
    [selectedCapture],
  );

  const selectPipeline = useCallback(
    async (id: string) => {
      setSelectedPipelineId(id);
      if (!selectedProject) return;
      const project = { ...selectedProject, activePipelineId: id };
      await store.saveProject(project);
      setProjects((prev) => prev.map((item) => (item.id === project.id ? project : item)));
    },
    [selectedProject],
  );

  const saveCompletedCapture = useCallback(
    async (rawCapture: SpectrumCapture): Promise<SpectrumCapture> => {
      const quality = await qualityEngine.evaluate(rawCapture);
      let capture: SpectrumCapture = {
        ...rawCapture,
        projectId: selectedProject?.id,
        sessionId: selectedSession?.id,
        metadata: cleanMetadata({
          operator: selectedSession?.metadata?.operator ?? selectedProject?.metadata?.operator ?? "",
          location: selectedSession?.metadata?.location ?? selectedProject?.metadata?.location ?? "",
          ...nextCaptureMetadata,
        }),
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
      setNextCaptureMetadata((prev) => ({ ...prev, observation: "", sample_label: "", lot: "" }));
      return capture;
    },
    [nextCaptureMetadata, selectedPipeline, selectedProject, selectedSession],
  );

  const runScan = useCallback(async () => {
    if (!device) return;
    setError(null);
    setState("busy");
    try {
      await device.setActiveConfiguration(configId);
      const rawCapture = await device.startScan({ saveToDevice, sampleId }, setProgress);
      await saveCompletedCapture(rawCapture);
      setSampleId((current) => nextSampleId(current));
      setView("scan");
    } catch (err) {
      setError(formatError(err));
    } finally {
      setProgress(null);
      setState("connected");
    }
  }, [configId, device, sampleId, saveToDevice, saveCompletedCapture]);

  const loadStored = useCallback(
    async (index: number) => {
      if (!device) return;
      setState("busy");
      setError(null);
      try {
        const rawCapture = await device.readStoredScan(index, setProgress);
        await saveCompletedCapture(rawCapture);
        setView("scan");
      } catch (err) {
        setError(formatError(err));
      } finally {
        setProgress(null);
        setState("connected");
      }
    },
    [device, saveCompletedCapture],
  );

  const importPipeline = useCallback(
    async (file: File) => {
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
    },
    [selectedProject],
  );

  const fitDemoPipeline = useCallback(async () => {
    setError(null);
    try {
      const artifact = { ...(await inferenceEngine.fitDemoArtifact(projectCaptures)), projectId: selectedProject?.id };
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
  }, [projectCaptures, selectedProject]);

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

  const exportProject = useCallback(
    async (kind: ExportKind) => {
      const target = kind === "single-csv" && selectedCapture ? [selectedCapture] : projectCaptures;
      await exportTextFile(buildExport(target, kind, { project: selectedProject, sessions: projectSessions, pipelines: projectPipelines }));
    },
    [projectCaptures, projectPipelines, projectSessions, selectedCapture, selectedProject],
  );

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

          {view === "projects" && (
            <section className="projects-page">
              <div className="project-column">
                <Panel title="Project" icon={Layers3}>
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
                  <Field label="Project name">
                    <input value={selectedProject?.name ?? ""} onChange={(event) => void updateProject({ name: event.target.value })} />
                  </Field>
                  <MetadataFields values={selectedProject?.metadata ?? {}} fields={projectMetadataFields} onChange={(key, value) => void updateProjectMetadata(key, value)} />
                </Panel>

                <Panel title="Sessions" icon={ClipboardList}>
                  <button className="primary-button full" onClick={createNewSession} disabled={!selectedProject}>
                    <Plus size={17} />
                    Add session
                  </button>
                  <SessionList sessions={projectSessions} selectedId={selectedSession?.id ?? null} onSelect={setSelectedSessionId} />
                  <Field label="Session name">
                    <input value={selectedSession?.name ?? ""} onChange={(event) => void updateSession({ name: event.target.value })} />
                  </Field>
                  <MetadataFields values={selectedSession?.metadata ?? {}} fields={sessionMetadataFields} onChange={(key, value) => void updateSessionMetadata(key, value)} />
                </Panel>

                <Panel title="Models" icon={Sparkles}>
                  <FileImportButton label="Load .n4a model" onFile={importPipeline} />
                  <button className="ghost-button full" onClick={fitDemoPipeline} disabled={projectCaptures.filter((capture) => capture.spectrum).length < 4}>
                    <FlaskConical size={17} />
                    Fit demo from captures
                  </button>
                  <PipelineList pipelines={projectPipelines} selectedId={selectedPipeline?.id ?? null} onSelect={(id) => void selectPipeline(id)} />
                </Panel>
              </div>

              <div className="project-main">
                <Panel title="Dataset Quality" icon={Gauge} wide>
                  <DatasetQualityView summary={datasetQuality} />
                </Panel>

                <Panel title="Export" icon={Download}>
                  <div className="toolbar compact-toolbar">
                    <button className="ghost-button" onClick={() => void exportProject("single-csv")} disabled={!selectedCapture}>
                      <Download size={17} />
                      Spectrum CSV
                    </button>
                    <button className="ghost-button" onClick={() => void exportProject("matrix-csv")} disabled={projectCaptures.length === 0}>
                      <Save size={17} />
                      Matrix CSV
                    </button>
                    <button className="ghost-button" onClick={() => void exportProject("metadata-csv")} disabled={!selectedProject}>
                      <ClipboardList size={17} />
                      Metadata CSV
                    </button>
                    <button className="ghost-button" onClick={() => void exportProject("json")} disabled={!selectedProject}>
                      <FileJson size={17} />
                      Project JSON
                    </button>
                  </div>
                </Panel>

                <Panel title="Captures" icon={Database} wide>
                  <CaptureList captures={projectCaptures} selectedId={selectedCapture?.id ?? null} onSelect={setSelectedCaptureId} onDelete={removeCapture} />
                </Panel>
              </div>
            </section>
          )}

          {view === "connection" && (
            <section className="connection-page">
              <Panel title="Device" icon={RadioTower}>
                <DeviceOptionGrid options={deviceOptions} selected={transport} onSelect={setTransport} />
                {!isNativeShell && !webBluetoothAvailable && (
                  <div className="compat-note">
                    <Info size={16} />
                    <span>Web Bluetooth is not exposed by this browser. Use the simulator here, Chrome/Edge over HTTPS for web BLE, or the native app on mobile.</span>
                  </div>
                )}
                <div className="button-row">
                  <button className="primary-button" onClick={connect} disabled={!canConnect}>
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

              <Panel title="Device Status" icon={Info}>
                <DeviceStatusView status={status} />
              </Panel>

              <Panel title="Stored Scans" icon={HardDrive}>
                <StoredScans device={device} onLoad={loadStored} />
              </Panel>

              <Panel title="Runtime" icon={Cpu}>
                <RuntimeStack nativeShell={isNativeShell} webBluetoothAvailable={webBluetoothAvailable} />
              </Panel>
            </section>
          )}

          {view === "scan" && (
            <section className="scan-page">
              <div className="scan-control-column">
                <Panel title="Capture" icon={ScanLine}>
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
                  <div className="select-action sample-id-action">
                    <Field label="Sample ID">
                      <input value={sampleId} onChange={(event) => setSampleId(event.target.value)} />
                    </Field>
                    <button className="icon-button context-add" title="Next sample ID" onClick={() => setSampleId((current) => nextSampleId(current))}>
                      <Plus size={16} />
                    </button>
                  </div>
                  <Field label="Configuration">
                    <select value={configId} onChange={(event) => setConfigId(event.target.value)} disabled={configs.length === 0}>
                      {configs.length === 0 ? (
                        <option value="0">Connect a device first</option>
                      ) : (
                        configs.map((config) => (
                          <option key={config.id} value={config.id}>
                            {config.name}
                          </option>
                        ))
                      )}
                    </select>
                  </Field>
                  <label className="switch-line">
                    <input type="checkbox" checked={saveToDevice} onChange={(event) => setSaveToDevice(event.target.checked)} />
                    <span>Save on device SD</span>
                  </label>
                  <MetadataFields values={nextCaptureMetadata} fields={nextCaptureMetadataFields} onChange={(key, value) => setNextCaptureMetadata((prev) => ({ ...prev, [key]: value }))} />
                  <button className="primary-button scan-button" disabled={!connected || state === "busy" || !selectedSession} onClick={runScan}>
                    {state === "busy" ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
                    Start scan
                  </button>
                  {progress && <ProgressBar progress={progress} />}
                </Panel>

                <Panel title="Model Context" icon={Sparkles}>
                  <PipelineContext artifact={selectedPipeline} />
                </Panel>
              </div>

              <div className="scan-results-column">
                <Panel title="Spectrum" icon={Activity} wide>
                  <SpectrumView capture={selectedCapture} overlays={spectrumOverlays} />
                </Panel>
                <Panel title="Quality Metrics" icon={Gauge} wide>
                  <QualityView report={selectedCapture?.quality ?? null} />
                </Panel>
                <Panel title="Prediction" icon={Sparkles} wide>
                  <PredictionPanel capture={selectedCapture} artifact={selectedPipeline} onPredict={predict} />
                </Panel>
                <Panel title="Capture Metadata" icon={ClipboardList} wide>
                  {selectedCapture ? (
                    <MetadataFields values={selectedCapture.metadata ?? {}} fields={captureMetadataFields} onChange={(key, value) => void updateSelectedCaptureMetadata(key, value)} />
                  ) : (
                    <EmptyState text="No capture selected." />
                  )}
                </Panel>
                <Panel title="Session Captures" icon={Database} wide>
                  <CaptureList captures={sessionCaptures} selectedId={selectedCapture?.id ?? null} onSelect={setSelectedCaptureId} onDelete={removeCapture} />
                </Panel>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

function Panel({ title, icon: Icon, wide = false, children }: { title: string; icon: LucideIcon; wide?: boolean; children: ReactNode }) {
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function DeviceOptionGrid({
  options,
  selected,
  onSelect,
}: {
  options: DeviceOption[];
  selected: TransportKind;
  onSelect: (transport: TransportKind) => void;
}) {
  return (
    <div className="device-option-grid">
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={option.transport}
            className={selected === option.transport ? "device-option active" : "device-option"}
            onClick={() => onSelect(option.transport)}
            disabled={!option.enabled}
          >
            <Icon size={22} />
            <strong>{option.title}</strong>
            <span>{option.description}</span>
            <small>{option.badge}</small>
          </button>
        );
      })}
    </div>
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
              <option key={project.id} value={project.id}>
                {project.name || "Untitled project"}
              </option>
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
              <option key={session.id} value={session.id}>
                {session.name || "Untitled session"}
              </option>
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

function MetadataFields({
  values,
  fields,
  onChange,
}: {
  values: Record<string, string>;
  fields: MetadataField[];
  onChange: (key: string, value: string) => void;
}) {
  return (
    <div className="metadata-grid">
      {fields.map((field) => (
        <Field key={field.key} label={field.label}>
          {field.multiline ? (
            <textarea value={values[field.key] ?? ""} rows={3} onChange={(event) => onChange(field.key, event.target.value)} />
          ) : (
            <input value={values[field.key] ?? ""} onChange={(event) => onChange(field.key, event.target.value)} />
          )}
        </Field>
      ))}
    </div>
  );
}

function SessionList({ sessions, selectedId, onSelect }: { sessions: CaptureSession[]; selectedId: string | null; onSelect: (id: string) => void }) {
  if (sessions.length === 0) return <EmptyState text="No session in this project." />;
  return (
    <div className="list compact session-list">
      {sessions.map((session) => (
        <button key={session.id} className={session.id === selectedId ? "list-item active" : "list-item"} onClick={() => onSelect(session.id)}>
          <strong>{session.name || "Untitled session"}</strong>
          <span>{session.metadata?.operator || "No operator"} - {new Date(session.createdAt).toLocaleString()}</span>
        </button>
      ))}
    </div>
  );
}

function DatasetQualityView({ summary }: { summary: DatasetQualitySummary }) {
  const decodedPct = summary.captureCount === 0 ? 0 : summary.decodedCount / summary.captureCount;
  return (
    <div className="dataset-quality">
      <div className="dataset-metrics">
        <MetricCard label="Captures" value={String(summary.captureCount)} detail={`${summary.sessionCount} sessions`} />
        <MetricCard label="Decoded" value={formatPercent(decodedPct)} detail={`${summary.rawOnlyCount} raw-only`} />
        <MetricCard label="Median QC" value={summary.medianScore == null ? "n/a" : summary.medianScore.toFixed(0)} detail={summary.meanScore == null ? "no score" : `mean ${summary.meanScore.toFixed(1)}`} />
        <MetricCard label="Predicted" value={formatPercent(summary.predictionCoverage)} detail={`${summary.predictionCount} captures`} />
        <MetricCard label="Pass / Warn / Fail" value={`${summary.passCount}/${summary.warnCount}/${summary.failCount}`} detail={`${summary.unevaluatedCount} pending`} />
        <MetricCard
          label="Reps per sample"
          value={summary.repsPerSample ? `${summary.repsPerSample.min}-${summary.repsPerSample.max}` : "n/a"}
          detail={summary.repsPerSample ? `mean ${summary.repsPerSample.mean.toFixed(2)}` : "no sample"}
        />
      </div>
      <div className="dataset-detail-row">
        <div>
          <strong>Axis</strong>
          <span>
            {summary.axisRange
              ? `${summary.axisRange.start.toFixed(0)}-${summary.axisRange.end.toFixed(0)} ${summary.axisRange.unit}, ${summary.axisRange.bands} bands`
              : "No decoded axis"}
          </span>
        </div>
        <div>
          <strong>Protocol</strong>
          <span>{summary.metricProtocol.join(", ")}</span>
        </div>
      </div>
      <div className="flag-list">
        {summary.flagCounts.length === 0 ? (
          <span>No recurring quality flags.</span>
        ) : (
          summary.flagCounts.slice(0, 6).map((item) => (
            <span key={item.flag}>
              {item.flag}: {item.count}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function PipelineContext({ artifact }: { artifact: PipelineArtifact | null }) {
  if (!artifact) return <EmptyState text="No n4a model in context." />;
  return (
    <div className={artifact.runnable ? "pipeline-context ready" : "pipeline-context definition"}>
      <strong>{artifact.name}</strong>
      <span>{artifact.runnable ? `${artifact.nFeatures} features` : "pipeline definition only"}</span>
      {artifact.validationMessage && <small>{artifact.validationMessage}</small>}
    </div>
  );
}

function StatusPill({ state }: { state: DeviceConnectionState }) {
  const text = state === "busy" ? "busy" : state === "connected" ? "connected" : state === "error" ? "attention" : state;
  return <span className={`status-pill ${state}`}>{text}</span>;
}

function MiniStat({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
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

function RuntimeStack({ nativeShell, webBluetoothAvailable }: { nativeShell: boolean; webBluetoothAvailable: boolean }) {
  const manifest = inferenceEngine.capabilities();
  return (
    <div className="runtime-stack">
      <div><strong>{manifest.aggregate}</strong><span>{manifest.controllers.length} controllers</span></div>
      <div><strong>nirs4all-ui</strong><span>brand + contracts</span></div>
      <div><strong>Capacitor</strong><span>{nativeShell ? "native shell" : "web shell"}</span></div>
      <div><strong>BLE</strong><span>{nativeShell ? "native plugin" : webBluetoothAvailable ? "Web Bluetooth" : "not available"}</span></div>
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
    ["Status", status.statusText ?? "n/a"],
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
        {report.flags.length > 0 && (
          <div className="metric fail">
            <span>Flags</span>
            <strong>{report.flags.length}</strong>
            <small>{report.flags.join(", ")}</small>
          </div>
        )}
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
  if (!artifact) return <EmptyState text="No n4a model loaded for this project." />;
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
        Re-run prediction
      </button>
      {capture?.prediction ? (
        <div className="prediction-result">
          <span>{capture.prediction.pipelineName}</span>
          <strong>{formatNumber(capture.prediction.value)}</strong>
        </div>
      ) : (
        <EmptyState text="The active model will run automatically after the next decoded scan." />
      )}
    </div>
  );
}

function PipelineList({ pipelines, selectedId, onSelect }: { pipelines: PipelineArtifact[]; selectedId: string | null; onSelect: (id: string) => void }) {
  if (pipelines.length === 0) return <EmptyState text="No model loaded." />;
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
            <span>{capture.spectrum ? `${capture.spectrum.values.length} bands` : "raw payload"} - {capture.quality?.status ?? "no QC"}</span>
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
          <button key={index} onClick={() => onLoad(index)}>
            {index}
          </button>
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
      <input
        type="file"
        accept=".json,.n4a,application/json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void onFile(file);
          event.currentTarget.value = "";
        }}
      />
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
    metadata: {},
  };
}

function createSession(projectId: string, name: string, operator = ""): CaptureSession {
  return {
    id: makeEntityId("session"),
    projectId,
    name,
    createdAt: new Date().toISOString(),
    metadata: cleanMetadata({ operator }),
  };
}

function makeEntityId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function cleanMetadata(metadata: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(metadata)
      .map(([key, value]) => [key, value?.trim() ?? ""] as const)
      .filter(([, value]) => value.length > 0),
  );
}

function isWebBluetoothAvailable(): boolean {
  if (typeof navigator === "undefined") return false;
  return Boolean((navigator as Navigator & { bluetooth?: unknown }).bluetooth);
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

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
