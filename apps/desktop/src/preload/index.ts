import { contextBridge, ipcRenderer } from "electron";
import type { ShrikeApi } from "@shrike/schema";

const methods = [
  "openProjectDialog", "openProject", "sampleProjectPath", "openLiveSite", "getProject", "run", "stop", "getRunStatus", "reloadApp",
  "popOutApp", "dockApp", "appWindowOpen",
  "listFiles", "mapTree", "readFile", "writeFile", "getActions", "sendRequest", "detectBrains", "startAgent",
  "stopAgent", "answerApproval", "revertPatch", "getActionShot", "openInEditor", "saveClip",
] as const satisfies readonly Exclude<keyof ShrikeApi, "on">[];

const api: Record<string, unknown> = {
  platform: process.platform,
  on(channel: string, cb: (payload: unknown) => void) {
    const listener = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(`shrike:event:${channel}`, listener);
    return () => void ipcRenderer.removeListener(`shrike:event:${channel}`, listener);
  },
};
for (const m of methods) api[m] = (...args: unknown[]) => ipcRenderer.invoke(`shrike:${m}`, ...args);

// power: O1 point mode, O6 issue card, O13 images
const powerMethods = ["startPointMode", "cancelPointMode", "exportIssue", "showInFolder", "readFileDataUrl"] as const satisfies readonly Exclude<keyof ShrikeApi, "on">[];
for (const m of powerMethods) api[m] = (...args: unknown[]) => ipcRenderer.invoke(`shrike:${m}`, ...args);

// agent: A4 skills, A5 memory, A6 checkpoints, A11 watched-by, A13 diff comments
const agentMethods = ["listSkills", "getMemory", "removeMemory", "getCheckpoints", "rewindTo", "watchedBy", "reviseFix"] as const satisfies readonly Exclude<keyof ShrikeApi, "on">[];
for (const m of agentMethods) api[m] = (...args: unknown[]) => ipcRenderer.invoke(`shrike:${m}`, ...args);

// setup: D12 processes
const setupMethods = ["setProcesses", "setLiveUrl", "setAppSide", "signOutLive", "answerLiveLogin", "appPartition"] as const satisfies readonly Exclude<keyof ShrikeApi, "on">[];
for (const m of setupMethods) api[m] = (...args: unknown[]) => ipcRenderer.invoke(`shrike:${m}`, ...args);

// sdlc: L1–L7 rail, hidden moves, tests, saved commands
const sdlcMethods = ["getSdlc", "waiveReview", "startAgentWith", "reviewFix", "runTests", "listCommands"] as const satisfies readonly Exclude<keyof ShrikeApi, "on">[];
for (const m of sdlcMethods) api[m] = (...args: unknown[]) => ipcRenderer.invoke(`shrike:${m}`, ...args);

// git: G1–G6 ship, PRs, CI, conflicts, merge, sync
const gitMethods = ["gitState", "shipFix", "listPullRequests", "reviewPullRequest", "resolveConflicts", "explainCheck", "mergePullRequest", "syncWithMain"] as const satisfies readonly Exclude<keyof ShrikeApi, "on">[];
for (const m of gitMethods) api[m] = (...args: unknown[]) => ipcRenderer.invoke(`shrike:${m}`, ...args);

// skills: S1–S5, save as command
const skillMethods = ["runSkill", "answerSkillProposal", "saveAsSkill", "importClaudeSkills", "saveAsCommand", "editSkill", "claudeSkillsOffer", "getSkillLog", "noteSkillUse", "listSkillDrafts", "undoSkillLevel", "editSkillDraft"] as const satisfies readonly Exclude<keyof ShrikeApi, "on">[];
for (const m of skillMethods) api[m] = (...args: unknown[]) => ipcRenderer.invoke(`shrike:${m}`, ...args);

