import {
  Activity,
  BarChart3,
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
  Maximize2,
  Play,
  Plus,
  RadioTower,
  Repeat,
  Save,
  ScanLine,
  Sparkles,
  Trash2,
  Upload,
  Usb,
  X,
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
import { nextRepetitionId, nextSampleId } from "@/runtime/sampleIds";
import { summarizeSpectrum } from "@/runtime/spectrumStats";
import { CaptureStore } from "@/storage/captureStore";
import { buildExport, exportTextFile, type ExportKind } from "@/storage/export";

type ViewId = "projects" | "connection" | "scan";
type BatchScope = "project" | "session";
type ScanMode = "capture" | "repeat";

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
  const [scanMode, setScanMode] = useState<ScanMode | null>(null);
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
  const [overviewScope, setOverviewScope] = useState<BatchScope>("project");
  const [inspectedCaptureId, setInspectedCaptureId] = useState<string | null>(null);
  const [namePrompt, setNamePrompt] = useState<"project" | "session" | null>(null);
  const [nameDraft, setNameDraft] = useState("");
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
  const sessionQuality = useMemo(
    () => summarizeDatasetQuality(sessionCaptures, selectedSession ? [selectedSession] : []),
    [selectedSession, sessionCaptures],
  );
  const overviewCaptures = overviewScope === "session" ? sessionCaptures : projectCaptures;
  const overviewQuality = overviewScope === "session" ? sessionQuality : datasetQuality;
  const projectEnvelope = useMemo(
    () => buildOverlay(projectCaptures.filter((capture) => capture.id !== selectedCapture?.id), selectedCapture, "Project"),
    [projectCaptures, selectedCapture],
  );
  const sessionEnvelope = useMemo(
    () => buildOverlay(sessionCaptures.filter((capture) => capture.id !== selectedCapture?.id), selectedCapture, "Session"),
    [sessionCaptures, selectedCapture],
  );
  const spectrumOverlays = [projectEnvelope, sessionEnvelope].filter(Boolean) as SpectrumEnvelope[];
  const inspectedCapture = inspectedCaptureId ? projectCaptures.find((capture) => capture.id === inspectedCaptureId) ?? null : null;
  const inspectedSessionCaptures = projectCaptures.filter((capture) => capture.sessionId === inspectedCapture?.sessionId);
  const inspectedProjectEnvelope = useMemo(
    () => buildOverlay(projectCaptures.filter((capture) => capture.id !== inspectedCapture?.id), inspectedCapture, "Project"),
    [projectCaptures, inspectedCapture],
  );
  const inspectedSessionEnvelope = useMemo(
    () => buildOverlay(inspectedSessionCaptures.filter((capture) => capture.id !== inspectedCapture?.id), inspectedCapture, "Session"),
    [inspectedCapture, inspectedSessionCaptures],
  );
  const inspectedOverlays = [inspectedProjectEnvelope, inspectedSessionEnvelope].filter(Boolean) as SpectrumEnvelope[];
  const lastSessionCapture = sessionCaptures[0] ?? null;
  const repeatRepetition = lastSessionCapture ? nextRepetitionId(captureRepetition(lastSessionCapture) || "1") : null;
  const logo = useMemo(
    () => brand.generateNirs4allBrandSvg("nirs4all", { variant: "icon", title: "nirs4all Device", animated: true }),
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

  const selectSession = useCallback(
    (id: string) => {
      setSelectedSessionId(id);
      setSelectedCaptureId((prev) =>
        captures.some((capture) => capture.id === prev && capture.sessionId === id)
          ? prev
          : captures.find((capture) => capture.sessionId === id)?.id ?? null,
      );
    },
    [captures],
  );

  const createNewProject = useCallback(() => {
    setNameDraft(`Project ${projects.length + 1}`);
    setNamePrompt("project");
  }, [projects.length]);

  const createNewSession = useCallback(() => {
    if (!selectedProject) return;
    const count = sessions.filter((session) => session.projectId === selectedProject.id).length + 1;
    setNameDraft(`Session ${count}`);
    setNamePrompt("session");
  }, [selectedProject, sessions]);

  const confirmNamePrompt = useCallback(async () => {
    const kind = namePrompt;
    const name = nameDraft.trim();
    setNamePrompt(null);
    if (!kind || !name) return;
    if (kind === "project") {
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
      return;
    }
    if (!selectedProject) return;
    const session = createSession(selectedProject.id, name, selectedProject.metadata?.operator);
    await store.saveSession(session);
    setSessions((prev) => [session, ...prev]);
    setSelectedSessionId(session.id);
    setSelectedCaptureId(null);
  }, [nameDraft, namePrompt, selectedProject]);

  /* Editable fields update React state synchronously and persist in the background;
   * awaiting IndexedDB before setState loses keystrokes typed while a save is in flight. */
  const updateProject = useCallback(
    (patch: Partial<Project>) => {
      if (!selectedProject) return;
      const project = { ...selectedProject, ...patch };
      setProjects((prev) => prev.map((item) => (item.id === project.id ? project : item)));
      void store.saveProject(project).catch((err) => setError(formatError(err)));
    },
    [selectedProject],
  );

  const updateProjectMetadata = useCallback(
    (key: string, value: string) => {
      if (!selectedProject) return;
      updateProject({ metadata: cleanMetadata({ ...selectedProject.metadata, [key]: value }) });
    },
    [selectedProject, updateProject],
  );

  const updateSession = useCallback(
    (patch: Partial<CaptureSession>) => {
      if (!selectedSession) return;
      const session = { ...selectedSession, ...patch };
      setSessions((prev) => prev.map((item) => (item.id === session.id ? session : item)));
      void store.saveSession(session).catch((err) => setError(formatError(err)));
    },
    [selectedSession],
  );

  const updateSessionMetadata = useCallback(
    (key: string, value: string) => {
      if (!selectedSession) return;
      updateSession({ metadata: cleanMetadata({ ...selectedSession.metadata, [key]: value }) });
    },
    [selectedSession, updateSession],
  );

  const updateSelectedCapture = useCallback(
    (patch: Partial<SpectrumCapture>) => {
      if (!selectedCapture) return;
      const capture = { ...selectedCapture, ...patch };
      setCaptures((prev) => prev.map((item) => (item.id === capture.id ? capture : item)));
      void store.saveCapture(capture).catch((err) => setError(formatError(err)));
    },
    [selectedCapture],
  );

  const updateSelectedCaptureMetadata = useCallback(
    (key: string, value: string) => {
      if (!selectedCapture) return;
      updateSelectedCapture({ metadata: cleanMetadata({ ...selectedCapture.metadata, [key]: value }) });
    },
    [selectedCapture, updateSelectedCapture],
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
    async (rawCapture: SpectrumCapture, repetition: string): Promise<SpectrumCapture> => {
      const quality = await qualityEngine.evaluate(rawCapture);
      let capture: SpectrumCapture = {
        ...rawCapture,
        projectId: selectedProject?.id,
        sessionId: selectedSession?.id,
        metadata: cleanMetadata({
          operator: selectedSession?.metadata?.operator ?? selectedProject?.metadata?.operator ?? "",
          location: selectedSession?.metadata?.location ?? selectedProject?.metadata?.location ?? "",
          ...nextCaptureMetadata,
          repetition,
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

  const runScan = useCallback(
    async (mode: ScanMode) => {
      if (!device) return;
      const target =
        mode === "repeat" && lastSessionCapture
          ? { sampleId: lastSessionCapture.sampleId, repetition: nextRepetitionId(captureRepetition(lastSessionCapture) || "1") }
          : { sampleId, repetition: "1" };
      setError(null);
      setScanMode(mode);
      setState("busy");
      try {
        await device.setActiveConfiguration(configId);
        const rawCapture = await device.startScan({ saveToDevice, sampleId: target.sampleId }, setProgress);
        await saveCompletedCapture(rawCapture, target.repetition);
        if (mode === "capture") setSampleId(nextSampleId(target.sampleId));
        setView("scan");
        revealScanResult();
      } catch (err) {
        setError(formatError(err));
      } finally {
        setProgress(null);
        setScanMode(null);
        setState("connected");
      }
    },
    [configId, device, lastSessionCapture, sampleId, saveToDevice, saveCompletedCapture],
  );

  const loadStored = useCallback(
    async (index: number) => {
      if (!device) return;
      setState("busy");
      setError(null);
      try {
        const rawCapture = await device.readStoredScan(index, setProgress);
        await saveCompletedCapture(rawCapture, "1");
        setView("scan");
        revealScanResult();
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
    <div className="app-shell n4-app n4-app-bg">
      <div className="spectrum-strip n4-spectrum-strip" aria-hidden="true" />
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
              <button
                key={item.id}
                className={view === item.id ? "rail-item active" : "rail-item"}
                onClick={() => setView(item.id)}
                aria-current={view === item.id ? "page" : undefined}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <main className="workspace">
          {error && (
            <div className="error-banner" role="alert">
              <XCircle size={18} />
              <span>{error}</span>
              <button className="icon-button" title="Dismiss" aria-label="Dismiss error" onClick={() => setError(null)}>
                <X size={16} />
              </button>
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
                    onSessionChange={selectSession}
                    onNewProject={createNewProject}
                    onNewSession={createNewSession}
                  />
                  <Field label="Project name">
                    <input value={selectedProject?.name ?? ""} onChange={(event) => updateProject({ name: event.target.value })} />
                  </Field>
                  <MetadataFields values={selectedProject?.metadata ?? {}} fields={projectMetadataFields} onChange={updateProjectMetadata} />
                </Panel>

                <Panel title="Sessions" icon={ClipboardList}>
                  <button className="primary-button full" onClick={createNewSession} disabled={!selectedProject}>
                    <Plus size={17} />
                    Add session
                  </button>
                  <SessionList sessions={projectSessions} selectedId={selectedSession?.id ?? null} onSelect={setSelectedSessionId} />
                  <Field label="Session name">
                    <input value={selectedSession?.name ?? ""} onChange={(event) => updateSession({ name: event.target.value })} />
                  </Field>
                  <MetadataFields values={selectedSession?.metadata ?? {}} fields={sessionMetadataFields} onChange={updateSessionMetadata} />
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

                <Panel title="Dataset View" icon={BarChart3} wide>
                  <BatchOverview
                    scope={overviewScope}
                    summary={overviewQuality}
                    captures={overviewCaptures}
                    selectedId={selectedCapture?.id ?? null}
                    onScopeChange={setOverviewScope}
                    onSelect={(id) => setSelectedCaptureId(id)}
                    onInspect={(id) => {
                      setSelectedCaptureId(id);
                      setInspectedCaptureId(id);
                    }}
                  />
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
                <CaptureReadiness
                  connected={connected}
                  session={selectedSession}
                  deviceName={device?.descriptor.name ?? selectedDeviceOption.title}
                  onOpenConnection={() => setView("connection")}
                />
                <Panel title="Capture" icon={ScanLine}>
                  <ProjectSessionPanel
                    projects={projects}
                    sessions={projectSessions}
                    selectedProjectId={selectedProject?.id ?? ""}
                    selectedSessionId={selectedSession?.id ?? ""}
                    onProjectChange={selectProject}
                    onSessionChange={selectSession}
                    onNewProject={createNewProject}
                    onNewSession={createNewSession}
                  />
                  <div className="select-action sample-id-action">
                    <Field label="Next sample ID">
                      <input value={sampleId} onChange={(event) => setSampleId(event.target.value)} />
                    </Field>
                    <button
                      className="icon-button context-add"
                      title="Skip to next sample ID"
                      aria-label="Skip to next sample ID"
                      onClick={() => setSampleId((current) => nextSampleId(current))}
                    >
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
                  <details className="metadata-disclosure">
                    <summary>Capture metadata <span>optional</span></summary>
                    <MetadataFields values={nextCaptureMetadata} fields={nextCaptureMetadataFields} onChange={(key, value) => setNextCaptureMetadata((prev) => ({ ...prev, [key]: value }))} />
                  </details>
                  <div className="capture-submit">
                    <div className="capture-actions">
                      <button
                        className="primary-button scan-button"
                        disabled={!connected || state === "busy" || !selectedSession}
                        onClick={() => void runScan("capture")}
                      >
                        {scanMode === "capture" ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
                        <span className="action-label">
                          <strong>Capture</strong>
                          <small>{sampleId.trim() || "sample-001"}</small>
                        </span>
                      </button>
                      <button
                        className="ghost-button repeat-button"
                        disabled={!connected || state === "busy" || !selectedSession || !lastSessionCapture}
                        onClick={() => void runScan("repeat")}
                      >
                        {scanMode === "repeat" ? <Loader2 className="spin" size={18} /> : <Repeat size={18} />}
                        <span className="action-label">
                          <strong>Repeat</strong>
                          <small>{lastSessionCapture ? `rep ${repeatRepetition} · ${lastSessionCapture.sampleId}` : "no capture yet"}</small>
                        </span>
                      </button>
                    </div>
                  </div>
                  {progress && <ProgressBar progress={progress} />}
                </Panel>

                <Panel title="Model Context" icon={Sparkles} className="panel-model-context">
                  <PipelineContext artifact={selectedPipeline} />
                </Panel>
              </div>

              <div className="scan-results-column">
                <Panel title="Spectrum" icon={Activity} wide id="scan-spectrum">
                  <SpectrumView
                    capture={selectedCapture}
                    overlays={spectrumOverlays}
                    onInspect={selectedCapture ? () => setInspectedCaptureId(selectedCapture.id) : undefined}
                  />
                </Panel>
                <Panel title="Quality Metrics" icon={Gauge} wide>
                  <QualityView report={selectedCapture?.quality ?? null} />
                </Panel>
                <Panel title="Prediction" icon={Sparkles} wide>
                  <PredictionPanel capture={selectedCapture} artifact={selectedPipeline} onPredict={predict} />
                </Panel>
                <Panel title="Capture Metadata" icon={ClipboardList} wide>
                  {selectedCapture ? (
                    <>
                      <div className="capture-identity">
                        <Field label="Sample ID">
                          <input value={selectedCapture.sampleId} onChange={(event) => updateSelectedCapture({ sampleId: event.target.value })} />
                        </Field>
                        <Field label="Repetition">
                          <input
                            inputMode="numeric"
                            placeholder="1"
                            value={captureRepetition(selectedCapture)}
                            onChange={(event) => updateSelectedCaptureMetadata("repetition", event.target.value)}
                          />
                        </Field>
                      </div>
                      <MetadataFields values={selectedCapture.metadata ?? {}} fields={captureMetadataFields} onChange={updateSelectedCaptureMetadata} />
                    </>
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
      {inspectedCapture && (
        <SpectrumDetailDialog
          capture={inspectedCapture}
          overlays={inspectedOverlays}
          onClose={() => setInspectedCaptureId(null)}
        />
      )}
      {namePrompt && (
        <NameDialog
          title={namePrompt === "project" ? "New project" : "New session"}
          value={nameDraft}
          onChange={setNameDraft}
          onCancel={() => setNamePrompt(null)}
          onConfirm={() => void confirmNamePrompt()}
        />
      )}
    </div>
  );
}

function Panel({
  title,
  icon: Icon,
  wide = false,
  id,
  className,
  children,
}: {
  title: string;
  icon: LucideIcon;
  wide?: boolean;
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={["panel", wide ? "wide" : "", className ?? ""].filter(Boolean).join(" ")}>
      <div className="panel-header">
        <Icon size={18} />
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function CaptureReadiness({
  connected,
  session,
  deviceName,
  onOpenConnection,
}: {
  connected: boolean;
  session: CaptureSession | null;
  deviceName: string;
  onOpenConnection: () => void;
}) {
  if (!connected) {
    return (
      <button className="capture-readiness action" onClick={onOpenConnection}>
        <RadioTower size={18} />
        <span><strong>Device not connected</strong><small>Choose and connect a device before capturing.</small></span>
      </button>
    );
  }
  if (!session) {
    return (
      <div className="capture-readiness warning">
        <Info size={18} />
        <span><strong>Choose a session</strong><small>Every capture is stored in the active project and session.</small></span>
      </div>
    );
  }
  return (
    <div className="capture-readiness ready">
      <CheckCircle2 size={18} />
      <span><strong>{deviceName} ready</strong><small>{session.name || "Untitled session"}</small></span>
    </div>
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
        <button className="icon-button context-add" title="New project" aria-label="New project" onClick={onNewProject}>
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
        <button className="icon-button context-add" title="New session" aria-label="New session" onClick={onNewSession}>
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

function BatchOverview({
  scope,
  summary,
  captures,
  selectedId,
  onScopeChange,
  onSelect,
  onInspect,
}: {
  scope: BatchScope;
  summary: DatasetQualitySummary;
  captures: SpectrumCapture[];
  selectedId: string | null;
  onScopeChange: (scope: BatchScope) => void;
  onSelect: (id: string) => void;
  onInspect: (id: string) => void;
}) {
  const target =
    captures.find((capture) => capture.id === selectedId && capture.spectrum) ??
    captures.find((capture) => capture.spectrum) ??
    captures[0] ??
    null;
  const overlay = target?.spectrum
    ? buildSpectrumEnvelope(captures.filter((capture) => capture.id !== target.id), target.spectrum.axis, scope === "session" ? "Session" : "Project")
    : null;
  const overlays = overlay ? [overlay] : [];
  return (
    <div className="batch-overview">
      <div className="segmented-control" role="tablist" aria-label="Dataset scope">
        <button className={scope === "project" ? "active" : ""} onClick={() => onScopeChange("project")}>
          Project dataset
        </button>
        <button className={scope === "session" ? "active" : ""} onClick={() => onScopeChange("session")}>
          Active session
        </button>
      </div>
      <div className="batch-summary-strip">
        <MetricCard label="Captures" value={String(summary.captureCount)} detail={`${summary.decodedCount} decoded`} />
        <MetricCard label="QC median" value={summary.medianScore == null ? "n/a" : summary.medianScore.toFixed(0)} detail={`${summary.passCount}/${summary.warnCount}/${summary.failCount} pass/warn/fail`} />
        <MetricCard label="Predicted" value={formatPercent(summary.predictionCoverage)} detail={`${summary.predictionCount} captures`} />
      </div>
      <SpectrumView capture={target} overlays={overlays} onInspect={target ? () => onInspect(target.id) : undefined} />
      <SpectrumStatsView capture={target} compact />
      <BatchCaptureTable captures={captures} selectedId={target?.id ?? selectedId} onSelect={onSelect} onInspect={onInspect} />
    </div>
  );
}

function BatchCaptureTable({
  captures,
  selectedId,
  onSelect,
  onInspect,
}: {
  captures: SpectrumCapture[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onInspect: (id: string) => void;
}) {
  if (captures.length === 0) return <EmptyState text="No captures in this scope." />;
  return (
    <div className="batch-capture-table">
      {captures.slice(0, 8).map((capture) => (
        <div
          key={capture.id}
          className={capture.id === selectedId ? "batch-row active" : "batch-row"}
        >
          <button className="batch-select" onClick={() => onSelect(capture.id)}>
            <strong>{formatCaptureLabel(capture)}</strong>
            <span>{capture.quality?.status ?? "no QC"}</span>
            <span>{capture.prediction ? formatNumber(capture.prediction.value) : "no prediction"}</span>
          </button>
          <button className="batch-inspect icon-button" title={`Inspect ${formatCaptureLabel(capture)}`} aria-label={`Inspect ${formatCaptureLabel(capture)}`} onClick={() => onInspect(capture.id)}>
            <Maximize2 size={15} />
          </button>
        </div>
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
  return (
    <span className={`status-pill ${state}`}>
      <i className="dot" aria-hidden="true" />
      {text}
    </span>
  );
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
      <div
        className="progress-track"
        role="progressbar"
        aria-label={progress.phase}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress.pct)}
      >
        <div style={{ width: `${progress.pct}%` }} />
      </div>
    </div>
  );
}

function SpectrumView({
  capture,
  overlays = [],
  onInspect,
}: {
  capture: SpectrumCapture | null;
  overlays?: SpectrumEnvelope[];
  onInspect?: () => void;
}) {
  if (!capture?.spectrum) {
    return <EmptyState text={capture?.rawPayloadBase64 ? "Raw Nano payload captured." : "No decoded spectrum selected."} />;
  }
  const { axis, values } = capture.spectrum;
  const repetition = captureRepetition(capture);
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
      <div className="spectrum-plot">
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
        {onInspect && (
          <button className="spectrum-inspect icon-button" title="Inspect spectrum" aria-label="Inspect spectrum" onClick={onInspect}>
            <Maximize2 size={17} />
          </button>
        )}
      </div>
      <div className="spectrum-meta">
        <span>{axis[0]?.toFixed(0)}-{axis.at(-1)?.toFixed(0)} {capture.spectrum.axisUnit}</span>
        {repetition && <span>rep {repetition}</span>}
        <span>{values.length} bands</span>
        <span>{capture.spectrum.signalType}</span>
        {overlays.map((overlay) => (
          <span key={overlay.label}>{overlay.label} q10-q90{overlay.count ? ` n=${overlay.count}` : ""}</span>
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

function SpectrumStatsView({ capture, compact = false }: { capture: SpectrumCapture | null; compact?: boolean }) {
  const stats = summarizeSpectrum(capture);
  if (!stats) return <EmptyState text="No spectrum statistics available." />;
  const rows: Array<{ label: string; value: string; detail: string }> = [
    { label: "Bands", value: String(stats.bands), detail: `${formatPercent(stats.finiteShare)} finite` },
    { label: "Mean", value: formatNullable(stats.mean), detail: "reflectance" },
    { label: "Std dev", value: formatNullable(stats.std), detail: "sample spread" },
    { label: "Range", value: formatNullable(stats.range), detail: `${formatNullable(stats.min)} to ${formatNullable(stats.max)}` },
  ];
  return (
    <div className={compact ? "spectrum-stats compact" : "spectrum-stats"}>
      {rows.map((row) => (
        <MetricCard key={row.label} label={row.label} value={row.value} detail={row.detail} />
      ))}
    </div>
  );
}

function SpectrumDetailDialog({
  capture,
  overlays,
  onClose,
}: {
  capture: SpectrumCapture;
  overlays: SpectrumEnvelope[];
  onClose: () => void;
}) {
  useCloseOnEscape(onClose);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="spectrum-dialog" role="dialog" aria-modal="true" aria-label={`Spectrum ${formatCaptureLabel(capture)}`}>
        <div className="dialog-header">
          <div>
            <strong>{formatCaptureLabel(capture)}</strong>
            <span>{new Date(capture.createdAt).toLocaleString()}</span>
          </div>
          <button className="icon-button" title="Close" aria-label="Close spectrum detail" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="dialog-grid">
          <div className="dialog-main">
            <SpectrumView capture={capture} overlays={overlays} />
            <SpectrumStatsView capture={capture} />
          </div>
          <div className="dialog-side">
            <QualityView report={capture.quality ?? null} />
            <CaptureDetailMeta capture={capture} />
          </div>
        </div>
      </section>
    </div>
  );
}

function CaptureDetailMeta({ capture }: { capture: SpectrumCapture }) {
  const rows = [
    ["Device", capture.device.name],
    ["Configuration", capture.configuration?.name ?? "n/a"],
    ["Source", capture.source],
    ["Signal", capture.spectrum?.signalType ?? "raw"],
    ["Prediction", capture.prediction ? `${capture.prediction.pipelineName}: ${formatNumber(capture.prediction.value)}` : "n/a"],
    ...Object.entries(capture.metadata ?? {}).map(([key, value]) => [formatMetadataKey(key), value] as [string, string]),
  ];
  return (
    <dl className="status-grid detail-meta">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
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
            <strong>{formatCaptureLabel(capture)}</strong>
            <span>{new Date(capture.createdAt).toLocaleString()}</span>
            <span>{capture.spectrum ? `${capture.spectrum.values.length} bands` : "raw payload"} - {capture.quality?.status ?? "no QC"}</span>
          </button>
          <ConfirmDeleteButton label={`Delete ${formatCaptureLabel(capture)}`} onConfirm={() => onDelete(capture.id)} />
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

function NameDialog({
  title,
  value,
  onChange,
  onCancel,
  onConfirm,
}: {
  title: string;
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useCloseOnEscape(onCancel);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <form
        className="name-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm();
        }}
      >
        <strong>{title}</strong>
        <input
          autoFocus
          value={value}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => onChange(event.target.value)}
        />
        <div className="dialog-actions">
          <button type="button" className="ghost-button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={!value.trim()}>
            Create
          </button>
        </div>
      </form>
    </div>
  );
}

function ConfirmDeleteButton({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 2600);
    return () => window.clearTimeout(timer);
  }, [armed]);
  return (
    <button
      className={armed ? "icon-button danger-armed" : "icon-button"}
      title={armed ? "Tap again to confirm" : label}
      aria-label={armed ? `Confirm: ${label}` : label}
      onClick={() => (armed ? onConfirm() : setArmed(true))}
    >
      <Trash2 size={16} />
    </button>
  );
}

function useCloseOnEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

function revealScanResult() {
  if (!window.matchMedia("(max-width: 820px)").matches) return;
  window.setTimeout(() => {
    document.getElementById("scan-spectrum")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 80);
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

function formatNullable(value: number | null): string {
  return value == null ? "n/a" : formatNumber(value);
}

function formatMetadataKey(key: string): string {
  return key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function captureRepetition(capture: SpectrumCapture): string {
  return capture.metadata?.repetition?.trim() ?? "";
}

function formatCaptureLabel(capture: SpectrumCapture): string {
  const repetition = captureRepetition(capture);
  return repetition ? `${capture.sampleId} rep ${repetition}` : capture.sampleId;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
