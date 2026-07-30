import type { Agent } from '../types';

interface Props {
  agents: Agent[];
  /** Per-agent status hue, memoized in NexusView — same values the clusters use. */
  colors: string[];
  onOpen: (view: string) => void;
}

// Fleet roster — the second door into every agent. The brain in the middle is
// the pretty way in; this is the fast way in. Both call the same onOpen, so a
// row click and a cluster click land on the identical page.
//
// Chrome deliberately mirrors SatWatch (which sits directly above it): the home
// stage does NOT carry .ops-theme, so the spy palette — green on black, hard
// corners, tiny letter-spaced mono — is the theme here, not the ops green skin.
export function AgentRoster({ agents, colors, onOpen }: Props) {
  return (
    <div
      className="nx-roster"
      // The canvas owns the drag; without this a click here starts a pan.
      onPointerDown={(e) => e.stopPropagation()}
      // Keep the canvas from running its cluster hit-test while the cursor is
      // in the list — otherwise the brain flares nodes as you read the roster.
      onPointerMove={(e) => e.stopPropagation()}
      // ...and keep a scroll over the list from diving the camera instead.
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="nxr-head">
        <span>FLEET ROSTER</span>
        <span className="nxr-count">{agents.length}</span>
      </div>

      <div className="nxr-body">
        <button
          className="nxr-row nxr-core"
          onClick={(e) => { e.stopPropagation(); onOpen('core'); }}
          title="Enter the command room"
        >
          <span className="nxr-glyph">◆</span>
          <span className="nxr-name">CORE</span>
        </button>

        {agents.map((a, i) => (
          <button
            key={a.id}
            className={`nxr-row ${a.status}`}
            onClick={(e) => { e.stopPropagation(); onOpen(a.id); }}
            title={a.description}
          >
            <span className="nxr-dot" style={{ ['--c' as any]: colors[i] }} />
            <span className="nxr-name">{a.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
