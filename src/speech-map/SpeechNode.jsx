import { memo } from "react";
import { Handle, NodeToolbar, Position } from "@xyflow/react";
import { Icon } from "./icons.jsx";

const TYPE_LABELS = { point: "Point", example: "Example", evidence: "Evidence", transition: "Transition", question: "Question", closing: "Closing" };

function SpeechNode({ id, data, selected }) {
  const update = (patch) => data.onUpdate(id, patch);
  const stop = (event) => event.stopPropagation();
  return (
    <div className={`speech-node speech-node--${data.status || "planned"} ${selected ? "is-selected" : ""}`}>
      <NodeToolbar className="node-toolbar" isVisible={selected} position={Position.Top} offset={10}>
        <button title="Add branch" onClick={() => data.onBranch(id)}><Icon name="branch" size={16}/></button>
        <button title="Duplicate" onClick={() => data.onDuplicate(id)}><Icon name="copy" size={16}/></button>
        <label title="Change node type">
          <span className="sr-only">Node type</span>
          <select value={data.type} onChange={(event) => update({ type: event.target.value })} onPointerDown={stop}>
            {Object.entries(TYPE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </label>
        <button title="Delete" className="danger" onClick={() => data.onDelete(id)}><Icon name="trash" size={16}/></button>
      </NodeToolbar>
      <Handle type="target" position={Position.Left} />
      <div className="node-kind">{TYPE_LABELS[data.type] || "Point"}</div>
      <input
        className="node-title nodrag"
        aria-label="Idea title"
        value={data.title}
        onChange={(event) => update({ title: event.target.value })}
      />
      <textarea
        className="node-content nodrag nowheel"
        aria-label="Idea content"
        value={data.content}
        rows={3}
        onChange={(event) => update({ content: event.target.value })}
      />
      {data.status ? <div className={`coverage-tag coverage-tag--${data.status}`}>{data.status}</div> : null}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export default memo(SpeechNode);