// action-recipes: S8
const recipeMethods = ["listRecipes", "saveRecipe", "resetRecipe"] as const satisfies readonly Exclude<keyof ShrikeApi, "on">[];
for (const m of recipeMethods) api[m] = (...args: unknown[]) => ipcRenderer.invoke(`shrike:${m}`, ...args);

// worktrees: W1 tabs, W3 race, W4 sandbox, W5 clean up
const worktreeMethods = ["listWorktrees", "createWorktree", "switchWorktree", "removeWorktree", "startRace", "adoptWorktreeFix", "trySandbox"] as const satisfies readonly Exclude<keyof ShrikeApi, "on">[];
for (const m of worktreeMethods) api[m] = (...args: unknown[]) => ipcRenderer.invoke(`shrike:${m}`, ...args);

// flows: B1–B4 flows and my MCP servers, sessions
const flowMethods = ["listFlows", "startFlowRecording", "stopFlowRecording", "runFlow", "setFlowWatch", "deleteFlow", "saveFlow", "listMyMcpServers", "lastSession"] as const satisfies readonly Exclude<keyof ShrikeApi, "on">[];
for (const m of flowMethods) api[m] = (...args: unknown[]) => ipcRenderer.invoke(`shrike:${m}`, ...args);

// voice: V1 helper, V3 Jev
const voiceMethods = ["voiceSend", "openVoiceSettings", "setWindowChrome", "voiceModels", "voiceModelAct", "voicePlan", "voicePlanWarm"] as const satisfies readonly Exclude<keyof ShrikeApi, "on">[];
for (const m of voiceMethods) api[m] = (...args: unknown[]) => ipcRenderer.invoke(`shrike:${m}`, ...args);

// branches: C1 branch, C2 map, C3 aside, C5 bring back
const branchMethods = ["listRuns", "getRunSteps", "retryRun", "branchRun", "askAside", "keepAside", "bringBack"] as const satisfies readonly Exclude<keyof ShrikeApi, "on">[];
for (const m of branchMethods) api[m] = (...args: unknown[]) => ipcRenderer.invoke(`shrike:${m}`, ...args);

// xray: X5 context map
const xrayMethods = ["getContextMap"] as const satisfies readonly Exclude<keyof ShrikeApi, "on">[];
for (const m of xrayMethods) api[m] = (...args: unknown[]) => ipcRenderer.invoke(`shrike:${m}`, ...args);

// inspector: I place inspector
const inspectorMethods = ["inspect"] as const satisfies readonly Exclude<keyof ShrikeApi, "on">[];
for (const m of inspectorMethods) api[m] = (...args: unknown[]) => ipcRenderer.invoke(`shrike:${m}`, ...args);

// start-agent: R1–R8 Run driven by Claude
const startMethods = ["getStartPlan", "startApp", "stopApp", "answerStart", "getStartSettings", "setStartSettings"] as const satisfies readonly Exclude<keyof ShrikeApi, "on">[];
for (const m of startMethods) api[m] = (...args: unknown[]) => ipcRenderer.invoke(`shrike:${m}`, ...args);

// progression: XP1–XP8
const progressMethods = ["getProgress", "saveImage"] as const satisfies readonly Exclude<keyof ShrikeApi, "on">[];
for (const m of progressMethods) api[m] = (...args: unknown[]) => ipcRenderer.invoke(`shrike:${m}`, ...args);

// chains: P1 up next, P2 schedules, P3 conditional chains, P4 chains are skills
const chainMethods = ["getChains", "queuePrompt", "editUpNext", "moveUpNext", "pauseUpNext", "answerMissed", "listChains", "startChain", "stopChain", "saveChain"] as const satisfies readonly Exclude<keyof ShrikeApi, "on">[];
for (const m of chainMethods) api[m] = (...args: unknown[]) => ipcRenderer.invoke(`shrike:${m}`, ...args);

// options: M1–M6 ask_options cards
const optionsMethods = ["getOptions", "answerOptions"] as const satisfies readonly Exclude<keyof ShrikeApi, "on">[];
for (const m of optionsMethods) api[m] = (...args: unknown[]) => ipcRenderer.invoke(`shrike:${m}`, ...args);

