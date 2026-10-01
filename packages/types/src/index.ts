export type AIMode = 'local' | 'api';
export type ProviderName = 'openai' | 'anthropic' | 'gemini' | 'custom' | 'ollama';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type JobKind = 'analysis' | 'transcription' | 'render' | 'model-download';
export type ClipCategory = 'hook' | 'educational' | 'story' | 'controversial' | 'emotional' | 'insight' | 'funny' | 'quotable';
export type CaptionStyle = 'classic' | 'minimal' | 'bold' | 'creator' | 'karaoke' | 'highlight' | 'clean';
export type AspectRatio = '9:16' | '1:1' | '16:9';
export type FaceStrategy = 'active-speaker' | 'largest' | 'center' | 'manual';

export interface Word {
  id: string;
  word: string;
  start: number;
  end: number;
}
export interface TranscriptSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  words: Word[];
}
export interface Transcript {
  language: string;
  duration: number;
  segments: TranscriptSegment[];
  model: string;
}
export interface VideoMetadata {
  filename: string;
  size: number;
  width: number;
  height: number;
  fps: number;
  duration: number;
  codec: string;
  hasAudio: boolean;
  audioCodec: string | null;
  audioChannels: number | null;
  isAudio: boolean;
}
export interface ClipCandidate {
  id: string;
  projectId: string;
  startTime: number;
  endTime: number;
  duration: number;
  title: string;
  hook: string;
  score: number;
  reasons: string[];
  transcript: string;
  categories: ClipCategory[];
  favorite: boolean;
  rejected: boolean;
  thumbnailUrl: string | null;
  headlines: string[];
  createdAt: string;
}
export interface CaptionSettings {
  enabled: boolean;
  style: CaptionStyle;
  font: 'DejaVu Sans' | 'Arial' | 'Verdana';
  fontSize: number;
  position: 'top' | 'center' | 'bottom';
  color: string;
  highlightColor: string;
  background: string;
  maxWords: number;
  animation: 'none' | 'fade' | 'pop';
}
export interface HeadlineSettings {
  enabled: boolean;
  text: string;
  fontSize: number;
  color: string;
  background: string;
  position: 'top' | 'center' | 'bottom';
  alignment: 'left' | 'center' | 'right';
  font: 'DejaVu Sans' | 'Arial' | 'Verdana';
}
export interface RenderSettings {
  preset: 'tiktok' | 'reels' | 'shorts' | 'custom';
  aspectRatio: AspectRatio;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  filename: string;
  format: 'mp4';
  faceStrategy: FaceStrategy;
  manualCropX: number;
  trackFaces: boolean;
  audioVolume: number;
  captionSettings: CaptionSettings;
  headlineSettings: HeadlineSettings;
  words: Word[];
  startTime: number;
  endTime: number;
}
export interface ClipEdit {
  clipId: string;
  projectId: string;
  settings: RenderSettings;
  updatedAt: string;
}
export interface ProjectSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: 'imported' | 'analyzing' | 'ready' | 'failed';
  media: VideoMetadata;
  clipCount: number;
  exportCount: number;
  thumbnailUrl: string | null;
  aiMode: AIMode;
  lastError: string | null;
}
export interface Project extends ProjectSummary {
  sourceUrl: string;
  sourceLocation: string;
  transcriptLocation: string;
  transcript: Transcript | null;
  clips: ClipCandidate[];
  edits: ClipEdit[];
  scenes: number[];
}
export interface JobStep {
  key: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'skipped';
}
export interface Job {
  id: string;
  projectId: string | null;
  clipId: string | null;
  kind: JobKind;
  status: JobStatus;
  progress: number;
  message: string;
  steps: JobStep[];
  createdAt: string;
  updatedAt: string;
  error: AppErrorData | null;
  resultId: string | null;
}
export interface JobEvent {
  type: 'progress' | 'job-completed' | 'job-failed' | 'job-cancelled' | 'snapshot';
  jobId: string;
  sequence: number;
  job: Job;
}
export interface RenderedClip {
  id: string;
  projectId: string;
  clipId: string;
  title: string;
  filename: string;
  url: string;
  thumbnailUrl: string | null;
  size: number;
  duration: number;
  width: number;
  height: number;
  preset: string;
  createdAt: string;
  path: string;
}
export interface AnalyzeOptions {
  minDuration: number;
  maxDuration: number;
  aiMode: AIMode;
  model: string;
  language: string | null;
  provider: ProviderName;
  providerModel: string;
  endpoint: string;
  transcriptConsent: boolean;
}
export interface ModelInfo {
  name: string;
  label: string;
  size: string;
  installed: boolean;
  recommended: boolean;
}
export interface Health {
  status: 'ok';
  version: string;
  runtime: 'web' | 'desktop';
  ffmpeg: boolean;
  ffprobe: boolean;
  transcription: boolean;
  models: ModelInfo[];
  hardware: { cpuCores: number; memoryGb: number; gpu: boolean };
  storage: { used: number; free: number; projectCount: number };
  providers: { name: ProviderName; configured: boolean }[];
  activeJobs: number;
  limits: { maxUploadBytes: number };
}
export interface NetworkRecord {
  id: string;
  kind: 'transcript-api' | 'model-download';
  provider: string;
  timestamp: string;
  bytesSent: number;
  status: 'started' | 'completed' | 'failed';
  projectId: string | null;
}
export interface PrivacyInfo {
  runtime: 'web' | 'desktop';
  dataLocation: string;
  sourceUploadRequired: boolean;
  projects: { id: string; title: string; videoLocation: string; transcriptLocation: string; aiMode: AIMode }[];
  networkActivity: NetworkRecord[];
  activeFiles: { projectId: string; filename: string; jobId: string; kind: string }[];
}
export interface AppSettings {
  theme: 'dark' | 'light' | 'system';
  language: string;
  autosave: boolean;
  aiMode: AIMode;
  model: string;
  provider: ProviderName;
  providerModel: string;
  endpoint: string;
  localLlm: 'heuristic' | 'ollama';
  minDuration: number;
  maxDuration: number;
  aspectRatio: AspectRatio;
  fps: number;
  captionStyle: CaptionStyle;
  exportDirectory: string;
}
export interface License {
  tier: 'free' | 'trial' | 'pro';
  status: 'active' | 'expired' | 'inactive';
  expiresAt: string | null;
  offlineProcessing: boolean;
}
export interface LicenseManager {
  getLicense(): Promise<License>;
  activateLicense(key: string): Promise<void>;
  deactivate(): Promise<void>;
}
export interface ClipAnalysis { candidates: ClipCandidate[]; }
export interface AIProvider {
  name: string;
  analyzeTranscript(transcript: string): Promise<ClipAnalysis>;
}
export interface AppErrorData {
  code: string;
  message: string;
  detail: string;
  retryable: boolean;
}
export type Unsubscribe = () => void;
export interface MediaProcessingBackend {
  runtime: 'web' | 'desktop';
  health(): Promise<Health>;
  listProjects(): Promise<ProjectSummary[]>;
  getProject(id: string): Promise<Project>;
  importVideo(file?: File, title?: string, uploadConsent?: boolean): Promise<Project | null>;
  updateProject(id: string, update: { title?: string; aiMode?: AIMode }): Promise<Project>;
  deleteProject(id: string): Promise<void>;
  analyze(projectId: string, options: AnalyzeOptions): Promise<Job>;
  transcribe(projectId: string, options: AnalyzeOptions): Promise<Job>;
  listJobs(): Promise<Job[]>;
  getJob(id: string): Promise<Job>;
  cancelJob(id: string): Promise<Job>;
  subscribeJob(id: string, onEvent: (event: JobEvent) => void, onConnection?: (connected: boolean) => void): Unsubscribe;
  updateClip(id: string, update: { favorite?: boolean; rejected?: boolean; title?: string }): Promise<ClipCandidate>;
  saveEdit(clipId: string, settings: RenderSettings): Promise<ClipEdit>;
  render(clipId: string, settings: RenderSettings): Promise<Job>;
  listExports(): Promise<RenderedClip[]>;
  deleteExport(id: string): Promise<void>;
  exportFile(exported: RenderedClip): Promise<void>;
  privacy(): Promise<PrivacyInfo>;
  deleteNetworkHistory(): Promise<void>;
  installModel(name: string): Promise<Job>;
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  getLicense(): Promise<License>;
  storeApiKey(provider: ProviderName, key: string): Promise<void>;
  mediaUrl(url: string): string;
}
