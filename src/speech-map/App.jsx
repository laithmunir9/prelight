import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addEdge,
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import { validateCoverage, validateSpeechGraph } from "../../speechMapCore.js";
import { apiJson, transcribeAudio } from "./api.js";
import { Icon } from "./icons.jsx";
import SpeechNode from "./SpeechNode.jsx";
import { clearWorkspace, loadTutorialProgress, loadWorkspace, saveTutorialProgress, saveWorkspace } from "./storage.js";

const NODE_TYPES = { speech: SpeechNode };
const EDGE_DEFAULTS = { type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 }, style: { stroke: "#8d94a5", strokeWidth: 1.4 } };
const ACTIONS = [
  ["clearer", "Make clearer"],
  ["shorten", "Shorten"],
  ["example", "Add an example"],
  ["alternative", "Alternative phrasing"],
];

const TUTORIAL_COMPLETE_KEY = "prelightStudioTutorialComplete";
const PURPOSE_OPTIONS = ["Startup pitch", "Interview answer", "Class presentation", "Project update"];
const TUTORIAL_STEPS = {
  1: {
    title: "What are you preparing for?",
    copy: "Start with the speaking moment. I’ll give you a small map to shape inside this workspace.",
    action: "Begin walkthrough",
  },
  2: {
    title: "Build the ideas you want to land",
    copy: "Each card is one idea, not a script. Rewrite the title or supporting line on any card to make this map yours.",
    action: "Show me rehearsal",
  },
  3: {
    title: "Rehearse the map, not a script",
    copy: "Use Rehearse in the top-right. For this walkthrough, I’ll show you a local coverage preview without requesting your microphone.",
    action: null,
  },
  4: {
    title: "See what actually landed",
    copy: "After a take, every idea is marked covered, partial, or missed. Select a card to see the matching transcript evidence.",
    action: "Finish tutorial",
  },
};

function makeTutorialGraph() {
  const ideas = [
    ["hook", "Hook", "Open with the moment that makes this worth hearing.", "point"],
    ["main-point", "Main point", "State the one idea you want the audience to remember.", "point"],
    ["example", "Example", "Make the idea concrete with one short example.", "example"],
    ["close", "Close", "End with the next step you want from the audience.", "closing"],
  ];
  return {
    nodes: ideas.map(([id, title, content, type], index) => ({ id, title, content, type, position: { x: 80, y: index * 155 } })),
    edges: ideas.slice(1).map(([id], index) => ({ id: `edge-${ideas[index][0]}-${id}`, source: ideas[index][0], target: id })),
  };
}

function titleFromPurpose(purpose) {
  const words = String(purpose).trim().split(/\s+/).slice(0, 6).join(" ");
  return words ? words[0].toUpperCase() + words.slice(1) : "Untitled speech";
}