// pr-ci: PR1–PR8 the pull request and CI panel
const prMethods = ["prView", "prCheckJob", "prAct", "prAgent", "openLink"] as const satisfies readonly Exclude<keyof ShrikeApi, "on">[];
for (const m of prMethods) api[m] = (...args: unknown[]) => ipcRenderer.invoke(`shrike:${m}`, ...args);

// workspaces: WS1 rail, WS2 create dialog
const workspaceMethods = ["listWorkspaces", "addWorkspaceProject", "workspaceSources", "createWorkspace", "openWorkspace", "workspaceAction", "renameWorkspace", "deleteWorkspace"] as const satisfies readonly Exclude<keyof ShrikeApi, "on">[];
for (const m of workspaceMethods) api[m] = (...args: unknown[]) => ipcRenderer.invoke(`shrike:${m}`, ...args);

// scm: SC1–SC7 the Changes dock
const scmMethods = ["scmState", "scmDiff", "scmStage", "scmUnstage", "scmDiscard", "scmCommit", "scmUndoCommit", "scmWriteMessage", "scmSync", "scmCommitFiles", "scmOpenOnGitHub"] as const satisfies readonly Exclude<keyof ShrikeApi, "on">[];
for (const m of scmMethods) api[m] = (...args: unknown[]) => ipcRenderer.invoke(`shrike:${m}`, ...args);

// quests: QB1–QB9
const questMethods = ["listQuests", "planQuest", "listIssues", "importIssue", "questAct"] as const satisfies readonly Exclude<keyof ShrikeApi, "on">[];
for (const m of questMethods) api[m] = (...args: unknown[]) => ipcRenderer.invoke(`shrike:${m}`, ...args);

// review-lessons: RL1–RL9
const lessonMethods = ["reviewLessons", "refreshReviewLessons", "learnFromComment", "selfCheck", "fixSelfCheck"] as const satisfies readonly Exclude<keyof ShrikeApi, "on">[];
for (const m of lessonMethods) api[m] = (...args: unknown[]) => ipcRenderer.invoke(`shrike:${m}`, ...args);

// ci-lessons: CI1–CI8 pipeline map, CI lessons, pre-flight
const ciMethods = ["ciLessons", "ciLearn", "preflight", "stopPreflight", "ciFixLeg"] as const satisfies readonly Exclude<keyof ShrikeApi, "on">[];
for (const m of ciMethods) api[m] = (...args: unknown[]) => ipcRenderer.invoke(`shrike:${m}`, ...args);

// mcp: MCP1 to MCP8 the tools hub
const mcpMethods = ["mcpState", "mcpCheck", "mcpSetEnabled", "mcpTrust", "mcpAdd", "mcpRemove", "mcpFix", "mcpDismiss", "connectInfo", "connectResetToken"] as const satisfies readonly Exclude<keyof ShrikeApi, "on">[];
for (const m of mcpMethods) api[m] = (...args: unknown[]) => ipcRenderer.invoke(`shrike:${m}`, ...args);

// api: AP the API client
const apiMethods = ["apiCollections", "apiCreateCollection", "apiLinkCollection", "apiUnlinkCollection", "apiReadRequest", "apiSaveRequest", "apiDeleteItem", "apiCreateFolder", "apiRenameItem", "apiReadEnvironment", "apiSaveEnvironment", "apiSend", "apiCancel", "apiHistory", "apiClearHistory", "apiImport", "apiCode", "apiPickFile", "apiRoutes", "apiGuessRoutes", "apiSaveGuess"] as const satisfies readonly Exclude<keyof ShrikeApi, "on">[];
for (const m of apiMethods) api[m] = (...args: unknown[]) => ipcRenderer.invoke(`shrike:${m}`, ...args);

contextBridge.exposeInMainWorld("shrike", api as unknown as ShrikeApi);