function formatTime(seconds = 0) {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function stripGraph(nodes, edges) {
  return {
    nodes: nodes.map(({ id, position, data }) => ({ id, position, title: data.title, content: data.content, type: data.type })),
    edges: edges.map(({ id, source, target }) => ({ id, source, target })),
  };
}

function Onboarding({ guided, onGenerated, onBlank }) {
  const [purpose, setPurpose] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const generate = async (event) => {
    event.preventDefault();
    if (!purpose.trim()) return setError("Describe the moment you are preparing for.");
    if (guided) {
      onGenerated(makeTutorialGraph(), purpose.trim());
      return;
    }
    setLoading(true); setError("");
    try {
      const result = validateSpeechGraph(await apiJson("/api/speech-map/generate", { purpose: purpose.trim() }));
      onGenerated(result, purpose.trim());
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };
  return (
    <main className="onboarding">
      <a className="onboarding-brand" href="/"><img src="/prelight-mascot.png" alt=""/>Prelight</a>
      <section className="onboarding-card">
        <div className="onboarding-character">
          <span>{guided ? "First, tell me what you’re preparing for." : "Let’s shape your next talk."}</span>
          <img className="onboarding-guide" src="/prelight-mascot.png" alt="Prelight" />
        </div>
        {guided ? <div className="onboarding-step">Prelight · Step 1 of 4</div> : null}
        <h1>What are you preparing for?</h1>
        <p>Start with the ideas you want to land. You can change everything afterward.</p>
        <form onSubmit={generate}>
          <label htmlFor="purpose">Speaking moment</label>
          <input id="purpose" autoFocus value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="3-minute startup pitch for Prelight" maxLength={400}/>
          <button className="primary large" disabled={loading}>{loading ? "Building your outline…" : "Generate outline"}</button>
        </form>
        <button className="text-action" onClick={() => onBlank(purpose.trim())}>Start from blank</button>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </section>
    </main>
  );
}

function TutorialGuide({ step, purpose, canAdvance, onPurposeChange, onNext, onBack, onExit }) {
  const content = TUTORIAL_STEPS[step];
  if (!content) return null;
  return (
    <>
      <div className={`tutorial-scrim tutorial-scrim--step-${step}`} aria-hidden="true" />
      <aside className={`tutorial-guide tutorial-guide--step-${step}`} aria-label={`Prelight tutorial step ${step} of 4`} aria-live="polite">
      <img src="/prelight-mascot.png" alt="" />
      <div className="tutorial-guide-body">
        <button className="tutorial-close" onClick={onExit} aria-label="End tutorial">×</button>
        <div className="tutorial-guide-meta"><strong>Prelight</strong><span>Step {step} of 4</span></div>
        <h2>{content.title}</h2>
        <p>{content.copy}</p>
        {step === 2 && !canAdvance ? <p className="tutorial-requirement">Edit the title or supporting line on any card to unlock the next step.</p> : null}
        {step === 1 ? (
          <div className="tutorial-setup">
            <label className="tutorial-purpose" htmlFor="tutorial-purpose">
              <span>Speaking moment</span>
              <input
                id="tutorial-purpose"
                autoFocus
                value={purpose}
                onChange={(event) => onPurposeChange(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter" && purpose.trim()) onNext(); }}
                placeholder="Say what you want to prepare for"
                maxLength={400}
              />
            </label>
            <span className="tutorial-or">Or choose one</span>
            <div className="tutorial-purpose-options" aria-label="Suggested speaking moments">
              {PURPOSE_OPTIONS.map((option) => (
                <button key={option} className={purpose === option ? "selected" : ""} onClick={() => onPurposeChange(option)}>{option}</button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="tutorial-guide-actions">
          {step > 1 ? <button className="tutorial-back" onClick={onBack}>Back</button> : <span />}
          {content.action ? <button className="primary" onClick={onNext} disabled={step === 1 && !purpose.trim()}>{content.action}</button> : null}
        </div>
        {step > 1 ? <button className="tutorial-exit" onClick={onExit}>Exit walkthrough</button> : null}
      </div>
      </aside>
    </>
  );
}

function DeliveryPanel({ take, onClose }) {
  const features = take?.features;
  return (
    <aside className="inspector delivery-panel">
      <div className="inspector-heading"><div><span className="section-label">Delivery</span><h2>{take?.label || "Latest rehearsal"}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close delivery"><Icon name="close"/></button></div>
      {!take ? <div className="quiet-empty"><p>Rehearse once to see optional delivery measurements.</p></div> : !features ? <div className="quiet-empty"><p>Delivery measurements were unavailable for this take. Your transcript and coverage are still saved.</p></div> : (
        <>
          <p className="inspector-copy">A lightweight local read on how the take sounded. Coverage stays the main review.</p>
          <dl className="delivery-metrics">
            <div><dt>Duration</dt><dd>{formatTime(take.duration)}</dd></div>
            <div><dt>Pauses</dt><dd>{features.pauses?.length ?? "N/A"}</dd></div>
            <div><dt>Pitch variation</dt><dd>{Number.isFinite(features.pitchVariability) ? `${Math.round(features.pitchVariability)} Hz` : "N/A"}</dd></div>
            <div><dt>Silence</dt><dd>{Number.isFinite(features.silenceRatio) ? `${Math.round(features.silenceRatio * 100)}%` : "N/A"}</dd></div>
          </dl>
        </>
      )}
    </aside>
  );
}

function Workspace() {
  const entryParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const guidedEntry = entryParams.get("tour") === "1";
  const continuedFromTutorial = entryParams.get("from") === "tutorial";
  const stored = useMemo(() => guidedEntry ? loadTutorialProgress() : loadWorkspace(), [guidedEntry]);
  const [ready, setReady] = useState(Boolean(stored) || guidedEntry);
  const [title, setTitle] = useState(stored?.title || (guidedEntry ? "Your speaking moment" : "Untitled speech"));
  const [purpose, setPurpose] = useState(stored?.purpose || "");
  const [takes, setTakes] = useState(stored?.takes || []);
  const [selectedId, setSelectedId] = useState(null);
  const [activeTakeId, setActiveTakeId] = useState(stored?.takes?.[0]?.id || null);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [processing, setProcessing] = useState("");
  const [notice, setNotice] = useState(continuedFromTutorial ? "Your map is right where you left it. Rehearse when you’re ready." : "");
  const [editingAction, setEditingAction] = useState("");
  const [tutorialStep, setTutorialStep] = useState(guidedEntry ? (stored?.step || 1) : 0);
  const [tutorialNodeEdited, setTutorialNodeEdited] = useState(guidedEntry ? Boolean(stored?.nodeEdited) : false);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef(null);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState((stored?.edges || []).map((edge) => ({ ...edge, ...EDGE_DEFAULTS })));

  const updateNode = useCallback((id, patch) => {
    setNodes((current) => current.map((node) => node.id === id ? { ...node, data: { ...node.data, ...patch } } : node));
    if (tutorialStep === 2 && (Object.hasOwn(patch, "title") || Object.hasOwn(patch, "content"))) setTutorialNodeEdited(true);
  }, [setNodes, tutorialStep]);
  const deleteNode = useCallback((id) => {
    setNodes((current) => current.filter((node) => node.id !== id));
    setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id));
    setSelectedId((current) => current === id ? null : current);
  }, [setEdges, setNodes]);
  const duplicateNode = useCallback((id) => setNodes((current) => {
    const source = current.find((node) => node.id === id);
    if (!source) return current;
    const nextId = `idea-${Date.now()}`;
    return [...current, { ...source, id: nextId, selected: false, position: { x: source.position.x + 42, y: source.position.y + 150 }, data: { ...source.data, title: `${source.data.title} copy`, status: null, evidence: null } }];
  }), [setNodes]);
  const branchNode = useCallback((id) => {
    const nextId = `idea-${Date.now()}`;
    setNodes((current) => {
      const source = current.find((node) => node.id === id);
      if (!source) return current;
      return [...current, makeFlowNode({ id: nextId, title: "New branch", content: "Add the supporting idea here.", type: "point", position: { x: source.position.x + 285, y: source.position.y + 155 } })];
    });
    setEdges((current) => addEdge({ id: `edge-${id}-${nextId}`, source: id, target: nextId, ...EDGE_DEFAULTS }, current));
    setSelectedId(nextId);
  }, [setEdges, setNodes]);

  const handlersRef = useRef({});
  handlersRef.current = { onUpdate: updateNode, onDelete: deleteNode, onDuplicate: duplicateNode, onBranch: branchNode };
  function makeFlowNode(node) {
    return {
      id: node.id,
      type: "speech",
      position: node.position,
      data: {
        title: node.title,
        content: node.content,
        type: node.type,
        status: node.status || null,
        evidence: node.evidence || null,
        onUpdate: (...args) => handlersRef.current.onUpdate(...args),
        onDelete: (...args) => handlersRef.current.onDelete(...args),
        onDuplicate: (...args) => handlersRef.current.onDuplicate(...args),
        onBranch: (...args) => handlersRef.current.onBranch(...args),
      },
    };
  }

  useEffect(() => {
    if (stored) {
      setNodes(stored.nodes.map(makeFlowNode));
      if (guidedEntry) setSelectedId(stored.nodes[0]?.id || null);
      return;
    }
    if (guidedEntry) {
      const graph = makeTutorialGraph();
      setNodes(graph.nodes.map(makeFlowNode));
      setEdges(graph.edges.map((edge) => ({ ...edge, ...EDGE_DEFAULTS })));
      setSelectedId(graph.nodes[0]?.id || null);
    }
  }, []); // The stored snapshot is intentionally read once.

  useEffect(() => {
    if (!ready) return;
    const timeout = setTimeout(() => {
      try {
        const snapshot = { title, purpose, nodes, edges, takes };
        if (guidedEntry) saveTutorialProgress({ ...snapshot, step: tutorialStep, nodeEdited: tutorialNodeEdited });
        else saveWorkspace(snapshot);
      }
      catch (error) { console.warn("Speech map could not be saved", error); }
    }, 180);
    return () => clearTimeout(timeout);
  }, [ready, title, purpose, nodes, edges, takes, guidedEntry, tutorialStep, tutorialNodeEdited]);

  useEffect(() => () => {
    clearInterval(timerRef.current);
    recorderRef.current?.stream?.getTracks().forEach((track) => track.stop());
  }, []);

  const initialize = (graph, nextPurpose) => {
    setTitle(titleFromPurpose(nextPurpose));
    setPurpose(nextPurpose);
    setNodes(graph.nodes.map(makeFlowNode));
    setEdges(graph.edges.map((edge) => ({ ...edge, ...EDGE_DEFAULTS })));
    setReady(true);
    if (guidedEntry) setTutorialStep(2);
  };

  const selectedNode = nodes.find((node) => node.id === selectedId) || null;
  const activeTake = takes.find((take) => take.id === activeTakeId) || takes[0] || null;

  const addNode = useCallback(() => {
    const index = nodes.length;
    const id = `idea-${Date.now()}`;
    setNodes((current) => [...current, makeFlowNode({ id, title: "New idea", content: "Say what you want to land.", type: "point", position: { x: 100 + (index % 3) * 285, y: 100 + Math.floor(index / 3) * 190 } })]);
    setSelectedId(id);
  }, [nodes.length, setNodes]);

  const onConnect = useCallback((connection) => setEdges((current) => addEdge({ ...connection, ...EDGE_DEFAULTS }, current)), [setEdges]);

  const applyTake = (take) => {
    const byId = new Map((take.coverage || []).map((item) => [item.id, item]));
    setNodes((current) => current.map((node) => {
      const coverage = byId.get(node.id);
      return { ...node, data: { ...node.data, status: coverage?.status || null, evidence: coverage?.evidence || null } };
    }));
    setActiveTakeId(take.id);
  };

  async function extractFeatures(blob) {
    if (!window.SpeechProfiler?.extractFeatures) return null;
    let context;
    try {
      context = new AudioContext();
      const buffer = await context.decodeAudioData(await blob.arrayBuffer());
      return window.SpeechProfiler.extractFeatures(buffer.getChannelData(0), buffer.sampleRate);
    } catch { return null; }
    finally { if (context) await context.close(); }
  }

  async function finishRecording(blob, duration) {
    setRecording(false);
    clearInterval(timerRef.current);
    setProcessing("Transcribing your rehearsal…");
    const metadata = { mimeType: blob.type || "audio/webm", bytes: blob.size, recordedAt: new Date().toISOString() };
    const featuresPromise = extractFeatures(blob);
    let transcript = "";
    try {
      transcript = await transcribeAudio(blob, duration);
    } catch (error) {
      setProcessing(""); setNotice(error.message); return;
    }

    const baseTake = { id: `take-${Date.now()}`, label: `Take ${takes.length + 1}`, transcript, duration, metadata, features: await featuresPromise, coverage: [], createdAt: metadata.recordedAt };
    setProcessing("Checking your map coverage…");
    try {
      const graph = stripGraph(nodes, edges);
      const coverage = validateCoverage(await apiJson("/api/speech-map/coverage", { transcript, nodes: graph.nodes }), graph.nodes).nodes;
      const completeTake = { ...baseTake, coverage };
      setTakes((current) => [completeTake, ...current]);
      applyTake(completeTake);
      setNotice("Rehearsal saved. Your map now shows what you covered.");
    } catch (error) {
      setTakes((current) => [baseTake, ...current]);
      setActiveTakeId(baseTake.id);
      setNotice(error.message);
    } finally { setProcessing(""); }
  }

  async function startRecording() {
    setNotice("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorder.stream = stream;
      chunksRef.current = [];
      startedAtRef.current = performance.now();
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const duration = (performance.now() - startedAtRef.current) / 1000;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        stream.getTracks().forEach((track) => track.stop());
        finishRecording(blob, duration);
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecordingSeconds(0); setRecording(true);
      timerRef.current = setInterval(() => setRecordingSeconds((performance.now() - startedAtRef.current) / 1000), 250);
    } catch { setNotice("Microphone access is needed to rehearse aloud."); }
  }

  function handleRehearse() {
    if (tutorialStep !== 3) {
      startRecording();
      return;
    }
    const preview = [
      ["covered", "You opened with a clear reason to listen."],
      ["covered", "Your main point came through directly."],
      ["partial", "You mentioned the example but could make it more concrete."],
      ["missed", null],
    ];
    setNodes((current) => current.map((node, index) => ({
      ...node,
      data: { ...node.data, status: preview[index]?.[0] || "covered", evidence: preview[index]?.[1] || null },
    })));
    setSelectedId(nodes[0]?.id || null);
    setNotice("Coverage preview ready. Select any idea to inspect what landed.");
    setTutorialStep(4);
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  async function editSelected(action) {
    if (!selectedNode || editingAction) return;
    setEditingAction(action); setNotice("");
    try {
      const result = await apiJson("/api/speech-map/edit-node", { action, node: selectedNode.data });
      updateNode(selectedNode.id, result);
    } catch (error) { setNotice(error.message); }
    finally { setEditingAction(""); }
  }

  function newWorkspace() {
    if (!window.confirm("Start a new speaking map? Your current local workspace will be cleared.")) return;
    clearWorkspace();
    window.location.reload();
  }

  function advanceTutorial() {
    if (tutorialStep === 1) {
      if (!purpose.trim()) return;
      setTitle(titleFromPurpose(purpose));
      setTutorialStep(2);
      return;
    }
    if (tutorialStep === 2 && !tutorialNodeEdited) {
      setSelectedId(nodes[0]?.id || null);
      setNotice("Edit the title or supporting line on any card, then choose Show me rehearsal again.");
      window.requestAnimationFrame(() => document.querySelector(".speech-node .node-title")?.focus());
      return;
    }
    if (tutorialStep < 4) {
      setTutorialStep((step) => step + 1);
      return;
    }
    try { localStorage.setItem(TUTORIAL_COMPLETE_KEY, JSON.stringify(true)); } catch {}
    window.location.assign("/");
  }

  function backTutorial() {
    setTutorialStep((step) => Math.max(1, step - 1));
  }

  function exitTutorial() {
    if (!window.confirm("End the walkthrough and return to the Prelight home screen?")) return;
    window.location.assign("/");
  }

  if (!ready) return <Onboarding guided={guidedEntry} onGenerated={initialize} onBlank={(nextPurpose) => initialize({ nodes: [], edges: [] }, nextPurpose)} />;

  return (
    <main className="workspace-shell">
      <header className="topbar">
        <a className="brand" href="/"><img src="/prelight-mascot.png" alt=""/>Prelight</a>
        <span className="top-divider" />
        <input className="workspace-title" aria-label="Workspace title" value={title} onChange={(event) => setTitle(event.target.value)} />
        <div className="top-actions">
          <button className="secondary" onClick={() => setDeliveryOpen((value) => !value)}><Icon name="delivery"/>Delivery</button>
          <button className={`primary ${tutorialStep === 3 ? "tutorial-target" : ""}`} onClick={handleRehearse} disabled={!nodes.length || recording || Boolean(processing)} title={!nodes.length ? "Add an idea before rehearsing" : "Start rehearsal"}><Icon name="mic"/>{processing ? "Reviewing…" : "Rehearse"}</button>
        </div>
      </header>

      <aside className="outline-rail">
        <div className="rail-header"><span>Outline</span><span>{nodes.length}</span></div>
        <nav className="outline-list" aria-label="Speech outline">
          {nodes.map((node) => <button key={node.id} className={node.id === selectedId ? "active" : ""} onClick={() => setSelectedId(node.id)}><span className={`outline-dot status-${node.data.status || "planned"}`}/><span>{node.data.title || "Untitled idea"}</span></button>)}
        </nav>
        <button className="add-idea" onClick={addNode}><Icon name="plus"/>Add idea</button>
        <div className="prelight-guide" aria-live="polite">
          <img src="/prelight-mascot.png" alt="Prelight" />
          <p>{selectedNode?.data.status === "missed"
            ? "That idea did not make this take. Keep it for the next one, or edit the map."
            : selectedNode?.data.status === "partial"
              ? "You touched this idea. Open it up if it needs to land more clearly."
              : takes.length
                ? "Pick any idea to see exactly where it showed up in your rehearsal."
                : "Shape the ideas first. When the map feels right, rehearse it out loud."}</p>
        </div>
        <div className="rehearsal-history">
          <div className="history-title"><span>Rehearsals</span><Icon name="history" size={15}/></div>
          {takes.length ? takes.map((take) => <button key={take.id} className={take.id === activeTakeId ? "active" : ""} onClick={() => applyTake(take)}><span>{take.label}</span><small>{formatTime(take.duration)}</small></button>) : <p>Your takes will appear here.</p>}
        </div>
        <button className="new-workspace" onClick={newWorkspace}>New map</button>
      </aside>

      <section className="canvas" aria-label="Speaking map editor">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => setSelectedId(node.id)}
          onPaneClick={() => setSelectedId(null)}
          fitView
          fitViewOptions={{ padding: 0.24, maxZoom: 1.05 }}
          minZoom={0.35}
          maxZoom={1.6}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={EDGE_DEFAULTS}
          deleteKeyCode={["Backspace", "Delete"]}
        >
          <Background color="#4d5671" gap={22} size={1} />
          <Controls showInteractive={false} position="bottom-left" />
        </ReactFlow>
        {!nodes.length ? <div className="blank-canvas"><h2>Start with one idea.</h2><p>Add the first point you want your audience to remember.</p><button className="primary" onClick={addNode}><Icon name="plus"/>Add idea</button></div> : null}
        {notice ? <button className="notice" onClick={() => setNotice("")} aria-label="Dismiss message">{notice}<Icon name="close" size={14}/></button> : null}
        {processing ? <div className="processing"><span className="spinner"/>{processing}</div> : null}
      </section>

      {deliveryOpen ? <DeliveryPanel take={activeTake} onClose={() => setDeliveryOpen(false)} /> : (
        <aside className={`inspector ${tutorialStep === 4 ? "tutorial-target" : ""}`}>
          {selectedNode ? (
            <>
              <div className="inspector-heading"><div><span className="section-label">{selectedNode.data.type}</span><h2>{selectedNode.data.title}</h2></div><button className="icon-button" onClick={() => setSelectedId(null)} aria-label="Close inspector"><Icon name="close"/></button></div>
              <section><h3>Planned</h3><p>{selectedNode.data.content || "Add the idea you want to land."}</p></section>
              <section><h3>Coverage</h3>{selectedNode.data.status ? <div className={`coverage-summary status-${selectedNode.data.status}`}><span>{selectedNode.data.status}</span><small>{activeTake?.label}</small></div> : <p className="muted">Rehearse to check this idea.</p>}</section>
              <section><h3>Transcript evidence</h3>{selectedNode.data.evidence ? <blockquote>“{selectedNode.data.evidence}”</blockquote> : <p className="muted">{selectedNode.data.status === "missed" ? "No matching excerpt in this take." : "No evidence yet."}</p>}</section>
              <section><h3>Refine this idea</h3><div className="node-actions">{ACTIONS.map(([value, label]) => <button key={value} onClick={() => editSelected(value)} disabled={Boolean(editingAction)}>{editingAction === value ? "Editing…" : label}</button>)}</div></section>
            </>
          ) : activeTake ? (
            <>
              <div className="inspector-heading"><div><span className="section-label">Rehearsal</span><h2>{activeTake.label}</h2></div></div>
              <section><h3>Duration</h3><p>{formatTime(activeTake.duration)}</p></section>
              <section><h3>Transcript</h3><p className="transcript">{activeTake.transcript}</p></section>
              <p className="inspector-hint">Select a node to inspect its planned idea and transcript evidence.</p>
            </>
          ) : <div className="quiet-empty"><img className="empty-guide" src="/prelight-mascot.png" alt=""/><h2>Your map is ready.</h2><p>Select a node to edit it, or rehearse to see what you covered.</p></div>}
        </aside>
      )}

      {recording ? <div className="recording-bar" role="status"><img src="/prelight-mascot.png" alt=""/><span className="recording-pulse"/><div><strong>Rehearsing</strong><span>{formatTime(recordingSeconds)}</span></div><button onClick={stopRecording}><Icon name="stop" size={16}/>Stop</button></div> : null}
      {tutorialStep >= 1 ? <TutorialGuide step={tutorialStep} purpose={purpose} canAdvance={tutorialNodeEdited} onPurposeChange={setPurpose} onNext={advanceTutorial} onBack={backTutorial} onExit={exitTutorial} /> : null}
    </main>
  );
}

export default function App() {
  return <ReactFlowProvider><Workspace /></ReactFlowProvider>;
}
